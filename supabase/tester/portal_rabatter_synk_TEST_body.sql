-- Test av 20261105130000_portal_rabatter_synk.sql. ALLTID i en transaksjon som rulles tilbake.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261105130000_portal_rabatter_synk.sql; cat supabase/tester/portal_rabatter_synk_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  r jsonb; v_rad portal_kunde_rabatt%rowtype;
begin
  -- T1: kun service_role kan kalle funksjonen
  insert into _res(navn, ok, info) values ('T1 bare service_role har kjøretillatelse (ikke anon/authenticated/public)',
    has_function_privilege('service_role', 'public.portal_rabatter_synk(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.portal_rabatter_synk(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_rabatter_synk(jsonb)', 'execute'), null);

  -- T1b: RLS er på, og bare admin kan lese direkte
  insert into _res(navn, ok, info) values ('T1b RLS er slått på for portal_kunde_rabatt',
    (select relrowsecurity from pg_class where relname = 'portal_kunde_rabatt'), null);

  -- Oppsett: sett ett Kontakter-forhandler for "kjent kontakt_id"-sjekken (rulles tilbake uansett)
  update innstillinger set kontakter = jsonb_build_array(
    jsonb_build_object('id', 'k_test_kjent', 'navn', 'TEST Forhandler', 'type', 'Forhandler', 'kontaktpersoner', '[]'::jsonb)
  ) where id = 1;

  -- T2: ugyldig input (ikke en liste) avvises
  begin perform portal_rabatter_synk('{}'::jsonb); insert into _res(navn, ok, info) values ('T2 ugyldig input (objekt, ikke liste) avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2 ugyldig input (objekt, ikke liste) avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  -- T3: første kjøring - oppretter rader, teller ukjent kontakt_id og ugyldig rad riktig
  r := portal_rabatter_synk(jsonb_build_array(
    jsonb_build_object('portal_forhandler_id', 'pf_1', 'kontakt_id', 'k_test_kjent', 'kontakt_navn', 'TEST Forhandler', 'orgnr', '999888777', 'rabatt_standard', 20, 'rabatt_ekstrautstyr', 10, 'rabatt_modulsystem', 0),
    jsonb_build_object('portal_forhandler_id', 'pf_2', 'kontakt_id', 'k_ukjent_i_kontakter', 'kontakt_navn', 'TEST Forhandler 2', 'orgnr', null, 'rabatt_standard', null, 'rabatt_ekstrautstyr', null, 'rabatt_modulsystem', null),
    jsonb_build_object('portal_forhandler_id', '', 'kontakt_id', 'k_test_kjent', 'kontakt_navn', 'Ugyldig - tom id', 'orgnr', null, 'rabatt_standard', 0, 'rabatt_ekstrautstyr', 0, 'rabatt_modulsystem', 0),
    jsonb_build_object('portal_forhandler_id', 'pf_3', 'kontakt_id', null, 'kontakt_navn', 'Ugyldig - mangler kontakt_id', 'orgnr', null, 'rabatt_standard', 0, 'rabatt_ekstrautstyr', 0, 'rabatt_modulsystem', 0)
  ));
  insert into _res(navn, ok, info) values ('T3 to gyldige rader opprettet', (r->>'opprettet')::int = 2, r::text);
  insert into _res(navn, ok, info) values ('T3 to ugyldige rader (tom/manglende id) telles og lagres ikke', (r->>'ugyldigRad')::int = 2, r::text);
  insert into _res(navn, ok, info) values ('T3 én rad med ukjent kontakt_id telles, men lagres likevel', (r->>'ukjentKontaktId')::int = 1, r::text);

  select * into v_rad from portal_kunde_rabatt where portal_forhandler_id = 'pf_1';
  insert into _res(navn, ok, info) values ('T3 pf_1 lagret med riktige satser', v_rad.rabatt_standard = 20 and v_rad.rabatt_ekstrautstyr = 10 and v_rad.rabatt_modulsystem = 0, to_jsonb(v_rad)::text);
  select * into v_rad from portal_kunde_rabatt where portal_forhandler_id = 'pf_2';
  insert into _res(navn, ok, info) values ('T3 pf_2 (ukjent kontakt_id) likevel lagret, med NULL-satser (ikke 0)', found and v_rad.rabatt_standard is null and v_rad.rabatt_ekstrautstyr is null and v_rad.rabatt_modulsystem is null, to_jsonb(v_rad)::text);
  insert into _res(navn, ok, info) values ('T3 ingen rad for tom/manglende portal_forhandler_id', not exists (select 1 from portal_kunde_rabatt where kontakt_navn in ('Ugyldig - tom id', 'Ugyldig - mangler kontakt_id')), null);

  -- T4: idempotens - andre kjøring med SAMME input endrer ingenting mer
  r := portal_rabatter_synk(jsonb_build_array(
    jsonb_build_object('portal_forhandler_id', 'pf_1', 'kontakt_id', 'k_test_kjent', 'kontakt_navn', 'TEST Forhandler', 'orgnr', '999888777', 'rabatt_standard', 20, 'rabatt_ekstrautstyr', 10, 'rabatt_modulsystem', 0)
  ));
  insert into _res(navn, ok, info) values ('T4 idempotens: uendret ved identisk gjenkjøring', (r->>'uendret')::int = 1 and (r->>'opprettet')::int = 0 and (r->>'oppdatert')::int = 0, r::text);

  -- T5: en faktisk endring (ny sats) teller som oppdatert, ikke opprettet - og endrer raden
  r := portal_rabatter_synk(jsonb_build_array(
    jsonb_build_object('portal_forhandler_id', 'pf_1', 'kontakt_id', 'k_test_kjent', 'kontakt_navn', 'TEST Forhandler', 'orgnr', '999888777', 'rabatt_standard', 25, 'rabatt_ekstrautstyr', 10, 'rabatt_modulsystem', 0)
  ));
  insert into _res(navn, ok, info) values ('T5 endret sats telles som oppdatert', (r->>'oppdatert')::int = 1 and (r->>'opprettet')::int = 0, r::text);
  select * into v_rad from portal_kunde_rabatt where portal_forhandler_id = 'pf_1';
  insert into _res(navn, ok, info) values ('T5 ny sats faktisk lagret', v_rad.rabatt_standard = 25, to_jsonb(v_rad)::text);

  -- T6: samme kontakt_id på FLERE portal_forhandler_id (delt Kontakter-kontakt, f.eks. BOS-gruppen) er bevisst lov
  r := portal_rabatter_synk(jsonb_build_array(
    jsonb_build_object('portal_forhandler_id', 'pf_4', 'kontakt_id', 'k_test_kjent', 'kontakt_navn', 'TEST Forhandler avd. 2', 'orgnr', '999888777', 'rabatt_standard', 15, 'rabatt_ekstrautstyr', 5, 'rabatt_modulsystem', 0)
  ));
  insert into _res(navn, ok, info) values ('T6 delt kontakt_id på flere portal_forhandler_id er lov (ny rad opprettet)', (r->>'opprettet')::int = 1, r::text);
  insert into _res(navn, ok, info) values ('T6 to rader med samme kontakt_id finnes nå', (select count(*) from portal_kunde_rabatt where kontakt_id = 'k_test_kjent') = 2, null);

  -- T7: check-constraint stopper en umulig sats selv om den skulle slippe forbi edge-funksjonen
  begin
    insert into portal_kunde_rabatt (portal_forhandler_id, kontakt_id, kontakt_navn, rabatt_standard) values ('pf_ugyldig', 'k_test_kjent', 'X', 101);
    insert into _res(navn, ok, info) values ('T7 check-constraint avviser sats over 100', false, 'ingen feil kastet');
  exception when others then
    insert into _res(navn, ok, info) values ('T7 check-constraint avviser sats over 100', sqlstate = '23514', sqlerrm);
  end;
end;
$test$;

select navn, ok, info from _res order by n;
