-- ============================================================
-- Salmaker'n – ny bildeseksjon "Avstand/skader" på ordredetaljen,
-- mellom Bilder-Ankomst og Bilder-Levering. 3 bilder: Avstand (tvangskrevd),
-- Skade 1 og Skade 2 (valgfrie).
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

alter table ordrer add column if not exists bilder_avstand_skader jsonb default '[]';
