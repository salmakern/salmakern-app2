-- Test av kontaktperson_slett-fiksen (migrasjon 20261031190000, s09-034). ALLTID i en
-- transaksjon som rulles tilbake: ingenting blir stående, ingen åpen app ser noe.
-- Legger en MIDLERTIDIG TEST-forhandler (ikke en ekte rad) inn i innstillinger.kontakter
-- INNE i transaksjonen, tester sletting mot den, og alt forsvinner ved rollback.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261031190000_kontaktperson_slett_null_id_fiks.sql; cat supabase/tester/kontaktperson_slett_null_id_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_kontakter_for jsonb;
  v_test_forhandler jsonb;
  v_ans_id bigint; v_ans_tok text;
  v_ikke_admin_id bigint; v_ikke_admin_tok text;
  r jsonb;
  v_personer_etter jsonb;
  v_feil text;
begin
  select kontakter into v_kontakter_for from public.innstillinger where id = 1;

  -- TEST-forhandler med tre kontaktpersoner: to UTEN id (eldre rader, som de 61 ekte) og én MED id (den som skal slettes).
  v_test_forhandler := jsonb_build_object(
    'id', 'k_test_null_id_fiks', 'navn', 'TEST Forhandler (null-id-fiks)', 'type', 'Forhandler', 'orgnr', '',
    'kontaktpersoner', jsonb_build_array(
      jsonb_build_object('navn', 'TEST Uten id 1', 'epost', 'uten1@test.no'),
      jsonb_build_object('navn', 'TEST Uten id 2', 'epost', 'uten2@test.no'),
      jsonb_build_object('id', 'kp_test_med_id', 'navn', 'TEST Med id', 'epost', 'medid@test.no')
    )
  );
  update public.innstillinger set kontakter = coalesce(v_kontakter_for, '[]'::jsonb) || jsonb_build_array(v_test_forhandler) where id = 1;

  select id, coalesce(session_token,'') into v_ans_id, v_ans_tok from public.ansatte where aktiv and rolle = 'admin' order by id limit 1;
  select id, coalesce(session_token,'') into v_ikke_admin_id, v_ikke_admin_tok from public.ansatte where aktiv and rolle = 'ansatt' order by id limit 1;

  -- T1: ikke-admin kan ikke kalle funksjonen (uendret oppførsel fra før fiksen)
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ikke_admin_id, 'session_token', v_ikke_admin_tok)::text, true);
  begin
    perform public.kontaktperson_slett('k_test_null_id_fiks', 'kp_test_med_id');
    v_feil := 'ingen feil';
  exception when others then
    v_feil := sqlerrm;
  end;
  insert into _res(navn, ok, info) values ('T1 ikke-admin avvises fortsatt (KUN_ADMIN)', v_feil = 'KUN_ADMIN', v_feil);

  -- T2: admin sletter kontaktpersonen MED id - de to UTEN id skal overleve.
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans_id, 'session_token', v_ans_tok)::text, true);
  r := public.kontaktperson_slett('k_test_null_id_fiks', 'kp_test_med_id');
  select kp->'kontaktpersoner' into v_personer_etter
  from jsonb_array_elements(r) kp where kp->>'id' = 'k_test_null_id_fiks';

  insert into _res(navn, ok, info) values ('T2 (FIKS, s09-034) de to id-løse kontaktpersonene OVERLEVER sletting av en annen',
    jsonb_array_length(v_personer_etter) = 2
    and v_personer_etter @> jsonb_build_array(jsonb_build_object('navn','TEST Uten id 1','epost','uten1@test.no'))
    and v_personer_etter @> jsonb_build_array(jsonb_build_object('navn','TEST Uten id 2','epost','uten2@test.no')), v_personer_etter::text);

  insert into _res(navn, ok, info) values ('T2 kontaktpersonen MED id er faktisk slettet',
    not exists (select 1 from jsonb_array_elements(v_personer_etter) p where p->>'id' = 'kp_test_med_id'), '');

  -- T3: slette en av de id-løse kontaktpersonene direkte (p_kontaktperson_id = 'finnes_ikke', siden de ikke har egen id å målrette) skal IKKE slette dem (ingen id matcher noensinne en id-løs rad med denne logikken - forventet, ikke et mål for denne fiksen).
  r := public.kontaktperson_slett('k_test_null_id_fiks', 'finnes_ikke_som_id');
  select kp->'kontaktpersoner' into v_personer_etter
  from jsonb_array_elements(r) kp where kp->>'id' = 'k_test_null_id_fiks';
  insert into _res(navn, ok, info) values ('T3 kall med en id som ikke finnes: begge gjenværende (id-løse) kontaktpersoner urørt, ingen feil',
    jsonb_array_length(v_personer_etter) = 2, v_personer_etter::text);
end
$test$;

select n, case when ok then 'OK  ' else 'FEIL' end as resultat, navn, case when ok then '' else info end as info from _res order by n;
