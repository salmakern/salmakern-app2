-- ============================================================
-- Salmaker'n – Møter: mulig å velge hvilke ansatte møtet gjelder,
-- slik at kun de valgte får varsel (tom liste = alle, som før)
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table moter add column if not exists deltaker_ider bigint[] not null default '{}';
