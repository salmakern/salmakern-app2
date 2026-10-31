-- Bestill: forhandlerens eget bestillingsnummer som en tredje måte å identifisere bilen på (2026-10-31, Henrik: «bestillingsnummer fra forhandler ved siden av chassis.nr og serienummer»).
-- Sjekk-regelen på portal_bestillinger.ident_type tillot bare CHASSIS og SERIENUMMER; nå også BESTILLINGSNR. Selve behandlingen (løs rad i Admin-ark med nummeret i Serienummer-kolonnen)
-- ligger i portal_koble_bestilling v3 (20261030210000_portal_koble_bestilling.sql, kjøres på nytt med create or replace). Additivt og bakoverkompatibelt: eksisterende rader (CHASSIS/SERIENUMMER)
-- og edge-funksjonen/portalen før denne endringen påvirkes ikke. Tabellen var tom da dette ble kjørt (ingen ekte bestillinger koblet ennå).
-- Rollback: drop constraint portal_bestillinger_ident_type_check og legg den tilbake med ('CHASSIS', 'SERIENUMMER') (bare hvis ingen rad har BESTILLINGSNR).

alter table public.portal_bestillinger drop constraint if exists portal_bestillinger_ident_type_check;
alter table public.portal_bestillinger
  add constraint portal_bestillinger_ident_type_check check (ident_type in ('CHASSIS', 'SERIENUMMER', 'BESTILLINGSNR'));
