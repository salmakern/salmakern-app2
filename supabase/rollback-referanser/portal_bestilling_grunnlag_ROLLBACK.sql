-- Rollback for 20261030200000_portal_bestilling_grunnlag.sql
-- Fjerner de to portal-tabellene og de tre portal-kolonnene på ordrer. Kjør kun manuelt, aldri via db push.
-- TRYGT bare så lenge (1) ingen senere steg (funksjon, edge-funksjon, app-kode) er kjørt, og (2) ingen ordre er merket som portal-ordre.
-- Sjekk først:  select count(*) from public.portal_bestillinger;  select count(*) from public.ordrer where portal_bestilling_id is not null;
-- Begge skal være 0. Etter go-live skal tilbakerulling skje ved å SKRU AV koblingen (portalen), aldri ved å droppe, fordi sporet av hvilke
-- ordrer som kom fra portalen og hvilke som er avvist forsvinner da.
drop index if exists public.ordrer_portal_bestilling_id_idx;
alter table public.ordrer
  drop column if exists portal_bestilling_id,
  drop column if exists portal_bekreftet_at,
  drop column if exists portal_bekreftet_av;
drop table if exists public.portal_modell_kobling;
drop table if exists public.portal_bestillinger;
