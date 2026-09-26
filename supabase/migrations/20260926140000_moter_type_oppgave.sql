-- Kjørt: 2026-09-26
-- Bakgrunn: Henrik ba om å kunne skrive frie "oppgaver" (ting som skal gjøres, ikke
-- knyttet til en ordre) rett inn i ukekalenderen ved å klikke i en tom rute - i stedet
-- for å bygge et helt nytt, parallelt system til dette (egen tabell, egen sanntid, egen
-- CRUD), gjenbrukes møter-tabellen: en "oppgave" er teknisk sett et møte uten deltakere,
-- skilt fra ekte møter kun ved dette nye type-feltet (default 'møte' for alle
-- eksisterende rader, ingen bakoverkompatibilitet-migrering av data nødvendig).
alter table moter add column if not exists type text not null default 'møte';
