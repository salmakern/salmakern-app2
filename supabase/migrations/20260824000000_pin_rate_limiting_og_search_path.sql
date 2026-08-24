-- Kjørt: 2026-08-24
-- Bakgrunn: `supabase db advisors` avdekket at PIN-innlogging (logg_inn_med_pin /
-- login_med_pin) er SECURITY DEFINER-funksjoner som kan kalles direkte via REST
-- API-et av HVEM SOM HELST uten innlogging (anon-rollen), helt uten noen
-- forsøksbegrensning. En 4-sifret PIN har bare 10 000 kombinasjoner, så uten
-- denne migreringen kunne noen skrevet et script som prøvde alle på under et
-- minutt. Denne migreringen legger til en delt forsøksteller per anonym
-- Auth-sesjon (auth.uid()): 5 feil PIN-forsøk på rad låser den sesjonen ute i
-- 10 minutter. Fikser i samme slengen to "search_path mutable"-varsler
-- (privilegie-eskaleringsrisiko på funksjoner uten fast search_path).

-- ────────────────────────────────────────────────────────────
-- 1) Forsøksteller-tabell (samme mønster som ansatte_pin: RLS på, ingen
--    policies - kun de SECURITY DEFINER-funksjonene under kan lese/skrive den).
-- ────────────────────────────────────────────────────────────
create table if not exists public.pin_forsok (
  auth_uid uuid primary key,
  antall_feil integer not null default 0,
  sist_forsok timestamptz not null default now(),
  blokkert_til timestamptz
);
alter table public.pin_forsok enable row level security;
revoke all on public.pin_forsok from anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 2) Interne hjelpefunksjoner - ikke ment å kalles direkte fra klienten.
-- ────────────────────────────────────────────────────────────
create or replace function public._pin_rate_limit_sjekk()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_blokkert timestamptz;
begin
  if v_uid is null then return; end if;
  select blokkert_til into v_blokkert from pin_forsok where auth_uid = v_uid;
  if v_blokkert is not null and v_blokkert > now() then
    raise exception 'FOR_MANGE_FORSOK';
  end if;
end;
$$;
revoke all on function public._pin_rate_limit_sjekk() from anon, authenticated;

create or replace function public._pin_rate_limit_registrer(v_suksess boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if v_suksess then
    delete from pin_forsok where auth_uid = v_uid;
  else
    insert into pin_forsok (auth_uid, antall_feil, sist_forsok, blokkert_til)
    values (v_uid, 1, now(), null)
    on conflict (auth_uid) do update
      set antall_feil   = pin_forsok.antall_feil + 1,
          sist_forsok   = now(),
          blokkert_til  = case when pin_forsok.antall_feil + 1 >= 5
                                then now() + interval '10 minutes'
                                else pin_forsok.blokkert_til end;
  end if;
end;
$$;
revoke all on function public._pin_rate_limit_registrer(boolean) from anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 3) logg_inn_med_pin - hovedinnlogging. Samme logikk som før, med
--    rate-limit-sjekk lagt til øverst og registrering av resultat.
--    (search_path var allerede satt riktig her fra før.)
-- ────────────────────────────────────────────────────────────
create or replace function public.logg_inn_med_pin(kandidat_pin text)
returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  treff ansatte%rowtype;
  ny_token text;
begin
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

  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 4) login_med_pin - brukt for godkjenner-PIN ved lukking av ordre.
--    Konvertert fra ren SQL til plpgsql for å kunne legge inn samme
--    rate-limit-logikk.
-- ────────────────────────────────────────────────────────────
create or replace function public.login_med_pin(kandidat_pin text)
returns table(id bigint, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, session_token text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  treff ansatte%rowtype;
begin
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
$$;

-- ────────────────────────────────────────────────────────────
-- 5) De to "search_path mutable"-varslene fra advisoren.
--    beskytt_utstyr_maler_fn er en trigger-funksjon (påvirker ikke RLS/
--    sikkerhet direkte, men fast search_path er beste praksis uansett).
-- ────────────────────────────────────────────────────────────
create or replace function public.beskytt_utstyr_maler_fn()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if jsonb_array_length(coalesce(old.utstyr_maler, '[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(new.utstyr_maler, '[]'::jsonb)) = 0 then
    new.utstyr_maler := old.utstyr_maler;
  end if;
  return new;
end;
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public'
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
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 6) opprett_ansatt sjekker allerede internt at kalleren er admin (trygt),
--    men trenger uansett ikke være kallbar av anon i utgangspunktet -
--    fjerner tilgangen som forsvarsverk i dybden (advisor-anbefaling).
-- ────────────────────────────────────────────────────────────
revoke execute on function public.opprett_ansatt(integer, text, text, text) from anon;
