-- s08-048 (Henrik 30.10 kveld, ja 31.10 kveld): «det er viktig at det er produkt.nr som
-- blir med, og at rabatten også legges inn i Fiken, så kunden ser at vi har gitt dem
-- rabatt». Portalens Bestill-dialog kan etter hvert sende med produktlinjer (produktnummer,
-- navn, rabatt-prosent FRA BESTILLINGEN - ikke Salmaker'ns kundesats i fiken_kunde_rabatt).
--
-- To kolonner, begge nullable (portalen sender ikke feltet ennå - helt additivt):
--  - portal_bestillinger.linjer: rått, validert innhold (admin-innsyn, samme som resten av tabellen).
--  - ordrer.portal_linjer: samme innhold kopiert til selve ordren (kun ny_ordre-grenen) -
--    leses av klienten (dbToOrdre) og brukes av leggTilPortalUtstyrLinjer() (js/lager.js)
--    når en portal-ordre bekreftes: fyller «Skal ha etter visning» og fiken_linjer med
--    rabatten FROSSET per linje (fiken-fakturer bruker den linjens rabatt i stedet for
--    fiken_kunde_rabatt for disse radene - se supabase/functions/fiken-fakturer/index.ts).
--    Samme skrive-mønster som portal_modell_slug (20261031150000): LESES av dbToOrdre,
--    ALDRI skrevet av ordreToDb/save() - dekket av det samme generiske /portal/i-regex-
--    testet i test/portal-ordre-visning.test.js.
alter table public.portal_bestillinger add column if not exists linjer jsonb;
alter table public.ordrer add column if not exists portal_linjer jsonb;
