-- Kjørt: 2026-10-08
-- Bakgrunn: Henrik delte den faktiske minimumsregelen for egenmelding uten IA-avtale -
-- blant annet at egenmelding først kan brukes etter minst 2 måneders ansettelse. Appen
-- har i dag ingen ansettelsesdato lagret noe sted, så den må legges til før denne regelen
-- kan håndheves. NULL (ukjent) for alle eksisterende ansatte - admin må fylle inn ekte
-- datoer per ansatt i "Vis ansatte". Se lagreTimer() i js/timer.js: så lenge feltet er
-- NULL/tomt, blokkeres IKKE egenmelding (antar kvalifisert til det motsatte er kjent),
-- for å unngå å plutselig stenge alle eksisterende ansatte ute av egenmelding ved en feil.
alter table ansatte add column if not exists ansettelsesdato date;
