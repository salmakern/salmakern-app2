-- Rollback for 20261116110000_portal_forhandler_salg.sql
--
-- Migrasjonen endrer INGEN data (den lager bare en skrivebeskyttet funksjon), så dette er alt som skal til i databasen.
--
-- REKKEFØLGE (portalen henter fakta herfra; se også portalens CLAUDE.md og supabase/README.md «Importerte biler til portalen», samme mønster):
-- 1) Fjern "lønnsomhet per forhandler" fra Kalkyle-sidens kode i portalen FØRST, så portalen slutter å kalle edge-funksjonen.
-- 2) Slett edge-funksjonen:
--      npx supabase functions delete portal-forhandler-salg --project-ref qoqpenbfdxeduylxirwk
-- 3) Drop funksjonen (denne filen). Gjøres den i feil rekkefølge, svarer edge-funksjonen 502 intern_feil (PGRST202, funksjonen finnes ikke), og
--    portalens kjøring gjør ingenting (feilet faktakall = ingen tall vist).

drop function if exists public.portal_forhandler_salg(text[]);
