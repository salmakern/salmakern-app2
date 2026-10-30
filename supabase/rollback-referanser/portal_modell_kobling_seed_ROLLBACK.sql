-- Rollback for 20261030220000_portal_modell_kobling_seed.sql
-- Fjerner de 14 seedede radene. Kjør kun manuelt, aldri via db push. Etter dette gir alle nye chassis-bestillinger utfallet venter_modell (ingen ordre) til radene er lagt inn igjen.
-- Ordrer som allerede er opprettet fra portalen berøres ikke (de har merke/modell skrevet direkte).
delete from public.portal_modell_kobling where godkjent_av = 'Henrik 2026-10-30';
