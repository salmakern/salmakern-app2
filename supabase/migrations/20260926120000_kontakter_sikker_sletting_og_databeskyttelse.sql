-- Kjørt: 2026-09-26
-- Bakgrunn: Henrik la til fraktselskaper i Kontakter, prøvde å slette én av dem, og ALLE
-- kontakter (82 forhandlere + fraktselskapene) ble slettet. Nøyaktig samme rotårsak som
-- beskytt_utstyr_maler_fn (20260807092228) ble laget for: saveInnstillinger() i
-- js/ansatte-utstyr.js gjør en FULL kolonne-overskriving av `kontakter` basert på HELE
-- fanens lokale S.kontakter, hver gang NOE som helst i Kontakter endres. Denne fanen hadde
-- tydeligvis en foreldet/ufullstendig lokal kopi (trolig fra en sanntids-hendelse som ble
-- ignorert av ignorerRealtimeInnstillinger sitt 10-sekunders "ekko"-vindu, som blokkerer
-- ALLE innkommende endringer i det vinduet - ikke bare fanens egne) - da Henrik slettet én
-- kontakt, ble denne foreldede, nesten-tomme lista skrevet rett over den ekte, fulle lista.
--
-- To tiltak:
-- 1) Utvider det eksisterende databasevernet (beskytt_utstyr_maler_fn) til også å dekke
--    `kontakter` (og de andre JSONB-listekolonnene på samme rad, samme risiko) - nekter en
--    oppdatering som ville tømt en liste helt (fra >0 til 0), uansett hvor den kommer fra.
-- 2) Legger til to trygge funksjoner for å legge til/redigere/slette ÉN kontakt om gangen,
--    beregnet fra kontakter-kolonnens FERSKE verdi i selve databasen (ikke fra en
--    potensielt foreldet kopi i en nettleserfane) - brukes av js/ansatte-utstyr.js sin
--    slettKontakt()/lagreKontakt() fremover i stedet for saveInnstillinger() sin
--    blinde full-overskriving.

create or replace function public.beskytt_innstillinger_lister_fn()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if jsonb_array_length(coalesce(old.utstyr_maler, '[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(new.utstyr_maler, '[]'::jsonb)) = 0 then
    new.utstyr_maler := old.utstyr_maler;
  end if;
  if jsonb_array_length(coalesce(old.kontakter, '[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(new.kontakter, '[]'::jsonb)) = 0 then
    new.kontakter := old.kontakter;
  end if;
  if jsonb_array_length(coalesce(old.drivstoff_satser, '[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(new.drivstoff_satser, '[]'::jsonb)) = 0 then
    new.drivstoff_satser := old.drivstoff_satser;
  end if;
  if jsonb_array_length(coalesce(old.hms, '[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(new.hms, '[]'::jsonb)) = 0 then
    new.hms := old.hms;
  end if;
  return new;
end;
$$;

drop trigger if exists beskytt_utstyr_maler on innstillinger;
drop trigger if exists beskytt_innstillinger_lister on innstillinger;
create trigger beskytt_innstillinger_lister
  before update on innstillinger
  for each row
  execute function public.beskytt_innstillinger_lister_fn();

-- ────────────────────────────────────────────────────────────
-- Trygg sletting av ÉN kontakt - beregnet fra kontakter sin FERSKE verdi i databasen,
-- ikke fra klientens lokale kopi. Returnerer den nye, fulle listen slik at klienten kan
-- oppdatere sin egen S.kontakter uten en ekstra round-trip.
-- ────────────────────────────────────────────────────────────
create or replace function public.kontakter_slett(p_kontakt_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ny jsonb;
begin
  select coalesce(jsonb_agg(k), '[]'::jsonb)
  into v_ny
  from innstillinger, jsonb_array_elements(kontakter) k
  where innstillinger.id = 1 and k->>'id' != p_kontakt_id;

  update innstillinger set kontakter = coalesce(v_ny, '[]'::jsonb) where id = 1;
  return v_ny;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- Trygg opprettelse/redigering av ÉN kontakt (matcher på id - finnes den, erstattes den,
-- ellers legges den til) - samme prinsipp: beregnet fra databasens ferske verdi.
-- ────────────────────────────────────────────────────────────
create or replace function public.kontakter_upsert(p_kontakt jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ny jsonb;
  v_id text := p_kontakt->>'id';
begin
  if v_id is null or v_id = '' then
    raise exception 'Kontakt mangler id';
  end if;

  select coalesce(jsonb_agg(
    case when k->>'id' = v_id then p_kontakt else k end
  ), '[]'::jsonb)
  into v_ny
  from innstillinger, jsonb_array_elements(kontakter) k
  where innstillinger.id = 1;

  if not exists (select 1 from jsonb_array_elements(v_ny) k where k->>'id' = v_id) then
    v_ny := v_ny || jsonb_build_array(p_kontakt);
  end if;

  update innstillinger set kontakter = v_ny where id = 1;
  return v_ny;
end;
$$;
