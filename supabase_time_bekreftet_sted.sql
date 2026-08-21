-- ============================================================
-- Salmaker'n – Admin-ark: Time bekreftet kan ha et STED til slutt
-- (f.eks. "21.08 - 11:30 Skien"), siden biltilsyn kan være ulike steder.
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table admin_ark add column if not exists time_bekreftet_sted text not null default '';

-- Speiles til ordren (som tid_biltilsynet/tid_biltilsynet_tid allerede gjør) slik at
-- stedet også vises på selve ordresiden og i kalenderen på Oversikt.
alter table ordrer add column if not exists tid_biltilsynet_sted text not null default '';
