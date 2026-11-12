-- Test av portal_oppdater_bestilling_chassis (migrasjon 20261112190000). ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, ingen åpen app ser noe.
-- Bruker samme TEST-mønster som portal_bekreft_avvis_TEST_body.sql: portal_koble_bestilling lager ekte TEST-ordre/-bestillinger mot AK Auto AS
-- (k_portal_akauto, org.nr 831862122, modell kia-ev9 - må finnes i portal_modell_kobling), chassis TESTWXYZ0000000xx.
--
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261112190000_portal_oppdater_bestilling_chassis.sql; cat supabase/tester/portal_oppdater_bestilling_chassis_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha resultat OK.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  c_a constant text := 'k_portal_akauto'; c_org_a constant text := '831862122';
  v_admin bigint; v_admin_tok text;
  r jsonb; v_id text; v_id2 text; v_feil text;
  v_ident1 text; v_ident2 text;
begin
  select id, coalesce(session_token, '') into v_admin, v_admin_tok from public.ansatte where aktiv and rolle = 'admin' order by id limit 1;
  insert into _res(navn, ok, info) values ('Forutsetning: fant en aktiv admin å lage innlogging av', v_admin is not null, coalesce(v_admin::text, '-'));

  -- ===== T1: ikke innlogget =====
  perform set_config('request.jwt.claims', '', true);
  begin perform public.portal_oppdater_bestilling_chassis('ord_finnes_ikke', 'TESTWXYZ000000091'); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T1 ikke innlogget: IKKE_INNLOGGET', v_feil = 'IKKE_INNLOGGET', v_feil);

  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin, 'session_token', v_admin_tok)::text, true);

  -- ===== T2: ugyldig chassis (feil lengde, tomt) =====
  begin perform public.portal_oppdater_bestilling_chassis('ord_finnes_ikke', 'FORKORT'); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T2a for kort chassis: UGYLDIG_CHASSIS', v_feil = 'UGYLDIG_CHASSIS', v_feil);
  begin perform public.portal_oppdater_bestilling_chassis('ord_finnes_ikke', ''); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T2b tomt chassis: UGYLDIG_CHASSIS', v_feil = 'UGYLDIG_CHASSIS', v_feil);
  begin perform public.portal_oppdater_bestilling_chassis('ord_finnes_ikke', null); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T2c null chassis: UGYLDIG_CHASSIS', v_feil = 'UGYLDIG_CHASSIS', v_feil);

  -- ===== T3: ordre finnes ikke (gyldig chassis, men ordre-id er oppdiktet) =====
  begin perform public.portal_oppdater_bestilling_chassis('ord_finnes_virkelig_ikke', 'TESTWXYZ000000091'); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T3 ordre finnes ikke: ORDRE_FINNES_IKKE', v_feil = 'ORDRE_FINNES_IKKE', v_feil);

  -- ===== T4: "ny_ordre"-grenen - ordrer.portal_bestilling_id er satt, synk retter den ene raden =====
  perform set_config('request.jwt.claims', '', true);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbkchs00001', 'nr', 'B-TEST-CHS01', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000091',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  v_id := r->>'ordre_id';
  insert into _res(navn, ok, info) values ('T4 forutsetning: ny ordre opprettet med portal_bestilling_id satt', r->>'status' = 'ny_ordre' and (select portal_bestilling_id from public.ordrer where id = v_id) = 'testbkchs00001', r::text);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin, 'session_token', v_admin_tok)::text, true);
  r := public.portal_oppdater_bestilling_chassis(v_id, 'testwxyz000000092');  -- små bokstaver inn - skal normaliseres
  select ident into v_ident1 from public.portal_bestillinger where portal_bestilling_id = 'testbkchs00001';
  insert into _res(navn, ok, info) values ('T4 ident oppdatert til NY chassis (store bokstaver) for den tilknyttede bestillingen, 1 rad', r->>'kode' = 'ok' and (r->>'antall_oppdatert')::int = 1 and v_ident1 = 'TESTWXYZ000000092', r::text || ' ident=' || coalesce(v_ident1, '-'));
  insert into _res(navn, ok, info) values ('T4 selve ordren sitt chassis-felt er UENDRET (synken rører bare portal_bestillinger, ikke ordrer)', (select chassis from public.ordrer where id = v_id) = 'TESTWXYZ000000091', '');
  -- Simulerer at sf()/save() (den VANLIGE chassis-lagringen i appen) allerede har satt selve
  -- ordrens chassis til den rettede verdien - RPC-en over rører bevisst ALDRI ordrer-tabellen
  -- selv (se raden over), så dette steget gjøres normalt av noe helt annet enn funksjonen som testes her.
  update public.ordrer set chassis = 'TESTWXYZ000000092' where id = v_id;

  -- ===== T5: "koblet"-grenen - en SENERE bestilling på samme (nye) chassis kobles til samme ordre uten å sette ordrer.portal_bestilling_id på nytt =====
  perform set_config('request.jwt.claims', '', true);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbkchs00002', 'nr', 'B-TEST-CHS02', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000092',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  insert into _res(navn, ok, info) values ('T5 forutsetning: andre bestilling på (nå gjeldende) chassis ble KOBLET til samme ordre', r->>'status' = 'koblet' and r->>'ordre_id' = v_id, r::text);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin, 'session_token', v_admin_tok)::text, true);
  r := public.portal_oppdater_bestilling_chassis(v_id, 'TESTWXYZ000000093');
  select ident into v_ident1 from public.portal_bestillinger where portal_bestilling_id = 'testbkchs00001';
  select ident into v_ident2 from public.portal_bestillinger where portal_bestilling_id = 'testbkchs00002';
  insert into _res(navn, ok, info) values ('T5 BEGGE bestillingene (opprinnelig via portal_bestilling_id, koblet via ordre_id) oppdateres - 2 rader',
    r->>'kode' = 'ok' and (r->>'antall_oppdatert')::int = 2 and v_ident1 = 'TESTWXYZ000000093' and v_ident2 = 'TESTWXYZ000000093', r::text || ' idents=' || coalesce(v_ident1,'-') || '/' || coalesce(v_ident2,'-'));

  -- ===== T6: en ordre uten noen portal-tilknytning i det hele tatt - 0 rader, ingen feil =====
  insert into public.ordrer (id, kunde, chassis, merke, modell, ordre_status, status) values ('ord_test_chs_ikke_portal', 'TEST - ikke portal', 'TESTWXYZ000000099', 'Test', 'Test', 'ikke_paabegynt', 'aktiv');
  r := public.portal_oppdater_bestilling_chassis('ord_test_chs_ikke_portal', 'TESTWXYZ000000098');
  insert into _res(navn, ok, info) values ('T6 ordre uten portal-tilknytning: ok, 0 rader oppdatert, ingen feil', r->>'kode' = 'ok' and (r->>'antall_oppdatert')::int = 0, r::text);

  -- ===== T7: SERIENUMMER-rader røres aldri (defensiv sjekk - skal i praksis aldri forekomme siden slike ordre ikke får portal_bestilling_id) =====
  insert into public.portal_bestillinger (portal_bestilling_id, portal_nr, status, ident_type, ident, forhandler_kontakt_id, forhandler_orgnr, selger_navn)
  values ('testbkchs_serie', 'B-TEST-SERIE', 'mottatt', 'SERIENUMMER', 'SN-TEST-12345', c_a, c_org_a, 'Zzyzx Test Selger');
  update public.portal_bestillinger set ordre_id = v_id where portal_bestilling_id = 'testbkchs_serie';  -- kunstig oppsett for å bevise at ident_type sjekkes
  r := public.portal_oppdater_bestilling_chassis(v_id, 'TESTWXYZ000000094');
  select ident into v_ident1 from public.portal_bestillinger where portal_bestilling_id = 'testbkchs_serie';
  insert into _res(navn, ok, info) values ('T7 en SERIENUMMER-rad knyttet til samme ordre_id røres IKKE (ident_type-sjekken virker)', v_ident1 = 'SN-TEST-12345', r::text || ' ident=' || coalesce(v_ident1, '-'));
end;
$test$;

select * from _res order by n;
