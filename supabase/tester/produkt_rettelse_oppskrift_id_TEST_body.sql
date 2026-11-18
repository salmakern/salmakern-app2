-- Test av 20261118120000_produkt_rettelse_oppskrift_id.sql: legg_til_ordre_produkt_rettelse godtar nå også en oppskrifts-id (oppskrift_<10-16 siffer>) som
-- «produktnummer» (rad med bare deler: dørbeskyttere på KIA EV9), uten å slippe gjennom noe annet enn det som ble godtatt før (T1-T6). T7: grensen på 300
-- rettelser per ordre. T8-T9: oppdater_ordre_fiken_linje og oppdater_ordre_fiken_linje_ved_id avviser å LEGGE TIL en fakturalinje med en oppskrifts-id
-- (en gammel klient kan lese dørbeskyttere-rettelsen som et vanlig produkt), men tillater fortsatt å fjerne en slik rest og alt som gjaldt før.
-- ALLTID i en transaksjon som rulles tilbake: testen setter inn en TEST-ordre (id ord_test_rett_oppskrift, merke TESTRETT) og alt rulles tilbake. Ansatt-
-- radene LESES bare (for å lage innloggingsutsagn med request.jwt.claims); ingen ansatt endres. RPC-en gjør en UPDATE på TEST-ordren (bare produkt_rettelser),
-- og eventuelle triggere i den transaksjonen forkastes ved rollback.
-- Kjøring (fra rotmappen). Dette er et SKRIVENDE steg mot den delte databasen (create or replace function, rullet tilbake): bare etter Henriks ja:
--   ( echo "begin;"; cat supabase/migrations/20261118120000_produkt_rettelse_oppskrift_id.sql; cat supabase/tester/produkt_rettelse_oppskrift_id_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader skal være OK. Uten å røre den delte databasen: samme filer mot PGlite med stubbet ordrer-/ansatte-tabell og current_ansatt().

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  c_id constant text := 'ord_test_rett_oppskrift';
  c_dor constant text := 'oppskrift_1790236543257';
  v_ans bigint; v_tok text; v_navn text;
  r jsonb; v_feil text; v_n int; v_for int; v_ugyldig text; v_ok boolean; v_linjer jsonb;
  v_ugyldige text[] := array['oppskrift_abc', 'oppskrift_123456789', 'oppskrift_12345678901234567', 'oppskrift_1790236543257x', 'x oppskrift_1790236543257',
    'OPPSKRIFT_1790236543257', 'oppskrift_', 'oppskrift', 'opp_1790236543257', '0501', '012', '0', 'ev9', '501 ', ' 501', '501x', '12345678901', '',
    '501' || chr(10), 'oppskrift_1790236543257' || chr(10), 'oppskrift_-1790236543257', 'oppskrift_17902365432.7'];
begin
  select id, coalesce(session_token, ''), navn into v_ans, v_tok, v_navn from public.ansatte where aktiv and rolle = 'ansatt' order by id limit 1;
  insert into _res(navn, ok, info) values ('Forutsetning: fant en aktiv ansatt å lage innlogging av', v_ans is not null, coalesce(v_ans::text, '-'));

  insert into public.ordrer (id, chassis, kunde, merke, modell, ordre_status, status)
    values (c_id, 'TESTRETT0000000001', 'TEST Kunde', 'TESTRETT', 'EV9', 'paa_vei', 'aktiv');

  -- T1: uten innlogging avvises alt (også en oppskrifts-id) før noe annet sjekkes
  perform set_config('request.jwt.claims', '', true);
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'legg_til', 'produktnummer', c_dor)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T1 uten innlogging: IKKE_INNLOGGET også for en oppskrifts-id', v_feil = 'IKKE_INNLOGGET', v_feil);

  -- Innlogget som ansatt
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans, 'session_token', v_tok)::text, true);

  -- T2: et vanlig produktnummer virker som før
  r := public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'legg_til', 'produktnummer', '501', 'navn', 'Takluke', 'portalId', 'p_TEST_501'));
  insert into _res(navn, ok, info) values ('T2 produktnummer 501 godtas som før (én rettelse, navn og portalId lagret, «av» satt av databasen)',
    jsonb_array_length(r) = 1 and r->0->>'produktnummer' = '501' and r->0->>'handling' = 'legg_til' and r->0->>'navn' = 'Takluke' and r->0->>'portalId' = 'p_TEST_501'
    and r->0->>'av' = v_navn and r->0->>'at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$', r::text);

  -- T3: en oppskrifts-id godtas for alle tre handlinger
  r := public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'legg_til', 'produktnummer', c_dor, 'navn', 'Dørbeskyttere'));
  insert into _res(navn, ok, info) values ('T3 oppskrifts-id godtas som legg_til (nøkkel og navn lagret, portalId utelatt)',
    jsonb_array_length(r) = 2 and r->1->>'produktnummer' = c_dor and r->1->>'handling' = 'legg_til' and r->1->>'navn' = 'Dørbeskyttere' and not (r->1 ? 'portalId'), r::text);
  r := public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'fjern', 'produktnummer', c_dor, 'navn', 'Dørbeskyttere'));
  insert into _res(navn, ok, info) values ('T3 oppskrifts-id godtas som fjern', jsonb_array_length(r) = 3 and r->2->>'handling' = 'fjern' and r->2->>'produktnummer' = c_dor, r::text);
  r := public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'angre', 'produktnummer', c_dor));
  insert into _res(navn, ok, info) values ('T3 oppskrifts-id godtas som angre (navn er valgfritt)', jsonb_array_length(r) = 4 and r->3->>'handling' = 'angre' and not (r->3 ? 'navn'), r::text);
  -- grenser for lengden: 10 og 16 siffer godtas
  r := public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'fjern', 'produktnummer', 'oppskrift_1234567890'));
  insert into _res(navn, ok, info) values ('T3 oppskrifts-id med 10 siffer godtas', jsonb_array_length(r) = 5, r->4->>'produktnummer');
  r := public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'fjern', 'produktnummer', 'oppskrift_1234567890123456'));
  insert into _res(navn, ok, info) values ('T3 oppskrifts-id med 16 siffer godtas', jsonb_array_length(r) = 6, r->5->>'produktnummer');
  -- tall som JSON-tall (ikke tekst) var godtatt før og er det fortsatt
  r := public.legg_til_ordre_produkt_rettelse(c_id, '{"handling":"fjern","produktnummer":502}'::jsonb);
  insert into _res(navn, ok, info) values ('T3 produktnummer som JSON-tall (502) godtas som før', jsonb_array_length(r) = 7 and r->6->>'produktnummer' = '502', (r->6)::text);

  -- T4: alt annet avvises med UGYLDIG_INPUT, og loggen er uendret etterpå
  v_for := jsonb_array_length((select produkt_rettelser from public.ordrer where id = c_id));
  foreach v_ugyldig in array v_ugyldige loop
    begin perform public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'legg_til', 'produktnummer', v_ugyldig)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
    insert into _res(navn, ok, info) values ('T4 avvises: «' || replace(v_ugyldig, chr(10), '\n') || '»', v_feil = 'UGYLDIG_INPUT', v_feil);
  end loop;
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, '{"handling":"legg_til"}'::jsonb); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T4 manglende produktnummer avvises', v_feil = 'UGYLDIG_INPUT', v_feil);
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, '{"handling":"legg_til","produktnummer":null}'::jsonb); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T4 produktnummer null avvises', v_feil = 'UGYLDIG_INPUT', v_feil);
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'slett', 'produktnummer', c_dor)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T4 ukjent handling avvises også med gyldig oppskrifts-id', v_feil = 'UGYLDIG_INPUT', v_feil);
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'legg_til', 'produktnummer', c_dor, 'navn', repeat('x', 201))); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T4 for langt navn avvises også med gyldig oppskrifts-id', v_feil = 'UGYLDIG_INPUT', v_feil);
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'legg_til', 'produktnummer', c_dor, 'portalId', repeat('x', 65))); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T4 for lang portalId avvises også med gyldig oppskrifts-id', v_feil = 'UGYLDIG_INPUT', v_feil);
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, '"oppskrift_1790236543257"'::jsonb); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T4 rettelse som ikke er et objekt avvises', v_feil = 'UGYLDIG_INPUT', v_feil);
  insert into _res(navn, ok, info) values ('T4 ingen av de avviste kallene la noe i loggen',
    jsonb_array_length((select produkt_rettelser from public.ordrer where id = c_id)) = v_for, v_for::text || ' rettelser');

  -- T5: ordre som ikke finnes
  begin perform public.legg_til_ordre_produkt_rettelse('ord_test_finnes_ikke', jsonb_build_object('handling', 'legg_til', 'produktnummer', c_dor)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T5 ukjent ordre med oppskrifts-id: ORDRE_FINNES_IKKE', v_feil = 'ORDRE_FINNES_IKKE', v_feil);

  -- T6: rettighetene er som før (anon kan ikke, innloggede og service_role kan, PUBLIC kan ikke)
  v_ok := has_function_privilege('authenticated', 'public.legg_til_ordre_produkt_rettelse(text,jsonb)', 'execute')
      and has_function_privilege('service_role', 'public.legg_til_ordre_produkt_rettelse(text,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.legg_til_ordre_produkt_rettelse(text,jsonb)', 'execute');
  insert into _res(navn, ok, info) values ('T6 rettigheter uendret: authenticated og service_role kan kjøre den, anon kan ikke', v_ok, '');
  insert into _res(navn, ok, info) values ('T6 funksjonen er fortsatt security definer med fast search_path',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'legg_til_ordre_produkt_rettelse' and p.prosecdef
            and p.proconfig is not null and 'search_path=public' = any (p.proconfig)), '');
  insert into _res(navn, ok, info) values ('T6 det finnes bare ÉN funksjon med dette navnet (ingen gammel overload ved siden av)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'legg_til_ordre_produkt_rettelse') = 1, '');

  -- T7: grensen på 300 rettelser per ordre (299 fra før: den 300. godtas, den 301. avvises, og loggen vokser ikke)
  update public.ordrer set produkt_rettelser = (select jsonb_agg(jsonb_build_object('handling', 'fjern', 'produktnummer', '501')) from generate_series(1, 299)) where id = c_id;
  r := public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'fjern', 'produktnummer', '501'));
  insert into _res(navn, ok, info) values ('T7 rettelse nr. 300 godtas (299 fra før)', jsonb_array_length(r) = 300, jsonb_array_length(r)::text);
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'fjern', 'produktnummer', '501')); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T7 rettelse nr. 301 avvises med FOR_MANGE_RETTELSER', v_feil = 'FOR_MANGE_RETTELSER', v_feil);
  begin perform public.legg_til_ordre_produkt_rettelse(c_id, jsonb_build_object('handling', 'legg_til', 'produktnummer', c_dor)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T7 grensen gjelder også en oppskrifts-id', v_feil = 'FOR_MANGE_RETTELSER', v_feil);
  insert into _res(navn, ok, info) values ('T7 loggen vokste ikke etter de avviste kallene',
    jsonb_array_length((select produkt_rettelser from public.ordrer where id = c_id)) = 300, jsonb_array_length((select produkt_rettelser from public.ordrer where id = c_id))::text);
  update public.ordrer set produkt_rettelser = '[]'::jsonb where id = c_id;

  -- T8: oppdater_ordre_fiken_linje (nøkkelen er produktnummeret)
  update public.ordrer set fiken_linjer = '[]'::jsonb where id = c_id;
  r := public.oppdater_ordre_fiken_linje(c_id, '501', jsonb_build_object('produktnummer', '501', 'antall', 1));
  insert into _res(navn, ok, info) values ('T8 et vanlig produktnummer legges til som før', jsonb_array_length(r->'fikenLinjer') = 1 and r->'fikenLinjer'->0->>'produktnummer' = '501', r::text);
  begin perform public.oppdater_ordre_fiken_linje(c_id, c_dor, jsonb_build_object('produktnummer', c_dor, 'antall', 1)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T8 en oppskrifts-id legges IKKE til som fakturalinje (UGYLDIG_PRODUKTNUMMER)', v_feil = 'UGYLDIG_PRODUKTNUMMER', v_feil);
  begin perform public.oppdater_ordre_fiken_linje(c_id, 'oppskrift_', jsonb_build_object('produktnummer', 'oppskrift_', 'antall', 1)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T8 alt som begynner på «oppskrift_» avvises', v_feil = 'UGYLDIG_PRODUKTNUMMER', v_feil);
  r := public.oppdater_ordre_fiken_linje(c_id, 'Oppskrift_1', jsonb_build_object('produktnummer', 'Oppskrift_1', 'antall', 1));
  insert into _res(navn, ok, info) values ('T8 vernet gjelder bare prefikset «oppskrift_» (annen skrivemåte er et vanlig nummer, som før)', jsonb_array_length(r->'fikenLinjer') = 2, r::text);
  r := public.oppdater_ordre_fiken_linje(c_id, 'Oppskrift_1', null);
  insert into _res(navn, ok, info) values ('T8 ... og fjernes igjen som vanlig', jsonb_array_length(r->'fikenLinjer') = 1, r::text);
  select fiken_linjer into v_linjer from public.ordrer where id = c_id;
  insert into _res(navn, ok, info) values ('T8 ingen av de avviste kallene endret fakturalinjene', jsonb_array_length(v_linjer) = 1 and v_linjer->0->>'produktnummer' = '501', v_linjer::text);
  -- en rest fra en gammel klient (alt lagret) kan fjernes
  update public.ordrer set fiken_linjer = jsonb_build_array(jsonb_build_object('produktnummer', '501', 'antall', 1), jsonb_build_object('produktnummer', c_dor, 'antall', 1)) where id = c_id;
  r := public.oppdater_ordre_fiken_linje(c_id, c_dor, null);
  insert into _res(navn, ok, info) values ('T8 en rest med oppskrifts-id fjernes (p_linje null står åpent) og den andre linjen blir stående',
    jsonb_array_length(r->'fikenLinjer') = 1 and r->'fikenLinjer'->0->>'produktnummer' = '501', r::text);
  begin perform public.oppdater_ordre_fiken_linje('ord_test_finnes_ikke', '501', jsonb_build_object('produktnummer', '501', 'antall', 1)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T8 ukjent ordre: ORDRE_FINNES_IKKE som før', v_feil = 'ORDRE_FINNES_IKKE', v_feil);
  perform set_config('request.jwt.claims', '', true);
  begin perform public.oppdater_ordre_fiken_linje(c_id, c_dor, jsonb_build_object('produktnummer', c_dor, 'antall', 1)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T8 uten innlogging: IKKE_INNLOGGET (innloggingen sjekkes først)', v_feil = 'IKKE_INNLOGGET', v_feil);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans, 'session_token', v_tok)::text, true);

  -- T9: oppdater_ordre_fiken_linje_ved_id (nøkkelen er linje-id-en)
  update public.ordrer set fiken_linjer = '[]'::jsonb where id = c_id;
  r := public.oppdater_ordre_fiken_linje_ved_id(c_id, 'l_test_1', jsonb_build_object('id', 'l_test_1', 'produktnummer', '501', 'antall', 1));
  insert into _res(navn, ok, info) values ('T9 en linje med et vanlig produktnummer legges til som før', jsonb_array_length(r->'fikenLinjer') = 1, r::text);
  begin perform public.oppdater_ordre_fiken_linje_ved_id(c_id, 'l_test_2', jsonb_build_object('id', 'l_test_2', 'produktnummer', c_dor, 'antall', 1)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T9 en ny linje med oppskrifts-id avvises (UGYLDIG_PRODUKTNUMMER)', v_feil = 'UGYLDIG_PRODUKTNUMMER', v_feil);
  begin perform public.oppdater_ordre_fiken_linje_ved_id(c_id, 'l_test_1', jsonb_build_object('id', 'l_test_1', 'produktnummer', c_dor, 'antall', 1)); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T9 en eksisterende linje kan heller ikke endres til en oppskrifts-id', v_feil = 'UGYLDIG_PRODUKTNUMMER', v_feil);
  r := public.oppdater_ordre_fiken_linje_ved_id(c_id, 'l_test_1', jsonb_build_object('id', 'l_test_1', 'antall', 2));
  insert into _res(navn, ok, info) values ('T9 en endring uten produktnummer (antall) virker som før', r->'fikenLinjer'->0->>'produktnummer' = '501' and (r->'fikenLinjer'->0->>'antall')::int = 2, r::text);
  select fiken_linjer into v_linjer from public.ordrer where id = c_id;
  insert into _res(navn, ok, info) values ('T9 ingen av de avviste kallene endret fakturalinjene', jsonb_array_length(v_linjer) = 1 and v_linjer->0->>'produktnummer' = '501', v_linjer::text);
  update public.ordrer set fiken_linjer = jsonb_build_array(jsonb_build_object('id', 'l_test_1', 'produktnummer', '501', 'antall', 1), jsonb_build_object('id', 'l_rest', 'produktnummer', c_dor, 'antall', 1)) where id = c_id;
  r := public.oppdater_ordre_fiken_linje_ved_id(c_id, 'l_rest', null);
  insert into _res(navn, ok, info) values ('T9 en rest med oppskrifts-id fjernes på linje-id (p_linje null står åpent)', jsonb_array_length(r->'fikenLinjer') = 1 and r->'fikenLinjer'->0->>'id' = 'l_test_1', r::text);

  -- T10: rettighetene og form på de to Fiken-linje-funksjonene er uendret
  v_ok := has_function_privilege('authenticated', 'public.oppdater_ordre_fiken_linje(text,text,jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.oppdater_ordre_fiken_linje_ved_id(text,text,jsonb)', 'execute');
  insert into _res(navn, ok, info) values ('T10 authenticated kan fortsatt kjøre begge Fiken-linje-funksjonene', v_ok, '');
  insert into _res(navn, ok, info) values ('T10 begge er fortsatt security definer med fast search_path, og det finnes bare ÉN av hver',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('oppdater_ordre_fiken_linje', 'oppdater_ordre_fiken_linje_ved_id')
       and p.prosecdef and p.proconfig is not null and 'search_path=public' = any (p.proconfig)) = 2
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('oppdater_ordre_fiken_linje', 'oppdater_ordre_fiken_linje_ved_id')) = 2, '');
end; $test$;

select navn, ok, info from _res order by n;
