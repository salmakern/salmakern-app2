-- Fiken-fakturer avgjør i dag "ombygging" (20%) vs "ekstra utstyr" (10%) rabattkategori
-- utelukkende ved å lete etter "ombygg" i Fiken-PRODUKTNAVNET (erOmbyggingslinje()). Dette
-- feiler på tre kjente måter, alle bekreftet mot ekte produktnavn 11.11:
--   1. Skrivefeil i selve ombygging-produktet: 2401 "Varebilombyyging..." (dobbel-y) og
--      3200 "Varebilombyging..." (mangler en g) - treffer ikke /ombygg/i, feilaktig 10%.
--   2. Et "ombygging"-ord i et ekstrautstyr-produkts navn: 412 "Gummimatte standard
--      ombygging" - feilaktig 20% (motsatt retning).
--   3. Faste tilleggsprodukter (utstyr-sjekklistepunkter i ansatte-utstyr.js) som Henrik
--      bekreftet HØRER TIL ombygging-jobben (11.11: "ja de hører til de"), men hvis
--      produktnavn ikke inneholder "ombygg": Takluke (306), Panorama (501), 4-seter (502),
--      og de øvrige faste GLS/Geländewagen/Discovery5/ID BUZZ-tilleggene.
--
-- Denne kolonnen er en EKSPLISITT, forhåndsbekreftet kategori per produktnummer - brukes i
-- stedet for navnegjetting når den er satt (NULL = fortsatt navnegjetting, som før - rører
-- ikke noe produkt Henrik ikke har sett på). Ren tilleggskolonne, ingen rader berøres
-- bortsett fra UPDATE-setningene under.
--
-- Kjør: npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file supabase/migrations/20261111200000_fiken_priser_kategori.sql
-- Rollback: alter table public.fiken_priser drop column if exists kategori;

alter table public.fiken_priser
  add column if not exists kategori text
  check (kategori is null or kategori in ('ombygging', 'ekstra_utstyr'));

-- De to skrivefeil-rammede ombygging-produktene (feilet /ombygg/i pga. skrivefeil i navnet)
update public.fiken_priser set kategori = 'ombygging' where produktnummer in ('2401', '3200');

-- Det ene feilklassifiserte ekstrautstyr-produktet (fikk 20% pga. "ombygging" i navnet)
update public.fiken_priser set kategori = 'ekstra_utstyr' where produktnummer = '412';

-- Faste utstyr-tilleggsprodukter Henrik bekreftet hører til ombygging-jobben (11.11):
-- EV9 (501 Panorama, 502 4-seter), Geländewagen (306 Takluke, 302 Airbag 2. seterad,
-- 308 DVD i nakkeputer, 309 Taktrekk i skinn), GLS (401 Klima i taket, 402 Airbag,
-- 403 Koppholder i midtkonsoll, 404 Subwoofer, 405 DVD-skjermer), Discovery 5
-- (201 7-seter, 202 4-soners klima, 204 Adaptive Dynamics, 205 Demontering reservehjul),
-- ID BUZZ (1801 Lang modell).
update public.fiken_priser set kategori = 'ombygging'
  where produktnummer in ('501','502','306','302','308','309','401','402','403','404','405','201','202','204','205','1801');
