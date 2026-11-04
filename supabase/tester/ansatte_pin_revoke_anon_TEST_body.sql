-- Test av 20261105100000_ansatte_pin_revoke_anon.sql.
-- ALLTID i en transaksjon som rulles tilbake. Kjøres SAMMEN med
-- ansatte_beskytt_skriving_innlogging_TEST_body.sql (den beviser at PIN-innloggingen fortsatt
-- virker helt likt - SECURITY DEFINER er upåvirket av grants). Denne filen beviser i tillegg at
-- selve hullet faktisk er tettet: anon/authenticated kan ikke lenger SELECT fra ansatte_pin i
-- det hele tatt (uavhengig av RLS, som uansett skal blokkere dem - dette er et ekstra lag).
--
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261105100000_ansatte_pin_revoke_anon.sql; cat supabase/tester/ansatte_pin_revoke_anon_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file /tmp/t.sql

-- Eget tabellnavn (ikke "_res") - kan kjøres i SAMME transaksjon som
-- ansatte_beskytt_skriving_innlogging_TEST_body.sql (som bruker "_res") uten navnekollisjon,
-- for en enda mer helhetlig kontroll. Kjørt hver for seg i praksis her 5.11, begge grønne.
create temp table _res_pin_revoke (n serial, navn text, ok boolean, info text);

do $test$
declare v_feil text;
begin
  set local role anon;
  begin
    perform 1 from public.ansatte_pin limit 1;
    v_feil := 'INGEN FEIL - SELECT gikk gjennom';
  exception when insufficient_privilege then
    v_feil := 'insufficient_privilege';
  end;
  reset role;
  insert into _res_pin_revoke(navn, ok, info) values ('T1 anon kan IKKE lenger SELECT fra ansatte_pin (avvist på grant-nivå, ikke bare RLS)', v_feil = 'insufficient_privilege', v_feil);

  set local role authenticated;
  begin
    perform 1 from public.ansatte_pin limit 1;
    v_feil := 'INGEN FEIL - SELECT gikk gjennom';
  exception when insufficient_privilege then
    v_feil := 'insufficient_privilege';
  end;
  reset role;
  insert into _res_pin_revoke(navn, ok, info) values ('T2 authenticated kan IKKE lenger SELECT fra ansatte_pin (avvist på grant-nivå, ikke bare RLS)', v_feil = 'insufficient_privilege', v_feil);
end $test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res_pin_revoke order by n;
