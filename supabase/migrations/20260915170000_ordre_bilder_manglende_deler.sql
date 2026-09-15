-- ============================================================
-- Bilder - manglende deler: ny, fritt voksende bilde-liste på ordren (0-uendelig
-- bilder), i motsetning til de faste Ankomst/Levering/Avstand-skader-seksjonene
-- (bedt om av Henrik 2026-09-15). Samme type/default som de eksisterende
-- bilder_*-kolonnene for konsistens.
-- ============================================================

alter table ordrer add column if not exists bilder_manglende_deler jsonb default '[]'::jsonb;
