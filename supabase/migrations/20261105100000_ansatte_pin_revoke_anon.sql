-- Ikke kjørt ennå (skrives 5.11, kjøres etter Henriks eget, eksplisitte ja - se Henger igjen
-- s90-20261105-sikkerhet, punkt 3).
-- Funnet av portal-øktas 27-punkts sikkerhetsgjennomgang 5.11, bekreftet uavhengig her mot
-- ekte grants (aclexplode(pg_class.relacl)): ansatte_pin (kolonnen med 4-sifret PIN i
-- KLARTEKST) har standard Supabase-grants (SELECT/INSERT/UPDATE/DELETE osv.) til BÅDE anon
-- OG authenticated - RLS skjuler radene for begge i dag (ingen policy gir tilgang), men selve
-- GRANT-et er unødvendig bredt: ett feiltrinn i en fremtidig RLS-endring (akkurat den klassen
-- feil som allerede låste alle ute 31.10, se CLAUDE.md) ville da eksponere ALLE ansattes PIN-
-- koder direkte via et vanlig SELECT, uten omveien om innloggingsfunksjonen og rate-limiten.
--
-- PIN-innloggingen (logg_inn_med_pin/login_med_pin) er SECURITY DEFINER og kjører derfor med
-- EIERENS rettigheter (postgres), ikke kallerens - revoke fra anon/authenticated endrer
-- ingenting for selve innloggingen. Verifisert i rullet-tilbake transaksjon sammen med den
-- etablerte testen for akkurat dette området (ansatte_beskytt_skriving_innlogging_TEST_body.sql,
-- 17 kontroller, alle OK) FØR denne filen ble skrevet ferdig.
--
-- Rollback: grant select, insert, update, delete on public.ansatte_pin to anon, authenticated;
-- (gjenoppretter standard-grantene - ikke anbefalt, kun til feilsøking).

revoke all on public.ansatte_pin from anon, authenticated;
