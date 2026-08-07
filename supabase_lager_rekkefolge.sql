-- ============================================================
-- Salmaker'n – Egen rekkefølge på lagervarer innad i kategori
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table lagervarer add column if not exists rekkefolge integer not null default 0;
