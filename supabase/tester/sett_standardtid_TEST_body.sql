-- Test av 20261125100000_sett_standardtid.sql (Henger igjen s09-027): standardtid per modell skrives med en egen, målrettet rutine.
-- ALLTID i en transaksjon som rulles tilbake: testen endrer innstillinger.standardtider (og leser ansatte for å lage innloggingsutsagn
-- med request.jwt.claims, samme mønster som lager_bestillingsforslag_TEST_body.sql). Ingen ansatt endres.
-- Kjøring (fra rotmappen). Et SKRIVENDE steg mot den delte databasen (create function, rullet tilbake): bare etter Henriks ja, og
-- ALDRI uten rollback-linjen:
--   ( echo "begin;"; cat supabase/migrations/20261125100000_sett_standardtid.sql; cat supabase/tester/sett_standardtid_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader skal være OK.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_admin_id bigint; v_admin_tok text; v_ans_id bigint; v_ans_tok text;
  v_for jsonb; v_maler_for jsonb; v_satser_for jsonb; v_reise_for jsonb; v_pin_for text;
  r jsonb; v_feil text;
  m1 constant text := 'TEST - modell s09-027';
  m2 constant text := 'TEST - modell s09-027 b ';  -- med mellomrom på slutten: nøkkelen skal brukes uendret
begin
  select id, coalesce(session_token,'') into v_admin_id, v_admin_tok from public.ansatte where aktiv and rolle='admin' and not flere_enheter order by id limit 1;
  select id, coalesce(session_token,'') into v_ans_id, v_ans_tok from public.ansatte where aktiv and rolle='ansatt' and not flere_enheter order by id limit 1;
  insert into _res(navn, ok, info) values ('Forutsetning: fant en admin og en vanlig ansatt', v_admin_id is not null and v_ans_id is not null, format('admin=%s ansatt=%s', v_admin_id, v_ans_id));

  select standardtider, utstyr_maler, drivstoff_satser, biltilsyn_reisetider, dagens_pin
    into v_for, v_maler_for, v_satser_for, v_reise_for, v_pin_for from innstillinger where id = 1;
  insert into _res(navn, ok, info) values ('Forutsetning: TEST-modellene finnes ikke fra før', not (coalesce(v_for,'{}') ? m1) and not (coalesce(v_for,'{}') ? m2), null);

  -- Uten innlogging og som vanlig ansatt: avvist, ingenting endret
  perform set_config('request.jwt.claims', '', true);
  begin perform public.sett_standardtid(m1, 120); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('S1 uten innlogging: KUN_ADMIN', v_feil = 'KUN_ADMIN', v_feil);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans_id, 'session_token', v_ans_tok)::text, true);
  begin perform public.sett_standardtid(m1, 120); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('S2 vanlig ansatt: KUN_ADMIN', v_feil = 'KUN_ADMIN', v_feil);
  insert into _res(navn, ok, info) select 'S3 standardtider uendret etter avvisningene', standardtider = v_for, null from innstillinger where id = 1;

  -- Som admin
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin_id, 'session_token', v_admin_tok)::text, true);
  r := public.sett_standardtid(m1, 480);
  insert into _res(navn, ok, info) values ('S4 admin setter 480 min: svaret har nøkkelen med ombygging 480', (r -> m1 ->> 'ombygging') = '480', r -> m1 ->> 'ombygging');
  insert into _res(navn, ok, info) select 'S5 alle ANDRE modeller er uendret (bare én nøkkel lagt til)', (standardtider - m1) = coalesce(v_for, '{}'::jsonb), null from innstillinger where id = 1;
  insert into _res(navn, ok, info) select 'S6 utstyrsmaler, drivstoffsatser, reisetider og dagens PIN er urørt',
    utstyr_maler = v_maler_for and drivstoff_satser is not distinct from v_satser_for and biltilsyn_reisetider is not distinct from v_reise_for and dagens_pin is not distinct from v_pin_for, null
    from innstillinger where id = 1;

  -- Andre felt i modellens objekt beholdes, bare ombygging endres
  update innstillinger set standardtider = jsonb_set(standardtider, array[m1], (standardtider -> m1) || '{"klargjoring": 60}'::jsonb) where id = 1;
  r := public.sett_standardtid(m1, 300);
  insert into _res(navn, ok, info) values ('S7 ny verdi erstatter ombygging, klargjoring (annet felt) beholdes', r -> m1 = '{"ombygging": 300, "klargjoring": 60}'::jsonb, (r -> m1)::text);
  r := public.sett_standardtid(m1, 0);
  insert into _res(navn, ok, info) values ('S8 0 er lov (= ikke satt, som i appen)', (r -> m1 ->> 'ombygging') = '0', null);

  -- Nøkkelen brukes uendret (ingen trimming)
  r := public.sett_standardtid(m2, 90);
  insert into _res(navn, ok, info) values ('S9 nøkkel med mellomrom på slutten lagres uendret', (r ? m2) and not (r ? btrim(m2)), null);

  -- En modell som var lagret som noe annet enn et objekt (skadet data) blir et objekt med bare ombygging
  update innstillinger set standardtider = jsonb_set(standardtider, array[m1], '"tull"'::jsonb) where id = 1;
  r := public.sett_standardtid(m1, 200);
  insert into _res(navn, ok, info) values ('S10 skadet verdi for modellen erstattes av {ombygging}', r -> m1 = '{"ombygging": 200}'::jsonb, (r -> m1)::text);

  -- Ugyldig input
  begin perform public.sett_standardtid('   ', 10); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('S11 blank modell: UGYLDIG_MODELL', v_feil = 'UGYLDIG_MODELL', v_feil);
  begin perform public.sett_standardtid(null, 10); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('S12 null-modell: UGYLDIG_MODELL', v_feil = 'UGYLDIG_MODELL', v_feil);
  begin perform public.sett_standardtid(repeat('x', 101), 10); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('S13 over 100 tegn: UGYLDIG_MODELL', v_feil = 'UGYLDIG_MODELL', v_feil);
  begin perform public.sett_standardtid(m1, -1); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('S14 negative minutter: UGYLDIG_MINUTTER', v_feil = 'UGYLDIG_MINUTTER', v_feil);
  begin perform public.sett_standardtid(m1, null); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('S15 null-minutter: UGYLDIG_MINUTTER', v_feil = 'UGYLDIG_MINUTTER', v_feil);
  begin perform public.sett_standardtid(m1, 100001); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('S16 over 100000 minutter: UGYLDIG_MINUTTER', v_feil = 'UGYLDIG_MINUTTER', v_feil);

  -- Rettigheter og definisjon
  insert into _res(navn, ok, info) select 'S17 authenticated kan kjøre den (admin-sjekken er inni), funksjonen er security definer med fast search_path',
    has_function_privilege('authenticated', 'public.sett_standardtid(text,integer)', 'execute')
    and (select p.prosecdef and p.proconfig @> array['search_path=public'] from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'sett_standardtid'), null;
  perform set_config('request.jwt.claims', '', true);
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
