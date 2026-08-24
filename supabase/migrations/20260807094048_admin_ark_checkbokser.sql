-- ============================================================
-- Salmaker'n – Admin-ark: Papirer og Dokumenter blir avkrysning
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table admin_ark alter column papirer drop default;
alter table admin_ark alter column papirer type boolean using (papirer <> '');
alter table admin_ark alter column papirer set default false;

alter table admin_ark alter column dokumenter drop default;
alter table admin_ark alter column dokumenter type boolean using (dokumenter <> '');
alter table admin_ark alter column dokumenter set default false;
