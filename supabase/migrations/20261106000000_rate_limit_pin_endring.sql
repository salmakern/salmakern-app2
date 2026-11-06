-- Ikke kjørt ennå. Retter s00-029 (funnet av portal-øktas uavhengige gjennomgang 5.11,
-- oppjustert av dem til "hører ikke hjemme i bunnen av en backlog" - en innlogget ansatt kan
-- finne admin sin PIN og logge inn som admin): endre_egen_pin(p_ny_pin) og
-- admin_sett_pin(p_ansatt_id, p_ny_pin) sjekker begge
-- "exists (select 1 from ansatte_pin where pin = p_ny_pin and ansatt_id <> ...)" og kaster
-- PIN_I_BRUK hvis sann - en ekte oracle UTEN rate-limit (ulikt logg_inn_med_pin/login_med_pin,
-- som har hatt 5-feil/10-min-sperre siden 20260824000000_pin_rate_limiting_og_search_path.sql).
-- En hvilken som helst innlogget ansatt kunne dermed kalle endre_egen_pin 10 000 ganger med
-- hver mulige 4-sifrede PIN og få vite PRESIST hvilke ~20-30 koder som faktisk er tildelt noen
-- (uten å vite HVEM) - en ~300-500x innsnevring av gjettingen på selve PIN-innloggingen.
--
-- Henrik 6.11: "Rate-limit som innlogging" (valgt fremfor å fjerne selve informasjonslekkasjen).
--
-- Gjenbruker EKSAKT samme infrastruktur som innloggingen (pin_forsok-tabellen og
-- _pin_rate_limit_sjekk()/_pin_rate_limit_registrer()) fremfor en ny, parallell sperre - dette
-- fungerer fordi en INNLOGGET ansatt sin Supabase Auth-sesjon er den SAMME anonyme sesjonen
-- (auth.uid()) som PIN-innloggingen selv kjørte på (PIN-innlogging beriker bare
-- raw_app_meta_data på den, se custom_access_token_hook). Et felles forsøksteller gir dermed et
-- STERKERE forsvar enn to separate tellere (en som har brukt opp forsøk på den ene veien er også
-- blokkert på den andre). Den GLOBALE telleren (pin_global_forsok, 20261030170000) er BEVISST
-- IKKE koblet inn her: den finnes for å stoppe en angriper som sprer forsøk over MANGE ferske
-- anonyme økter - et scenario som ikke gjelder her (man må allerede være en ekte, innlogget
-- ansatt for å kalle disse funksjonene, så "åpne en ny anonym økt" gir ingen ny mulighet). Å
-- koble inn samme globale budsjett ville i tillegg latt helt vanlig PIN-velging (noen kollisjoner
-- er ren tilfeldighet) spise av budsjettet som er ment for ekte innloggingsforsøk på tvers av
-- HELE bedriften, med risiko for å låse PIN-innloggingen for alle ved uheldig timing.
--
-- VIKTIG ARKITEKTURPUNKT (funnet under testing av første utkast, IKKE opplagt): en
-- "raise exception" ruller tilbake HELE den inneværende transaksjonen i Postgres - også
-- skrivinger gjort av en tidligere, vellykket statement i SAMME transaksjon/kall (her: selve
-- _pin_rate_limit_registrer(false)-innsettingen rett før). Dette er NETTOPP hvorfor
-- logg_inn_med_pin ALDRI raiser ved feil PIN (den returnerer bare tomt) - en exception her ville
-- usynliggjort hvert eneste registrerte forsøk. Samme regel gjelder nå endre_egen_pin: PIN_I_BRUK
-- kan ikke lenger signaliseres med "raise exception" (det ville slettet registreringen med
-- samme bevegelse) - funksjonen returnerer i stedet teksten 'PIN_I_BRUK' (vanlig, vellykket
-- retur, så registreringen FAKTISK blir stående) i stedet for 'ok'. De andre feilene
-- (IKKE_INNLOGGET, UGYLDIG_PIN, KUN_ADMIN, FOR_MANGE_FORSOK) skjer FØR noen registrering i det
-- hele tatt skal skje, så de raiser fortsatt som før - ingenting å miste der.
--
-- KLIENTENDRING KREVES (gjort i samme commit, js/ansatte-utstyr.js): lagreEgenPin() og
-- adminSettNyPin() sjekket tidligere r.error.message for 'PIN_I_BRUK' - sjekker nå r.data
-- (den returnerte teksten) i stedet, siden funksjonen ikke lenger kaster for akkurat dette
-- tilfellet. Alle andre feilmeldinger er uendret.
--
-- Returtypen endres fra void til text, og CREATE OR REPLACE kan ikke endre returtypen på en
-- eksisterende funksjon - begge droppes og opprettes på nytt under, med grants (anon,
-- authenticated) satt eksplisitt igjen etterpå.
--
-- Rollback: gjenopprett de to funksjonene fra 20261008150000_endre_egen_pin_og_admin_sett_pin.sql
-- (returns void, PIN_I_BRUK som raise exception igjen) OG rull tilbake js/ansatte-utstyr.js sine
-- to funksjoner til å sjekke r.error igjen i stedet for r.data.

-- "create or replace" kan ikke endre returtypen til en eksisterende funksjon (void -> text) -
-- må droppes og opprettes på nytt, så grants (anon, authenticated) må settes eksplisitt igjen.
drop function if exists public.endre_egen_pin(text);
create function public.endre_egen_pin(p_ny_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  meg integer;
begin
  select id into meg from current_ansatt();
  if meg is null then
    raise exception 'IKKE_INNLOGGET';
  end if;

  if p_ny_pin !~ '^[0-9]{4}$' then
    raise exception 'UGYLDIG_PIN';
  end if;

  perform public._pin_rate_limit_sjekk();

  if exists (select 1 from ansatte_pin where pin = p_ny_pin and ansatt_id <> meg) then
    perform public._pin_rate_limit_registrer(false);
    return 'PIN_I_BRUK';
  end if;
  perform public._pin_rate_limit_registrer(true);

  update ansatte_pin set pin = p_ny_pin where ansatt_id = meg;
  return 'ok';
end;
$$;
grant execute on function public.endre_egen_pin(text) to anon, authenticated;

drop function if exists public.admin_sett_pin(integer, text);
create function public.admin_sett_pin(p_ansatt_id integer, p_ny_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  if p_ny_pin !~ '^[0-9]{4}$' then
    raise exception 'UGYLDIG_PIN';
  end if;

  perform public._pin_rate_limit_sjekk();

  if exists (select 1 from ansatte_pin where pin = p_ny_pin and ansatt_id <> p_ansatt_id) then
    perform public._pin_rate_limit_registrer(false);
    return 'PIN_I_BRUK';
  end if;
  perform public._pin_rate_limit_registrer(true);

  insert into ansatte_pin (ansatt_id, pin) values (p_ansatt_id, p_ny_pin)
  on conflict (ansatt_id) do update set pin = excluded.pin;
  return 'ok';
end;
$$;
grant execute on function public.admin_sett_pin(integer, text) to anon, authenticated;
