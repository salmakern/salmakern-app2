-- ============================================================
-- Fingerprint-felt for automatisk generering av Vegvesen-dokumenter: lar appen
-- avgjøre om noe som påvirker dokumentene har endret seg siden forrige generering,
-- uten å måtte regenerere PDF-ene på hver render. Ett felt på ordrer (frittstående
-- ordre utenfor flåte) og ett på flater (Egenerklæring/Vektfordeling/Fabrikantattest/
-- Melding om registrering/Kjøretøyliste deles av og genereres samlet for hele flåten
-- når ordren er del av en, se js/vegvesen-dokumenter.js).
-- ============================================================
alter table ordrer add column if not exists vegvesen_fingerprint text default null;
alter table flater add column if not exists vegvesen_fingerprint text default null;
