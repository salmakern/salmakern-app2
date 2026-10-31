-- s08-034 (Bestill fase 3, del 2 - selve utsendingen): før denne kjøres kør ordre-status-
-- utboks-triggeren (20261030200000) i kø for ALLE ordre, uansett om de kom fra portalen
-- eller ikke. Portalen vet bare om bestillinger DEN selv har sendt (portal_bestilling_id),
-- så en biler som ikke kom derfra ville bare blitt uleverte rader i køen for alltid
-- (ingen mottaker-side kjenner dem). Admin-ark/manuell e-post dekker de bilene som før
-- (s08-034, "Biler som ikke kom fra portalen: Admin-ark som før").
--
-- Rent additivt filter på en trigger som allerede finnes - endrer ingenting for rader som
-- allerede ligger i køen, bare hvilke NYE statusendringer som legges inn fra nå.
create or replace trigger "ordre-status-utboks" after update on public.ordrer
  for each row
  when (old.ordre_status is distinct from new.ordre_status and new.portal_bestilling_id is not null)
  execute function public.ordre_status_utboks_trigger_fn();
