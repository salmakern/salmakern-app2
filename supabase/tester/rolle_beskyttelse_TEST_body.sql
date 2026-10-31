-- Test av beskyttelsen mot rolle-eskalering og mot kall uten ansatt-sesjon (s08-017; trigger fra 20261029120000_hindre_selv_rolleendring.sql,
-- admin-rutinene bruker current_ansatt()). ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, og Realtime sender aldri rader fra en tilbakerullet transaksjon.
-- Bruker TEST-ansatte lagd i selve transaksjonen (id 990001 ansatt, 990002 godkjenner, 990003 admin, 990004 forsøksrad) - ingen ekte ansatt-rader leses eller endres.
-- Kallene gjøres som i PostgREST: databaserolle byttes (authenticated/anon/service_role) og request.jwt.claims settes, så RLS og triggere gjelder på ekte
-- (en test som kjører som postgres ville omgått RLS og ikke bevist noe). En forfalsket JWT (feil signatur) avvises før databasen av PostgREST; det testes separat mot det ekte API-et.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/tester/rolle_beskyttelse_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle T-linjer skal ha resultat OK. «INFO»-linjer er kartlegging (ikke krav): de viser hva som faktisk er mulig i dag.

create temp table _res (n serial, navn text, ok boolean, info text);

-- Kjører én setning som en gitt databaserolle med gitte JWT-claims og gir 'OK rader=N' eller feilmeldingen.
create function pg_temp._som(p_rolle text, p_claims jsonb, p_stmt text) returns text
language plpgsql as $f$
declare v_n int; v_ut text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute format('set local role %I', p_rolle);
  begin
    execute p_stmt;
    get diagnostics v_n = row_count;
    v_ut := 'OK rader=' || v_n;
  exception when others then
    v_ut := sqlerrm;
  end;
  execute 'reset role';
  return v_ut;
end;
$f$;

-- Hva current_ansatt() gir for en gitt rolle og claims ('id:rolle' eller 'ingen').
create function pg_temp._ca(p_rolle text, p_claims jsonb) returns text
language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute format('set local role %I', p_rolle);
  begin
    select coalesce(string_agg(id::text || ':' || rolle, ','), 'ingen') into v from public.current_ansatt();
  exception when others then
    v := sqlerrm;
  end;
  execute 'reset role';
  return v;
end;
$f$;

-- Antall rader en gitt rolle ser (kun tall, aldri innhold).
create function pg_temp._tell(p_rolle text, p_claims jsonb, p_stmt text) returns text
language plpgsql as $f$
declare v bigint; v_ut text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute format('set local role %I', p_rolle);
  begin
    execute p_stmt into v;
    v_ut := v::text;
  exception when others then
    v_ut := sqlerrm;
  end;
  execute 'reset role';
  return v_ut;
end;
$f$;

create temp table _kallere (navn text, rolle text, claims jsonb);

do $test$
declare
  c_ans jsonb := jsonb_build_object('role', 'authenticated', 'ansatt_id', 990001, 'session_token', 'TEST-tok-ans');
  c_godk jsonb := jsonb_build_object('role', 'authenticated', 'ansatt_id', 990002, 'session_token', 'TEST-tok-godk');
  c_admin jsonb := jsonb_build_object('role', 'authenticated', 'ansatt_id', 990003, 'session_token', 'TEST-tok-admin');
  c_forfalsket_rolle jsonb := jsonb_build_object('role', 'authenticated', 'ansatt_id', 990001, 'session_token', 'TEST-tok-ans', 'rolle', 'admin');
  c_feil_token jsonb := jsonb_build_object('role', 'authenticated', 'ansatt_id', 990003, 'session_token', 'GJETTET-TOKEN');
  c_service jsonb := jsonb_build_object('role', 'service_role');
  c_anon jsonb := jsonb_build_object('role', 'anon');
  c_uinnlogget jsonb := jsonb_build_object('role', 'authenticated');
  v text; v_rolle text; v_avvik text := ''; v_antall int := 0; k record; s text;
  v_rpc text[] := array[
    'select public.admin_sett_pin(990001, ''0000'')',
    'select public.opprett_ansatt(990004, ''TEST - forsøk'', ''admin'', ''0000'')',
    'select public.kontakter_slett(''finnes_ikke_test'')',
    'select public.admin_hent_ansatt_kontaktinfo()',
    'select public.admin_sett_ansatt_kontaktinfo(990001, ''TEST'', null)'
  ];
begin
  if exists (select 1 from public.ansatte where id in (990001, 990002, 990003, 990004)) then
    raise exception 'TEST-id-ene (990001-990004) er i bruk - avbryter uten å røre noe';
  end if;
  insert into public.ansatte (id, navn, rolle, aktiv, session_token) values
    (990001, 'TEST - ansatt', 'ansatt', true, 'TEST-tok-ans'),
    (990002, 'TEST - godkjenner', 'godkjenner', true, 'TEST-tok-godk'),
    (990003, 'TEST - admin', 'admin', true, 'TEST-tok-admin');
  insert into _kallere values
    ('ansatt', 'authenticated', c_ans), ('godkjenner', 'authenticated', c_godk),
    ('ansatt med forfalsket rolle-claim admin', 'authenticated', c_forfalsket_rolle),
    ('admin-id med gjettet session_token', 'authenticated', c_feil_token),
    ('service_role (server-funksjon)', 'service_role', c_service), ('anon', 'anon', c_anon),
    ('anonym Auth-sesjon uten PIN-innlogging', 'authenticated', c_uinnlogget);

  -- ===== T0 Testoppsettet virker (ellers beviser ikke testene noe) =====
  v := pg_temp._ca('authenticated', c_admin);
  insert into _res(navn, ok, info) values ('T0 admin-claims gir current_ansatt = admin', v = '990003:admin', v);
  v := pg_temp._ca('authenticated', c_ans);
  insert into _res(navn, ok, info) values ('T0 ansatt-claims gir current_ansatt = ansatt', v = '990001:ansatt', v);

  -- ===== T1-T3 Ingen kan endre rolle uten å være admin =====
  v := pg_temp._som('authenticated', c_ans, 'update public.ansatte set rolle = ''admin'' where id = 990001');
  select rolle into v_rolle from public.ansatte where id = 990001;
  insert into _res(navn, ok, info) values ('T1 ansatt kan IKKE gjøre seg selv til admin (KUN_ADMIN, rolle uendret)', v = 'KUN_ADMIN' and v_rolle = 'ansatt', v || ' / rolle=' || v_rolle);
  v := pg_temp._som('authenticated', c_godk, 'update public.ansatte set rolle = ''admin'' where id = 990002');
  select rolle into v_rolle from public.ansatte where id = 990002;
  insert into _res(navn, ok, info) values ('T2 godkjenner kan IKKE gjøre seg selv til admin', v = 'KUN_ADMIN' and v_rolle = 'godkjenner', v || ' / rolle=' || v_rolle);
  v := pg_temp._som('authenticated', c_ans, 'update public.ansatte set rolle = ''admin'' where id = 990002');
  select rolle into v_rolle from public.ansatte where id = 990002;
  insert into _res(navn, ok, info) values ('T3 ansatt kan IKKE endre en annen ansatts rolle', v = 'KUN_ADMIN' and v_rolle = 'godkjenner', v || ' / rolle=' || v_rolle);
  v := pg_temp._som('authenticated', c_ans, 'update public.ansatte set rolle = ''ansatt'' where id = 990002');
  select rolle into v_rolle from public.ansatte where id = 990002;
  insert into _res(navn, ok, info) values ('T3b ansatt kan IKKE nedgradere en annen ansatt heller', v = 'KUN_ADMIN' and v_rolle = 'godkjenner', v || ' / rolle=' || v_rolle);

  -- ===== T4-T5 Forfalskede claims =====
  v := pg_temp._ca('authenticated', c_forfalsket_rolle);
  insert into _res(navn, ok, info) values ('T4 «rolle: admin» i token-et ignoreres: current_ansatt leser rollen fra databasen', v = '990001:ansatt', v);
  v := pg_temp._som('authenticated', c_forfalsket_rolle, 'update public.ansatte set rolle = ''admin'' where id = 990001');
  select rolle into v_rolle from public.ansatte where id = 990001;
  insert into _res(navn, ok, info) values ('T4 forfalsket rolle-claim kan IKKE gi admin-rettigheter på ansatte', v = 'KUN_ADMIN' and v_rolle = 'ansatt', v || ' / rolle=' || v_rolle);
  v := pg_temp._ca('authenticated', c_feil_token);
  insert into _res(navn, ok, info) values ('T5 admins ansatt_id med gjettet session_token gir INGEN ansatt-sesjon', v = 'ingen', v);
  v := pg_temp._som('authenticated', c_feil_token, 'update public.ansatte set rolle = ''admin'' where id = 990001');
  select rolle into v_rolle from public.ansatte where id = 990001;
  insert into _res(navn, ok, info) values ('T5 gjettet token: RLS slipper ingen rader gjennom (0 rader endret), rolle uendret', v = 'OK rader=0' and v_rolle = 'ansatt', v || ' / rolle=' || v_rolle);

  -- ===== T6 Positiv kontroll: admin KAN endre rolle (ellers kan T1-T5 feile av feil årsak) =====
  v := pg_temp._som('authenticated', c_admin, 'update public.ansatte set rolle = ''godkjenner'' where id = 990001');
  select rolle into v_rolle from public.ansatte where id = 990001;
  insert into _res(navn, ok, info) values ('T6 admin KAN endre rolle (positiv kontroll)', v = 'OK rader=1' and v_rolle = 'godkjenner', v || ' / rolle=' || v_rolle);
  update public.ansatte set rolle = 'ansatt' where id = 990001;

  -- ===== T7 Server-funksjon med service-nøkkelen (har ingen ansatt-sesjon) =====
  v := pg_temp._ca('service_role', c_service);
  insert into _res(navn, ok, info) values ('T7 service_role har ingen ansatt-sesjon i current_ansatt', v = 'ingen', v);
  v := pg_temp._som('service_role', c_service, 'update public.ansatte set rolle = ''admin'' where id = 990001');
  select rolle into v_rolle from public.ansatte where id = 990001;
  insert into _res(navn, ok, info) values ('T7 service_role kan IKKE endre rolle (triggeren gjelder også RLS-omgåelse)', v = 'KUN_ADMIN' and v_rolle = 'ansatt', v || ' / rolle=' || v_rolle);

  -- ===== T8 Admin-rutinene avviser alle som ikke er en admin-sesjon =====
  for k in select * from _kallere loop
    foreach s in array v_rpc loop
      v := pg_temp._som(k.rolle, k.claims, s);
      v_antall := v_antall + 1;
      if v <> 'KUN_ADMIN' then v_avvik := v_avvik || k.navn || ' / ' || left(s, 34) || ' = ' || v || '; '; end if;
    end loop;
  end loop;
  insert into _res(navn, ok, info) values ('T8 ' || v_antall || ' admin-rutinekall (5 rutiner x 7 slags kallere): alle gir KUN_ADMIN', v_antall = 35 and v_avvik = '', coalesce(nullif(v_avvik, ''), 'ingen avvik'));
  v := pg_temp._som('authenticated', c_admin, 'select public.admin_sett_ansatt_kontaktinfo(990001, ''TEST'', null)');
  insert into _res(navn, ok, info) values ('T8 positiv kontroll: admin slipper gjennom samme rutine', v = 'OK rader=1', v);

  -- ===== T9 Ingen ansatt-tilgang uten ansatt-sesjon: rad-tellinger (kun tall) =====
  for k in select * from _kallere where navn in ('anon', 'anonym Auth-sesjon uten PIN-innlogging', 'service_role (server-funksjon)', 'admin-id med gjettet session_token') loop
    v := pg_temp._tell(k.rolle, k.claims, 'select count(*) from public.ansatte where id < 990000');
    insert into _res(navn, ok, info) values ('T9 ' || k.navn || ' ser ' || case when k.rolle = 'service_role' then 'alle (bypass RLS, forventet)' else 'ingen ekte ansatt-rader' end,
      case when k.rolle = 'service_role' then v::bigint > 0 else v = '0' or v like 'permission denied%' end, 'antall=' || v);
  end loop;
  v := pg_temp._tell('authenticated', c_ans, 'select count(*) from public.ansatte where id < 990000');
  insert into _res(navn, ok, info) values ('T9 innlogget ansatt ser ansatt-radene (positiv kontroll)', v::bigint > 0, 'antall=' || v);

  -- ===== INFO: kartlegging av hva en vanlig innlogget ansatt kan gjøre med ansatte-tabellen i dag (ikke krav) =====
  v := pg_temp._som('authenticated', c_ans, 'insert into public.ansatte (id, navn, rolle, aktiv) values (990004, ''TEST - forsøk admin'', ''admin'', true)');
  select coalesce(rolle, 'ingen rad') into v_rolle from (select 1) x left join public.ansatte a on a.id = 990004;
  insert into _res(navn, ok, info) values ('INFO ansatt oppretter en NY rad med rolle admin (triggeren dekker bare UPDATE av rolle)', true, v || ' / rad-rolle=' || v_rolle || ' (raden har ingen PIN: ansatte_pin har ingen skrivepolicy)');
  v := pg_temp._som('authenticated', c_ans, 'update public.ansatte set aktiv = false where id = 990003');
  select aktiv::text into v_rolle from public.ansatte where id = 990003;
  insert into _res(navn, ok, info) values ('INFO ansatt setter en admin inaktiv', true, v || ' / admin.aktiv=' || v_rolle);
  v := pg_temp._som('authenticated', c_ans, 'delete from public.ansatte where id = 990003');
  insert into _res(navn, ok, info) values ('INFO ansatt sletter en admin-rad', true, v);
end $test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
