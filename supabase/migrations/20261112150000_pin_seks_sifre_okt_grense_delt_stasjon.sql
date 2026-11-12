-- ============================================================
-- Lengre PIN (6 sifre), øktgrense (auto-utlogging) og delt verksted-stasjon
-- ============================================================
-- Bedt om av Henrik 2026-11-12, som det "lettere" alternativet til full 2-trinns
-- pålogging (TOTP) for alle ansatte - se designkritikken (ikke i repoet, i samtalen) som fant
-- at TOTP ville gitt langt mer friksjon enn nytte på delte PC-er/nettbrett på verkstedgulvet.
-- Adresserer Henriks egentlige bekymring ("hvis noen får tak i linken, skal det være vanskelig
-- å komme seg inn") med: lengre PIN (10 000 -> 1 000 000 kombinasjoner) og en uttrykkelig
-- øktgrense (i dag finnes INGEN automatisk utlogging i det hele tatt utover eksplisitt
-- "Logg ut" eller at "Dagens PIN" byttes).
--
-- Tre deler:
-- 1) PIN økes fra 4 til 6 sifre for NYE/ENDREDE PIN-er. Eksisterende 4-sifrede PIN-er
--    fortsetter å virke for INNLOGGING (selve sammenligningen p.pin = kandidat_pin er
--    lengdeuavhengig tekst-match, rørt IKKE her) - Henrik 12.11: "de må [bytte], men demmes
--    være aktive til i morgen". Funksjonene som SETTER en PIN (endre_egen_pin, admin_sett_pin,
--    opprett_ansatt) krever nå 6 sifre for alt nytt. Klienten (samme commit) viser en
--    SPERRENDE "sett ny PIN"-skjerm (ikke en avvisbar påminnelse) for en ansatt med en kort
--    PIN, fra og med cutover-datoen i js/core.js (PIN6_KREVES_FRA) - Henrik må si fra i
--    chatten FØR den datoen er nådd dersom den må utsettes; selve innloggingen stopper
--    ALDRI (de logger inn med den gamle PIN-en som før, sperreskjermen kommer ETTERPÅ, slik
--    at de aldri låses helt ute og alltid kan bytte selv).
-- 2) Øktgrense: ansatte.okt_maks_minutter (standard 240 = 4 timer) håndheves i
--    current_ansatt() (ALL RLS) og hent_innlogget_ansatt() (sesjonsgjenoppretting) via et nytt
--    JWT-claim 'logget_inn_at', satt av logg_inn_med_pin og kopiert inn i JWT-en av
--    custom_access_token_hook (samme mønster som ansatt_id/rolle/session_token).
--    VIKTIG (lærdom fra tidligere hendelser i dette repoet - en ny håndhevingsbetingelse som
--    rammer ALLE eksisterende sesjoner med en gang er nøyaktig den klassen bug som ga PIN-
--    nedetid 31.10): et manglende 'logget_inn_at'-claim (enhver sesjon logget inn FØR denne
--    migreringen) regnes som "ingen grense ennå", IKKE som utløpt - grensen gjelder først fra
--    NESTE ekte innlogging. Uten dette ville ALLE innloggede (antagelig de fleste aktive
--    ansatte midt i en arbeidsdag) blitt kastet ut med én gang migreringen kjørte.
-- 3) Delt verksted-stasjon: ansatte.er_delt_stasjon (ny boolean) markerer en konto som en
--    DELT PIN for en fast stasjon, ikke en navngitt person - satt true for id 114
--    ("Booking Salmaker", en etablert konto Henrik allerede bruker til dette, kan_fore_lonn
--    allerede false fra før). Får okt_maks_minutter = 120 (2 timer) i stedet for standard 240
--    (4 timer). Klienten (samme commit) bruker er_delt_stasjon til å IKKE anvende
--    lukk-fanen-logger-ut-mekanismen på denne kontoen (en fast stasjon forventes å stå åpen),
--    mens personlige kontoer (er_delt_stasjon = false) logges ut når fanen/appen faktisk
--    lukkes, i tillegg til 4-timersgrensen.
--
-- login_med_pin (godkjenner-PIN ved lukking av ordre) er BEVISST urørt: den oppretter ingen
-- vedvarende sesjon (kun en engangsbekreftelse), så verken pin_kort-varsling eller
-- øktgrense-logikk er relevant der. Den fortsetter å godta PIN-er av hvilken som helst lengde,
-- akkurat som i dag.
--
-- Rollback: gjenopprett de fire berørte funksjonene (logg_inn_med_pin, hent_innlogget_ansatt,
-- current_ansatt, custom_access_token_hook, endre_egen_pin, admin_sett_pin, opprett_ansatt)
-- fra migrasjonene de sist ble endret i (se historikken i denne filens toppkommentar-liste
-- over hvilke migrasjoner som sist rørte hver), og kjør
-- "alter table ansatte drop column if exists okt_maks_minutter, drop column if exists
-- er_delt_stasjon;".

-- ────────────────────────────────────────────────────────────
-- 0) Skjema
-- ────────────────────────────────────────────────────────────
alter table public.ansatte add column if not exists okt_maks_minutter integer not null default 240;
alter table public.ansatte add column if not exists er_delt_stasjon boolean not null default false;

-- Markerer id 114 ("Booking Salmaker") som delt stasjon. ansatte_beskytt_skriving-triggeren
-- krever admin (current_ansatt() er tom i denne rå SQL-tilkoblingen) - avslått kun for disse to
-- linjene, slik samme mønster er brukt tidligere i dette repoet for tilsvarende engangs-UPDATE-er.
alter table public.ansatte disable trigger ansatte_beskytt_skriving_trigger;
update public.ansatte set er_delt_stasjon = true, okt_maks_minutter = 120 where id = 114;
alter table public.ansatte enable trigger ansatte_beskytt_skriving_trigger;

-- ────────────────────────────────────────────────────────────
-- 1) PIN-lengde: 6 sifre for alt NYTT (innlogging med gamle 4-sifrede PIN-er er urørt)
-- ────────────────────────────────────────────────────────────
create or replace function public.endre_egen_pin(p_ny_pin text)
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

  if p_ny_pin !~ '^[0-9]{6}$' then
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

create or replace function public.admin_sett_pin(p_ansatt_id integer, p_ny_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
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
  return 'ok';
end;
$$;

-- Validerte ALDRI PIN-formatet server-side før (kun klientens maxlength) - lagt til her i
-- samme slengen, for nye ansatte fra nå av.
create or replace function public.opprett_ansatt(p_id integer, p_navn text, p_rolle text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'UGYLDIG_PIN';
  end if;

  if exists (select 1 from ansatte_pin where pin = p_pin) then
    raise exception 'PIN_I_BRUK';
  end if;

  insert into ansatte (id, navn, rolle, aktiv, kan_fore_lonn)
  values (p_id, p_navn, p_rolle, true, true);

  insert into ansatte_pin (ansatt_id, pin) values (p_id, p_pin);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 2) logg_inn_med_pin - ny signatur (flere utdata-kolonner, krever drop+create, se
--    lærdommen i 20260826000000/20261106000000: create or replace kan ikke endre
--    returtypen på en eksisterende funksjon).
-- ────────────────────────────────────────────────────────────
drop function if exists public.logg_inn_med_pin(text);
create function public.logg_inn_med_pin(kandidat_pin text)
returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean,
              ansettelsesdato date, pin_kort boolean, okt_maks_minutter integer,
              er_delt_stasjon boolean, logget_inn_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  treff ansatte%rowtype;
  ny_token text;
  v_pin_lengde integer;
  v_na timestamptz := now();
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

  select length(pin) into v_pin_lengde from ansatte_pin where ansatt_id = treff.id;

  ny_token := gen_random_uuid()::text;
  -- Markerer for ansatte_beskytt_skriving at DETTE er en innlogging (bare session_token endres); nulles rett etter.
  perform set_config('app.pin_innlogging', '1', true);
  update ansatte set session_token = ny_token where ansatte.id = treff.id;
  perform set_config('app.pin_innlogging', '', true);

  update auth.users
  set raw_app_meta_data = raw_app_meta_data
    || jsonb_build_object('ansatt_id', treff.id, 'rolle', treff.rolle, 'session_token', ny_token,
                           'logget_inn_at', v_na)
  where auth.users.id = auth.uid();

  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn,
    treff.ansettelsesdato, (v_pin_lengde <> 6), treff.okt_maks_minutter, treff.er_delt_stasjon, v_na;
end;
$function$;
grant execute on function public.logg_inn_med_pin(text) to anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 3) hent_innlogget_ansatt - samme type utvidelse + håndhever øktgrensen (sesjonsgjenoppretting
--    skal ALDRI overleve lenger enn en fersk innlogging ville gjort).
-- ────────────────────────────────────────────────────────────
drop function if exists public.hent_innlogget_ansatt();
create function public.hent_innlogget_ansatt()
returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean,
              pin_kort boolean, okt_maks_minutter integer, er_delt_stasjon boolean,
              logget_inn_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.navn, a.rolle, a.aktiv, a.kan_fore_lonn,
    (exists (select 1 from ansatte_pin p where p.ansatt_id = a.id and length(p.pin) <> 6)),
    a.okt_maks_minutter, a.er_delt_stasjon,
    (auth.jwt()->>'logget_inn_at')::timestamptz
  from ansatte a
  where a.aktiv = true
    and (auth.jwt()->>'ansatt_id') is not null
    and a.id = (auth.jwt()->>'ansatt_id')::integer
    and (a.flere_enheter or a.session_token = (auth.jwt()->>'session_token'))
    -- Manglende claim (sesjon fra FØR denne migreringen) = ingen grense ennå, IKKE utløpt -
    -- se toppkommentaren, punkt 2 (unngår å kaste ut alle eksisterende innlogginger med én gang).
    and (
      (auth.jwt()->>'logget_inn_at') is null
      or now() - (auth.jwt()->>'logget_inn_at')::timestamptz < (a.okt_maks_minutter || ' minutes')::interval
    );
$$;
grant execute on function public.hent_innlogget_ansatt() to anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 4) current_ansatt() - SAMME øktgrense-betingelse, for ALL ANNEN RLS (ikke bare
--    sesjonsgjenoppretting). Signaturen er UENDRET (table(id bigint, rolle text)) - bare
--    funksjonskroppen endres, create or replace er trygt her.
-- ────────────────────────────────────────────────────────────
create or replace function public.current_ansatt()
returns table (id bigint, rolle text)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.rolle
  from ansatte a
  where a.aktiv = true
    and (auth.jwt()->>'ansatt_id') is not null
    and a.id = (auth.jwt()->>'ansatt_id')::integer
    and (a.flere_enheter or a.session_token = (auth.jwt()->>'session_token'))
    and (
      (auth.jwt()->>'logget_inn_at') is null
      or now() - (auth.jwt()->>'logget_inn_at')::timestamptz < (a.okt_maks_minutter || ' minutes')::interval
    );
$$;

-- ────────────────────────────────────────────────────────────
-- 5) custom_access_token_hook - kopierer også logget_inn_at inn i JWT-en, samme mønster som
--    ansatt_id/rolle/session_token. Signaturen er UENDRET (jsonb -> jsonb).
-- ────────────────────────────────────────────────────────────
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  meta jsonb;
begin
  select raw_app_meta_data into meta from auth.users where id = (event->>'user_id')::uuid;
  claims := coalesce(event->'claims', '{}'::jsonb);
  if meta ? 'ansatt_id' then
    claims := claims || jsonb_build_object(
      'ansatt_id', meta->'ansatt_id',
      'rolle', meta->'rolle',
      'session_token', meta->'session_token'
    );
    if meta ? 'logget_inn_at' then
      claims := claims || jsonb_build_object('logget_inn_at', meta->'logget_inn_at');
    end if;
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;
