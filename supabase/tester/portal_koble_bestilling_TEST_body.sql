-- Test av portal_koble_bestilling (migrasjon 20261030210000). ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, og ingen åpen app ser noe
-- (realtime sender først ved commit). Funksjonen opprettes INNI transaksjonen, så testen kan kjøres før den er kjørt for alvor.
-- Bruker EKTE kontakter bare til lesing (AK Auto AS = k_portal_akauto, Autostrada Seljord AS = k2) og en midlertidig modell-oversettelse.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261030210000_portal_koble_bestilling.sql; cat supabase/tester/portal_koble_bestilling_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok = true.

create temp table _res (n serial, navn text, ok boolean, info text);
insert into public.portal_modell_kobling (portal_modell_slug, merke, modell, godkjent_av) values ('testmodell', 'TESTMERKE', 'TESTMODELL', 'test');

do $test$
declare
  r jsonb; r2 jsonb; o public.ordrer%rowtype; a public.admin_ark%rowtype; v_real public.ordrer%rowtype;
  v_n int; v_max int; v_aar int; v_id text; v_oid text; v_ok boolean; v_feil text; i int;
  c_a constant text := 'k_portal_akauto'; c_org_a constant text := '831862122';
  c_b constant text := 'k2';              c_org_b constant text := '927975564';
  function_args jsonb; v_fk_id text; v_fk_org text; v_other text;
begin
  select * into v_real from public.ordrer where status = 'aktiv' order by created_at desc limit 1;

  -- ===== T1 Ny chassis gir ny ordre «På vei», ikke bekreftet, i appens form =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0001', 'nr', 'B-TEST-0001', 'ident_type', 'CHASSIS', 'ident', ' testwxyz-000000001 ',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'forhandler_navn', 'AK Auto AS', 'selger_navn', 'andreas kåsa', 'selger_epost', 'Andreas.AKauto@gmail.com', 'modell_slug', 'testmodell'));
  insert into _res(navn, ok, info) values ('T1 ny chassis: kode ok, status ny_ordre, ordre_id i svaret', r->>'kode' = 'ok' and r->>'status' = 'ny_ordre' and r->>'ordre_id' like 'ord\_%', r::text);
  select * into o from public.ordrer where portal_bestilling_id = 'testbest0001';
  insert into _res(navn, ok, info) values ('T1 ordre: På vei, aktiv, ikke bekreftet, ingen ankomstdato', o.ordre_status = 'paa_vei' and o.status = 'aktiv' and o.portal_bekreftet_at is null and o.ankomstdato is null, o.ordre_status);
  insert into _res(navn, ok, info) values ('T1 chassis normalisert (store bokstaver, uten mellomrom og bindestrek)', o.chassis = 'TESTWXYZ000000001', o.chassis);
  insert into _res(navn, ok, info) values ('T1 forhandler = Kontakter-navn, org.nr fra Kontakter, merke/modell fra oversettelsen', o.kunde = 'AK Auto AS' and o.forhandler_orgnr = c_org_a and o.merke = 'TESTMERKE' and o.modell = 'TESTMODELL', o.kunde || '|' || o.forhandler_orgnr || '|' || o.merke || '|' || o.modell);
  insert into _res(navn, ok, info) values ('T1 eier = kontaktperson under riktig forhandler (matchet på e-post, ikke skrivemåte)', o.eier = 'Andreas Kåsa', o.eier);
  insert into _res(navn, ok, info) values ('T1 jsonb-form som en ekte ordre: ombygging/vekter/drivstoff har samme nøkler, aldri {}',
    (select array_agg(k order by k) from jsonb_object_keys(o.ombygging) k) = (select array_agg(k order by k) from jsonb_object_keys(v_real.ombygging) k)
    and (select array_agg(k order by k) from jsonb_object_keys(o.vekter) k) = (select array_agg(k order by k) from jsonb_object_keys(v_real.vekter) k)
    and (select array_agg(k order by k) from jsonb_object_keys(o.drivstoff) k) = (select array_agg(k order by k) from jsonb_object_keys(v_real.drivstoff) k)
    and o.utstyr <> '{}'::jsonb and o.vekter <> '{}'::jsonb and o.drivstoff <> '{}'::jsonb and o.ombygging <> '{}'::jsonb, 'nøkler');
  insert into _res(navn, ok, info) values ('T1 listelengder som en ekte ordre (bilder 6/6/3)', jsonb_array_length(o.bilder_ankomst) = jsonb_array_length(v_real.bilder_ankomst) and jsonb_array_length(o.bilder_levering) = jsonb_array_length(v_real.bilder_levering)
    and jsonb_array_length(o.bilder_avstand_skader) = jsonb_array_length(v_real.bilder_avstand_skader), jsonb_array_length(o.bilder_ankomst)::text);
  insert into _res(navn, ok, info) values ('T1 utstyr har appens felt (hengerfeste, skalHaBekreftet)', o.utstyr->>'hengerfeste' = 'ikke_hengerfeste' and o.utstyr->>'skalHaBekreftet' = 'false' and o.utstyr ? 'hengerfesteMontert', o.utstyr::text);
  insert into _res(navn, ok, info) values ('T1 endringslogg har én linje i appens format (av, tid, txt), uten selgerens kommentar', jsonb_array_length(o.endringer) = 1 and (o.endringer->0) ?& array['av','tid','txt'] and o.notater = '', o.endringer::text);

  insert into _res(navn, ok, info) values ('T1 kontakt uten fullmakt-fil: fullmakt = har_ikke og ingen dokumenter (som en ordre lagt inn for hånd)', o.fullmakt = 'har_ikke' and o.dokumenter = '[]'::jsonb, o.fullmakt);

  -- ===== T2 Idempotens =====
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0001', 'nr', 'B-TEST-0001', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000001',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'andreas kåsa', 'modell_slug', 'testmodell'));
  select count(*) into v_n from public.ordrer where portal_bestilling_id = 'testbest0001';
  insert into _res(navn, ok, info) values ('T2 samme bestilling to ganger: samme ordre, bare én rad', r2->>'ordre_id' = r->>'ordre_id' and v_n = 1 and (select count(*) from public.portal_bestillinger where portal_bestilling_id = 'testbest0001') = 1, r2::text);

  -- ===== T3 Samme chassis, annen bestilling, samme forhandler: kobles uten å røre ordren =====
  select updated_at into o.updated_at from public.ordrer where portal_bestilling_id = 'testbest0001';
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0002', 'nr', 'B-TEST-0002', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000001',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testmodell'));
  select count(*) into v_n from public.ordrer where upper(btrim(chassis)) = 'TESTWXYZ000000001';
  insert into _res(navn, ok, info) values ('T3 samme chassis og forhandler: koblet til eksisterende, ingen ny ordre', r2->>'status' = 'koblet' and r2->>'ordre_id' = r->>'ordre_id' and v_n = 1, r2::text);
  insert into _res(navn, ok, info) values ('T3 den eksisterende ordren ble IKKE endret (ingen UPDATE: ingen push, ingen historikkrad)', (select updated_at from public.ordrer where portal_bestilling_id = 'testbest0001') = o.updated_at and (select portal_bestilling_id from public.ordrer where id = r->>'ordre_id') = 'testbest0001', '');

  -- ===== T4 Samme chassis, ANNEN forhandler: avklaring, ingen ny ordre, ingen detaljer i svaret =====
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0003', 'nr', 'B-TEST-0003', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000001',
        'kontakt_id', c_b, 'orgnr', c_org_b, 'selger_navn', 'Annen Selger', 'modell_slug', 'testmodell'));
  select count(*) into v_n from public.ordrer where upper(btrim(chassis)) = 'TESTWXYZ000000001';
  insert into _res(navn, ok, info) values ('T4 annen forhandler: avklaring_annen_forhandler og ingen ny ordre', r2->>'status' = 'avklaring_annen_forhandler' and r2->>'kode' = 'trenger_avklaring' and v_n = 1, r2::text);
  insert into _res(navn, ok, info) values ('T4 svaret til portalen har ingen detaljer og ikke andre forhandlers navn (bare kode og status)', (select array_agg(k order by k) from jsonb_object_keys(r2) k) = array['kode','status'] and r2::text not like '%AK Auto%', r2::text);
  insert into _res(navn, ok, info) values ('T4 detaljen (kun admin) nevner den andre forhandleren', (select detalj from public.portal_bestillinger where portal_bestilling_id = 'testbest0003') like '%AK Auto AS%', '');

  -- ===== T5 GRAVSTEIN: slettet ordre gjenopplives aldri =====
  delete from public.ordrer where portal_bestilling_id = 'testbest0001';
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0001', 'nr', 'B-TEST-0001', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000001',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testmodell'));
  select count(*) into v_n from public.ordrer where upper(btrim(chassis)) = 'TESTWXYZ000000001';
  insert into _res(navn, ok, info) values ('T5 slettet ordre: nytt kall gir avvist og lager IKKE en ny ordre', r2->>'status' = 'avvist' and v_n = 0 and (select status from public.portal_bestillinger where portal_bestilling_id = 'testbest0001') = 'avvist', r2::text);
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0001', 'nr', 'B-TEST-0001', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000001',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testmodell'));
  select count(*) into v_n from public.ordrer where upper(btrim(chassis)) = 'TESTWXYZ000000001';
  insert into _res(navn, ok, info) values ('T5 avvist forblir avvist ved nytt kall', r2->>'status' = 'avvist' and v_n = 0, r2::text);

  -- ===== T6 Hentet men ikke arkivert: manuell avklaring =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0010', 'nr', 'B-TEST-0010', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000002',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testmodell'));
  update public.ordrer set ordre_status = 'hentet' where id = r->>'ordre_id';
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0011', 'nr', 'B-TEST-0011', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000002',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testmodell'));
  insert into _res(navn, ok, info) values ('T6 aktiv ordre med status hentet: avklaring_chassis (ikke automatisk kobling)', r2->>'status' = 'avklaring_chassis', r2::text);

  -- ===== T7 Arkivert ordre gir NY ordre =====
  update public.ordrer set status = 'arkivert' where id = r->>'ordre_id';
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0012', 'nr', 'B-TEST-0012', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000002',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Andreas Kåsa', 'modell_slug', 'testmodell'));
  insert into _res(navn, ok, info) values ('T7 chassis kun på arkivert ordre: ny ordre opprettes', r2->>'status' = 'ny_ordre' and r2->>'ordre_id' <> r->>'ordre_id', r2::text);

  -- ===== T8 Serienummer: løs rad i Admin-ark =====
  v_aar := extract(year from (now() at time zone 'Europe/Oslo'))::int;
  select coalesce(max(rekkefolge), 0) into v_max from public.admin_ark where aar = v_aar and rekkefolge <> 2147483647;
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0020', 'nr', 'B-TEST-0020', 'ident_type', 'SERIENUMMER', 'ident', ' bu 39953 ',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'andreas kåsa', 'selger_epost', 'andreas.akauto@gmail.com', 'modell_slug', 'testmodell'));
  select * into a from public.admin_ark where id = (select admin_ark_id from public.portal_bestillinger where portal_bestilling_id = 'testbest0020');
  insert into _res(navn, ok, info) values ('T8 serienummer: status admin_ark, ingen ordre', r->>'status' = 'admin_ark' and r->>'kode' = 'ok' and not exists (select 1 from public.ordrer where portal_bestilling_id = 'testbest0020'), r::text);
  insert into _res(navn, ok, info) values ('T8 Admin-ark-raden: forhandler, kontaktperson, serienummer, tom chassis, riktig år og radnummer', a.forhandler = 'AK Auto AS' and a.kontaktperson = 'Andreas Kåsa' and a.serienummer = 'BU 39953' and a.chassis_nr = '' and a.aar = v_aar and a.rekkefolge = v_max + 1 and a.merknader = 'Fra portalen B-TEST-0020' and a.id like 'ark\_%', row(a.forhandler, a.kontaktperson, a.serienummer, a.rekkefolge)::text);
  r2 := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0020', 'nr', 'B-TEST-0020', 'ident_type', 'SERIENUMMER', 'ident', 'BU 39953', 'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'x'));
  insert into _res(navn, ok, info) values ('T8 serienummer idempotent: ingen ny Admin-ark-rad', (select count(*) from public.admin_ark where serienummer = 'BU 39953' and forhandler = 'AK Auto AS' and aar = v_aar and merknader = 'Fra portalen B-TEST-0020') = 1, r2::text);

  -- ===== T9 Forhandler og modell mangler =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0030', 'nr', 'B-TEST-0030', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000030', 'kontakt_id', 'k_finnes_ikke', 'orgnr', c_org_a, 'selger_navn', 'S', 'modell_slug', 'testmodell'));
  insert into _res(navn, ok, info) values ('T9 ukjent kontakt: venter_forhandler, ingen ordre', r->>'status' = 'venter_forhandler' and not exists (select 1 from public.ordrer where chassis = 'TESTWXYZ000000030'), r::text);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0031', 'nr', 'B-TEST-0031', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000031', 'kontakt_id', c_a, 'orgnr', c_org_b, 'selger_navn', 'S', 'modell_slug', 'testmodell'));
  insert into _res(navn, ok, info) values ('T9 org.nr stemmer ikke med kontakten: venter_forhandler, ingen ordre', r->>'status' = 'venter_forhandler' and not exists (select 1 from public.ordrer where chassis = 'TESTWXYZ000000031'), r::text);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0032', 'nr', 'B-TEST-0032', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000032', 'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'S', 'modell_slug', 'ikke-oversatt'));
  insert into _res(navn, ok, info) values ('T9 modell uten oversettelse: venter_modell, ingen ordre', r->>'status' = 'venter_modell' and not exists (select 1 from public.ordrer where chassis = 'TESTWXYZ000000032'), r::text);

  -- ===== T10 Nytt kall på venter_* kjøres bare ved eksplisitt «kjor_pa_nytt» =====
  insert into public.portal_modell_kobling (portal_modell_slug, merke, modell) values ('ikke-oversatt', 'TESTMERKE2', 'TESTMODELL2');
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0032', 'nr', 'B-TEST-0032', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000032', 'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'S', 'modell_slug', 'ikke-oversatt'));
  insert into _res(navn, ok, info) values ('T10 portalens vanlige nytt forsøk kjører IKKE venter-rader på nytt', r->>'status' = 'venter_modell' and not exists (select 1 from public.ordrer where chassis = 'TESTWXYZ000000032'), r::text);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0032', 'nr', 'B-TEST-0032', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000032', 'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'S', 'modell_slug', 'ikke-oversatt', 'kjor_pa_nytt', true));
  insert into _res(navn, ok, info) values ('T10 eksplisitt kjor_pa_nytt etter at modellen er oversatt: ny ordre', r->>'status' = 'ny_ordre' and (select merke from public.ordrer where id = r->>'ordre_id') = 'TESTMERKE2', r::text);

  -- ===== T11 Tak per forhandler =====
  select count(*) into v_n from public.ordrer where status = 'aktiv' and portal_bestilling_id is not null and portal_bekreftet_at is null and lower(btrim(kunde)) = 'ak auto as';
  i := 0; r := null;
  while i < 15 loop
    i := i + 1;
    r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testtak' || lpad(i::text, 4, '0'), 'nr', 'B-TEST-T' || i, 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ0000001' || lpad(i::text, 2, '0'),
          'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'S', 'modell_slug', 'testmodell'));
    exit when r->>'status' = 'avklaring_tak';
  end loop;
  insert into _res(navn, ok, info) values ('T11 tak: ordre nummer 11 hos samme forhandler blir avklaring_tak, og det finnes høyst 10 ubekreftede',
    r->>'status' = 'avklaring_tak' and (select count(*) from public.ordrer where status = 'aktiv' and portal_bestilling_id is not null and portal_bekreftet_at is null and lower(btrim(kunde)) = 'ak auto as') = 10,
    'ubekreftede før taket-testen: ' || v_n);

  -- ===== T12 Ugyldig input kaster UGYLDIG_INPUT (ingen rader) =====
  for v_id, function_args in select * from (values
      ('chassis 16 tegn', jsonb_build_object('bestilling_id', 'testbest0040', 'nr', 'B-X', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ00000004')),
      ('chassis med I', jsonb_build_object('bestilling_id', 'testbest0041', 'nr', 'B-X', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ00000004I')),
      ('chassis med Q', jsonb_build_object('bestilling_id', 'testbest0042', 'nr', 'B-X', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ00000004Q')),
      ('ukjent ident_type', jsonb_build_object('bestilling_id', 'testbest0043', 'nr', 'B-X', 'ident_type', 'REGNR', 'ident', 'AB12345')),
      ('for kort bestilling_id', jsonb_build_object('bestilling_id', 'x', 'nr', 'B-X', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000043')),
      ('serienummer med <script>', jsonb_build_object('bestilling_id', 'testbest0044', 'nr', 'B-X', 'ident_type', 'SERIENUMMER', 'ident', '<script>1')),
      ('mangler nr', jsonb_build_object('bestilling_id', 'testbest0045', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000045')),
      ('ikke et objekt', to_jsonb('tekst'::text))
    ) as t(a, b) loop
    v_ok := false; v_feil := '';
    begin
      perform public.portal_koble_bestilling(function_args);
    exception when others then
      v_ok := sqlerrm like 'UGYLDIG_INPUT%'; v_feil := sqlerrm;
    end;
    insert into _res(navn, ok, info) values ('T12 ugyldig input avvises: ' || v_id, v_ok, v_feil);
  end loop;
  insert into _res(navn, ok, info) values ('T12 ugyldig input etterlot ingen portal-rader', not exists (select 1 from public.portal_bestillinger where portal_bestilling_id in ('testbest0040','testbest0041','testbest0042','testbest0043','testbest0044','testbest0045')), '');

  -- ===== T13 Sanering av fritekst fra selgeren =====
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0050', 'nr', 'B-TEST-0050', 'ident_type', 'SERIENUMMER', 'ident', 'SAN-1', 'kontakt_id', c_b, 'orgnr', c_org_b,
        'selger_navn', E'<img src=x onerror=1>Ola‮Nord\u0001mann' || repeat('x', 200), 'selger_epost', ' <A@B.NO> '));
  select * into a from public.admin_ark where id = (select admin_ark_id from public.portal_bestillinger where portal_bestilling_id = 'testbest0050');
  insert into _res(navn, ok, info) values ('T13 selgernavn: ingen < >, retningstegn eller kontrolltegn, kappet til 80 tegn', a.kontaktperson not like '%<%' and a.kontaktperson not like '%>%' and a.kontaktperson !~ '[‮\u0001]' and char_length(a.kontaktperson) <= 80, a.kontaktperson);
  insert into _res(navn, ok, info) values ('T13 e-post: små bokstaver, uten mellomrom og < >', (select selger_epost from public.portal_bestillinger where portal_bestilling_id = 'testbest0050') = 'a@b.no', (select selger_epost from public.portal_bestillinger where portal_bestilling_id = 'testbest0050'));

  -- ===== T15 Fullmakt: som appens autoFyllForhandlerFullmakt (dokumenter vedlagt OG fullmakt = 'har'), og uten fullmakt = 'har_ikke' =====
  select * into o from public.ordrer where portal_bestilling_id = 'testbest0010';
  insert into _res(navn, ok, info) values ('T15 kontakt UTEN fullmakt-fil: fullmakt = har_ikke og dokumenter tom', o.fullmakt = 'har_ikke' and o.dokumenter = '[]'::jsonb, o.fullmakt);
  select k->>'id', regexp_replace(coalesce(k->>'orgnr', ''), '\D', '', 'g') into v_fk_id, v_fk_org
  from public.innstillinger i, jsonb_array_elements(i.kontakter) k
  where i.id = 1 and k->>'type' = 'Forhandler' and btrim(coalesce(k->>'fullmaktUrl', '')) <> '' and regexp_replace(coalesce(k->>'orgnr', ''), '\D', '', 'g') <> ''
  limit 1;
  if v_fk_id is null then
    insert into _res(navn, ok, info) values ('T15 kontakt MED fullmakt-fil: hoppet over (ingen kontakt har fullmakt i dag)', true, '');
  else
    r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0060', 'nr', 'B-TEST-0060', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000060',
          'kontakt_id', v_fk_id, 'orgnr', v_fk_org, 'selger_navn', 'Fullmakt Test', 'modell_slug', 'testmodell'));
    select * into o from public.ordrer where portal_bestilling_id = 'testbest0060';
    insert into _res(navn, ok, info) values ('T15 kontakt MED fullmakt-fil: dokumenter har fullmakten og fullmakt = har',
      r->>'status' = 'ny_ordre' and o.fullmakt = 'har' and jsonb_array_length(o.dokumenter) = 1 and o.dokumenter->0->>'lastetOppAv' = 'Automatisk (forhandlerfullmakt)' and (o.dokumenter->0->>'url') <> '', r::text || ' / ' || coalesce(o.fullmakt, ''));
  end if;

  -- ===== T16 Navnekollisjon: selgerens navn tilhører en kontaktperson hos EN ANNEN forhandler (navnet hentes fra AK Auto og brukes mot Autostrada Seljord; tak-testen T11 har fylt AK Auto) =====
  -- Admin-ark slår opp e-post på navn på tvers av alle forhandlere, så et slikt navn skal ikke bli kontaktperson/eier (ville sendt e-post til feil person).
  select kp->>'navn' into v_other
  from public.innstillinger i, jsonb_array_elements(i.kontakter) k, jsonb_array_elements(coalesce(k->'kontaktpersoner', '[]'::jsonb)) kp
  where i.id = 1 and k->>'id' = c_a and btrim(coalesce(kp->>'navn', '')) <> ''
    and lower(btrim(kp->>'navn')) not in (select lower(btrim(coalesce(kp2->>'navn', ''))) from public.innstillinger i2, jsonb_array_elements(i2.kontakter) k2, jsonb_array_elements(coalesce(k2->'kontaktpersoner', '[]'::jsonb)) kp2 where i2.id = 1 and k2->>'id' = c_b)
  limit 1;
  if v_other is null then
    insert into _res(navn, ok, info) values ('T16 navnekollisjon: hoppet over (fant ingen kontaktperson hos AK Auto som ikke også finnes hos Autostrada Seljord)', true, '');
  else
    r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0070', 'nr', 'B-TEST-0070', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000070',
          'kontakt_id', c_b, 'orgnr', c_org_b, 'selger_navn', upper(v_other), 'modell_slug', 'testmodell'));
    select * into o from public.ordrer where portal_bestilling_id = 'testbest0070';
    insert into _res(navn, ok, info) values ('T16 navn som tilhører en kontaktperson hos en annen forhandler (selv med andre store/små bokstaver): ordrens eier blir TOM', r->>'status' = 'ny_ordre' and o.eier = '', coalesce(o.eier, 'null'));
    insert into _res(navn, ok, info) values ('T16 selgeren står likevel i endringsloggen', o.endringer->0->>'txt' like '%' || upper(v_other) || '%', '');
    r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0071', 'nr', 'B-TEST-0071', 'ident_type', 'SERIENUMMER', 'ident', 'KOLL 7071',
          'kontakt_id', c_b, 'orgnr', c_org_b, 'selger_navn', v_other, 'modell_slug', 'testmodell'));
    select * into a from public.admin_ark where id = (select admin_ark_id from public.portal_bestillinger where portal_bestilling_id = 'testbest0071');
    insert into _res(navn, ok, info) values ('T16 serienummer med kollisjon: Admin-ark-raden har tom kontaktperson og selgeren i merknaden', a.kontaktperson = '' and a.merknader like 'Fra portalen B-TEST-0071 (selger: %', a.merknader);
  end if;
  -- Et navn som INGEN kontakt har, brukes som før (kontaktperson/eier = selgerens eget navn).
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbest0072', 'nr', 'B-TEST-0072', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000072',
        'kontakt_id', c_b, 'orgnr', c_org_b, 'selger_navn', 'Zzyzx Qwertyuiop Testperson', 'modell_slug', 'testmodell'));
  select * into o from public.ordrer where portal_bestilling_id = 'testbest0072';
  insert into _res(navn, ok, info) values ('T16 navn som ingen kontakt har: eier = selgerens eget navn (som før)', o.eier = 'Zzyzx Qwertyuiop Testperson', coalesce(o.eier, 'null'));

  -- ===== T14 Rettigheter =====
  insert into _res(navn, ok, info) values ('T14 bare service_role kan kalle funksjonen (ikke anon, authenticated eller public)',
    has_function_privilege('service_role', 'public.portal_koble_bestilling(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.portal_koble_bestilling(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_koble_bestilling(jsonb)', 'execute'), '');
end
$test$;

select n, case when ok then 'OK  ' else 'FEIL' end as resultat, navn, case when ok then '' else info end as info from _res order by n;
