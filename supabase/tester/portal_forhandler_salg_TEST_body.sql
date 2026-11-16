-- Test av 20261116110000_portal_forhandler_salg.sql (sjekkene S1-S11). ALLTID i en transaksjon som rulles tilbake: testen setter inn TEST-ordrer
-- (id-prefiks ord_test_fs_) - alt rulles tilbake, rører aldri ekte data (sjekkene leter bare etter de egne test-radene; ekte grupper telles bare, aldri vist).
-- Ingen UPDATE på ordrer (triggerne «ordre-push»/«ordre-status-*» er AFTER UPDATE): radene settes inn med riktige verdier fra starten.
--
-- Kjøring (fra rotmappen). Dette er et SKRIVENDE steg (rader i en transaksjon): krever Henriks ja, og ikke mellom 00:00 og 03:00:
--   ( echo "begin;"; cat supabase/migrations/20261116110000_portal_forhandler_salg.sql; cat supabase/tester/portal_forhandler_salg_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader skal være OK. Etterpå: to_regprocedure('public.portal_forhandler_salg(text[])') er fortsatt null (transaksjonen ble rullet tilbake).

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  r jsonb; v_grupper jsonb; v_o1 int; v_o2 int; v_feil text; v_ok boolean;
begin
  -- ===== S1 Bare service_role kan kalle funksjonen =====
  insert into _res(navn, ok, info) values ('S1 bare service_role har kjøretillatelse (ikke anon, authenticated eller public)',
    has_function_privilege('service_role', 'public.portal_forhandler_salg(text[])', 'execute')
    and not has_function_privilege('anon', 'public.portal_forhandler_salg(text[])', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_forhandler_salg(text[])', 'execute')
    and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.portal_forhandler_salg(text[])'::regprocedure and a.grantee = 0), null);

  -- ===== S2 Stable og security invoker (kan ikke skrive, ingen utvidede rettigheter) =====
  insert into _res(navn, ok, info) values ('S2 stable (provolatile = s) og security invoker (prosecdef = false)',
    (select p.provolatile = 's' and p.prosecdef = false from pg_proc p where p.oid = 'public.portal_forhandler_salg(text[])'::regprocedure), null);

  -- ===== Oppsett: TEST-ordrer (rulles tilbake uansett) =====
  -- a: to fakturerte ordre, samme forhandler+modell -> skal summeres til ÉN gruppe med antall_ordre=2.
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, fakturert, forhandler_kontakt_id, portal_modell_slug, fiken_linjer, created_at, updated_at) values
    ('ord_test_fs_a1', 'bil', 'TEST', 'TESTCHASSISFS0000001', '', 'KIA', 'EV9', 'hentet', 'aktiv', true, 'k_test_fs_a', 'kia-ev9',
     '[{"antall":1,"pris":51500,"produktnummer":"500"},{"antall":1,"pris":3750,"produktnummer":"521"}]'::jsonb, now(), now()),
    ('ord_test_fs_a2', 'bil', 'TEST', 'TESTCHASSISFS0000002', '', 'KIA', 'EV9', 'hentet', 'aktiv', true, 'k_test_fs_a', 'kia-ev9',
     '[{"antall":1,"belop":50000}]'::jsonb, now(), now());
  -- b: annen forhandler, annen modell, med skjulte tegn og dobbelt mellomrom i merke/modell (skal renses).
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, fakturert, forhandler_kontakt_id, portal_modell_slug, fiken_linjer, created_at, updated_at) values
    ('ord_test_fs_b1', 'bil', 'TEST', 'TESTCHASSISFS0000003', '', chr(8203) || 'Land  Rover', 'Defender  110' || chr(8203), 'hentet', 'aktiv', true, 'k_test_fs_b', null,
     '[{"antall":2,"pris":1000}]'::jsonb, now(), now());
  -- c: linje med ugyldige tall (streng i stedet for tall) - skal regnes som 0, ikke kaste.
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, fakturert, forhandler_kontakt_id, portal_modell_slug, fiken_linjer, created_at, updated_at) values
    ('ord_test_fs_c1', 'bil', 'TEST', 'TESTCHASSISFS0000004', '', 'TEST-MERKE-C', 'TEST-MODELL-C', 'hentet', 'aktiv', true, 'k_test_fs_c', null,
     '[{"antall":"ikke-et-tall","pris":"heller-ikke"},{"belop":"umulig"}]'::jsonb, now(), now());
  -- d: IKKE fakturert - skal utelates helt.
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, fakturert, forhandler_kontakt_id, portal_modell_slug, fiken_linjer, created_at, updated_at) values
    ('ord_test_fs_d1', 'bil', 'TEST', 'TESTCHASSISFS0000005', '', 'TEST-MERKE-D', 'TEST-MODELL-D', 'ikke_hentet', 'aktiv', false, 'k_test_fs_d', null,
     '[{"antall":1,"pris":99999}]'::jsonb, now(), now());
  -- e: fakturert, men INGEN forhandler_kontakt_id - skal utelates helt.
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, fakturert, forhandler_kontakt_id, portal_modell_slug, fiken_linjer, created_at, updated_at) values
    ('ord_test_fs_e1', 'bil', 'TEST', 'TESTCHASSISFS0000006', '', 'TEST-MERKE-E', 'TEST-MODELL-E', 'hentet', 'aktiv', true, null, null,
     '[{"antall":1,"pris":99999}]'::jsonb, now(), now());
  -- f: fakturert, forhandler satt, men ORDRETYPE = leveranse (ikke bil) - skal utelates helt.
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, fakturert, forhandler_kontakt_id, portal_modell_slug, fiken_linjer, created_at, updated_at) values
    ('ord_test_fs_f1', 'leveranse', 'TEST', '', '', 'TEST-MERKE-F', 'TEST-MODELL-F', 'under_arbeid', 'aktiv', true, 'k_test_fs_f', null,
     '[{"antall":1,"pris":99999}]'::jsonb, now(), now());

  select count(*) into v_o1 from public.ordrer where id like 'ord_test_fs_%';
  insert into _res(navn, ok, info) values ('Oppsett: 7 TEST-ordre satt inn', v_o1 = 7, v_o1::text);

  -- ===== S3 Grunnkall: henter grupper for alle TEST-forhandlerne, radantall uendret før/etter =====
  r := public.portal_forhandler_salg(array['k_test_fs_a','k_test_fs_b','k_test_fs_c','k_test_fs_d','k_test_fs_e','k_test_fs_f']);
  select count(*) into v_o2 from public.ordrer where id like 'ord_test_fs_%';
  insert into _res(navn, ok, info) values ('S3 radantallet i ordrer er likt før og etter et kall (funksjonen skriver aldri)', v_o1 = v_o2, null);
  insert into _res(navn, ok, info) values ('S3 toppnivå-formen er versjon 1, generert, grupper', (r ? 'versjon') and (r ? 'generert') and (r ? 'grupper') and (r->>'versjon')::int = 1, null);
  v_grupper := r->'grupper';

  -- ===== S4 Gruppe a: to ordre, samme forhandler+modell, slått sammen til ÉN gruppe med summert beløp og riktig antall =====
  select g into r from jsonb_array_elements(v_grupper) g where g->>'forhandler_kontakt_id' = 'k_test_fs_a' limit 1;
  insert into _res(navn, ok, info) values ('S4 forhandler a: nøyaktig 1 gruppe (ikke 2, selv om 2 ordre)',
    (select count(*) from jsonb_array_elements(v_grupper) g where g->>'forhandler_kontakt_id' = 'k_test_fs_a') = 1, null);
  insert into _res(navn, ok, info) values ('S4 forhandler a: antall_ordre = 2', (r->>'antall_ordre')::int = 2, r->>'antall_ordre');
  insert into _res(navn, ok, info) values ('S4 forhandler a: beløp = 51500+3750+50000 = 105250 (pris×antall + belop summert riktig)',
    (r->>'fakturert_belop_eks_mva')::numeric = 105250, r->>'fakturert_belop_eks_mva');
  insert into _res(navn, ok, info) values ('S4 forhandler a: portal_modell_slug = kia-ev9', r->>'portal_modell_slug' = 'kia-ev9', r->>'portal_modell_slug');

  -- ===== S5 Gruppe b: tekstrensing (skjulte tegn fjernet, dobbelt mellomrom til ett), beløp = 2 x 1000 = 2000, slug null =====
  select g into r from jsonb_array_elements(v_grupper) g where g->>'forhandler_kontakt_id' = 'k_test_fs_b' limit 1;
  insert into _res(navn, ok, info) values ('S5 merke renset ("Land Rover" uten skjult tegn/dobbelt mellomrom)', r->>'merke' = 'Land Rover', r->>'merke');
  insert into _res(navn, ok, info) values ('S5 modell renset ("Defender 110" uten skjult tegn/dobbelt mellomrom)', r->>'modell' = 'Defender 110', r->>'modell');
  insert into _res(navn, ok, info) values ('S5 beløp = 2 x 1000 = 2000', (r->>'fakturert_belop_eks_mva')::numeric = 2000, r->>'fakturert_belop_eks_mva');
  insert into _res(navn, ok, info) values ('S5 portal_modell_slug er null (ikke satt på ordren)', r->'portal_modell_slug' = 'null'::jsonb, null);

  -- ===== S6 Gruppe c: ugyldige tall i fiken_linjer gir 0 per linje, ikke en kastet feil =====
  select g into r from jsonb_array_elements(v_grupper) g where g->>'forhandler_kontakt_id' = 'k_test_fs_c' limit 1;
  insert into _res(navn, ok, info) values ('S6 ugyldige tall i fiken_linjer kaster ikke og gir 0, gruppen finnes fortsatt', r is not null and (r->>'fakturert_belop_eks_mva')::numeric = 0, null);

  -- ===== S7 Filtrering: ikke-fakturert (d), ingen forhandler (e) og ikke-bil (f) er ALDRI med, uansett filter =====
  r := public.portal_forhandler_salg(null); -- alle forhandlere
  insert into _res(navn, ok, info) values ('S7 ikke-fakturert ordre (d) er aldri med, selv uten filter',
    not exists (select 1 from jsonb_array_elements(r->'grupper') g where g->>'forhandler_kontakt_id' = 'k_test_fs_d'), null);
  insert into _res(navn, ok, info) values ('S7 fakturert ordre uten forhandler_kontakt_id (e) gir ingen gruppe for k_test_fs_e',
    not exists (select 1 from jsonb_array_elements(r->'grupper') g where g->>'forhandler_kontakt_id' = 'k_test_fs_e'), null);
  insert into _res(navn, ok, info) values ('S7 fakturert leveranse (f, ikke ordretype=bil) er aldri med',
    not exists (select 1 from jsonb_array_elements(r->'grupper') g where g->>'forhandler_kontakt_id' = 'k_test_fs_f'), null);

  -- ===== S8 p_forhandler_kontakt_ider begrenser resultatet =====
  r := public.portal_forhandler_salg(array['k_test_fs_a']);
  insert into _res(navn, ok, info) values ('S8 filter på én forhandler: bare den forhandleren kommer tilbake',
    (select count(*) from jsonb_array_elements(r->'grupper') g) = 1
    and (select g->>'forhandler_kontakt_id' from jsonb_array_elements(r->'grupper') g limit 1) = 'k_test_fs_a', null);
  r := public.portal_forhandler_salg(array['k_test_fs_ingen_slik']);
  insert into _res(navn, ok, info) values ('S8 filter på en forhandler uten treff gir tom liste, ikke feil', (r->'grupper') = '[]'::jsonb, null);

  -- ===== S9 Ugyldig id i p_forhandler_kontakt_ider kaster UGYLDIG_INPUT =====
  begin
    perform public.portal_forhandler_salg(array['gyldig', 'ugyldig id med mellomrom']);
    v_ok := false;
  exception when others then
    v_feil := sqlerrm;
    v_ok := v_feil like 'UGYLDIG_INPUT%';
  end;
  insert into _res(navn, ok, info) values ('S9 en forhandler-id utenfor mønsteret kaster UGYLDIG_INPUT', v_ok, v_feil);

  -- ===== S10 Over 500 forhandler-id-er kaster UGYLDIG_INPUT =====
  begin
    perform public.portal_forhandler_salg((select array_agg('k' || g) from generate_series(1, 501) g));
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like 'UGYLDIG_INPUT%';
  end;
  insert into _res(navn, ok, info) values ('S10 over 500 forhandler-id-er kaster UGYLDIG_INPUT', v_ok, null);

  -- ===== S11 generert er et gyldig ISO-tidspunkt i UTC-formatet funksjonen selv bruker =====
  r := public.portal_forhandler_salg(array['k_test_fs_a']);
  insert into _res(navn, ok, info) values ('S11 generert matcher YYYY-MM-DDTHH:MI:SS.MSZ', (r->>'generert') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$', r->>'generert');
end;
$test$;

select n, navn, ok, info from _res order by n;
select count(*) as antall_feil from _res where ok is distinct from true;
