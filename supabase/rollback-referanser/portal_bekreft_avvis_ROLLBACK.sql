-- Rollback for 20261030230000_portal_bekreft_avvis.sql
-- Fjerner de to funksjonene. Kjør kun manuelt, aldri via db push. Appkoden som kaller dem (Bekreft/Avvis i ordredetaljen) må rulles tilbake først (git revert + ny CACHE-bump i sw.js).
-- Ordrer som allerede er bekreftet beholder portal_bekreftet_at/-av (harmløse kolonner) og endringsloggen.
drop function if exists public.portal_avvis_ordre(text);
drop function if exists public.portal_bekreft_ordre(text);
