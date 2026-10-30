-- Kjørt: 2026-10-30 (rent tillegg: nullable kolonne)
-- Fase 2, G9: push-varsel til administratorer når en ny portal-bestilling kommer. Én ny kolonne som sørger for at varselet sendes NØYAKTIG én gang per bestilling:
-- edge-funksjonen portal-bestilling «claimer» raden ved å sette push_sendt_at (bare hvis den er NULL) FØR den sender, så retry fra portalen eller to samtidige kall
-- aldri gir to varsler. Rent tillegg (nullable kolonne uten default; metadataendring), ingen kode i appen leser den. Tabellen er fortsatt bare lesbar for admin.
-- Rollback: supabase/rollback-referanser/portal_bestilling_push_ROLLBACK.sql (drop column; edge-funksjonen må da rulles tilbake først).
alter table public.portal_bestillinger add column if not exists push_sendt_at timestamptz;
