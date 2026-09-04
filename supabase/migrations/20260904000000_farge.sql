-- ============================================================
-- Salmaker'n – farge på bilen, del av bilinfo på ordren
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================
alter table ordrer add column if not exists farge text;
