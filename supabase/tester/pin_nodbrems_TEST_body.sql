-- Test av 20261125200000_pin_nodbrems.sql (samlet PIN-sperre: nødbrems, ny PIN etter nødbrems, varsel ved den automatiske sperren).
-- ALLTID i en transaksjon som rulles tilbake: TEST-ansatte (id 990031-990034) lages inne i transaksjonen via opprett_ansatt, en ekte admin
-- brukes KUN som autorisasjon for det (ingen rad på den endres), og eksisterende anonyme Auth-brukere brukes som innloggingssesjoner (radene
-- rulles tilbake). pin_global_forsok tømmes inne i transaksjonen (rulles tilbake). Ingen push sendes: pg_net sender bare committede køer.
-- Kallene gjøres som i PostgREST: databaserolle byttes og request.jwt.claims settes, så RLS og rettigheter gjelder på ekte.
-- Kjøring (fra rotmappen, IKKE mellom 00:00 og 03:00 norsk tid, og helst utenom arbeidstid: migrasjonen i transaksjonen låser ansatte_pin
-- i noen sekunder, så en innlogging akkurat da venter litt):
--   ( echo "begin;"; cat supabase/migrations/20261125200000_pin_nodbrems.sql; cat supabase/tester/pin_nodbrems_TEST_body.sql; \
--     cat supabase/tester/ansatte_beskytt_skriving_innlogging_TEST_body.sql | sed 's/create temp table _res/create temp table _res2/; s/_res(/_res2(/g; s/from _res order/from _res2 order/' ; echo "rollback;" ) > "$TEMP/t.sql"
--   bash C:/w/med-las.sh npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader i resultatsettene skal ha resultat OK.
--
-- Tid: alt i én transaksjon har samme now(). For å kunne skille «før» og «etter» nødbremsen flyttes nodbrems_siden 30 sekunder tilbake
-- rett etter at den er trukket (som om trykket skjedde for 30 s siden); «gamle» økter har logget_inn_at = now() - 1 min, «nye» now().

create temp table _res (n serial, navn text, ok boolean, info text);

create function pg_temp._n_som(p_rolle text, p_claims jsonb, p_stmt text) returns text
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

-- Kaller en funksjon som gir én verdi (text/jsonb) som authenticated; gir verdien eller feilmeldingen.
create function pg_temp._n_verdi(p_claims jsonb, p_uttrykk text) returns text
language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute 'select (' || p_uttrykk || ')::text' into v;
  exception when others then
    v := sqlerrm;
  end;
  execute 'reset role';
  return coalesce(v, 'null');
end;
$f$;

-- PIN-innlogging: 'ok:<id> ny=<bool> tok=<session_token>', 'ingen rad' eller feilmeldingen.
create function pg_temp._n_innlogg(p_claims jsonb, p_pin text) returns text
language plpgsql as $f$
declare v_id int; v_ny boolean; v_ut text; v_tok text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute 'set local role authenticated';
  begin
    select l.id, l.ny_pin_kreves into v_id, v_ny from public.logg_inn_med_pin(p_pin) l limit 1;
    v_ut := case when v_id is null then 'ingen rad' else 'ok:' || v_id || ' ny=' || v_ny::text end;
  exception when others then
    v_ut := sqlerrm;
  end;
  execute 'reset role';
  if v_id is not null then
    select session_token into v_tok from public.ansatte where id = v_id;
    v_ut := v_ut || ' tok=' || coalesce(v_tok, '');
  end if;
  return v_ut;
end;
$f$;

create function pg_temp._n_godkj(p_claims jsonb, p_pin text) returns text
language plpgsql as $f$
declare v_id int; v_ut text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute 'set local role authenticated';
  begin
    select l.id into v_id from public.login_med_pin(p_pin) l limit 1;
    v_ut := case when v_id is null then 'ingen rad' else 'ok:' || v_id end;
  exception when others then
    v_ut := sqlerrm;
  end;
  execute 'reset role';
  return v_ut;
end;
$f$;

create function pg_temp._n_ca(p_claims jsonb) returns text
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

create function pg_temp._n_hent(p_claims jsonb) returns text
language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  execute 'set local role authenticated';
  select coalesce(string_agg(id::text || ':' || rolle, ','), 'ingen') into v from public.hent_innlogget_ansatt();
  execute 'reset role';
  return v;
end;
$f$;

-- Claims for en økt: anonym Auth-bruker + ansatt + session_token + når den logget inn.
create function pg_temp._n_c(p_uid uuid, p_id int, p_inn timestamptz) returns jsonb
language sql as $f$
  select jsonb_build_object('role', 'authenticated', 'sub', p_uid, 'ansatt_id', p_id,
    'session_token', (select session_token from public.ansatte where id = p_id), 'logget_inn_at', p_inn::text);
$f$;

create function pg_temp._n_kø() returns int
language sql as $f$
  select count(*)::int from net.http_request_queue
  where url like '%/functions/v1/send-push' and convert_from(body, 'utf8')::jsonb->>'type' = 'pin_global_sperre';
$f$;

do $test$
declare
  u uuid[];
  v_admin_claims jsonb;
  pin_a text; pin_b text; pin_x text; pin_y text; pin_ny text; pin_ny2 text; pin_ny3 text; pin_feil text;
  c_a_gml jsonb; c_x jsonb; c_y_gml jsonb; c_y_ny jsonb; c_a_ny jsonb; c_x_ny jsonb; c_fersk3 jsonb; c_uten jsonb; c_b_ny jsonb;
  v text; v2 text; i int; v_n0 int; v_n1 int; v_glob0 int; v_glob1 int; v_k0 int; v_k1 int; v_st record; v_tid timestamptz;
  v_pinsett timestamptz;
begin
  select array_agg(id) into u from (select id from auth.users where is_anonymous order by created_at asc limit 5) s;
  if coalesce(array_length(u, 1), 0) < 5 then raise exception 'fant ikke 5 anonyme Auth-brukere - avbryter'; end if;
  if exists (select 1 from public.ansatte where id between 990031 and 990034) then raise exception 'TEST-id 990031-990034 er i bruk - avbryter'; end if;
  delete from public.pin_forsok where auth_uid = any(u);
  delete from public.pin_global_forsok;

  -- Sju ledige 6-sifrede PIN-er.
  for i in 1..500 loop
    pin_a := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_b := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_x := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_y := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_ny := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_ny2 := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_ny3 := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    pin_feil := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    exit when (select count(distinct p) from unnest(array[pin_a, pin_b, pin_x, pin_y, pin_ny, pin_ny2, pin_ny3, pin_feil]) p) = 8
      and not exists (select 1 from public.ansatte_pin where pin in (pin_a, pin_b, pin_x, pin_y, pin_ny, pin_ny2, pin_ny3, pin_feil));
  end loop;

  -- ===== Oppsett (som en ekte admin, bare autorisasjon) =====
  select jsonb_build_object('ansatt_id', id, 'session_token', coalesce(session_token, ''), 'logget_inn_at', now()::text) into v_admin_claims
  from public.ansatte where aktiv and rolle = 'admin' order by id limit 1;
  perform set_config('request.jwt.claims', v_admin_claims::text, true);
  perform public.opprett_ansatt(990031, 'TEST - nødbrems A', 'ansatt', pin_a);
  perform public.opprett_ansatt(990032, 'TEST - nødbrems B', 'godkjenner', pin_b);
  perform public.opprett_ansatt(990033, 'TEST - nødbrems admin X', 'admin', pin_x);
  perform public.opprett_ansatt(990034, 'TEST - nødbrems admin Y', 'admin', pin_y);
  perform set_config('request.jwt.claims', '', true);
  -- Gamle PIN-er: satt før nødbremsen (som alle PIN-er som fantes da migrasjonen ble kjørt: null).
  update public.ansatte_pin set pin_satt_at = null where ansatt_id between 990031 and 990034;

  insert into _res(navn, ok, info) values ('N0a tabellen finnes med én rad, nødbremsen er av, Realtime publiserer den',
    (select count(*) = 1 and bool_and(not nodbrems_aktiv) from public.sikkerhet_tilstand)
    and exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sikkerhet_tilstand'), '');
  insert into _res(navn, ok, info) values ('N0b rettigheter: authenticated kan lese, ingen kan skrive direkte, anon kan ikke lese',
    has_table_privilege('authenticated', 'public.sikkerhet_tilstand', 'select')
    and not has_table_privilege('authenticated', 'public.sikkerhet_tilstand', 'update')
    and not has_table_privilege('authenticated', 'public.sikkerhet_tilstand', 'insert')
    and not has_table_privilege('authenticated', 'public.sikkerhet_tilstand', 'delete')
    and not has_table_privilege('anon', 'public.sikkerhet_tilstand', 'select'), '');
  insert into _res(navn, ok, info) values ('N0c anon/public kan ikke kjøre nodbrems_pa/av/endre_pin_etter_nodbrems; ingen klient kan kjøre _sikkerhet_push',
    not has_function_privilege('anon', 'public.nodbrems_pa()', 'execute')
    and not has_function_privilege('anon', 'public.nodbrems_av()', 'execute')
    and not has_function_privilege('anon', 'public.endre_pin_etter_nodbrems(text)', 'execute')
    and not has_function_privilege('authenticated', 'public._sikkerhet_push(text,integer)', 'execute')
    and not has_function_privilege('anon', 'public._sikkerhet_push(text,integer)', 'execute')
    and has_function_privilege('anon', 'public.logg_inn_med_pin(text)', 'execute')
    and has_function_privilege('authenticated', 'public.logg_inn_med_pin(text)', 'execute'), '');

  -- Innlogging før nødbremsen: A på u1, X på u2 (X trekker nødbremsen), Y på u3.
  v := pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[1]), pin_a);
  insert into _res(navn, ok, info) values ('N1 vanlig innlogging virker og gir ny_pin_kreves=false', v like 'ok:990031 ny=false%', v);
  perform pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[2]), pin_x);
  perform pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[3]), pin_y);
  c_a_gml := pg_temp._n_c(u[1], 990031, now() - interval '1 minute');
  c_x := pg_temp._n_c(u[2], 990033, now() - interval '1 minute');
  c_y_gml := pg_temp._n_c(u[3], 990034, now() - interval '1 minute');
  c_uten := c_a_gml - 'logget_inn_at';

  insert into _res(navn, ok, info) values ('N2 før nødbrems: gyldige økter slipper gjennom (A, X, Y)',
    pg_temp._n_ca(c_a_gml) = '990031:ansatt' and pg_temp._n_ca(c_x) = '990033:admin' and pg_temp._n_ca(c_y_gml) = '990034:admin',
    pg_temp._n_ca(c_a_gml) || ' / ' || pg_temp._n_ca(c_x) || ' / ' || pg_temp._n_ca(c_y_gml));
  insert into _res(navn, ok, info) values ('N3 økt UTEN logget_inn_at (de 54 gamle fra før 12.11) avvises nå, både i current_ansatt og hent_innlogget_ansatt',
    pg_temp._n_ca(c_uten) = 'ingen' and pg_temp._n_hent(c_uten) = 'ingen', pg_temp._n_ca(c_uten) || ' / ' || pg_temp._n_hent(c_uten));

  -- ===== Bare admin kan trekke nødbremsen =====
  v := pg_temp._n_verdi(c_a_gml, 'public.nodbrems_pa()');
  insert into _res(navn, ok, info) values ('N4 vanlig ansatt kan IKKE trekke nødbremsen', v = 'KUN_ADMIN', v);
  v := pg_temp._n_som('authenticated', c_a_gml, 'update public.sikkerhet_tilstand set nodbrems_aktiv = true');
  insert into _res(navn, ok, info) values ('N4b ingen kan skrive tabellen direkte', v like 'permission denied%', v);
  v := pg_temp._n_som('anon', null, 'select public.nodbrems_pa()');
  insert into _res(navn, ok, info) values ('N4c anon kan ikke kalle nodbrems_pa', v like 'permission denied%', v);

  -- ===== Nødbremsen trekkes av X =====
  v_k0 := pg_temp._n_kø();
  v := pg_temp._n_verdi(c_x, 'public.nodbrems_pa()');
  v_k1 := pg_temp._n_kø();
  select * into v_st from public.sikkerhet_tilstand where id = 1;
  insert into _res(navn, ok, info) values ('N5 admin X trekker nødbremsen: aktiv, siden, av og Auth-bruker lagret, og ett push-varsel køet',
    v like '%"ok": true%' and v_st.nodbrems_aktiv and v_st.nodbrems_av = 990033 and v_st.nodbrems_auth_uid = u[2] and v_st.nodbrems_siden = now() and v_k1 = v_k0 + 1,
    v || ' kø ' || v_k0 || '->' || v_k1);
  v := pg_temp._n_verdi(c_x, 'public.nodbrems_pa()');
  insert into _res(navn, ok, info) values ('N5b et nytt trykk mens den er aktiv endrer ingenting', v like '%"alleredeAktiv": true%' and (select nodbrems_auth_uid from public.sikkerhet_tilstand) = u[2], v);
  update public.sikkerhet_tilstand set nodbrems_siden = now() - interval '30 seconds' where id = 1;

  insert into _res(navn, ok, info) values ('N6 X sin egen økt (samme enhet) beholdes',
    pg_temp._n_ca(c_x) = '990033:admin' and pg_temp._n_hent(c_x) = '990033:admin', pg_temp._n_ca(c_x));
  insert into _res(navn, ok, info) values ('N7 en vanlig ansatt sin gyldige økt kastes ut med en gang (current_ansatt og hent_innlogget_ansatt)',
    pg_temp._n_ca(c_a_gml) = 'ingen' and pg_temp._n_hent(c_a_gml) = 'ingen', pg_temp._n_ca(c_a_gml));
  insert into _res(navn, ok, info) values ('N8 en annen admin sin økt kastes også ut', pg_temp._n_ca(c_y_gml) = 'ingen', pg_temp._n_ca(c_y_gml));
  insert into _res(navn, ok, info) values ('N9 X sine claims på en ANNEN enhet (annen Auth-bruker) slipper ikke gjennom',
    pg_temp._n_ca(c_x || jsonb_build_object('sub', u[3])) = 'ingen', pg_temp._n_ca(c_x || jsonb_build_object('sub', u[3])));
  v := pg_temp._n_som('authenticated', c_a_gml, 'select 1 from public.ordrer limit 1');
  insert into _res(navn, ok, info) values ('N9b RLS: den utkastede økta ser ingen ordrer', v = 'OK rader=0', v);
  v := pg_temp._n_som('authenticated', jsonb_build_object('role','authenticated','sub',u[4]), 'select 1 from public.sikkerhet_tilstand where nodbrems_aktiv');
  insert into _res(navn, ok, info) values ('N9c en fersk sesjon på PIN-skjermen kan lese at nødbremsen er aktiv', v = 'OK rader=1', v);

  -- ===== Innlogging mens nødbremsen er aktiv =====
  c_fersk3 := jsonb_build_object('role','authenticated','sub',u[4]);
  select count(*) into v_glob0 from public.pin_global_forsok;
  v := pg_temp._n_innlogg(c_fersk3, pin_a);
  v2 := pg_temp._n_innlogg(c_fersk3, pin_feil);
  select count(*) into v_glob1 from public.pin_global_forsok;
  select antall_feil into v_n1 from public.pin_forsok where auth_uid = u[4];
  insert into _res(navn, ok, info) values ('N10 vanlig ansatt med RIKTIG PIN får samme svar som feil PIN, og begge telles som feil forsøk (per enhet og globalt)',
    v = 'ingen rad' and v2 = 'ingen rad' and v_glob1 = v_glob0 + 2 and v_n1 = 2, v || ' / ' || v2 || ' / global +' || (v_glob1 - v_glob0) || ' / enhet ' || coalesce(v_n1, 0));
  insert into _res(navn, ok, info) values ('N10b A sin session_token ble IKKE byttet (ingen innlogging skjedde)',
    (select session_token from public.ansatte where id = 990031) = c_a_gml->>'session_token', '');
  v := pg_temp._n_godkj(c_fersk3, pin_b);
  insert into _res(navn, ok, info) values ('N11 login_med_pin (godkjenner-PIN) for en ikke-admin gir også «ingen rad»', v = 'ingen rad', v);

  v := pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[3]), pin_y);
  insert into _res(navn, ok, info) values ('N12 admin Y kan logge inn mens nødbremsen er aktiv, men må bytte PIN (ny_pin_kreves=true)', v like 'ok:990034 ny=true%', v);
  c_y_ny := pg_temp._n_c(u[3], 990034, now());
  insert into _res(navn, ok, info) values ('N13 Y sin nye økt slipper IKKE gjennom før PIN er byttet (klientsperren kan ikke omgås)',
    pg_temp._n_ca(c_y_ny) = 'ingen' and pg_temp._n_hent(c_y_ny) = 'ingen', pg_temp._n_ca(c_y_ny));
  v := pg_temp._n_verdi(c_y_ny, 'public.endre_egen_pin(''' || pin_ny || ''')');
  insert into _res(navn, ok, info) values ('N14 endre_egen_pin kan ikke brukes som omvei', v = 'IKKE_INNLOGGET', v);
  v := pg_temp._n_verdi(c_y_ny, 'public.endre_pin_etter_nodbrems(''' || pin_y || ''')');
  insert into _res(navn, ok, info) values ('N15a samme PIN som før avvises', v = 'SAMME_PIN', v);
  v := pg_temp._n_verdi(c_y_ny, 'public.endre_pin_etter_nodbrems(''' || pin_a || ''')');
  insert into _res(navn, ok, info) values ('N15b en annens PIN avvises', v = 'PIN_I_BRUK', v);
  v := pg_temp._n_verdi(c_y_ny, 'public.endre_pin_etter_nodbrems(''12345'')');
  insert into _res(navn, ok, info) values ('N15c ugyldig PIN avvises', v = 'UGYLDIG_PIN', v);
  v := pg_temp._n_verdi(c_y_gml, 'public.endre_pin_etter_nodbrems(''' || pin_ny || ''')');
  insert into _res(navn, ok, info) values ('N15d en økt fra FØR nødbremsen kan ikke bytte PIN', v = 'IKKE_INNLOGGET', v);
  v := pg_temp._n_verdi(c_y_ny, 'public.endre_pin_etter_nodbrems(''' || pin_ny || ''')');
  insert into _res(navn, ok, info) values ('N15e ny PIN lagres, og økta slipper gjennom etterpå',
    v = 'ok' and pg_temp._n_ca(c_y_ny) = '990034:admin' and pg_temp._n_hent(c_y_ny) = '990034:admin'
    and (select pin from public.ansatte_pin where ansatt_id = 990034) = pin_ny, v || ' / ' || pg_temp._n_ca(c_y_ny));
  v := pg_temp._n_verdi(c_y_ny, 'public.endre_pin_etter_nodbrems(''' || pin_ny2 || ''')');
  insert into _res(navn, ok, info) values ('N15f når PIN-en er byttet sier funksjonen IKKE_PAKREVD (vanlig bytte går via endre_egen_pin)', v = 'IKKE_PAKREVD', v);
  v := pg_temp._n_godkj(c_fersk3, pin_ny);
  insert into _res(navn, ok, info) values ('N16 login_med_pin for admin virker under nødbrems', v = 'ok:990034', v);

  -- En vanlig ansatt som har en økt etter nødbremsen (kan i praksis ikke skje): får ikke bytte PIN mens den er aktiv.
  c_a_ny := pg_temp._n_c(u[1], 990031, now());
  v := pg_temp._n_verdi(c_a_ny, 'public.endre_pin_etter_nodbrems(''' || pin_ny3 || ''')');
  insert into _res(navn, ok, info) values ('N17 en vanlig ansatt kan ikke bytte PIN mens nødbremsen er aktiv', v = 'IKKE_INNLOGGET', v);

  -- Y (som nå har en gyldig økt) kan også oppheve.
  v := pg_temp._n_verdi(c_a_gml, 'public.nodbrems_av()');
  insert into _res(navn, ok, info) values ('N18 vanlig ansatt kan IKKE oppheve nødbremsen', v = 'KUN_ADMIN', v);

  -- ===== Opphev =====
  v_k0 := pg_temp._n_kø();
  v := pg_temp._n_verdi(c_x, 'public.nodbrems_av()');
  v_k1 := pg_temp._n_kø();
  select * into v_st from public.sikkerhet_tilstand where id = 1;
  insert into _res(navn, ok, info) values ('N19 X opphever: av, ny_pin_kreves_fra = nodbrems_siden, opphevet av X, ett push-varsel køet',
    v like '%"varAktiv": true%' and not v_st.nodbrems_aktiv and v_st.ny_pin_kreves_fra = v_st.nodbrems_siden and v_st.nodbrems_opphevet_av = 990033 and v_k1 = v_k0 + 1,
    v || ' kø ' || v_k0 || '->' || v_k1);
  insert into _res(navn, ok, info) values ('N20 X sin økt (den som trakk) gjelder fortsatt etter opphevingen', pg_temp._n_ca(c_x) = '990033:admin', pg_temp._n_ca(c_x));
  insert into _res(navn, ok, info) values ('N20b økter fra FØR nødbremsen er fortsatt ute etter opphevingen', pg_temp._n_ca(c_a_gml) = 'ingen' and pg_temp._n_ca(c_y_gml) = 'ingen', '');

  -- A logger inn med den GAMLE PIN-en etter opphevingen: må bytte.
  delete from public.pin_forsok where auth_uid = u[1];
  v := pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[1]), pin_a);
  insert into _res(navn, ok, info) values ('N21 etter opphevingen: vanlig ansatt logger inn med gammel PIN, ny_pin_kreves=true', v like 'ok:990031 ny=true%', v);
  c_a_ny := pg_temp._n_c(u[1], 990031, now());
  insert into _res(navn, ok, info) values ('N22 ... og slipper ikke gjennom før PIN er byttet', pg_temp._n_ca(c_a_ny) = 'ingen', pg_temp._n_ca(c_a_ny));
  v := pg_temp._n_verdi(c_a_ny, 'public.endre_pin_etter_nodbrems(''' || pin_ny3 || ''')');
  insert into _res(navn, ok, info) values ('N23 ... bytter PIN og slipper gjennom', v = 'ok' and pg_temp._n_ca(c_a_ny) = '990031:ansatt', v || ' / ' || pg_temp._n_ca(c_a_ny));
  v := pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[1]), pin_ny3);
  insert into _res(navn, ok, info) values ('N23b neste innlogging med den nye PIN-en krever ikke bytte', v like 'ok:990031 ny=false%', v);

  -- X (admin, ingen unntak) logger inn på nytt: må også bytte.
  v := pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[2]), pin_x);
  c_x_ny := pg_temp._n_c(u[2], 990033, now());
  insert into _res(navn, ok, info) values ('N24 også admin som trakk nødbremsen må bytte PIN ved neste innlogging (ingen admin-unntak)',
    v like 'ok:990033 ny=true%' and pg_temp._n_ca(c_x_ny) = 'ingen', v || ' / ' || pg_temp._n_ca(c_x_ny));

  -- admin_sett_pin og endre_egen_pin setter pin_satt_at, så en PIN admin har satt etter nødbremsen krever ikke bytte.
  v := pg_temp._n_verdi(c_y_ny, 'public.admin_sett_pin(990032, ''' || pin_ny2 || ''')');
  select pin_satt_at into v_pinsett from public.ansatte_pin where ansatt_id = 990032;
  insert into _res(navn, ok, info) values ('N25 admin_sett_pin lagrer pin_satt_at', v = 'ok' and v_pinsett = now(), v);
  v := pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[5]), pin_ny2);
  c_b_ny := pg_temp._n_c(u[5], 990032, now());
  insert into _res(navn, ok, info) values ('N26 ... og B logger inn uten bytte og slipper gjennom', v like 'ok:990032 ny=false%' and pg_temp._n_ca(c_b_ny) = '990032:godkjenner', v);
  update public.ansatte_pin set pin_satt_at = null where ansatt_id = 990032;
  v := pg_temp._n_verdi(c_b_ny, 'public.endre_egen_pin(''' || pin_b || ''')');
  v2 := pg_temp._n_verdi(c_b_ny, 'public.endre_pin_etter_nodbrems(''' || pin_b || ''')');
  select pin_satt_at into v_pinsett from public.ansatte_pin where ansatt_id = 990032;
  insert into _res(navn, ok, info) values ('N27 endre_egen_pin virker ikke for en som må bytte (pin_satt_at null igjen), men endre_pin_etter_nodbrems gjør og setter pin_satt_at',
    v = 'IKKE_INNLOGGET' and v2 = 'ok' and v_pinsett = now(), v || ' / ' || v2);
  v := pg_temp._n_verdi(c_b_ny, 'public.endre_egen_pin(''' || pin_ny2 || ''')');
  insert into _res(navn, ok, info) values ('N27b vanlig endre_egen_pin virker igjen etterpå og setter pin_satt_at', v = 'ok', v);

  -- ===== Varsel ved den automatiske sperren =====
  delete from public.pin_global_forsok;
  update public.sikkerhet_tilstand set global_sperre_varslet_at = null where id = 1;
  insert into public.pin_global_forsok (tidspunkt) select now() from generate_series(1, 28);
  v_k0 := pg_temp._n_kø();
  perform public._pin_rate_limit_global_registrer(false); -- 29
  v_k1 := pg_temp._n_kø();
  insert into _res(navn, ok, info) values ('V1 forsøk nr. 29 gir ikke varsel', v_k1 = v_k0 and (select global_sperre_varslet_at from public.sikkerhet_tilstand) is null, v_k0 || '->' || v_k1);
  perform public._pin_rate_limit_global_registrer(false); -- 30
  v_k1 := pg_temp._n_kø();
  insert into _res(navn, ok, info) values ('V2 forsøk nr. 30 (sperren slår inn) gir ETT push-varsel med type pin_global_sperre/global_sperre og server-hemmeligheten',
    v_k1 = v_k0 + 1 and (select global_sperre_varslet_at from public.sikkerhet_tilstand) = now()
    and (select convert_from(body, 'utf8')::jsonb->>'hendelse' = 'global_sperre' and (headers->>'x-server-secret') = (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_server_secret')
         from net.http_request_queue where url like '%/functions/v1/send-push' order by id desc limit 1), v_k0 || '->' || v_k1);
  perform public._pin_rate_limit_global_registrer(false);
  perform public._pin_rate_limit_global_registrer(false);
  v_k0 := pg_temp._n_kø();
  insert into _res(navn, ok, info) values ('V3 flere forsøk innen 10 min gir ikke flere varsler', v_k0 = v_k1, v_k1 || '->' || v_k0);
  update public.sikkerhet_tilstand set global_sperre_varslet_at = now() - interval '11 minutes' where id = 1;
  perform public._pin_rate_limit_global_registrer(false);
  insert into _res(navn, ok, info) values ('V4 etter 10 min kan et nytt varsel gå', pg_temp._n_kø() = v_k0 + 1, '');
  v_k0 := pg_temp._n_kø();
  perform public._pin_rate_limit_global_registrer(true);
  insert into _res(navn, ok, info) values ('V5 et vellykket forsøk gir aldri varsel og ingen ny rad', pg_temp._n_kø() = v_k0, '');
  v := pg_temp._n_innlogg(jsonb_build_object('role','authenticated','sub',u[5]), pin_ny);
  insert into _res(navn, ok, info) values ('V6 selve sperren er uendret: med 30+ forsøk stoppes også admin (FOR_MANGE_FORSOK_GLOBALT)', v = 'FOR_MANGE_FORSOK_GLOBALT', v);
  -- Mangler Vault-hemmeligheten: varselet hoppes over, innloggings-registreringen feiler ikke.
  delete from vault.secrets where name = 'send_push_server_secret';
  update public.sikkerhet_tilstand set global_sperre_varslet_at = null where id = 1;
  v_k0 := pg_temp._n_kø();
  begin
    perform public._pin_rate_limit_global_registrer(false);
    v := 'ok';
  exception when others then v := sqlerrm;
  end;
  insert into _res(navn, ok, info) values ('V7 uten server-hemmelighet i Vault: ingen feil, intet varsel køet', v = 'ok' and pg_temp._n_kø() = v_k0, v);

  -- Tilbake til normal drift (i transaksjonen), så en test som kjøres etter denne i samme transaksjon starter rent.
  update public.sikkerhet_tilstand set nodbrems_aktiv = false, nodbrems_siden = null, nodbrems_av = null, nodbrems_auth_uid = null,
    nodbrems_opphevet_at = null, nodbrems_opphevet_av = null, ny_pin_kreves_fra = null, global_sperre_varslet_at = null where id = 1;
  delete from public.pin_global_forsok;
  delete from public.pin_forsok where auth_uid = any(u);
end $test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
