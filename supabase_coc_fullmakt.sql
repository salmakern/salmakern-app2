-- ============================================================
-- Salmaker'n – COC og Fullmakt-felt på ordre
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================
alter table ordrer add column if not exists coc text not null default 'har_ikke';
alter table ordrer add column if not exists fullmakt text not null default 'har_ikke';
