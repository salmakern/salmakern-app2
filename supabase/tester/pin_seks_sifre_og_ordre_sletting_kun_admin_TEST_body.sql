-- Test for 20261116200000_pin_seks_sifre_og_ordre_sletting_kun_admin.sql.
-- ÉN DO-blokk som ALLTID ender med en exception (meldingen er resultatet), så alt rulles tilbake:
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file supabase/tester/pin_seks_sifre_og_ordre_sletting_kun_admin_TEST_body.sql
-- Forventet: «TEST_OK ... 11 kontroller bestått, 0 feil». Blokken bruker en ekte ansatts og en ekte admins sesjon
-- KUN som claims i denne transaksjonen (ingenting skrives), og slår av triggerne på ordrer i transaksjonen
-- (ingen push/varsler). Er migrasjonen ikke kjørt ennå, legges endringene inn i transaksjonen først.
do $$
declare
  v_anvend boolean := not exists (select 1 from pg_policies where schemaname='public' and tablename='ordrer' and policyname='ordrer_slette_kun_admin');
  v_ansatt record; v_admin record; v_ordre text; n integer; feil text[] := '{}'; ok integer := 0;
begin
  if v_anvend then
    alter table public.ansatte_pin add constraint ansatte_pin_seks_sifre check (pin ~ '^[0-9]{6}$');
    drop policy krever_innlogget_ansatt on public.ordrer;
    create policy ordrer_lese on public.ordrer for select using (exists (select 1 from current_ansatt()));
    create policy ordrer_opprette on public.ordrer for insert with check (exists (select 1 from current_ansatt()));
    create policy ordrer_endre on public.ordrer for update using (exists (select 1 from current_ansatt())) with check (exists (select 1 from current_ansatt()));
    create policy ordrer_slette_kun_admin on public.ordrer for delete using (exists (select 1 from current_ansatt() where rolle = 'admin'));
  end if;
  alter table public.ordrer disable trigger user;

  -- PIN: kort PIN kan ikke settes, 6 sifre kan
  begin
    update ansatte_pin set pin = '1234' where ansatt_id = (select min(ansatt_id) from ansatte_pin);
    feil := feil || 'kort PIN ble godtatt'::text;
  exception when check_violation then ok := ok + 1; end;
  begin
    update ansatte_pin set pin = '12a456' where ansatt_id = (select min(ansatt_id) from ansatte_pin);
    feil := feil || 'PIN med bokstav ble godtatt'::text;
  exception when check_violation then ok := ok + 1; end;
  begin
    update ansatte_pin set pin = pin where ansatt_id = (select min(ansatt_id) from ansatte_pin);
    ok := ok + 1;
  exception when others then feil := feil || ('gyldig PIN avvist: ' || sqlerrm); end;

  select id, session_token into v_ansatt from ansatte where aktiv and rolle = 'ansatt' and session_token is not null and not flere_enheter order by id limit 1;
  select id, session_token into v_admin  from ansatte where aktiv and rolle = 'admin'  and session_token is not null order by id limit 1;
  select id into v_ordre from ordrer order by id limit 1;
  if v_ansatt.id is null or v_admin.id is null or v_ordre is null then raise exception 'TEST_AVBRUTT: fant ikke ansatt/admin/ordre å teste med'; end if;

  -- Vanlig ansatt
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','ansatt_id',v_ansatt.id,'session_token',v_ansatt.session_token)::text, true);
  set local role authenticated;
  select count(*) into n from ordrer;
  if n > 0 then ok := ok + 1; else feil := feil || 'ansatt kan ikke lese ordrer'::text; end if;
  update ordrer set kunde = kunde where id = v_ordre; get diagnostics n = row_count;
  if n = 1 then ok := ok + 1; else feil := feil || 'ansatt kan ikke endre ordre'::text; end if;
  begin
    insert into ordrer (id) values ('ord_TEST_rls_1'); get diagnostics n = row_count;
    if n = 1 then ok := ok + 1; else feil := feil || 'ansatt kan ikke opprette ordre'::text; end if;
  exception when others then feil := feil || ('ansatt: opprettelse feilet: ' || sqlerrm); end;
  delete from ordrer where id = v_ordre; get diagnostics n = row_count;
  if n = 0 then ok := ok + 1; else feil := feil || 'ANSATT KUNNE SLETTE EN ORDRE'::text; end if;
  delete from ordrer where id = 'ord_TEST_rls_1'; get diagnostics n = row_count;
  if n = 0 then ok := ok + 1; else feil := feil || 'ANSATT KUNNE SLETTE EGEN NY ORDRE'::text; end if;
  reset role;

  -- Ikke innlogget (anonym Auth-sesjon uten ansatt)
  perform set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from ordrer;
  if n = 0 then ok := ok + 1; else feil := feil || 'UINNLOGGET KAN LESE ORDRER'::text; end if;
  delete from ordrer where id = v_ordre; get diagnostics n = row_count;
  if n = 0 then ok := ok + 1; else feil := feil || 'UINNLOGGET KUNNE SLETTE'::text; end if;
  reset role;

  -- Admin
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','ansatt_id',v_admin.id,'session_token',v_admin.session_token)::text, true);
  set local role authenticated;
  delete from ordrer where id = 'ord_TEST_rls_1'; get diagnostics n = row_count;
  if n = 1 then ok := ok + 1; else feil := feil || 'admin kan ikke slette ordre'::text; end if;
  reset role;

  raise exception 'TEST_OK (alt rullet tilbake): % kontroller bestått, % feil %', ok, coalesce(array_length(feil,1),0), feil;
end $$;
