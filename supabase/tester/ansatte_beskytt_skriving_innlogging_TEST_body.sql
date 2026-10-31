-- Test av 20261031140000_ansatte_beskytt_skriving_innlogging.sql: PIN-innloggingen skal virke (fersk sesjon OG delt enhet) uten at beskyttelsen av ansatte-tabellen (s09-032) svekkes.
-- ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, og Realtime ser aldri TEST-ansatte. TEST-ansatte (id 990011, 990012) lages inne i transaksjonen via opprett_ansatt;
-- en ekte admin brukes KUN som autorisasjon for det (ingen rad på den endres), og en eksisterende anonym Auth-bruker brukes som innloggingssesjon (raden rulles tilbake).
-- Kallene gjøres som i PostgREST: databaserolle byttes og request.jwt.claims settes, så RLS og triggere gjelder på ekte.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261031140000_ansatte_beskytt_skriving_innlogging.sql; cat supabase/tester/ansatte_beskytt_skriving_innlogging_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha resultat OK.

create temp table _res (n serial, navn text, ok boolean, info text);

-- Kjører én setning som en gitt databaserolle med gitte JWT-claims; gir 'OK rader=N' eller feilmeldingen. p_flagg = sett app.pin_innlogging FØR rollen byttes (simulerer et forsøk på å misbruke markeringen).
create function pg_temp._som(p_rolle text, p_claims jsonb, p_stmt text, p_flagg boolean default false) returns text
language plpgsql as $f$
declare v_n int; v_ut text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  if p_flagg then perform set_config('app.pin_innlogging', '1', true); end if;
  execute format('set local role %I', p_rolle);
  begin
    execute p_stmt;
    get diagnostics v_n = row_count;
    v_ut := 'OK rader=' || v_n;
  exception when others then
    v_ut := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('app.pin_innlogging', '', true);
  return v_ut;
end;
$f$;

-- PIN-innlogging som appen gjør det: gir 'ok:<id>', 'ingen rad' (feil PIN) eller feilmeldingen.
create function pg_temp._innlogg(p_claims jsonb, p_pin text) returns text
language plpgsql as $f$
declare v_id int; v_ut text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute 'set local role authenticated';
  begin
    select l.id into v_id from public.logg_inn_med_pin(p_pin) l limit 1;
    v_ut := case when v_id is null then 'ingen rad' else 'ok:' || v_id end;
  exception when others then
    v_ut := sqlerrm;
  end;
  execute 'reset role';
  return v_ut;
end;
$f$;

create function pg_temp._ca(p_claims jsonb) returns text
language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute 'set local role authenticated';
  select coalesce(string_agg(id::text || ':' || rolle, ','), 'ingen') into v from public.current_ansatt();
  execute 'reset role';
  return v;
end;
$f$;

do $test$
declare
  v_anon uuid; v_admin_claims text; v_pin_a text; v_pin_b text; v_pin_feil text; v text; v_tok text; v_meta text; v_rolle text; v_flagg text; i int;
  c_fersk jsonb; c_b jsonb;
begin
  select id into v_anon from auth.users where is_anonymous order by created_at desc limit 1;
  if v_anon is null then raise exception 'fant ingen anonym Auth-bruker å bruke som innloggingssesjon - avbryter'; end if;
  if exists (select 1 from public.ansatte where id in (990011, 990012)) then raise exception 'TEST-id 990011/990012 er i bruk - avbryter'; end if;

  -- Tre PIN-er som ikke er i bruk (A, B og en som aldri finnes)
  for i in 1..200 loop
    v_pin_a := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    v_pin_b := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    v_pin_feil := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    exit when v_pin_a <> v_pin_b and v_pin_feil not in (v_pin_a, v_pin_b)
      and not exists (select 1 from public.ansatte_pin where pin in (v_pin_a, v_pin_b, v_pin_feil));
  end loop;

  -- Opprett TEST-ansatte med en ekte admins identitet som autorisasjon (kun lesing av admin-raden)
  select jsonb_build_object('ansatt_id', id, 'session_token', coalesce(session_token, ''))::text into v_admin_claims
  from public.ansatte where aktiv and rolle = 'admin' order by id limit 1;
  perform set_config('request.jwt.claims', v_admin_claims, true);
  perform public.opprett_ansatt(990011, 'TEST - innlogging A', 'ansatt', v_pin_a);
  perform public.opprett_ansatt(990012, 'TEST - innlogging B', 'ansatt', v_pin_b);
  update public.ansatte set session_token = 'TEST-tok-B' where id = 990012;
  perform set_config('request.jwt.claims', '', true);

  c_fersk := jsonb_build_object('role', 'authenticated', 'sub', v_anon);
  c_b := jsonb_build_object('role', 'authenticated', 'sub', v_anon, 'ansatt_id', 990012, 'session_token', 'TEST-tok-B');

  insert into _res(navn, ok, info) values ('T0 oppsettet: B har en gyldig ansatt-sesjon, en fersk sesjon har ingen', pg_temp._ca(c_b) = '990012:ansatt' and pg_temp._ca(c_fersk) = 'ingen', pg_temp._ca(c_b) || ' / ' || pg_temp._ca(c_fersk));

  -- ===== Innloggingen =====
  v := pg_temp._innlogg(c_fersk, v_pin_a);
  select session_token into v_tok from public.ansatte where id = 990011;
  select raw_app_meta_data->>'ansatt_id' into v_meta from auth.users where id = v_anon;
  v_flagg := coalesce(current_setting('app.pin_innlogging', true), '');
  insert into _res(navn, ok, info) values ('T1 fersk sesjon: PIN-innlogging virker (var KUN_ADMIN), nytt session_token lagret, claims satt på Auth-brukeren, markeringen nullet',
    v = 'ok:990011' and v_tok is not null and v_meta = '990011' and v_flagg = '', v || ' / token satt=' || (v_tok is not null)::text || ' / meta=' || coalesce(v_meta, '-') || ' / flagg=''' || v_flagg || '''');

  v := pg_temp._innlogg(c_b, v_pin_a);
  select session_token into v_tok from public.ansatte where id = 990011;
  insert into _res(navn, ok, info) values ('T2 delt enhet: B har gyldige claims og A taster sin PIN - innloggingen virker', v = 'ok:990011' and v_tok is not null, v);

  v := pg_temp._innlogg(c_fersk, v_pin_feil);
  insert into _res(navn, ok, info) values ('T3 feil PIN gir fortsatt «ingen rad» (ikke en feil)', v = 'ingen rad', v);

  -- ===== Beskyttelsen fra s09-032 gjelder fortsatt, for B (vanlig ansatt med gyldig sesjon) =====
  v := pg_temp._som('authenticated', c_b, 'update public.ansatte set session_token = ''x'' where id = 990011');
  insert into _res(navn, ok, info) values ('T4a B kan IKKE endre en annens session_token direkte', v = 'KUN_ADMIN', v);
  v := pg_temp._som('authenticated', c_b, 'update public.ansatte set session_token = ''x'' where id = 990012');
  insert into _res(navn, ok, info) values ('T4b B kan IKKE endre sitt eget session_token direkte (bare innloggingen kan)', v = 'KUN_ADMIN', v);
  v := pg_temp._som('authenticated', c_b, 'update public.ansatte set rolle = ''admin'' where id = 990012');
  insert into _res(navn, ok, info) values ('T4c B kan IKKE gjøre seg selv til admin', v = 'KUN_ADMIN', v);
  v := pg_temp._som('authenticated', c_b, 'insert into public.ansatte (id, navn, rolle, aktiv) values (990013, ''TEST - forsøk'', ''admin'', true)');
  insert into _res(navn, ok, info) values ('T4d B kan IKKE opprette en ny admin-rad', v = 'KUN_ADMIN', v);
  v := pg_temp._som('authenticated', c_b, 'delete from public.ansatte where id = 990011');
  insert into _res(navn, ok, info) values ('T4e B kan IKKE slette en annen ansatt', v = 'KUN_ADMIN', v);
  v := pg_temp._som('authenticated', c_b, 'update public.ansatte set aktiv = false where id = 990011');
  insert into _res(navn, ok, info) values ('T4f B kan IKKE sette en annen ansatt inaktiv', v = 'KUN_ADMIN', v);
  v := pg_temp._som('authenticated', c_b, 'update public.ansatte set navn = ''TEST - B nytt navn'' where id = 990012');
  insert into _res(navn, ok, info) values ('T4g B KAN endre sitt eget navn (som før)', v = 'OK rader=1', v);
  v := pg_temp._som('authenticated', c_b, 'update public.ansatte set stemplet_inn_siden = now() where id = 990012');
  insert into _res(navn, ok, info) values ('T4h B KAN stemple seg inn (som før)', v = 'OK rader=1', v);

  -- ===== Markeringen kan ikke brukes til noe annet enn session_token =====
  v := pg_temp._som('authenticated', c_b, 'update public.ansatte set rolle = ''admin'' where id = 990012', true);
  insert into _res(navn, ok, info) values ('T5a selv med markeringen satt blokkeres en rolle-endring', v = 'KUN_ADMIN', v);
  v := pg_temp._som('authenticated', c_b, 'update public.ansatte set session_token = ''x'', navn = ''TEST - misbruk'' where id = 990012', true);
  insert into _res(navn, ok, info) values ('T5b selv med markeringen blokkeres session_token + en annen kolonne i samme oppdatering', v = 'KUN_ADMIN', v);
  select rolle into v_rolle from public.ansatte where id = 990012;
  insert into _res(navn, ok, info) values ('T5c B har fortsatt rolle ansatt etter forsøkene', v_rolle = 'ansatt', v_rolle);
  v_flagg := coalesce(current_setting('app.pin_innlogging', true), '');
  insert into _res(navn, ok, info) values ('T5d markeringen er nullet etter hvert kall', v_flagg = '', '''' || v_flagg || '''');

  -- ===== Admin kan fortsatt alt (positiv kontroll) =====
  perform set_config('request.jwt.claims', v_admin_claims, true);
  v := pg_temp._som('authenticated', v_admin_claims::jsonb || jsonb_build_object('role', 'authenticated'), 'update public.ansatte set rolle = ''godkjenner'' where id = 990012');
  select rolle into v_rolle from public.ansatte where id = 990012;
  insert into _res(navn, ok, info) values ('T6 admin KAN fortsatt endre rolle (positiv kontroll)', v = 'OK rader=1' and v_rolle = 'godkjenner', v || ' / rolle=' || v_rolle);
end $test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
