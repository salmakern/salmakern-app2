-- ============================================================
-- Salmaker'n – Admin-ark: mulig å legge til rader uten ordre
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table admin_ark add column if not exists forhandler text not null default '';
alter table admin_ark add column if not exists kontaktperson text not null default '';
