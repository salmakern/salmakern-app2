-- Ikke kjørt ennå (skrives 2026-11-04, kjøres etter Henriks ja).
-- Henrik (4.11, via portal-øktas kartlegging): «Fakturert» betyr i dag bare at en KLADD er
-- laget i Fiken (fiken-fakturer lagrer fiken_kladd_url+fakturert=true samtidig) - appen får
-- aldri vite om kladden faktisk blir sendt, betalt eller slettet i Fiken. Henrik valgte å
-- starte med at appen leser fakturastatus TILBAKE fra Fiken (GET, les-bare). Dette er
-- FØRSTE, minste steg: bare lagre statusen - ingen varsler/UI ennå (kommer i senere steg).
--
-- Nye kolonner på ordrer:
--   fiken_faktura_status: 'kladd' (fortsatt uendret kladd), 'sendt' (ble en ekte faktura,
--     ikke bekreftet betalt), 'betalt' (Fiken sin sale.settled=true - eneste status som IKKE
--     sjekkes på nytt senere), 'kladd_borte' (kladden er borte fra Fiken og et oppslag fant
--     ingen tilhørende faktura - sannsynligvis slettet), 'ukjent' (kunne ikke avgjøres i det
--     hele tatt - se fiken_faktura_referanse under). NULL = ikke sjekket ennå (eller ikke
--     fakturert i det hele tatt). 'kladd_borte' og 'ukjent' sjekkes på nytt hver kjøring akkurat
--     som 'kladd'/'sendt' (kun 'betalt' er egentlig endelig) - uten det ville en feilslått
--     gjetning (f.eks. på et regnr som ble lagt inn ETTER fakturering, se under) stå fast for
--     alltid, siden funksjonen selv aldri ville sett på den raden igjen.
--   fiken_kladd_uuid: kladdens UUID, hentet og lagret FØRSTE gang kladden faktisk blir lest
--     mens den fortsatt finnes - brukes til et presist invoiceDraftUuid-oppslag mot Fiken
--     sitt /invoices-endepunkt hvis kladden senere forsvinner (sendt ELLER slettet).
--   fiken_faktura_referanse: ØYEBLIKKSBILDET av orderReference-teksten (chassis/regnr) slik
--     den FAKTISK ble sendt til Fiken da kladden ble opprettet (satt av fiken-fakturer i samme
--     kall) - IKKE regnet ut på nytt fra ordrens NÅVÆRENDE chassis/regnr. Uten denne kunne et
--     regnr lagt inn i appen ETTER fakturering (vanlig arbeidsflyt: bilen fakturers før den har
--     vært på Biltilsynet) gjøre at et fall-back-søk på "nåværende" referanse aldri traff
--     igjen - funnet i uavhengig gjennomgang 4.11. Brukes bare som fall-back når
--     fiken_kladd_uuid mangler (kladder som allerede var borte FØR første sjekk).
--   fiken_faktura_id: Fiken sin numeriske faktura-id, satt når en matchende faktura er funnet
--     - grunnlag for en direkte GET neste gang (og en fremtidig lenke i Fakturering-kortet).
--   fiken_faktura_status_sjekket_at: tidspunktet for siste vellykkede sjekk.
--
-- Rollback: alter table public.ordrer drop column fiken_faktura_status, drop column
-- fiken_kladd_uuid, drop column fiken_faktura_referanse, drop column fiken_faktura_id,
-- drop column fiken_faktura_status_sjekket_at;

alter table public.ordrer
  add column if not exists fiken_faktura_status text
    check (fiken_faktura_status is null or fiken_faktura_status in ('kladd', 'sendt', 'betalt', 'kladd_borte', 'ukjent')),
  add column if not exists fiken_kladd_uuid text,
  add column if not exists fiken_faktura_referanse text,
  add column if not exists fiken_faktura_id bigint,
  add column if not exists fiken_faktura_status_sjekket_at timestamptz;
