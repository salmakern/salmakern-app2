-- ============================================================
-- Salmaker'n – begrens lesing av hms_avvik
--
-- Henrik 2026-10-30: avvik er mer sensitivt enn resten av HMS-modulen (kan
-- gjelde noe en ansatt selv gjorde feil) - en vanlig ansatt skal kun se SINE
-- EGNE meldte avvik, ikke alles. Admin/verneombud ser og følger opp alt,
-- som før. Resten av HMS-modulen (risikovurdering/stoffkartotek/vernerunder/
-- håndbok) er fortsatt åpen for alle - uendret.
-- ============================================================

drop policy if exists "hms_avvik_lese" on hms_avvik;

create policy "hms_avvik_lese" on hms_avvik for select
  using (
    exists (select 1 from current_ansatt() where rolle in ('admin','verneombud'))
    or exists (select 1 from current_ansatt() where id = hms_avvik.meldt_av)
  );
