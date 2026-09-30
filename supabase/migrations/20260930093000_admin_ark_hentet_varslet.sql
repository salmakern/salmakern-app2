-- Kjørt: 2026-09-30
-- Bakgrunn (bedt om av Henrik): "Bestill"- og "Hentet"-knappene i Admin-ark skal vise
-- rødt (ikke trykket ennå) eller grønt (trykket/sendt) rundt seg selv. "Bestill" har
-- allerede admin_ark.bestilt_frakt å style ut fra - "Hentet" mangler en tilsvarende
-- lagret tilstand siden adminArkVarsleHentet() hittil bare har sendt en e-post uten å
-- markere noe etterpå. Samme mønster som bestilt_frakt (20260914130000).
alter table admin_ark add column if not exists hentet_varslet boolean not null default false;
