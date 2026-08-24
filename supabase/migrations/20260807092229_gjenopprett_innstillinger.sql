-- ============================================================
-- Salmaker'n – Gjenoppretter utstyr_maler og dagens_pin
-- (hentet fra sikkerhetskopi 05. aug 2026 00:24)
-- Kjør dette i LIVE-prosjektets SQL Editor → New Query → Run
-- ============================================================

update innstillinger
set
  dagens_pin = '6827',
  utstyr_maler = '[
    {"id":"u103","navn":"Mercedes-Benz GLS","biltype":"GLS","punkter":["Klima i taket","Airbag","Koppholder i midt konsoll","Subwoofer","DVD-Skjermer","Instruksjonsbok","2 nøkler","Deksler slepekrok","Parfyme","Rollon","Matter"]},
    {"id":"u104","navn":"Land Rover Defender","biltype":"Defender","punkter":["Panorama glasstak","3-seter foran","4-seter bak","5-seter bak","Airbag","Octa","Instruksjonsbok","2 nøkler","Gulvmatter","Plate med deler","130","Rollon"]},
    {"id":"u107","navn":"KGM Rexton","biltype":"Rexton","punkter":["Instruksjonsbok","2 nøkler","Gulvmatter","Rollon"]},
    {"id":"u108","navn":"Land Rover Discovery 5","biltype":"Discovery 5","punkter":["Panorama glasstak","Fast glasstak","5- seter bak","Klima i taket","Airbag","AD","Reservehjul","Instruksjonsbok","2 nøkler","Gulvmatter","Rollon"]},
    {"id":"u109","navn":"Toyota Land Cruiser 250","biltype":"Land Cruiser 250","punkter":["Klima i taket","Reservehjul","Takluke elektrisk","5-seter bak","Instruksjonsbok","2 nøkler","Gulvmatter","Rollon","Hybrid"]},
    {"id":"u110","navn":"KIA EV9","biltype":"EV9","punkter":["Klima i taket","Airbag","4-seter bak","5-seter bak","Panorama glasstak","4-seter bak 180","Matter","2 nøkler","Lader","Instruksjonsbok","Rollon"]},
    {"id":"u117","navn":"Volkswagen ID BUZZ","biltype":"ID BUZZ","punkter":["Klima i taket","Airdager 2. seterad","4-seter bak","5-seter bak","Panorama glasstak","Lang Modell","Instruksjonsbok","2 nøkler","Gulvmatter","Lader","Rollon"]},
    {"id":"u169","navn":"Mercedes-Benz Geländewagen","biltype":"Geländewagen","punkter":["Takluke","Airbag 2. seterad","DVD - skjermer","Taktrekk i skinn","Rollon","Instruksjonsbok","2 nøkler","Gulvmatter","Senterkopper"]}
  ]'::jsonb
where id = 1;
