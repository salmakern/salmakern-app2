-- Test av backfillen i migrasjon 20261113090000_forhandler_kontakt_id.sql. ALLTID i en transaksjon
-- som rulles tilbake: ingenting blir stående, heller ikke den midlertidige TEST-utvidelsen av
-- innstillinger.kontakter (append i en transaksjon som rulles tilbake er like trygt som å aldri ha gjort det).
--
-- Kjøring (fra rotmappen, migrasjonen må kjøres FØRST i samme transaksjon siden den også legger til kolonnen):
--   (echo "begin;"; cat supabase/migrations/20261113090000_forhandler_kontakt_id.sql; cat supabase/tester/forhandler_kontakt_id_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha resultat OK.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_unikt_orgnr constant text := '999999901';
  v_delt_orgnr constant text := '999999902';
  v_ny_kontakter jsonb;
begin
  -- Midlertidig TEST-utvidelse av innstillinger.kontakter (rulles tilbake med resten).
  select kontakter into v_ny_kontakter from innstillinger where id = 1;
  v_ny_kontakter := coalesce(v_ny_kontakter, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('id', 'ktest_unik', 'navn', 'TEST Unikt Orgnr AS', 'type', 'Forhandler', 'orgnr', v_unikt_orgnr),
    jsonb_build_object('id', 'ktest_a', 'navn', 'TEST Delt Orgnr AS Avdeling A', 'type', 'Forhandler', 'orgnr', v_delt_orgnr),
    jsonb_build_object('id', 'ktest_b', 'navn', 'TEST Delt Orgnr AS Avdeling B', 'type', 'Forhandler', 'orgnr', v_delt_orgnr),
    jsonb_build_object('id', 'ktest_c', 'navn', 'TEST Delt Orgnr AS Avdeling C', 'type', 'Forhandler', 'orgnr', v_delt_orgnr)
  );
  update innstillinger set kontakter = v_ny_kontakter where id = 1;

  -- T1: org.nr unikt for én kontakt
  insert into ordrer (id, kunde, chassis, merke, modell, ordre_status, status, forhandler_orgnr)
  values ('ord_test_fki_1', 'Hva som helst av kundetekst', 'TESTFKI00000001', 'Test', 'Test', 'ikke_paabegynt', 'aktiv', v_unikt_orgnr);

  -- T2: delt org.nr, kunde-tekst matcher EKSAKT avdeling B
  insert into ordrer (id, kunde, chassis, merke, modell, ordre_status, status, forhandler_orgnr)
  values ('ord_test_fki_2', 'TEST Delt Orgnr AS Avdeling B', 'TESTFKI00000002', 'Test', 'Test', 'ikke_paabegynt', 'aktiv', v_delt_orgnr);

  -- T3: delt org.nr, kunde-tekst matcher INGEN avdeling eksakt
  insert into ordrer (id, kunde, chassis, merke, modell, ordre_status, status, forhandler_orgnr)
  values ('ord_test_fki_3', 'TEST Delt Orgnr AS', 'TESTFKI00000003', 'Test', 'Test', 'ikke_paabegynt', 'aktiv', v_delt_orgnr);

  -- T4: portal-ordre - bestillingens EGEN forhandler_kontakt_id skal vinne over org.nr-reglene,
  -- selv om org.nr her (satt til det DELTE org.nr) ville gitt et annet/intet svar via regel 2/3.
  insert into portal_bestillinger (portal_bestilling_id, portal_nr, status, ident_type, ident, forhandler_kontakt_id, forhandler_orgnr, selger_navn)
  values ('ptest_fki_4', 'B-TEST-FKI04', 'bekreftet', 'CHASSIS', 'TESTFKI00000004', 'ktest_c', v_delt_orgnr, 'TEST Selger');
  insert into ordrer (id, kunde, chassis, merke, modell, ordre_status, status, forhandler_orgnr, portal_bestilling_id)
  values ('ord_test_fki_4', 'Kundetekst som IKKE matcher noen avdeling', 'TESTFKI00000004', 'Test', 'Test', 'ikke_paabegynt', 'aktiv', v_delt_orgnr, 'ptest_fki_4');

  -- Kjør backfillen (samme spørring som i migrasjonen, eksakt kopi).
  with k as (
    select (elem->>'id') as kontakt_id, elem->>'navn' as navn, elem->>'orgnr' as orgnr
    from innstillinger, jsonb_array_elements(coalesce(kontakter, '[]'::jsonb)) elem
    where id = 1 and elem->>'type' = 'Forhandler' and coalesce(elem->>'orgnr', '') <> ''
  ),
  orgnr_antall as (
    select orgnr, count(*) as n from k group by orgnr
  )
  update ordrer o
  set forhandler_kontakt_id = coalesce(
    (select pb.forhandler_kontakt_id from portal_bestillinger pb where pb.portal_bestilling_id = o.portal_bestilling_id and coalesce(pb.forhandler_kontakt_id, '') <> ''),
    (select k.kontakt_id from k join orgnr_antall oa on oa.orgnr = k.orgnr where k.orgnr = o.forhandler_orgnr and oa.n = 1),
    (select k.kontakt_id from k where k.orgnr = o.forhandler_orgnr and lower(btrim(k.navn)) = lower(btrim(o.kunde)))
  )
  where o.forhandler_kontakt_id is null and coalesce(o.forhandler_orgnr, '') <> ''
    and o.id like 'ord_test_fki_%';   -- test-isolasjon - rører aldri ekte rader her (de er allerede ferdig backfilt av selve migrasjonen rett over i samme transaksjon)

  insert into _res(navn, ok, info) values ('T1 unikt org.nr: satt uansett kundetekst',
    (select forhandler_kontakt_id from ordrer where id = 'ord_test_fki_1') = 'ktest_unik', (select coalesce(forhandler_kontakt_id,'NULL') from ordrer where id = 'ord_test_fki_1'));
  insert into _res(navn, ok, info) values ('T2 delt org.nr, eksakt navnetreff: riktig avdeling valgt',
    (select forhandler_kontakt_id from ordrer where id = 'ord_test_fki_2') = 'ktest_b', (select coalesce(forhandler_kontakt_id,'NULL') from ordrer where id = 'ord_test_fki_2'));
  insert into _res(navn, ok, info) values ('T3 delt org.nr, INGEN eksakt navnetreff: forblir NULL (aldri en gjetning)',
    (select forhandler_kontakt_id from ordrer where id = 'ord_test_fki_3') is null, (select coalesce(forhandler_kontakt_id,'NULL') from ordrer where id = 'ord_test_fki_3'));
  insert into _res(navn, ok, info) values ('T4 portal-ordre: bestillingens EGEN forhandler_kontakt_id vinner over org.nr-reglene',
    (select forhandler_kontakt_id from ordrer where id = 'ord_test_fki_4') = 'ktest_c', (select coalesce(forhandler_kontakt_id,'NULL') from ordrer where id = 'ord_test_fki_4'));
end;
$test$;

select * from _res order by n;
