-- Rollback for 20261101000000_portal_koble_chassis_fra_losrad.sql
-- To deler:
-- 1) Fjern den nye funksjonen (helt ny, trygt å droppe - ingenting annet kaller den).
-- 2) Sett portal_koble_bestilling TILBAKE til v5 (kjør 20261030210000_portal_koble_bestilling.sql
--    på nytt - den filen ligger uendret i migrations/ og re-oppretter funksjonen byte-identisk
--    med v5, uten "and not v_rerun" på admin_ark-grenen).
-- Rader som ALLEREDE er opprettet/koblet via den nye funksjonen (ordrer, portal_bestillinger-
-- oppdateringer) berøres IKKE av dette - de må ryddes bevisst hvis noe skal reverseres.
drop function if exists public.portal_koble_chassis_fra_losrad(text, text);

-- Kjør deretter (fra app-mappen):
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file supabase/migrations/20261030210000_portal_koble_bestilling.sql
