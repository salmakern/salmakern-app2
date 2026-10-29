-- Kjørt: 2026-10-29
-- KRITISK sikkerhetsfiks - funnet og bekreftet av to uavhengige Claude-økter samme dag, med
-- Henriks eksplisitte godkjenning før noe ble endret.
--
-- Hullet: _pin_rate_limit_sjekk()/_pin_rate_limit_registrer() gjør begge "if auth.uid() is
-- null then return" - altså et stille no-op uten noen egentlig sjekk/registrering når det
-- IKKE finnes noen autentisert bruker i det hele tatt. logg_inn_med_pin()/login_med_pin()
-- kaller disse FØRST, men selve PIN-sjekken (join mot ansatte_pin) kjører uansett utfall.
-- Vanlig bruk av appen rammes ikke (den oppretter alltid en ekte anonym Auth-sesjon FØR PIN
-- tastes inn, så auth.uid() er normalt aldri null) - men SUPA_KEY (den offentlige
-- publishable-nøkkelen) står åpent i appens egen kildekode på GitHub Pages, så hvem som helst
-- kunne i teorien kalt disse RPC-ene direkte mot Supabase sitt REST-API UTEN noen sesjon i
-- det hele tatt, og dermed prøvd alle 10 000 mulige 4-sifrede PIN-koder helt uten sperre.
--
-- Fiks:
-- 1. logg_inn_med_pin()/login_med_pin() kaster nå IKKE_INNLOGGET med en gang hvis
--    auth.uid() er null, FØR noen PIN-sjekk i det hele tatt kjører.
-- 2. _pin_rate_limit_sjekk()/_pin_rate_limit_registrer() sin kjøretillatelse er fjernet fra
--    public/anon/authenticated - de er interne hjelpefunksjoner (navnet starter med "_",
--    samme konvensjon som resten av appen), og skal kun kunne kalles INNENFRA andre
--    SECURITY DEFINER-funksjoner (som fortsatt virker uendret, siden et internt perform-kall
--    fra en SECURITY DEFINER-funksjon kjører som funksjonens EIER, ikke som den opprinnelige
--    callerens rolle).
--
-- IKKE gjort her (bevisst, egen vurdering senere): en global feilgrense på tvers av nye
-- anonyme sesjoner (en angriper kan fortsatt opprette mange ferske anonyme sesjoner for å få
-- hver sin egen 5-forsøksgrense) - vurdert som lavere alvorlighetsgrad enn selve hullet over,
-- og ville krevd en større endring (IP-basert eller global telling) med reell risiko for å
-- stenge ute ekte ansatte ved falske positiver. Tatt opp som egen, separat sak.
--
-- Rollback: se supabase/rollback-referanser/tett_pin_rate_limit_hull_ROLLBACK.sql

create or replace function public.logg_inn_med_pin(kandidat_pin text)
returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, ansettelsesdato date)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  treff ansatte%rowtype;
  ny_token text;
begin
  if auth.uid() is null then
    raise exception 'IKKE_INNLOGGET';
  end if;

  perform public._pin_rate_limit_sjekk();

  select a.* into treff
  from ansatte a
  join ansatte_pin p on p.ansatt_id = a.id
  where p.pin = kandidat_pin and a.aktiv = true
  limit 1;

  if not found then
    perform public._pin_rate_limit_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);

  ny_token := gen_random_uuid()::text;
  update ansatte set session_token = ny_token where ansatte.id = treff.id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data
    || jsonb_build_object('ansatt_id', treff.id, 'rolle', treff.rolle, 'session_token', ny_token)
  where auth.users.id = auth.uid();

  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn, treff.ansettelsesdato;
end;
$function$;

create or replace function public.login_med_pin(kandidat_pin text)
returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, session_token text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  treff ansatte%rowtype;
begin
  if auth.uid() is null then
    raise exception 'IKKE_INNLOGGET';
  end if;

  perform public._pin_rate_limit_sjekk();

  select a.* into treff
  from ansatte a
  join ansatte_pin p on p.ansatt_id = a.id
  where p.pin = kandidat_pin and a.aktiv = true
  limit 1;

  if not found then
    perform public._pin_rate_limit_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);
  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn, treff.session_token;
end;
$function$;

revoke execute on function public._pin_rate_limit_sjekk() from public;
revoke execute on function public._pin_rate_limit_registrer(boolean) from public;
