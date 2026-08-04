-- ============================================================
-- Salmaker'n – Ordentlig innlogging (erstatter "using(true)" på alt)
-- ============================================================
-- IKKE kjør denne uten å ha lest gjennom med Claude først. Denne filen
-- alene er IKKE nok - den krever i tillegg to innstillinger i Supabase-
-- dashbordet (se STEG 0 under) og oppdatert klientkode (js/core.js m.fl.,
-- ligger klart på git-grenen "auth-hardening-draft", IKKE på main ennå).
--
-- HVORFOR dette er større enn PIN-fiksen:
-- PIN-fiksen løste ett smalt problem (3 steder i koden). Å faktisk kreve
-- innlogging for å lese/skrive ordre, timelister, lager osv. betyr at
-- Supabase må vite HVEM som spør på en måte som virker BÅDE for vanlige
-- datakall OG for sanntidsoppdateringene (Realtime) som synker data live
-- mellom ansattes telefoner. Realtime sjekker ikke egendefinerte headere,
-- kun ekte innloggings-sesjoner (JWT). Derfor bruker denne løsningen ekte
-- Supabase Auth (anonym innlogging) i stedet for en enklere snarvei.
--
-- ============================================================
-- STEG 0 - MÅ gjøres i dashbordet FØR denne filen kjøres:
-- ============================================================
-- 1. Authentication → Sign In / Providers → skru PÅ "Allow anonymous sign-ins"
-- 2. Kjør HELE denne filen (oppretter funksjonen under)
-- 3. Authentication → Hooks → "Customize Access Token (JWT) Claims hook"
--    → velg funksjonen "custom_access_token_hook" fra dropdown-listen → Enable
-- ============================================================

-- Kobler en anonym Supabase Auth-sesjon til en ansatt-rad, basert på PIN.
-- Kalles fra klienten RETT ETTER supabase.auth.signInAnonymously().
-- auth.uid() her er avsenderens EGEN anonyme sesjon (kan ikke forfalskes),
-- så denne funksjonen kan bare "kreve" identiteten til seg selv, ikke andre.
create or replace function logg_inn_med_pin(kandidat_pin text)
returns table (id bigint, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  treff ansatte%rowtype;
  ny_token text;
begin
  select a.* into treff
  from ansatte a
  join ansatte_pin p on p.ansatt_id = a.id
  where p.pin = kandidat_pin and a.aktiv = true
  limit 1;

  if not found then
    return;
  end if;

  -- Ny session_token hver gang noen logger inn med denne PIN-en - gjør at
  -- en TIDLIGERE innlogget enhet (som fortsatt har en gyldig anonym
  -- Auth-sesjon) mister tilgangen neste gang den spør databasen, akkurat
  -- som i dag ("logget inn på en annen enhet").
  ny_token := gen_random_uuid()::text;
  update ansatte set session_token = ny_token where ansatte.id = treff.id;

  -- Knytt DENNE anonyme Auth-brukeren (avsenderen selv) til ansatt-raden.
  -- raw_app_meta_data kan IKKE endres av klienten selv (i motsetning til
  -- user_metadata), så dette er trygt mot forfalskning.
  update auth.users
  set raw_app_meta_data = raw_app_meta_data
    || jsonb_build_object('ansatt_id', treff.id, 'rolle', treff.rolle, 'session_token', ny_token)
  where auth.users.id = auth.uid();

  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn;
end;
$$;
grant execute on function logg_inn_med_pin(text) to anon, authenticated;

-- Custom Access Token Hook: kjøres av Supabase Auth hver gang en JWT
-- utstedes/fornyes for en bruker. Kopierer ansatt_id/rolle/session_token
-- fra raw_app_meta_data inn i selve JWT-en, slik at både vanlige datakall
-- OG Realtime kan lese dem via auth.jwt() uten noe eget headerskjema.
create or replace function custom_access_token_hook(event jsonb)
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
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;
grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Slår opp den innloggede ansatte "live" (ikke bare stol på JWT-claimet
-- for evig - sjekk at session_token fortsatt stemmer med ansatte-tabellen,
-- ellers ville en "kastet ut"-enhet fortsatt ha tilgang til JWT-en utløper).
create or replace function current_ansatt()
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
    and a.id = (auth.jwt()->>'ansatt_id')::bigint
    and a.session_token = (auth.jwt()->>'session_token');
$$;
grant execute on function current_ansatt() to anon, authenticated;

-- ============================================================
-- RLS-policyer - erstatter "using (true)" med krav om gyldig sesjon.
-- Bruker et DO-block som fjerner ALLE eksisterende policyer på hver
-- tabell dynamisk (uansett hva de heter i dag) før de nye opprettes.
-- ============================================================
do $$
declare
  pol record;
  tbl text;
begin
  foreach tbl in array array['ordrer','ansatte','flater','lagervarer','lagerhistorikk','lager_oppskrifter','innstillinger','push_abonnement']
  loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy %I on %I', pol.policyname, tbl);
    end loop;
    execute format(
      'create policy "krever_innlogget_ansatt" on %I for all using (exists (select 1 from current_ansatt())) with check (exists (select 1 from current_ansatt()))',
      tbl
    );
  end loop;

  -- timer_entries: egne regler per operasjon (kun admin redigerer/sletter,
  -- men alle innloggede kan registrere SINE EGNE timer - vanlig
  -- inn/ut-stempling må fortsatt virke for alle ansatte).
  for pol in select policyname from pg_policies where schemaname='public' and tablename='timer_entries' loop
    execute format('drop policy %I on timer_entries', pol.policyname);
  end loop;
end $$;

create policy "lese_timer" on timer_entries for select
  using (exists (select 1 from current_ansatt()));

create policy "sette_inn_egen_timer" on timer_entries for insert
  with check (
    exists (select 1 from current_ansatt() where id = timer_entries.ansatt_id)
    or exists (select 1 from current_ansatt() where rolle = 'admin')
  );

create policy "endre_timer_admin" on timer_entries for update
  using (exists (select 1 from current_ansatt() where rolle = 'admin'))
  with check (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "slette_timer_admin" on timer_entries for delete
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

-- ============================================================
-- Ekstra funn underveis: opprett_ansatt (fra PIN-sikkerhetsfiksen
-- tidligere i kveld) sjekket ikke HVEM som ringte den - hvem som helst
-- med den offentlige nøkkelen kunne opprette en falsk admin-konto
-- direkte, uten å logge inn først. Kunne ikke håndheves skikkelig før nå,
-- siden current_ansatt() ikke fantes ennå.
-- ============================================================
create or replace function opprett_ansatt(p_id bigint, p_navn text, p_rolle text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  if exists (select 1 from ansatte_pin where pin = p_pin) then
    raise exception 'PIN_I_BRUK';
  end if;

  insert into ansatte (id, navn, rolle, aktiv, kan_fore_lonn)
  values (p_id, p_navn, p_rolle, true, true);

  insert into ansatte_pin (ansatt_id, pin) values (p_id, p_pin);
end;
$$;
