-- ============================================================
-- Salmaker'n – Admin-ark: Mottatt blir en avkrysning, ikke en dato
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table admin_ark add column if not exists mottatt boolean not null default false;
