-- Kjørt: 2026-11-16
-- Bakgrunn: SQL-testen for portal_import_fakta (supabase/tester/portal_import_fakta_TEST_body.sql,
-- scenario S7) prøver å sette innstillinger.kontakter til en gyldig, men IKKE-liste, JSON-verdi
-- (f.eks. '{}'::jsonb, en JSON-streng, JSON null) for å bekrefte at portal_import_fakta håndterer
-- det pent. Selve UPDATE-en feiler i stedet HARDT, med en rå Postgres-feil ("cannot get array
-- length of a non-array"), FØR portal_import_fakta i det hele tatt kjører - kjørt i en rullet-
-- tilbake transaksjon 2026-11-16, ingen ekte data rørt (kontakter har fortsatt sine 91 ekte rader).
--
-- Rotårsak: beskytt_innstillinger_lister_fn() (20260926120000) kaller
-- jsonb_array_length(coalesce(new.<kolonne>, '[]'::jsonb)) - coalesce fanger bare SQL NULL, ikke
-- en gyldig JSON-verdi av feil type (objekt, streng, JSON null-literal). Treffer en slik verdi
-- `new.<kolonne>`, kaster jsonb_array_length selv, og HELE oppdateringen av raden feiler - selv om
-- oppdateringen gjaldt et helt annet felt på samme rad (f.eks. drivstoffsats eller biltilsyn-tid),
-- siden triggeren kjører BEFORE UPDATE for alle endringer på raden. Appen skriver i praksis aldri
-- en ugyldig verdi til disse feltene, så dette er ikke observert i produksjon - men det er nøyaktig
-- den typen feil denne triggeren finnes for å BESKYTTE mot, ikke krasje på.
--
-- Fiks: sjekk jsonb_typeof(new.<kolonne>) FØR jsonb_array_length kalles på den. En ny verdi som
-- ikke er en liste i det hele tatt behandles nå likt som en tom liste (beskyttes/beholder den
-- gamle verdien når den gamle var en ikke-tom liste), i stedet for å kaste. `old.<kolonne>` er
-- urørt (alltid lest via samme coalesce som før - aldri sett til noe annet enn en liste i praksis).
create or replace function public.beskytt_innstillinger_lister_fn()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if jsonb_array_length(coalesce(old.utstyr_maler, '[]'::jsonb)) > 0
     and jsonb_typeof(new.utstyr_maler) is distinct from 'array' then
    new.utstyr_maler := old.utstyr_maler;
  elsif jsonb_array_length(coalesce(old.utstyr_maler, '[]'::jsonb)) > 0
     and jsonb_array_length(new.utstyr_maler) = 0 then
    new.utstyr_maler := old.utstyr_maler;
  end if;

  if jsonb_array_length(coalesce(old.kontakter, '[]'::jsonb)) > 0
     and jsonb_typeof(new.kontakter) is distinct from 'array' then
    new.kontakter := old.kontakter;
  elsif jsonb_array_length(coalesce(old.kontakter, '[]'::jsonb)) > 0
     and jsonb_array_length(new.kontakter) = 0 then
    new.kontakter := old.kontakter;
  end if;

  if jsonb_array_length(coalesce(old.drivstoff_satser, '[]'::jsonb)) > 0
     and jsonb_typeof(new.drivstoff_satser) is distinct from 'array' then
    new.drivstoff_satser := old.drivstoff_satser;
  elsif jsonb_array_length(coalesce(old.drivstoff_satser, '[]'::jsonb)) > 0
     and jsonb_array_length(new.drivstoff_satser) = 0 then
    new.drivstoff_satser := old.drivstoff_satser;
  end if;

  if jsonb_array_length(coalesce(old.hms, '[]'::jsonb)) > 0
     and jsonb_typeof(new.hms) is distinct from 'array' then
    new.hms := old.hms;
  elsif jsonb_array_length(coalesce(old.hms, '[]'::jsonb)) > 0
     and jsonb_array_length(new.hms) = 0 then
    new.hms := old.hms;
  end if;

  return new;
end;
$$;
