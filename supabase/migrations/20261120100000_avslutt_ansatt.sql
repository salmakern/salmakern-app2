-- ============================================================
-- «Avslutt ansatt» - full tilgangssperring i ÉN atomisk operasjon
-- ============================================================
-- Sikkerhetsgjennomgang fant at dagens eneste verktøy for en ansatt som slutter/får sparken
-- («Deaktiver» under Mer, toggleAnsatt() i js/ansatte-utstyr.js) kun setter ansatte.aktiv =
-- false - ingen bekreftelse, feil vises bare i konsollen, og PIN-raden (ansatte_pin),
-- push-abonnementer (push_abonnement) og en eventuell pågående innstempling/ordreklokke blir
-- stående ubrukt. Henrik bekreftet eksplisitt: FULL TILGANGSSPERRING (ikke fysisk sletting av
-- ansatte-raden - det ville ødelagt gamle timelister/lønn/ordre-logger som peker på den).
--
-- avslutt_ansatt(p_ansatt_id) gjør i ÉN transaksjon (alt-eller-ingenting - en «raise exception»
-- ruller tilbake HELE kallet, se lærdommen i 20261106000000_rate_limit_pin_endring.sql):
--   1) stempler ansatten ut HVIS innstemplet - samme beregning som admin-utstempling
--      (beregnAdminUtstempling/beregnNettoMinutter i js/timer.js: 30 min pause fra 8 t rå tid),
--      men med stopptidspunkt = NÅ (ingen admin velger klokkeslett her). En rad settes bare inn
--      hvis varigheten er over 0 minutter.
--   2) stopper åpne ordreklokker (Ombygging) via den EKSISTERENDE stopp_ordreklokker_for_ansatt()
--      (20261104100000_ordreklokke_opprydding.sql) - gjenbrukt uendret, ikke duplisert her.
--   3) setter aktiv = false og nuller session_token.
--   4) sletter PIN-raden i ansatte_pin.
--   5) sletter push-abonnementene i push_abonnement.
-- Idempotent: kjøres den på en allerede inaktiv/opprydd ansatt, gjør den bare det som
-- gjenstår (nyttig for å rydde opp ansatte som tidligere ble deaktivert med den gamle,
-- ufullstendige «Deaktiver»-knappen - den knappen fjernes ikke, se js/ansatte-utstyr.js).
--
-- Kan ikke brukes på seg selv (KAN_IKKE_AVSLUTTE_SEG_SELV): ville nullet egen PIN/session_token
-- midt i den innloggede økta uten noen annen admin til stede for å rette det - en bevisst
-- sikkerhetssperre, ikke noe Henrik ba om eksplisitt.
--
-- admin_reaktiver_ansatt(p_ansatt_id, p_ny_pin) setter en HELT NY PIN og aktiv = true i ÉN
-- operasjon (samme PIN-validering/rate-limit/unikhet-mønster som admin_sett_pin), siden PIN-
-- raden er slettet av avslutt_ansatt - "Aktiver igjen" krever derfor alltid en ny PIN, uansett
-- om ansatten ble deaktivert via avslutt_ansatt eller den enkle aktiv-vippen.
--
-- Rollback: drop function if exists public.avslutt_ansatt(integer);
--           drop function if exists public.admin_reaktiver_ansatt(integer, text);

create or replace function public.avslutt_ansatt(p_ansatt_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me record;
  v_a ansatte%rowtype;
  v_na timestamptz := now();
  v_dato text;
  v_start text;
  v_stopp text;
  v_raatid int;
  v_mins int;
  v_rad_id text;
  v_tid_registrert boolean := false;
  v_klokker jsonb;
begin
  select * into v_me from current_ansatt();
  if v_me.id is null then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if v_me.rolle <> 'admin' then
    raise exception 'KUN_ADMIN';
  end if;
  if p_ansatt_id is null then
    raise exception 'UGYLDIG_ANSATT';
  end if;
  if p_ansatt_id = v_me.id then
    raise exception 'KAN_IKKE_AVSLUTTE_SEG_SELV';
  end if;

  select * into v_a from ansatte where id = p_ansatt_id for update;
  if not found then
    raise exception 'ANSATT_FINNES_IKKE';
  end if;

  -- 1) Stemple ut hvis innstemplet (nå, med vanlig pauseregel - se beregnNettoMinutter i js/timer.js).
  if v_a.stemplet_inn_siden is not null then
    v_dato := to_char(v_a.stemplet_inn_siden at time zone 'Europe/Oslo', 'YYYY-MM-DD');
    v_start := to_char(v_a.stemplet_inn_siden at time zone 'Europe/Oslo', 'HH24:MI');
    v_stopp := to_char(v_na at time zone 'Europe/Oslo', 'HH24:MI');
    v_raatid := round(extract(epoch from (v_na - v_a.stemplet_inn_siden)) / 60)::int;
    if v_raatid > 0 then
      v_mins := greatest(0, v_raatid - case when v_raatid >= 480 then 30 else 0 end);
      v_rad_id := 'tavslutt_' || p_ansatt_id || '_' || round(extract(epoch from v_a.stemplet_inn_siden) * 1000)::bigint;
      insert into timer_entries (id, ansatt_id, ansatt, dato, type, start, stopp, mins)
      values (v_rad_id, p_ansatt_id, v_a.navn, v_dato, 'normal', v_start, v_stopp, v_mins)
      on conflict (id) do nothing;
      v_tid_registrert := true;
    end if;
    update ansatte set stemplet_inn_siden = null
      where id = p_ansatt_id and stemplet_inn_siden = v_a.stemplet_inn_siden;
  end if;

  -- 2) Stopp åpne ordreklokker (Ombygging) - samme RPC som admin-utstempling bruker.
  select public.stopp_ordreklokker_for_ansatt(p_ansatt_id) into v_klokker;

  -- 3) Full tilgangssperring.
  update ansatte set aktiv = false, session_token = null where id = p_ansatt_id;
  delete from ansatte_pin where ansatt_id = p_ansatt_id;
  delete from push_abonnement where ansatt_id = p_ansatt_id;

  return jsonb_build_object(
    'ok', true,
    'navn', v_a.navn,
    'timeRegistrert', v_tid_registrert,
    'ordreklokkerStoppet', coalesce((v_klokker->>'antall')::int, 0)
  );
end;
$$;
revoke all on function public.avslutt_ansatt(integer) from public;
grant execute on function public.avslutt_ansatt(integer) to anon, authenticated;

create or replace function public.admin_reaktiver_ansatt(p_ansatt_id integer, p_ny_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;
  if p_ansatt_id is null or not exists (select 1 from ansatte where id = p_ansatt_id) then
    raise exception 'ANSATT_FINNES_IKKE';
  end if;
  if p_ny_pin !~ '^[0-9]{6}$' then
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

  update ansatte set aktiv = true where id = p_ansatt_id;
  return 'ok';
end;
$$;
revoke all on function public.admin_reaktiver_ansatt(integer, text) from public;
grant execute on function public.admin_reaktiver_ansatt(integer, text) to anon, authenticated;
