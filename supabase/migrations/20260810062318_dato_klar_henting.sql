-- ============================================================
-- Salmaker'n – dato ordren ble satt til "Klar for henting"
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================
alter table ordrer add column if not exists dato_klar_henting date;
