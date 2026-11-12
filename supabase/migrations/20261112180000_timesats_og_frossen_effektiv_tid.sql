-- s09-020 (Henrik, "ja legg det til" 2026-11-04): frys effektiv ordretid når bilen er
-- ferdig (status Hentet), og en timesats (kr/time) så den brukte tiden kan vises som en
-- kostnad på Bil-effektivitet-badgen uten en ny spørring hver gang ordren åpnes.
--
-- timesats_kr: ett globalt tall (singleton-raden i innstillinger, samme mønster som
-- gps_lat/gps_radius/dagens_pin), satt av admin under Mer -> Standardtider.
--
-- effektiv_tid_frossen: satt KUN av endreStatus() i js/oversikt-kalender.js når en ordre
-- settes til "Hentet" (aldri av den generelle save()/ordreToDb() - se dbToOrdre()-
-- kommentaren om portal_bestilling_id m.fl. for samme mønster og begrunnelse: en ansatt som
-- lagrer et annet felt på ordren skal aldri kunne overskrive/nullstille det frosne tallet
-- med en gammel lokal kopi). Nullstilles igjen hvis statusen flyttes bort fra Hentet.
--
-- Rollback: alter table innstillinger drop column if exists timesats_kr;
--           alter table ordrer drop column if exists effektiv_tid_frossen;

alter table innstillinger add column if not exists timesats_kr numeric;
alter table ordrer add column if not exists effektiv_tid_frossen jsonb;
