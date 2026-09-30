-- Kjørt: 2026-09-30
-- Bakgrunn (bedt om av Henrik): "Bestilt frakt" som en av verdiene i ordre_status-
-- nedtrekkslisten fjernes - den krevde manuelt valg og "stjal" plassen fra den faktiske,
-- mer nyttige statusen (Klar for henting/Hentet/osv). 0 aktive ordre sto i denne statusen
-- ved sjekk (2026-09-30), så ingen migrering av eksisterende data er nødvendig der.
--
-- I stedet: "Bestilt frakt" blir en egen, uavhengig markering PÅ ordren (samme mønster
-- som `prioritert` - en kantlinje+merkelapp på ordrekortet, se sorterOrdre()/
-- oversikt-kalender.js), satt AUTOMATISK når fraktbestillingen sendes på e-post fra
-- Admin-ark (adminArkFraktBestill/adminArkSendFraktBestilling i js/admin-ark.js) - i
-- stedet for et manuelt statusvalg som lett glemmes. hente_klar_dato er en valgfri dato
-- valgt i SAMME dialog, brukt til å vise "Henteklar (dato)" på kortet og til å sortere
-- ordrelistene etter hastverk.
alter table ordrer add column if not exists bestilt_frakt boolean not null default false;
alter table ordrer add column if not exists hente_klar_dato date;

-- Etterslep: 3 admin_ark-rader har allerede bestilt_frakt=true fra før denne endringen
-- (satt automatisk av den eksisterende adminArkFraktBestill()-flyten) - speiler dem over
-- på matchende ordre nå, sånn at det nye kortmerket viser riktig med en gang i stedet for
-- at disse tre først dukker opp neste gang noen tilfeldigvis rører raden på nytt.
update ordrer o
set bestilt_frakt = true
from admin_ark a
where a.bestilt_frakt = true
  and a.arkivert = false
  and upper(trim(o.chassis)) = upper(trim(a.chassis_nr))
  and o.status = 'aktiv';
