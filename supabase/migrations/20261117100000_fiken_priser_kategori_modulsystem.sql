-- fiken_priser.kategori får en tredje verdi, 'modulsystem' (Henrik 17.11: «ja bygg det nå»).
--
-- Bakgrunn: Henrik legger til et NYTT tillegg på en «Standard ombygging»-variant i
-- Forhandlerportalen som IKKE skal ha forhandlerrabatt. Vanlige tillegg arver ombyggingens
-- sats. fiken-fakturer gir en linje med kategori 'modulsystem' satsen
-- portal_kunde_rabatt.rabatt_modulsystem (hentet fra portalen, 0 for alle 72 forhandlere 17.11),
-- og 0 % når forhandleren ikke finnes i portal_kunde_rabatt (ingen lokal reservetabell for
-- denne kategorien). Se CLAUDE.md, «fiken_priser.kategori 'modulsystem'».
--
-- Ren utvidelse av CHECK-regelen: INGEN eksisterende rad endres. Produktnummeret tagges
-- separat når det finnes i Fiken (egen UPDATE, se CLAUDE.md).
--
-- Kjør: npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file supabase/migrations/20261117100000_fiken_priser_kategori_modulsystem.sql
-- Rollback (bare hvis ingen rad har 'modulsystem', ellers feiler den - sett dem til null først):
--   alter table public.fiken_priser drop constraint if exists fiken_priser_kategori_check;
--   alter table public.fiken_priser add constraint fiken_priser_kategori_check
--     check (kategori is null or kategori in ('ombygging', 'ekstra_utstyr'));

begin;

alter table public.fiken_priser drop constraint if exists fiken_priser_kategori_check;
alter table public.fiken_priser add constraint fiken_priser_kategori_check
  check (kategori is null or kategori in ('ombygging', 'ekstra_utstyr', 'modulsystem'));

commit;
