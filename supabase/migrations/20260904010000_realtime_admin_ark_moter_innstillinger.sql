-- ============================================================
-- Salmaker'n – admin_ark, moter og innstillinger manglet i
-- supabase_realtime-publiseringen, så endringer i disse ble ALDRI
-- sendt live til andre enheter (kun ordrer/ansatte/timer_entries/
-- flater/lager-tabellene var lagt til, se 20260428132000_tabeller.sql
-- og 20260730072342_varelager.sql) - selv om js/core.js sin
-- subscribeRealtime() abonnerer på postgres_changes for alle tre.
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================
alter publication supabase_realtime add table admin_ark;
alter publication supabase_realtime add table moter;
alter publication supabase_realtime add table innstillinger;
