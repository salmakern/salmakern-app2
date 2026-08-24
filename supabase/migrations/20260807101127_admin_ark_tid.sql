-- ============================================================
-- Salmaker'n – Admin-ark: Time bekreftet får eget klokkeslett-felt,
-- og "Time på biltilsynet" på selve ordren hentes fra dette.
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table admin_ark add column if not exists time_bekreftet_tid text not null default '';
alter table ordrer add column if not exists tid_biltilsynet_tid text;
