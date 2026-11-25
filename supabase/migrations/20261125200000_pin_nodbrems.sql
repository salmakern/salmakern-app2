-- Samlet PIN-sperre (Henger igjen oe3ybyfat1g3ef6dx2rm, spec 25.11, alle Henriks svar innhentet):
--   (1) NØDBREMS: admin kan med ett trykk stenge all PIN-innlogging (admin slipper fortsatt inn) og
--       kaste ut ALLE andre økter umiddelbart, også andre admin-økter og allerede utstedte JWT-er.
--       Etter at nødbremsen er opphevet må ALLE (også admin) logge inn med sin gamle PIN én gang og
--       sette en ny (tvungen bytteskjerm i klienten, håndhevet her i current_ansatt()).
--   (2) VARSEL: et push-varsel til admin når den EKSISTERENDE automatiske sperren (30 feil PIN-forsøk
--       på 10 min, _pin_rate_limit_global_*) slår inn. Selve sperren er UENDRET (gjelder alle, også admin).
--
-- Grunnlag: funksjonsdefinisjonene er hentet LIVE fra produksjonen 25.11 (pg_get_functiondef), ikke fra
-- eldre migrasjoner, og er endret så lite som mulig. Det nye i hver funksjon er merket «NØDBREMS».
--
-- VIKTIG BIVIRKNING (ønsket, Henrik 25.11): current_ansatt()/hent_innlogget_ansatt() godtar ikke lenger en
-- økt UTEN claimet logget_inn_at. Det gjaldt 54 gamle innlogginger fra før 12.11 (lest 25.11), som da
-- ikke hadde noen øktgrense i det hele tatt. De kastes ut i det øyeblikket migrasjonen kjøres (de logger
-- bare inn på nytt med PIN). Alle innlogginger etter 12.11 har claimet og merker ingenting.
--
-- Avvik fra specen (bevisst, se rapporten): logg_inn_med_pin/login_med_pin gjør IKKE «raise NODBREMS_AKTIV».
-- En raise ruller tilbake hele kallet, også registreringen av det feilede forsøket, og da ville forsøk
-- under nødbrems ikke telt i sperrene (fri gjetting etter en admin-PIN). I stedet oppfører et blokkert
-- forsøk seg nøyaktig som feil PIN (tomt svar, telles som feil forsøk, samme svar for riktig og feil PIN),
-- og klienten leser sikkerhet_tilstand.nodbrems_aktiv for å vise «Innlogging er midlertidig stengt av admin».
--
-- ROLLBACK (kjøres samlet, i en transaksjon):
--   1. Gjenopprett current_ansatt, hent_innlogget_ansatt, login_med_pin, endre_egen_pin, admin_sett_pin og
--      _pin_rate_limit_global_registrer fra supabase/rollback-referanser/pin_nodbrems_ROLLBACK.sql (de live
--      definisjonene fra 25.11).
--   2. logg_inn_med_pin: samme fil (drop + create med den gamle returtypen + grant).
--   3. drop function nodbrems_pa(), nodbrems_av(), endre_pin_etter_nodbrems(text), _sikkerhet_push(text,int);
--      alter publication supabase_realtime drop table sikkerhet_tilstand; drop table sikkerhet_tilstand;
--      alter table ansatte_pin drop column pin_satt_at.
--   Klienten tåler at tabellen/RPC-ene mangler (feil logges, innlogging virker som før).

-- ════════════ Tabell ════════════
create table if not exists public.sikkerhet_tilstand (
  id int primary key default 1 check (id = 1),
  nodbrems_aktiv boolean not null default false,
  nodbrems_siden timestamptz,          -- siste gang nødbremsen ble trukket (økter fra før dette godtas aldri igjen)
  nodbrems_av int,                     -- ansatt-id til admin som trakk den
  nodbrems_auth_uid uuid,              -- Auth-brukeren (enheten) som trakk den: bare den økta slipper gjennom
  nodbrems_opphevet_at timestamptz,
  nodbrems_opphevet_av int,
  ny_pin_kreves_fra timestamptz,       -- PIN satt før dette må byttes (= nodbrems_siden når den oppheves)
  global_sperre_varslet_at timestamptz -- siste push om den automatiske 30-feil-sperren (høyst ett per 10 min)
);
insert into public.sikkerhet_tilstand (id) values (1) on conflict (id) do nothing;

alter table public.sikkerhet_tilstand enable row level security;
revoke all on public.sikkerhet_tilstand from public, anon, authenticated;
grant select on public.sikkerhet_tilstand to authenticated;
drop policy if exists sikkerhet_tilstand_les on public.sikkerhet_tilstand;
-- Alle med en Auth-sesjon (også en fersk anonym sesjon på PIN-skjermen, og en økt som akkurat er kastet ut)
-- må kunne LESE tilstanden: klienten trenger den for meldingen på PIN-skjermen og for Realtime-utkastingen.
-- Ingen skriverettigheter: bare nodbrems_pa/nodbrems_av og _pin_rate_limit_global_registrer (security definer).
create policy sikkerhet_tilstand_les on public.sikkerhet_tilstand for select to authenticated using (true);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sikkerhet_tilstand') then
    alter publication supabase_realtime add table public.sikkerhet_tilstand;
  end if;
end $$;

-- Når ble PIN-en satt? null = før denne migrasjonen (regnes som «gammel»). Nye rader (opprett_ansatt) får now().
alter table public.ansatte_pin add column if not exists pin_satt_at timestamptz;
alter table public.ansatte_pin alter column pin_satt_at set default now();

-- ════════════ current_ansatt() ════════════
create or replace function public.current_ansatt()
 returns table(id bigint, rolle text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select a.id, a.rolle
  from ansatte a
  left join sikkerhet_tilstand st on st.id = 1
  where a.aktiv = true
    and (auth.jwt()->>'ansatt_id') is not null
    and a.id = (auth.jwt()->>'ansatt_id')::integer
    and (a.flere_enheter or a.session_token = (auth.jwt()->>'session_token'))
    -- NØDBREMS: manglende logget_inn_at godtas ikke lenger (var «ingen grense ennå» siden 12.11).
    and (auth.jwt()->>'logget_inn_at') is not null
    and now() - (auth.jwt()->>'logget_inn_at')::timestamptz < (a.okt_maks_minutter || ' minutes')::interval
    and (
      -- Økta som trakk nødbremsen (samme enhet, samme admin, innlogget før den ble trukket) beholdes.
      (st.nodbrems_auth_uid is not null and auth.uid() = st.nodbrems_auth_uid
        and a.id = st.nodbrems_av
        and (auth.jwt()->>'logget_inn_at')::timestamptz <= st.nodbrems_siden)
      or (
        -- Alle andre: økta må være startet ETTER siste nødbrems ...
        (st.nodbrems_siden is null or (auth.jwt()->>'logget_inn_at')::timestamptz > st.nodbrems_siden)
        -- ... og PIN-en må være byttet hvis nødbremsen krever det (klientens bytteskjerm kan ikke omgås).
        and not exists (
          select 1 from ansatte_pin p
          where p.ansatt_id = a.id
            and coalesce(p.pin_satt_at, '-infinity'::timestamptz)
                < (case when st.nodbrems_aktiv then st.nodbrems_siden else st.ny_pin_kreves_fra end)
        )
      )
    );
$function$;

-- ════════════ hent_innlogget_ansatt() (samme betingelse som current_ansatt) ════════════
create or replace function public.hent_innlogget_ansatt()
 returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, pin_kort boolean, okt_maks_minutter integer, er_delt_stasjon boolean, logget_inn_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select a.id, a.navn, a.rolle, a.aktiv, a.kan_fore_lonn,
    (exists (select 1 from ansatte_pin p where p.ansatt_id = a.id and length(p.pin) <> 6)),
    a.okt_maks_minutter, a.er_delt_stasjon,
    (auth.jwt()->>'logget_inn_at')::timestamptz
  from ansatte a
  left join sikkerhet_tilstand st on st.id = 1
  where a.aktiv = true
    and (auth.jwt()->>'ansatt_id') is not null
    and a.id = (auth.jwt()->>'ansatt_id')::integer
    and (a.flere_enheter or a.session_token = (auth.jwt()->>'session_token'))
    -- NØDBREMS: identisk med current_ansatt() (se der).
    and (auth.jwt()->>'logget_inn_at') is not null
    and now() - (auth.jwt()->>'logget_inn_at')::timestamptz < (a.okt_maks_minutter || ' minutes')::interval
    and (
      (st.nodbrems_auth_uid is not null and auth.uid() = st.nodbrems_auth_uid
        and a.id = st.nodbrems_av
        and (auth.jwt()->>'logget_inn_at')::timestamptz <= st.nodbrems_siden)
      or (
        (st.nodbrems_siden is null or (auth.jwt()->>'logget_inn_at')::timestamptz > st.nodbrems_siden)
        and not exists (
          select 1 from ansatte_pin p
          where p.ansatt_id = a.id
            and coalesce(p.pin_satt_at, '-infinity'::timestamptz)
                < (case when st.nodbrems_aktiv then st.nodbrems_siden else st.ny_pin_kreves_fra end)
        )
      )
    );
$function$;

-- ════════════ Push-hjelper (samme mønster som ordre_push_trigger_fn) ════════════
-- Sender {type:'pin_global_sperre', hendelse, avId} til send-push med server-hemmeligheten fra Vault.
-- Best effort: feiler aldri kalleren (innlogging/nødbrems skal aldri stoppe på et varsel). pg_net sender
-- forespørselen først når transaksjonen er committet.
create or replace function public._sikkerhet_push(p_hendelse text, p_av int)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_nokkel text;
  v_server text;
begin
  begin
    select decrypted_secret into v_nokkel from vault.decrypted_secrets where name = 'ordre_push_service_role_key';
    select decrypted_secret into v_server from vault.decrypted_secrets where name = 'send_push_server_secret';
    if v_nokkel is null or v_server is null then
      raise warning 'sikkerhet-push: mangler nøkkel/server-hemmelighet i Vault - hopper over varselet';
      return;
    end if;
    perform net.http_post(
      'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-push',
      jsonb_build_object('type', 'pin_global_sperre', 'hendelse', p_hendelse, 'avId', p_av),
      '{}'::jsonb,
      jsonb_build_object('Content-type', 'application/json', 'Authorization', 'Bearer ' || v_nokkel, 'x-server-secret', v_server),
      5000
    );
  exception when others then
    raise warning 'sikkerhet-push feilet (%), fortsetter uendret', sqlerrm;
  end;
end;
$function$;
revoke all on function public._sikkerhet_push(text, int) from public, anon, authenticated;

-- ════════════ Varsel når den automatiske sperren slår inn ════════════
-- Selve sperren (_pin_rate_limit_global_sjekk) er urørt. Varselet sendes HER og ikke i _sjekk: der rulles
-- alt tilbake av raise. Atomisk oppdatering gir høyst ett varsel per 10 min, også ved samtidige kall.
create or replace function public._pin_rate_limit_global_registrer(v_suksess boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_antall integer;
begin
  -- Nullstilles bevisst IKKE av en vellykket innlogging (se toppkommentaren) - en
  -- angriper som et uhell lykkes med én PIN skal ikke få et friskt forsøksbudsjett.
  if not v_suksess then
    insert into pin_global_forsok default values;
    -- NØDBREMS-varsel: aldri noe som kan påvirke selve innloggingen.
    begin
      select count(*) into v_antall from pin_global_forsok where tidspunkt >= now() - interval '10 minutes';
      if v_antall >= 30 then
        update sikkerhet_tilstand set global_sperre_varslet_at = now()
          where id = 1 and (global_sperre_varslet_at is null or global_sperre_varslet_at < now() - interval '10 minutes');
        if found then
          perform public._sikkerhet_push('global_sperre', null);
        end if;
      end if;
    exception when others then
      raise warning 'pin-sperre-varsel feilet (%), innloggingen fortsetter uendret', sqlerrm;
    end;
  end if;
end;
$function$;

-- ════════════ logg_inn_med_pin (ny kolonne ny_pin_kreves => drop + create) ════════════
drop function if exists public.logg_inn_med_pin(text);
create function public.logg_inn_med_pin(kandidat_pin text)
 returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, ansettelsesdato date, pin_kort boolean, okt_maks_minutter integer, er_delt_stasjon boolean, logget_inn_at timestamp with time zone, ny_pin_kreves boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  treff ansatte%rowtype;
  ny_token text;
  v_pin_lengde integer;
  v_pin_satt timestamptz;
  v_na timestamptz := now();
  v_st sikkerhet_tilstand%rowtype;
  v_terskel timestamptz;
  v_funnet boolean;
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
  v_funnet := found;

  -- NØDBREMS: mens den er aktiv slipper bare admin inn. Alle andre (riktig ELLER feil PIN) får nøyaktig
  -- samme svar som feil PIN og telles som et feil forsøk (ikke et PIN-orakel, og sperrene teller).
  select * into v_st from sikkerhet_tilstand where sikkerhet_tilstand.id = 1;
  if not v_funnet or (coalesce(v_st.nodbrems_aktiv, false) and treff.rolle is distinct from 'admin') then
    perform public._pin_rate_limit_registrer(false);
    perform public._pin_rate_limit_global_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);
  perform public._pin_rate_limit_global_registrer(true);

  select length(pin), pin_satt_at into v_pin_lengde, v_pin_satt from ansatte_pin where ansatt_id = treff.id;
  v_terskel := case when v_st.nodbrems_aktiv then v_st.nodbrems_siden else v_st.ny_pin_kreves_fra end;

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
    treff.ansettelsesdato, (v_pin_lengde <> 6), treff.okt_maks_minutter, treff.er_delt_stasjon, v_na,
    coalesce(coalesce(v_pin_satt, '-infinity'::timestamptz) < v_terskel, false);
end;
$function$;
-- Samme rettigheter som før (live 25.11: public, anon, authenticated, service_role).
grant execute on function public.logg_inn_med_pin(text) to public, anon, authenticated, service_role;

-- ════════════ login_med_pin (godkjenner-PIN ved lukking av ordre) ════════════
create or replace function public.login_med_pin(kandidat_pin text)
 returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, session_token text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  treff ansatte%rowtype;
  v_funnet boolean;
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
  v_funnet := found;

  -- NØDBREMS: som i logg_inn_med_pin - bare admin, og ellers samme svar som feil PIN.
  if not v_funnet or (exists (select 1 from sikkerhet_tilstand where sikkerhet_tilstand.id = 1 and nodbrems_aktiv)
                   and treff.rolle is distinct from 'admin') then
    perform public._pin_rate_limit_registrer(false);
    perform public._pin_rate_limit_global_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);
  perform public._pin_rate_limit_global_registrer(true);
  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn, treff.session_token;
end;
$function$;

-- ════════════ endre_egen_pin / admin_sett_pin: husk når PIN-en ble satt ════════════
create or replace function public.endre_egen_pin(p_ny_pin text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  update ansatte_pin set pin = p_ny_pin, pin_satt_at = now() where ansatt_id = meg;
  return 'ok';
end;
$function$;

create or replace function public.admin_sett_pin(p_ansatt_id integer, p_ny_pin text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  insert into ansatte_pin (ansatt_id, pin, pin_satt_at) values (p_ansatt_id, p_ny_pin, now())
  on conflict (ansatt_id) do update set pin = excluded.pin, pin_satt_at = excluded.pin_satt_at;
  return 'ok';
end;
$function$;

-- ════════════ Ny PIN etter nødbrems ════════════
-- current_ansatt() avviser en økt som må bytte PIN, så endre_egen_pin kan ikke brukes. Denne sjekker
-- JWT-claimene selv, med samme vilkår som current_ansatt() bortsett fra PIN-kravet.
create or replace function public.endre_pin_etter_nodbrems(p_ny_pin text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_a ansatte%rowtype;
  v_st sikkerhet_tilstand%rowtype;
  v_inn timestamptz;
  v_terskel timestamptz;
  v_pin_satt timestamptz;
begin
  if auth.uid() is null or (auth.jwt()->>'ansatt_id') is null or (auth.jwt()->>'logget_inn_at') is null then
    raise exception 'IKKE_INNLOGGET';
  end if;
  v_inn := (auth.jwt()->>'logget_inn_at')::timestamptz;

  select a.* into v_a from ansatte a
  where a.aktiv = true
    and a.id = (auth.jwt()->>'ansatt_id')::integer
    and (a.flere_enheter or a.session_token = (auth.jwt()->>'session_token'))
    and now() - v_inn < (a.okt_maks_minutter || ' minutes')::interval;
  if not found then
    raise exception 'IKKE_INNLOGGET';
  end if;

  select * into v_st from sikkerhet_tilstand where id = 1;
  if v_st.nodbrems_siden is not null and v_inn <= v_st.nodbrems_siden then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if v_st.nodbrems_aktiv and v_a.rolle <> 'admin' then
    raise exception 'IKKE_INNLOGGET';
  end if;

  v_terskel := case when v_st.nodbrems_aktiv then v_st.nodbrems_siden else v_st.ny_pin_kreves_fra end;
  select pin_satt_at into v_pin_satt from ansatte_pin where ansatt_id = v_a.id;
  if not found or v_terskel is null or coalesce(v_pin_satt, '-infinity'::timestamptz) >= v_terskel then
    return 'IKKE_PAKREVD';
  end if;

  if p_ny_pin is null or p_ny_pin !~ '^[0-9]{6}$' then
    raise exception 'UGYLDIG_PIN';
  end if;

  perform public._pin_rate_limit_sjekk();

  if exists (select 1 from ansatte_pin where ansatt_id = v_a.id and pin = p_ny_pin) then
    return 'SAMME_PIN';
  end if;
  if exists (select 1 from ansatte_pin where pin = p_ny_pin and ansatt_id <> v_a.id) then
    perform public._pin_rate_limit_registrer(false);
    return 'PIN_I_BRUK';
  end if;
  perform public._pin_rate_limit_registrer(true);

  update ansatte_pin set pin = p_ny_pin, pin_satt_at = now() where ansatt_id = v_a.id;
  return 'ok';
end;
$function$;
revoke all on function public.endre_pin_etter_nodbrems(text) from public, anon;
grant execute on function public.endre_pin_etter_nodbrems(text) to authenticated;

-- ════════════ Nødbrems på / av (bare admin) ════════════
create or replace function public.nodbrems_pa()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me int;
  v_st sikkerhet_tilstand%rowtype;
begin
  select id into v_me from current_ansatt() where rolle = 'admin';
  if v_me is null then
    raise exception 'KUN_ADMIN';
  end if;
  select * into v_st from sikkerhet_tilstand where id = 1 for update;
  if v_st.nodbrems_aktiv then
    return jsonb_build_object('ok', true, 'alleredeAktiv', true, 'siden', v_st.nodbrems_siden);
  end if;
  update sikkerhet_tilstand
    set nodbrems_aktiv = true, nodbrems_siden = now(), nodbrems_av = v_me, nodbrems_auth_uid = auth.uid(),
        nodbrems_opphevet_at = null, nodbrems_opphevet_av = null
    where id = 1;
  perform public._sikkerhet_push('nodbrems_pa', v_me);
  return jsonb_build_object('ok', true, 'alleredeAktiv', false, 'siden', now());
end;
$function$;

create or replace function public.nodbrems_av()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me int;
  v_st sikkerhet_tilstand%rowtype;
begin
  select id into v_me from current_ansatt() where rolle = 'admin';
  if v_me is null then
    raise exception 'KUN_ADMIN';
  end if;
  select * into v_st from sikkerhet_tilstand where id = 1 for update;
  if not v_st.nodbrems_aktiv then
    return jsonb_build_object('ok', true, 'varAktiv', false);
  end if;
  update sikkerhet_tilstand
    set nodbrems_aktiv = false, nodbrems_opphevet_at = now(), nodbrems_opphevet_av = v_me,
        ny_pin_kreves_fra = nodbrems_siden
    where id = 1;
  perform public._sikkerhet_push('nodbrems_av', v_me);
  return jsonb_build_object('ok', true, 'varAktiv', true);
end;
$function$;
revoke all on function public.nodbrems_pa() from public, anon;
revoke all on function public.nodbrems_av() from public, anon;
grant execute on function public.nodbrems_pa() to authenticated;
grant execute on function public.nodbrems_av() to authenticated;
