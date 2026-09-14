-- ============================================================
-- Salmaker'n – Admin-ark: Papirer blir tre tilstander, nye kolonner
-- Bestilt frakt og Utstyr.
-- ============================================================

-- Papirer: tom / gul hake / grønn hake, i stedet for av/på.
-- Eksisterende "true" (huket av) tolkes som grønn hake.
alter table admin_ark alter column papirer drop default;
alter table admin_ark alter column papirer type text using (case when papirer then 'gronn' else '' end);
alter table admin_ark alter column papirer set default '';

-- Bestilt frakt: enkel avkrysning (grønn hake), mellom Henteklar og Merknader.
alter table admin_ark add column if not exists bestilt_frakt boolean not null default false;

-- Utstyr: fritekst som speiles inn i ordrens "Utstyr - Skal ha etter visning".
alter table admin_ark add column if not exists utstyr text not null default '';
