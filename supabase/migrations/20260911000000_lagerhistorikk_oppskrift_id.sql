-- Av/på-boksen for en oppskrift på en ordre (renderOrdreLagerbruk() i lager.js) avgjorde
-- tidligere om oppskriften var trukket fra lager ved å matche oppskriftens NAVN mot
-- lagerhistorikk.kommentar. Endret man navnet på oppskriften etterpå (via redigering),
-- mistet boksen kontakten med den faktiske trekkingen - viste uhaket selv om delene
-- allerede var trukket, med fare for dobbelt uttrekk hvis noen hakte av på nytt.
-- Denne kolonnen lar nye trekk knyttes til oppskriften via ID i stedet for navn. Gamle
-- historikk-rader (før denne endringen) har ingen verdi her og faller fortsatt tilbake på
-- navn-matching i JS-koden, siden det ikke finnes noe å koble dem til i ettertid.
alter table lagerhistorikk add column if not exists oppskrift_id text;
