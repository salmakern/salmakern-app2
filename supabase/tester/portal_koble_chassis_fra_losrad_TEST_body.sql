-- Test av portal_koble_chassis_fra_losrad + v6 av portal_koble_bestilling (migrasjon
-- 20261101000000, s90-20261101-1). ALLTID i en transaksjon som rulles tilbake.
-- Bruker EKTE kontakter bare til lesing (AK Auto AS = k_portal_akauto, Autostrada Seljord AS = k2).
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261031150000_portal_modell_slug_matching.sql; cat supabase/migrations/20261101000000_portal_koble_chassis_fra_losrad.sql; cat supabase/tester/portal_koble_chassis_fra_losrad_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok = true.

create temp table _res (n serial, navn text, ok boolean, info text);
insert into public.portal_modell_kobling (portal_modell_slug, merke, modell, godkjent_av) values ('testlosrad', 'TESTMERKE', 'TESTMODELL', 'test');

do $test$
declare
  r jsonb; r2 jsonb; r3 jsonb; o public.ordrer%rowtype; v_o2 public.ordrer%rowtype;
  v_ark_id text; v_ark_id2 text; v_bestilling_id text; v_n int;
  c_a constant text := 'k_portal_akauto'; c_org_a constant text := '831862122';
  c_b constant text := 'k2';              c_org_b constant text := '927975564';
  v_admin_id bigint; v_admin_tok text; v_ikke_admin_id bigint; v_ikke_admin_tok text;
  v_feil text; v_ordre_id text;
begin
  select id, coalesce(session_token,'') into v_admin_id, v_admin_tok from public.ansatte where aktiv and rolle = 'admin' order by id limit 1;
  select id, coalesce(session_token,'') into v_ikke_admin_id, v_ikke_admin_tok from public.ansatte where aktiv and rolle = 'ansatt' order by id limit 1;

  -- ===== Hjelper: lag en SERIENUMMER-bestilling (løs Admin-ark-rad), returner admin_ark_id =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0001', 'nr', 'B-TEST-LR1', 'ident_type', 'SERIENUMMER', 'ident', 'LR 0001',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'selger_epost', 'andreas.akauto@gmail.com', 'modell_slug', 'testlosrad',
        'linjer', jsonb_build_array(jsonb_build_object('produktnummer','501','navn','Takluke','rabatt_prosent',12))));
  select admin_ark_id into v_ark_id from public.portal_bestillinger where portal_bestilling_id = 'testlr0001';
  insert into _res(navn, ok, info) values ('Forberedelse: SERIENUMMER-bestilling ga løs Admin-ark-rad', r->>'status' = 'admin_ark' and v_ark_id is not null, r::text);

  -- ===== T1: ikke-admin avvises =====
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ikke_admin_id, 'session_token', v_ikke_admin_tok)::text, true);
  begin
    perform public.portal_koble_chassis_fra_losrad(v_ark_id, 'TESTWXYZ000000101');
    v_feil := 'ingen feil';
  exception when others then
    v_feil := sqlerrm;
  end;
  insert into _res(navn, ok, info) values ('T1 ikke-admin ansatt avvises (KUN_ADMIN)', v_feil = 'KUN_ADMIN', v_feil);

  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin_id, 'session_token', v_admin_tok)::text, true);

  -- ===== T2: ukjent/garbage admin_ark_id -> tilknyttet false =====
  r := public.portal_koble_chassis_fra_losrad('finnes_ikke_som_id', 'TESTWXYZ000000102');
  insert into _res(navn, ok, info) values ('T2 ukjent admin_ark_id: tilknyttet=false', (r->>'tilknyttet')::boolean = false, r::text);

  -- ===== T3: vanlig (ikke-portal) Admin-ark-rad -> tilknyttet false, klienten faller tilbake til vanlig flyt =====
  insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, forhandler, kontaktperson, serienummer, merknader)
  values ('ark_test_vanlig', '', extract(year from now())::int, 999001, 'En Vanlig Kunde', 'Kari Nordmann', '', '');
  r := public.portal_koble_chassis_fra_losrad('ark_test_vanlig', 'TESTWXYZ000000103');
  insert into _res(navn, ok, info) values ('T3 vanlig (ikke-portal) Admin-ark-rad: tilknyttet=false, ingen ordre opprettet av denne funksjonen', (r->>'tilknyttet')::boolean = false and not exists (select 1 from public.ordrer where chassis = 'TESTWXYZ000000103'), r::text);

  -- ===== T4: hovedveien - chassis blir kjent, ordre opprettes og kobles, linjer følger med =====
  -- (simulerer at adminArkLagreFelter allerede har satt chassis_nr på raden FØR denne RPC-en kalles, som i den ekte klientflyten)
  update public.admin_ark set chassis_nr = 'TESTWXYZ000000104' where id = v_ark_id;
  r := public.portal_koble_chassis_fra_losrad(v_ark_id, 'testwxyz-000000104');
  v_ordre_id := r->'resultat'->>'ordre_id';
  insert into _res(navn, ok, info) values ('T4 tilknyttet=true, resultat kode ok status ny_ordre', (r->>'tilknyttet')::boolean = true and r->'resultat'->>'kode' = 'ok' and r->'resultat'->>'status' = 'ny_ordre', r::text);
  select * into o from public.ordrer where id = v_ordre_id;
  insert into _res(navn, ok, info) values ('T4 ordre: chassis normalisert, på vei, aktiv, portal_bestilling_id satt, IKKE bekreftet', o.chassis = 'TESTWXYZ000000104' and o.ordre_status = 'paa_vei' and o.status = 'aktiv' and o.portal_bestilling_id = 'testlr0001' and o.portal_bekreftet_at is null, row(o.chassis, o.ordre_status, o.portal_bestilling_id)::text);
  insert into _res(navn, ok, info) values ('T4 forhandler/modell fra Kontakter/kobling, som for en vanlig chassis-bestilling', o.kunde = 'AK Auto AS' and o.merke = 'TESTMERKE' and o.modell = 'TESTMODELL', row(o.kunde,o.merke,o.modell)::text);
  insert into _res(navn, ok, info) values ('T4 linjer fra den ORIGINALE serienummer-bestillingen havnet på ordrer.portal_linjer', jsonb_array_length(o.portal_linjer) = 1 and o.portal_linjer->0->>'produktnummer' = '501' and (o.portal_linjer->0->>'rabatt_prosent')::numeric = 12, coalesce(o.portal_linjer::text,'null'));
  insert into _res(navn, ok, info) values ('T4 portal_bestillinger: status ny_ordre, ordre_id satt', (select status from public.portal_bestillinger where portal_bestilling_id = 'testlr0001') = 'ny_ordre' and (select ordre_id from public.portal_bestillinger where portal_bestilling_id = 'testlr0001') = v_ordre_id, '');

  -- ===== T5: idempotent - kaller samme rad/chassis på nytt gir SAMME ordre, ingen duplikat =====
  r2 := public.portal_koble_chassis_fra_losrad(v_ark_id, 'TESTWXYZ000000104');
  select count(*) into v_n from public.ordrer where portal_bestilling_id = 'testlr0001';
  insert into _res(navn, ok, info) values ('T5 kall nummer to på samme rad: samme ordre, ingen duplikat', r2->'resultat'->>'ordre_id' = v_ordre_id and v_n = 1, r2::text);

  -- ===== T6: eksisterende aktiv ordre, SAMME forhandler, ikke hentet -> koblet uten å røre ordren =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0002', 'nr', 'B-TEST-LR2', 'ident_type', 'SERIENUMMER', 'ident', 'LR 0002',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testlosrad'));
  select admin_ark_id into v_ark_id2 from public.portal_bestillinger where portal_bestilling_id = 'testlr0002';
  update public.admin_ark set chassis_nr = 'TESTWXYZ000000104' where id = v_ark_id2;
  r2 := public.portal_koble_chassis_fra_losrad(v_ark_id2, 'TESTWXYZ000000104');
  insert into _res(navn, ok, info) values ('T6 samme chassis som en eksisterende aktiv ordre, samme forhandler: koblet, ikke ny ordre', r2->'resultat'->>'status' = 'koblet' and r2->'resultat'->>'ordre_id' = v_ordre_id, r2::text);
  select * into o from public.ordrer where id = v_ordre_id;
  insert into _res(navn, ok, info) values ('T6 den eksisterende ordren er IKKE endret (portal_bestilling_id fortsatt testlr0001)', o.portal_bestilling_id = 'testlr0001', o.portal_bestilling_id);

  -- ===== T7: eksisterende aktiv ordre, ANNEN forhandler -> avklaring_annen_forhandler =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0003', 'nr', 'B-TEST-LR3', 'ident_type', 'SERIENUMMER', 'ident', 'LR 0003',
        'kontakt_id', c_b, 'orgnr', c_org_b, 'selger_navn', 'Annen Selger', 'modell_slug', 'testlosrad'));
  select admin_ark_id into v_ark_id2 from public.portal_bestillinger where portal_bestilling_id = 'testlr0003';
  update public.admin_ark set chassis_nr = 'TESTWXYZ000000104' where id = v_ark_id2;
  r2 := public.portal_koble_chassis_fra_losrad(v_ark_id2, 'TESTWXYZ000000104');
  insert into _res(navn, ok, info) values ('T7 samme chassis, annen forhandler: avklaring_annen_forhandler, ingen ny ordre', r2->'resultat'->>'status' = 'avklaring_annen_forhandler' and r2->'resultat'->>'kode' = 'trenger_avklaring', r2::text);
  select count(*) into v_n from public.ordrer where chassis = 'TESTWXYZ000000104';
  insert into _res(navn, ok, info) values ('T7 fortsatt bare én ordre på dette chassisnummeret', v_n = 1, v_n::text);

  -- ===== T8: eksisterende ordre er "hentet" men ikke arkivert -> avklaring_chassis =====
  update public.ordrer set ordre_status = 'hentet' where id = v_ordre_id;
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0004', 'nr', 'B-TEST-LR4', 'ident_type', 'SERIENUMMER', 'ident', 'LR 0004',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testlosrad'));
  select admin_ark_id into v_ark_id2 from public.portal_bestillinger where portal_bestilling_id = 'testlr0004';
  update public.admin_ark set chassis_nr = 'TESTWXYZ000000104' where id = v_ark_id2;
  r2 := public.portal_koble_chassis_fra_losrad(v_ark_id2, 'TESTWXYZ000000104');
  insert into _res(navn, ok, info) values ('T8 chassis på en ordre som er hentet-men-ikke-arkivert: avklaring_chassis', r2->'resultat'->>'status' = 'avklaring_chassis', r2::text);

  -- ===== T9: flere aktive ordrer på samme chassis -> avklaring_chassis =====
  update public.ordrer set ordre_status = 'paa_vei' where id = v_ordre_id; -- rydd T8 sin tilstand
  -- Lag to HELT VANLIGE ordre via funksjonen (fullt gyldig radform), og tving dem deretter til
  -- samme chassis med en enkel UPDATE - trygere enn å gjette en manuell INSERT sin fulle kolonneliste.
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0005dup1', 'nr', 'B-TEST-LR5D1', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000106',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'S', 'modell_slug', 'testlosrad'));
  update public.ordrer set chassis = 'TESTWXYZ000000105' where id = r->>'ordre_id';
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0005dup2', 'nr', 'B-TEST-LR5D2', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000107',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'S', 'modell_slug', 'testlosrad'));
  update public.ordrer set chassis = 'TESTWXYZ000000105' where id = r->>'ordre_id';
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0005', 'nr', 'B-TEST-LR5', 'ident_type', 'SERIENUMMER', 'ident', 'LR 0005',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testlosrad'));
  select admin_ark_id into v_ark_id2 from public.portal_bestillinger where portal_bestilling_id = 'testlr0005';
  update public.admin_ark set chassis_nr = 'TESTWXYZ000000105' where id = v_ark_id2;
  r2 := public.portal_koble_chassis_fra_losrad(v_ark_id2, 'TESTWXYZ000000105');
  insert into _res(navn, ok, info) values ('T9 flere aktive ordrer på samme chassis: avklaring_chassis', r2->'resultat'->>'status' = 'avklaring_chassis', r2::text);

  -- ===== T10: ugyldig chassis-format forplantes som feil fra portal_koble_bestilling (ikke slukt) =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0006', 'nr', 'B-TEST-LR6', 'ident_type', 'SERIENUMMER', 'ident', 'LR 0006',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testlosrad'));
  select admin_ark_id into v_ark_id2 from public.portal_bestillinger where portal_bestilling_id = 'testlr0006';
  begin
    perform public.portal_koble_chassis_fra_losrad(v_ark_id2, 'for-kort');
    v_feil := 'ingen feil';
  exception when others then
    v_feil := sqlerrm;
  end;
  insert into _res(navn, ok, info) values ('T10 ugyldig chassis-format gir UGYLDIG_INPUT (ikke slukt av wrapperen)', v_feil = 'UGYLDIG_INPUT: chassis', v_feil);
  insert into _res(navn, ok, info) values ('T10 raden sto fortsatt som admin_ark etter den avviste forespørselen', (select status from public.portal_bestillinger where portal_bestilling_id = 'testlr0006') = 'admin_ark', '');

  -- ===== T11: rettigheter =====
  insert into _res(navn, ok, info) values ('T11 authenticated og service_role kan kalle funksjonen, ikke anon/public',
    has_function_privilege('authenticated', 'public.portal_koble_chassis_fra_losrad(text,text)', 'execute')
    and has_function_privilege('service_role', 'public.portal_koble_chassis_fra_losrad(text,text)', 'execute')
    and not has_function_privilege('anon', 'public.portal_koble_chassis_fra_losrad(text,text)', 'execute'), '');

  -- ===== T12 REGRESJON (v5 -> v6): portalens vanlige kall på en admin_ark-rad er UENDRET (ingen kjor_pa_nytt = fortsatt kort-sluttet) =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0007', 'nr', 'B-TEST-LR7', 'ident_type', 'SERIENUMMER', 'ident', 'LR 0007',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testlosrad'));
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0007', 'nr', 'B-TEST-LR7', 'ident_type', 'SERIENUMMER', 'ident', 'LR 0007',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testlosrad'));
  insert into _res(navn, ok, info) values ('T12 portalens vanlige nytt forsøk på en admin_ark-rad (uten kjor_pa_nytt): fortsatt bare {kode:ok,status:admin_ark}, ingen ny rad',
    r2->>'kode' = 'ok' and r2->>'status' = 'admin_ark' and (select array_agg(k order by k) from jsonb_object_keys(r2) k) = array['kode','status']
    and (select count(*) from public.admin_ark where serienummer = 'LR 0007') = 1, r2::text);

  -- ===== T13 REGRESJON: en helt vanlig CHASSIS-bestilling fra start til slutt er fortsatt uendret av v6 =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlr0008', 'nr', 'B-TEST-LR8', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000108',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testlosrad'));
  insert into _res(navn, ok, info) values ('T13 vanlig chassis-bestilling (uberørt av v6): ny_ordre som før', r->>'kode' = 'ok' and r->>'status' = 'ny_ordre', r::text);
end
$test$;

select n, case when ok then 'OK  ' else 'FEIL' end as resultat, navn, case when ok then '' else info end as info from _res order by n;
