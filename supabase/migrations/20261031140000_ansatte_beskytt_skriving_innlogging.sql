-- Kjørt: 2026-10-31. Retter en feil som ble innført av 20261031110000_ansatte_beskytt_skriving (s09-032): PIN-INNLOGGING VAR BRUTT for alle.
--
-- Feilen: logg_inn_med_pin (SECURITY DEFINER) setter et nytt session_token på ansatte-raden til den som taster riktig PIN
-- («update ansatte set session_token = ny_token»). Den oppdateringen skjer fra en sesjon som ennå ikke har ansatt-claims (ny anonym sesjon), eller fra en som har en ANNEN ansatts
-- claims (delt enhet uten utlogging). Den nye triggeren ansatte_beskytt_skriving så en UPDATE fra en «ikke-admin», og session_token står i listen over kolonner en ikke-admin ikke kan endre,
-- så den avviste med KUN_ADMIN. Resultat: POST rpc/logg_inn_med_pin ga HTTP 400 (KUN_ADMIN) og ingen kunne logge inn med PIN fra ca. kl. 11:45 norsk tid. Testene av s09-032 (14 scenarioer)
-- dekket opprett_ansatt og navn/stempling, men ikke selve innloggingen.
--
-- Rettelsen er så smal som mulig: logg_inn_med_pin setter en transaksjonslokal markering (app.pin_innlogging) RETT før session_token-oppdateringen og nuller den RETT etter, og triggeren
-- slipper gjennom en UPDATE som BARE endrer session_token når markeringen er satt. Klienter kan ikke sette en egen GUC via PostgREST (bare request.*-variabler settes derfra, og
-- set_config ligger ikke i et eksponert skjema), og en klient uten ansatt-sesjon stoppes av RLS før triggeren i det hele tatt kjører. Alt annet i triggeren er uendret: INSERT og DELETE
-- krever admin, og en ikke-admin kan bare endre navn og stemplet_inn_siden på sin egen rad (session_token, rolle, aktiv, kan_fore_lonn, ansettelsesdato, flere_enheter, id er blokkert).
--
-- Rollback: kjør 20261031110000_ansatte_skrivebeskyttelse.sql på nytt (setter triggerfunksjonen tilbake) og gjenopprett logg_inn_med_pin fra forrige migrasjon i historikken
-- (20261029140000_tett_pin_rate_limit_hull.sql / 20261030170000_global_pin_rate_limit.sql). NB: å bare slette triggeren fjerner beskyttelsen mot at en ansatt lager/sletter admin-rader.

create or replace function public.ansatte_beskytt_skriving()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_er_admin boolean;
  v_egen_id integer;
begin
  v_er_admin := exists (select 1 from current_ansatt() where rolle = 'admin');
  if v_er_admin then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'KUN_ADMIN';
  end if;

  -- Innlogging med PIN: logg_inn_med_pin har satt markeringen rett før den oppdaterer session_token. Bare session_token kan endres på denne måten.
  if coalesce(current_setting('app.pin_innlogging', true), '') = '1'
     and (to_jsonb(new) - 'session_token') = (to_jsonb(old) - 'session_token') then
    return new;
  end if;

  -- UPDATE: bare egen rad, og bare navn/stemplet_inn_siden kan endres av en ikke-admin.
  select id into v_egen_id from current_ansatt();
  if v_egen_id is null or new.id is distinct from v_egen_id then
    raise exception 'KUN_ADMIN';
  end if;
  if new.id is distinct from old.id
     or new.rolle is distinct from old.rolle
     or new.aktiv is distinct from old.aktiv
     or new.kan_fore_lonn is distinct from old.kan_fore_lonn
     or new.ansettelsesdato is distinct from old.ansettelsesdato
     or new.session_token is distinct from old.session_token
     or new.flere_enheter is distinct from old.flere_enheter
  then
    raise exception 'KUN_ADMIN';
  end if;
  return new;
end;
$$;

revoke all on function public.ansatte_beskytt_skriving() from public;

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
  perform public._pin_rate_limit_global_sjekk();

  select a.* into treff
  from ansatte a
  join ansatte_pin p on p.ansatt_id = a.id
  where p.pin = kandidat_pin and a.aktiv = true
  limit 1;

  if not found then
    perform public._pin_rate_limit_registrer(false);
    perform public._pin_rate_limit_global_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);
  perform public._pin_rate_limit_global_registrer(true);

  ny_token := gen_random_uuid()::text;
  -- Markerer for ansatte_beskytt_skriving at DETTE er en innlogging (bare session_token endres); nulles rett etter.
  perform set_config('app.pin_innlogging', '1', true);
  update ansatte set session_token = ny_token where ansatte.id = treff.id;
  perform set_config('app.pin_innlogging', '', true);

  update auth.users
  set raw_app_meta_data = raw_app_meta_data
    || jsonb_build_object('ansatt_id', treff.id, 'rolle', treff.rolle, 'session_token', ny_token)
  where auth.users.id = auth.uid();

  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn, treff.ansettelsesdato;
end;
$function$;
