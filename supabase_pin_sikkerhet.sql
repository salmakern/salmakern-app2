-- ============================================================
-- Salmaker'n – Skjul PIN-koder fra direkte REST/Realtime-tilgang
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================
-- I dag ligger PIN-kodene i ansatte-tabellen, som har
-- "using (true)" i RLS-policyen sin. Det betyr at hvem som helst
-- med appens offentlige nøkkel (som ligger åpent i sidekilden) kan
-- hente ut ALLE ansattes PIN-koder direkte fra REST-API-et, uten å
-- logge inn i appen i det hele tatt. Denne migreringen flytter
-- PIN-kodene til en egen tabell uten noen tilgang for anon/authenticated
-- i det hele tatt, og legger PIN-sjekken i databasen i stedet for i
-- nettleseren.

create table if not exists ansatte_pin (
  ansatt_id bigint primary key references ansatte(id) on delete cascade,
  pin       text not null
);
-- Ingen "unique" på pin her: det finnes minst én eksisterende duplikat-PIN i
-- dataene fra før (to rader for samme person), og migreringen skal ikke
-- feile på grunn av det. Duplikat-sjekk for NYE ansatte gjøres i stedet inne
-- i opprett_ansatt() under.
-- (Fjerner evt. unique-regel fra et tidligere forsøk, slik at scriptet er
-- trygt å kjøre på nytt uansett hva som skjedde forrige gang.)
alter table ansatte_pin drop constraint if exists ansatte_pin_pin_key;
alter table ansatte_pin enable row level security;
-- Ingen policies opprettes her med vilje - da har anon/authenticated
-- ingen tilgang overhodet, verken lesing eller skriving. Kun funksjonene
-- under (som kjører med eierens rettigheter via SECURITY DEFINER) kan
-- lese/skrive denne tabellen.

-- Flytt eksisterende PIN-koder over. Trygt å kjøre flere ganger.
insert into ansatte_pin (ansatt_id, pin)
select id, pin from ansatte where pin is not null
on conflict (ansatt_id) do update set pin = excluded.pin;

-- Innlogging: sjekker PIN i databasen og returnerer treffet uten
-- noensinne å sende PIN-koder til nettleseren.
create or replace function login_med_pin(kandidat_pin text)
returns table (id bigint, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, session_token text)
language sql
security definer
set search_path = public
as $$
  select a.id, a.navn, a.rolle, a.aktiv, a.kan_fore_lonn, a.session_token
  from ansatte a
  join ansatte_pin p on p.ansatt_id = a.id
  where p.pin = kandidat_pin and a.aktiv = true
  limit 1;
$$;
grant execute on function login_med_pin(text) to anon, authenticated;

-- Oppretter en ny ansatt + PIN-en dens i én transaksjon (ruller tilbake
-- begge deler hvis PIN-en allerede er i bruk av noen andre).
create or replace function opprett_ansatt(p_id bigint, p_navn text, p_rolle text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from ansatte_pin where pin = p_pin) then
    raise exception 'PIN_I_BRUK';
  end if;

  insert into ansatte (id, navn, rolle, aktiv, kan_fore_lonn)
  values (p_id, p_navn, p_rolle, true, true);

  insert into ansatte_pin (ansatt_id, pin) values (p_id, p_pin);
end;
$$;
grant execute on function opprett_ansatt(bigint, text, text, text) to anon, authenticated;

-- Selve pin-kolonnen fjernes fra ansatte-tabellen - den finnes nå kun i
-- ansatte_pin, som er utilgjengelig uten å gå via funksjonene over.
alter table ansatte drop column if exists pin;
