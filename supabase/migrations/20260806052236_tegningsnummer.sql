-- ============================================================
-- Salmaker'n – Bytt ut "Leverandør" med "Tegningsnummer" på lagervarer
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

-- Ny kolonne for tegningsnummer
alter table lagervarer add column if not exists tegningsnummer text not null default '';

-- Fjerner den gamle leverandør-kolonnen (erstattes av tegningsnummer)
alter table lagervarer drop column if exists leverandor;
