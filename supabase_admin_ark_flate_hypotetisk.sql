-- ============================================================
-- Salmaker'n – Admin-ark: mulig å skrive inn en hypotetisk flåte
-- under Flåte, som automatisk erstattes av ekte flåte.nr når
-- ordren faktisk får en flåte tildelt.
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table admin_ark add column if not exists flate_hypotetisk text not null default '';
