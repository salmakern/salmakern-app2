-- Test av 20261126100000_login_med_pin_uten_session_token.sql (godkjenner-PIN sender ikke lenger ut session_token).
-- ALLTID i en transaksjon som rulles tilbake: TEST-ansatte (id 990051-990053) lages inne i transaksjonen via opprett_ansatt, en ekte admin
-- brukes KUN som autorisasjon for det (ingen rad på den endres), og eksisterende anonyme Auth-brukere brukes som enheter (pin_forsok-radene
-- rulles tilbake). sikkerhet_tilstand og pin_global_forsok endres bare inne i transaksjonen. Ingen push: pg_net sender bare committede køer.
-- Kallene gjøres som i PostgREST: rollen byttes til authenticated og request.jwt.claims settes.
-- Kjøring (fra rotmappen, IKKE mellom 00:00 og 03:00 norsk tid). Nødbrems-testen kjøres i samme transaksjon som regresjonsvakt
-- (20261125200000 er allerede kjørt i produksjon og tas IKKE med foran; den er ikke idempotent):
--   ( echo "begin;"; cat supabase/migrations/20261126100000_login_med_pin_uten_session_token.sql; cat supabase/tester/pin_nodbrems_TEST_body.sql; \
--     cat supabase/tester/login_med_pin_uten_session_token_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   bash C:/w/med-las.sh npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader i begge resultatsettene skal ha resultat OK. Uten migrasjonen foran skal L1, L2, L3 og L6 gi FEIL (kalibrering, kjørt 26.11).

create temp table _res_lmp (n serial, navn text, ok boolean, info text);

-- Godkjenner-PIN som authenticated på en gitt enhet: hele svaret som jsonb-liste (én jsonb per rad), eller feilmeldingen.
create function pg_temp._l_godkj(p_uid uuid, p_pin text) returns text
language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_uid)::text, true);
  execute 'set local role authenticated';
  begin
    select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)::text into v from public.login_med_pin(p_pin) l;
  exception when others then
    v := sqlerrm;
  end;
  execute 'reset role';
  return v;
end;
$f$;

do $test$
declare
  u uuid[];
  v_admin_claims jsonb;
  pin_g text; pin_a text; pin_x text; pin_feil text;
  v text; v_j jsonb; i int; v_feil0 int; v_feil1 int; v_glob0 int; v_glob1 int;
  v_oid oid;
begin
  select array_agg(id) into u from (select id from auth.users where is_anonymous order by created_at asc limit 4) s;
  if coalesce(array_length(u, 1), 0) < 4 then raise exception 'fant ikke 4 anonyme Auth-brukere - avbryter'; end if;
  if exists (select 1 from public.ansatte where id between 990051 and 990053) then raise exception 'TEST-id 990051-990053 er i bruk - avbryter'; end if;
  delete from public.pin_forsok where auth_uid = any(u);
  delete from public.pin_global_forsok;
  -- Normal drift som utgangspunkt (bare i transaksjonen).
  update public.sikkerhet_tilstand set nodbrems_aktiv = false, nodbrems_siden = null, nodbrems_auth_uid = null, ny_pin_kreves_fra = null where id = 1;

  for i in 1..500 loop
    pin_g := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_a := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_x := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_feil := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    exit when (select count(distinct p) from unnest(array[pin_g, pin_a, pin_x, pin_feil]) p) = 4
      and not exists (select 1 from public.ansatte_pin where pin in (pin_g, pin_a, pin_x, pin_feil));
  end loop;

  -- Oppsett (en ekte admin er bare autorisasjon for opprett_ansatt).
  select jsonb_build_object('ansatt_id', id, 'session_token', coalesce(session_token, ''), 'logget_inn_at', now()::text) into v_admin_claims
  from public.ansatte where aktiv and rolle = 'admin' order by id limit 1;
  perform set_config('request.jwt.claims', v_admin_claims::text, true);
  perform public.opprett_ansatt(990051, 'TEST - godkjenner uten token', 'godkjenner', pin_g);
  perform public.opprett_ansatt(990052, 'TEST - ansatt uten token', 'ansatt', pin_a);
  perform public.opprett_ansatt(990053, 'TEST - admin uten token', 'admin', pin_x);
  update public.ansatte set session_token = 'TEST-TOKEN-SKAL-IKKE-UT-' || id where id between 990051 and 990053;
  perform set_config('request.jwt.claims', '', true);
  update public.ansatte_pin set pin_satt_at = now() where ansatt_id between 990051 and 990053;

  -- ===== Signatur og rettigheter =====
  select p.oid into v_oid from pg_proc p where p.proname = 'login_med_pin' and p.pronamespace = 'public'::regnamespace;
  insert into _res_lmp(navn, ok, info) values ('L0 nøyaktig én login_med_pin finnes', (select count(*) from pg_proc where proname = 'login_med_pin' and pronamespace = 'public'::regnamespace) = 1, '');
  insert into _res_lmp(navn, ok, info) values ('L1 returtypen har ikke session_token (aktiv og kan_fore_lonn står)',
    pg_get_function_result(v_oid) = 'TABLE(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean)', pg_get_function_result(v_oid));
  insert into _res_lmp(navn, ok, info) values ('L1b rettigheter uendret fra før migrasjonen (lest live 26.11), security definer og search_path som før',
    (select proacl::text from pg_proc where oid = v_oid) = '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
    and has_function_privilege('anon', v_oid, 'execute') and has_function_privilege('authenticated', v_oid, 'execute')
    and (select prosecdef from pg_proc where oid = v_oid) and (select proconfig::text from pg_proc where oid = v_oid) = '{search_path=public}',
    (select proacl::text || ' ' || proconfig::text from pg_proc where oid = v_oid));

  -- ===== Riktig PIN =====
  v := pg_temp._l_godkj(u[1], pin_g);
  v_j := case when left(v, 1) = '[' then v::jsonb else null end;
  insert into _res_lmp(navn, ok, info) values ('L2 riktig godkjenner-PIN: én rad, og svaret inneholder IKKE session_token (heller ikke verdien)',
    jsonb_array_length(v_j) = 1 and not (v_j->0 ? 'session_token') and v not like '%TEST-TOKEN-SKAL-IKKE-UT%', v);
  insert into _res_lmp(navn, ok, info) values ('L3 ... med nøyaktig id, navn, rolle, aktiv og kan_fore_lonn med riktige verdier',
    (select array_agg(k order by k) from jsonb_object_keys(v_j->0) k) = array['aktiv','id','kan_fore_lonn','navn','rolle']
    and (v_j->0->>'id')::int = 990051 and v_j->0->>'navn' = 'TEST - godkjenner uten token' and v_j->0->>'rolle' = 'godkjenner'
    and (v_j->0->>'aktiv')::boolean = true
    and (v_j->0->>'kan_fore_lonn')::boolean = (select kan_fore_lonn from public.ansatte where id = 990051), v);
  insert into _res_lmp(navn, ok, info) values ('L3b godkjenner-PIN lager ingen økt: session_token på raden er urørt',
    (select session_token from public.ansatte where id = 990051) = 'TEST-TOKEN-SKAL-IKKE-UT-990051', '');

  -- ===== Feil PIN (rate limit og telling uendret) =====
  select coalesce((select antall_feil from public.pin_forsok where auth_uid = u[2]), 0) into v_feil0;
  select count(*) into v_glob0 from public.pin_global_forsok;
  v := pg_temp._l_godkj(u[2], pin_feil);
  select coalesce((select antall_feil from public.pin_forsok where auth_uid = u[2]), 0) into v_feil1;
  select count(*) into v_glob1 from public.pin_global_forsok;
  insert into _res_lmp(navn, ok, info) values ('L4 feil PIN: 0 rader, telles som feil forsøk per enhet og globalt',
    v = '[]' and v_feil1 = v_feil0 + 1 and v_glob1 = v_glob0 + 1, v || ' enhet ' || v_feil0 || '->' || v_feil1 || ' global ' || v_glob0 || '->' || v_glob1);
  v := pg_temp._l_godkj(null, pin_g);
  insert into _res_lmp(navn, ok, info) values ('L4b uten Auth-bruker: IKKE_INNLOGGET som før', v = 'IKKE_INNLOGGET', v);

  -- ===== Nødbrems uendret =====
  update public.sikkerhet_tilstand set nodbrems_aktiv = true, nodbrems_siden = now() - interval '30 seconds' where id = 1;
  select count(*) into v_glob0 from public.pin_global_forsok;
  v := pg_temp._l_godkj(u[3], pin_g);
  select count(*) into v_glob1 from public.pin_global_forsok;
  insert into _res_lmp(navn, ok, info) values ('L5 nødbrems aktiv: riktig PIN for en ikke-admin gir 0 rader og telles som feil forsøk',
    v = '[]' and v_glob1 = v_glob0 + 1, v || ' global +' || (v_glob1 - v_glob0));
  v := pg_temp._l_godkj(u[3], pin_x);
  insert into _res_lmp(navn, ok, info) values ('L6 nødbrems aktiv: admin med PIN satt etter nødbremsen slipper gjennom, uten session_token',
    v like '[{%' and (v::jsonb)->0->>'id' = '990053' and not ((v::jsonb)->0 ? 'session_token'), v);
  update public.sikkerhet_tilstand set nodbrems_aktiv = false, ny_pin_kreves_fra = nodbrems_siden where id = 1;
  update public.ansatte_pin set pin_satt_at = null where ansatt_id = 990052;
  v := pg_temp._l_godkj(u[4], pin_a);
  insert into _res_lmp(navn, ok, info) values ('L7 etter opphevet nødbrems: en PIN som må byttes gir 0 rader', v = '[]', v);
  v := pg_temp._l_godkj(u[4], pin_g);
  insert into _res_lmp(navn, ok, info) values ('L7b ... mens en PIN satt etter nødbremsen godtas', v like '[{%' and (v::jsonb)->0->>'id' = '990051', v);

  -- Tilbake til normal drift i transaksjonen.
  update public.sikkerhet_tilstand set nodbrems_aktiv = false, nodbrems_siden = null, nodbrems_auth_uid = null, ny_pin_kreves_fra = null where id = 1;
  delete from public.pin_global_forsok;
  delete from public.pin_forsok where auth_uid = any(u);
end $test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res_lmp order by n;
