-- Rollback for 20261030240000_portal_bestilling_push.sql
-- Fjerner kolonnen. Rull ut edge-funksjonen portal-bestilling UTEN push (eller slett den) FØRST, ellers feiler push-claimet (best-effort: bestillinger stoppes aldri av det, men det logges).
-- Kjør kun manuelt, aldri via db push.
alter table public.portal_bestillinger drop column if exists push_sendt_at;
