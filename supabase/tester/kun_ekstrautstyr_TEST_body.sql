-- Test av 20261118110000_kun_ekstrautstyr.sql (ny kolonne ordrer.kun_ekstrautstyr, og at portal_import_fakta/portal_timer_fakta utelater slike ordrer).
-- ALLTID i en transaksjon som rulles tilbake: testen setter inn TEST-ordrer (id-prefiks ord_test_kun_, merke TESTKUN) og alt rulles tilbake. Ingen UPDATE på ordrer
-- (triggerne «ordre-push» m.fl. er AFTER UPDATE; ingen trigger på INSERT), så ingen varsler sendes. Svarene fra funksjonene vises aldri, bare telles.
-- Kjøring (fra rotmappen). Et SKRIVENDE steg (ALTER TABLE tar en kort lås på ordrer til rollback): bare etter Henriks ja, utenom arbeidstid, ikke mellom 00:00 og 03:00:
--   ( echo "begin;"; cat supabase/migrations/20261118110000_kun_ekstrautstyr.sql; cat supabase/tester/kun_ekstrautstyr_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader skal være OK. Etterpå: kolonnen finnes ikke (select count(*) from information_schema.columns where table_name='ordrer' and column_name='kun_ekstrautstyr' = 0).
-- Uten å røre den delte databasen: samme filer mot PGlite med stubbet ordrer-tabell (se CLAUDE.md, «Kun ekstrautstyr»).

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_aktive_for int;
  v_timer_for int;
  v_svar jsonb;
  v_timer jsonb;
  v_okt constant jsonb := '[{"start": 1763380800000, "stopp": 1763384400000}]'::jsonb;   -- én time
begin
  -- K1: kolonnen
  insert into _res(navn, ok, info) select 'K1 kolonnen finnes: boolean, not null, default false',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ordrer' and column_name = 'kun_ekstrautstyr'
            and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    (select data_type || ' / ' || is_nullable || ' / ' || coalesce(column_default, 'null') from information_schema.columns
      where table_schema = 'public' and table_name = 'ordrer' and column_name = 'kun_ekstrautstyr');

  -- K2: ingen eksisterende rad er endret (alle har false)
  insert into _res(navn, ok, info) select 'K2 alle eksisterende ordrer har kun_ekstrautstyr = false',
    not exists (select 1 from public.ordrer where kun_ekstrautstyr), (select count(*)::text || ' rader' from public.ordrer);

  -- Svarene FØR testradene (bare antall; de ekte radene er uendret av migrasjonen, så antallet skal være det samme som før).
  v_aktive_for := jsonb_array_length(public.portal_import_fakta(null)->'aktive');
  v_timer_for  := (public.portal_timer_fakta()->>'antall')::int;
  insert into _res(navn, ok, info) select 'K3 aktive = alle ikke-arkiverte bil-ordrer (ingen ekte rad utelatt)',
    v_aktive_for = (select count(*) from public.ordrer where ordretype = 'bil' and coalesce(nullif(btrim(status), ''), 'aktiv') <> 'arkivert'),
    v_aktive_for::text;

  -- Testrader: en vanlig bil og en «kun ekstrautstyr», begge aktive og med én time på klokka, pluss en arkivert «kun ekstrautstyr» med frossen tid.
  insert into public.ordrer (id, ordretype, kunde, chassis, merke, modell, ordre_status, status, ordre_timer_sessions)
    values ('ord_test_kun_vanlig', 'bil', 'TEST Kunde', 'TESTKUN0000000001', 'TESTKUN', 'vanlig', 'paabegynt', 'aktiv', v_okt);
  insert into public.ordrer (id, ordretype, kunde, chassis, merke, modell, ordre_status, status, ordre_timer_sessions, kun_ekstrautstyr)
    values ('ord_test_kun_ekstra', 'bil', 'TEST Kunde', 'TESTKUN0000000002', 'TESTKUN', 'kun', 'paabegynt', 'aktiv', v_okt, true);
  insert into public.ordrer (id, ordretype, kunde, chassis, merke, modell, ordre_status, status, effektiv_tid_frossen, kun_ekstrautstyr)
    values ('ord_test_kun_arkiv', 'bil', 'TEST Kunde', 'TESTKUN0000000003', 'TESTKUN', 'kun arkivert', 'hentet', 'arkivert',
            '{"totalMs": 3600000, "frossetVed": "2026-11-17T10:00:00.000Z"}'::jsonb, true);
  -- Default: en rad uten kolonnen i insert-en får false.
  insert into _res(navn, ok, info) select 'K4 ny rad uten kolonnen får false', (select not kun_ekstrautstyr from public.ordrer where id = 'ord_test_kun_vanlig'), null;

  v_svar := public.portal_import_fakta(array['ord_test_kun_ekstra', 'ord_test_kun_vanlig']);
  insert into _res(navn, ok, info) select 'K5 import: vanlig TEST-ordre står i aktive',
    exists (select 1 from jsonb_array_elements(v_svar->'aktive') e where e->>'ordre_id' = 'ord_test_kun_vanlig'), null;
  insert into _res(navn, ok, info) select 'K6 import: kun-ekstrautstyr står IKKE i aktive (heller ikke når id-en er i ider)',
    not exists (select 1 from jsonb_array_elements(v_svar->'aktive') e where e->>'ordre_id' like 'ord_test_kun_ekstra%'), null;
  insert into _res(navn, ok, info) select 'K7 import: aktive vokste med nøyaktig 1 (bare den vanlige)',
    jsonb_array_length(v_svar->'aktive') = v_aktive_for + 1, jsonb_array_length(v_svar->'aktive')::text || ' mot ' || v_aktive_for::text;
  insert into _res(navn, ok, info) select 'K8 import: utvalgte er uendret (kun-ordren finnes = true, 16 felt)',
    exists (select 1 from jsonb_array_elements(v_svar->'utvalgte') e where e->>'ordre_id' = 'ord_test_kun_ekstra' and (e->>'finnes')::boolean
            and (select count(*) from jsonb_object_keys(e)) = 16), null;
  insert into _res(navn, ok, info) select 'K9 import: kontrakten uendret (versjon 1, hver aktiv rad har 15 felt)',
    (v_svar->>'versjon') = '1' and not exists (select 1 from jsonb_array_elements(v_svar->'aktive') e where (select count(*) from jsonb_object_keys(e)) <> 15), null;

  v_timer := public.portal_timer_fakta();
  insert into _res(navn, ok, info) select 'K10 timer: vanlig TEST-ordre gir rad med 60 minutter',
    exists (select 1 from jsonb_array_elements(v_timer->'biler') b where b->>'merke' = 'TESTKUN' and b->>'modell' = 'vanlig' and (b->>'minutter_ombygging')::int = 60), null;
  insert into _res(navn, ok, info) select 'K11 timer: kun-ekstrautstyr (aktiv og arkivert) gir ingen rad',
    not exists (select 1 from jsonb_array_elements(v_timer->'biler') b where b->>'merke' = 'TESTKUN' and b->>'modell' like 'kun%'), null;
  insert into _res(navn, ok, info) select 'K12 timer: antall vokste med nøyaktig 1, og antall = lengden på biler',
    (v_timer->>'antall')::int = v_timer_for + 1 and jsonb_array_length(v_timer->'biler') = (v_timer->>'antall')::int,
    (v_timer->>'antall') || ' mot ' || v_timer_for::text;
  insert into _res(navn, ok, info) select 'K13 timer: kontrakten uendret (versjon 1, hver rad har 15 felt)',
    (v_timer->>'versjon') = '1' and not exists (select 1 from jsonb_array_elements(v_timer->'biler') b where (select count(*) from jsonb_object_keys(b)) <> 15), null;

  -- K14-K15: egenskapene til funksjonene er uendret (stable, security invoker, bare service_role)
  insert into _res(navn, ok, info) select 'K14 begge er stable og security invoker',
    (select bool_and(p.provolatile = 's' and not p.prosecdef) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('portal_import_fakta', 'portal_timer_fakta')), null;
  insert into _res(navn, ok, info) select 'K15 authenticated og anon kan ikke kalle dem, service_role kan',
    not has_function_privilege('authenticated', 'public.portal_import_fakta(text[])', 'execute')
    and not has_function_privilege('anon', 'public.portal_timer_fakta()', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_timer_fakta()', 'execute')
    and has_function_privilege('service_role', 'public.portal_import_fakta(text[])', 'execute')
    and has_function_privilege('service_role', 'public.portal_timer_fakta()', 'execute'), null;
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
