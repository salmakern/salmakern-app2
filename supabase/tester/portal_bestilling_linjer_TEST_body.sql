-- Test av linjer-feltet i portal_koble_bestilling (v5, s08-048, migrasjon
-- 20261031170000_portal_bestilling_linjer.sql + 20261030210000 v5). ALLTID i en transaksjon
-- som rulles tilbake. Kjøring (fra rotmappen, 20261031150000 trengs midlertidig til den er
-- kjørt mot produksjon - se samme forbehold i ordre_status_utboks_kun_portal_TEST_body.sql):
--   (echo "begin;"; cat supabase/migrations/20261031150000_portal_modell_slug_matching.sql; cat supabase/migrations/20261031170000_portal_bestilling_linjer.sql; cat supabase/migrations/20261030210000_portal_koble_bestilling.sql; cat supabase/tester/portal_bestilling_linjer_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql

create temp table _res (n serial, navn text, ok boolean, info text);
do $test$
declare
  r jsonb; v_feil text; v_ok boolean;
begin
  insert into public.portal_modell_kobling (portal_modell_slug, merke, modell, godkjent_av) values ('testlinjer', 'TESTMERKE', 'TESTMODELL', 'test')
    on conflict (portal_modell_slug) do nothing;

  -- T1: ingen linjer-felt - helt uendret (null lagret, ingen feil)
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlinjer001', 'nr', 'B-TEST-L1', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000091',
        'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test', 'modell_slug', 'testlinjer'));
  insert into _res(navn, ok, info) values ('T1 uten linjer-felt: ny_ordre, portal_linjer er null',
    r->>'status' = 'ny_ordre' and (select portal_linjer from public.ordrer where portal_bestilling_id = 'testlinjer001') is null, r::text);
  insert into _res(navn, ok, info) values ('T1 portal_bestillinger.linjer er null', (select linjer from public.portal_bestillinger where portal_bestilling_id = 'testlinjer001') is null, '');

  -- T2: gyldige linjer - lagret riktig på ordren
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlinjer002', 'nr', 'B-TEST-L2', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000092',
        'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test', 'modell_slug', 'testlinjer',
        'linjer', jsonb_build_array(jsonb_build_object('produktnummer','501','navn','Takluke','rabatt_prosent',10), jsonb_build_object('produktnummer','502','navn','4-seter','rabatt_prosent',15.5))));
  insert into _res(navn, ok, info) values ('T2 gyldige linjer: ny_ordre, 2 linjer lagret på ordren med riktig innhold',
    r->>'status' = 'ny_ordre' and (select jsonb_array_length(portal_linjer) from public.ordrer where portal_bestilling_id = 'testlinjer002') = 2
    and (select portal_linjer->0->>'produktnummer' from public.ordrer where portal_bestilling_id = 'testlinjer002') = '501'
    and (select (portal_linjer->1->>'rabatt_prosent')::numeric from public.ordrer where portal_bestilling_id = 'testlinjer002') = 15.5, r::text);
  insert into _res(navn, ok, info) values ('T2 portal_bestillinger.linjer har samme innhold',
    (select jsonb_array_length(linjer) from public.portal_bestillinger where portal_bestilling_id = 'testlinjer002') = 2, '');

  -- T3: ugyldig rabatt_prosent (over 100) avvises med UGYLDIG_INPUT, ingen rad opprettet
  begin
    perform public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlinjer003', 'nr', 'B-TEST-L3', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000093',
          'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test', 'modell_slug', 'testlinjer',
          'linjer', jsonb_build_array(jsonb_build_object('produktnummer','501','navn','Takluke','rabatt_prosent',150))));
    v_ok := false; v_feil := 'ingen feil';
  exception when others then
    v_ok := sqlerrm = 'UGYLDIG_INPUT: linjer'; v_feil := sqlerrm;
  end;
  insert into _res(navn, ok, info) values ('T3 rabatt_prosent over 100 avvises', v_ok, v_feil);
  insert into _res(navn, ok, info) values ('T3 ingen portal_bestillinger-rad etterlatt', not exists (select 1 from public.portal_bestillinger where portal_bestilling_id = 'testlinjer003'), '');

  -- T4: manglende produktnummer avvises
  begin
    perform public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlinjer004', 'nr', 'B-TEST-L4', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000094',
          'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test', 'modell_slug', 'testlinjer',
          'linjer', jsonb_build_array(jsonb_build_object('produktnummer','','navn','Takluke','rabatt_prosent',10))));
    v_ok := false; v_feil := 'ingen feil';
  exception when others then
    v_ok := sqlerrm = 'UGYLDIG_INPUT: linjer'; v_feil := sqlerrm;
  end;
  insert into _res(navn, ok, info) values ('T4 tomt produktnummer avvises', v_ok, v_feil);

  -- T5: linjer er ikke en liste (objekt i stedet) avvises
  begin
    perform public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlinjer005', 'nr', 'B-TEST-L5', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000095',
          'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test', 'modell_slug', 'testlinjer',
          'linjer', jsonb_build_object('produktnummer','501')));
    v_ok := false; v_feil := 'ingen feil';
  exception when others then
    v_ok := sqlerrm = 'UGYLDIG_INPUT: linjer'; v_feil := sqlerrm;
  end;
  insert into _res(navn, ok, info) values ('T5 linjer som objekt (ikke liste) avvises', v_ok, v_feil);

  -- T6: XSS/kontrolltegn i navn saneres (samme mønster som selger_navn)
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlinjer006', 'nr', 'B-TEST-L6', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000096',
        'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test', 'modell_slug', 'testlinjer',
        'linjer', jsonb_build_array(jsonb_build_object('produktnummer','501','navn','<script>Takluke</script>','rabatt_prosent',10))));
  insert into _res(navn, ok, info) values ('T6 navn saneres (ingen < >)',
    (select portal_linjer->0->>'navn' from public.ordrer where portal_bestilling_id = 'testlinjer006') not like '%<%', (select portal_linjer->0->>'navn' from public.ordrer where portal_bestilling_id = 'testlinjer006'));

  -- T7: serienummer-grenen (admin_ark) - linjer sendt med, men ingen ordre opprettes (admin_ark har ingen slik kolonne)
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testlinjer007', 'nr', 'B-TEST-L7', 'ident_type', 'SERIENUMMER', 'ident', 'LINJE 007',
        'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test',
        'linjer', jsonb_build_array(jsonb_build_object('produktnummer','501','navn','Takluke','rabatt_prosent',10))));
  insert into _res(navn, ok, info) values ('T7 serienummer med linjer: admin_ark som vanlig, ingen feil', r->>'status' = 'admin_ark', r::text);
end
$test$;
select n, case when ok then 'OK  ' else 'FEIL' end as resultat, navn, case when ok then '' else info end as info from _res order by n;
