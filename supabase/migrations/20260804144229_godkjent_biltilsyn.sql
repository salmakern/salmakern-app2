-- ============================================================
-- Salmaker'n – Godkjent på biltilsynet (egen avkrysning)
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================
alter table ordrer add column if not exists godkjent_biltilsyn boolean not null default false;
