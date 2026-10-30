-- Kjørt: 2026-10-30 (14 rader; kontrollert at appens Fiken-ombyggingsliste kjenner igjen 12 av dem, Land Cruiser 150 og Durango har ingen Fiken-kode i appen heller)
-- Fase 2, G2: oversettelsen fra Forhandlerportalens modell (slug) til appens merke/modell, brukt av portal_koble_bestilling når den oppretter en ordre.
-- Godkjent av Henrik 2026-10-30 (listen med 14 modeller; «ikke gjør noe» med Defender: portalmodellen «Defender 110, 130 og OCTA» blir «Defender 110» og
-- de ansatte retter det på ordren ved behov; begge ID. Buzz-modellene blir «ID BUZZ»). Merke og modell er skrevet NØYAKTIG som appen skriver dem på ordrer
-- (se distinkte verdier i ordrer), slik at utstyrsmaler, lageroppskrifter og Fiken-ombyggingsnummer (FIKEN_OMBYGGING_MODELLER i js/ordre-detalj.js) treffer.
-- Slug-ene er `Model.slug` i portalen. En ny portalmodell uten rad her gir utfallet venter_modell (ingen ordre) til en rad legges til.
-- Rollback: supabase/rollback-referanser/portal_modell_kobling_seed_ROLLBACK.sql. Idempotent (kan kjøres på nytt: oppdaterer eksisterende rader).

insert into public.portal_modell_kobling (portal_modell_slug, merke, modell, godkjent_av) values
  ('kia-ev9',                 'KIA',           'EV9',              'Henrik 2026-10-30'),
  ('mercedes-g',              'Mercedes-Benz', 'Geländewagen',     'Henrik 2026-10-30'),
  ('mercedes-gls',            'Mercedes-Benz', 'GLS',              'Henrik 2026-10-30'),
  ('toyota-lc-250',           'Toyota',        'Land Cruiser 250', 'Henrik 2026-10-30'),
  ('toyota-lc-150',           'Toyota',        'Land Cruiser 150', 'Henrik 2026-10-30'),
  ('land-rover-discovery-5',  'Land Rover',    'Discovery 5',      'Henrik 2026-10-30'),
  ('land-rover-defender-110', 'Land Rover',    'Defender 110',     'Henrik 2026-10-30'),
  ('vw-id-buzz-kort',         'Volkswagen',    'ID BUZZ',          'Henrik 2026-10-30'),
  ('vw-id-buzz-lang',         'Volkswagen',    'ID BUZZ',          'Henrik 2026-10-30'),
  ('mercedes-vklasse',        'Mercedes-Benz', 'V-Klasse',         'Henrik 2026-10-30'),
  ('mercedes-eqv',            'Mercedes-Benz', 'EQV',              'Henrik 2026-10-30'),
  ('mercedes-vito',           'Mercedes-Benz', 'Vito',             'Henrik 2026-10-30'),
  ('kgm-rexton',              'KGM',           'Rexton',           'Henrik 2026-10-30'),
  ('dodge-durango',           'Dodge',         'Durango',          'Henrik 2026-10-30')
on conflict (portal_modell_slug) do update
  set merke = excluded.merke, modell = excluded.modell, godkjent_av = excluded.godkjent_av, godkjent_at = now();
