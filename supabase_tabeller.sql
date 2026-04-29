-- ============================================================
-- Salmaker'n – Opprett alle tabeller i Supabase
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

-- 1. ANSATTE
create table if not exists ansatte (
  id          integer primary key,
  navn        text not null default '',
  pin         text not null default '',
  rolle       text not null default 'ansatt',
  aktiv       boolean not null default true
);

-- 2. ORDRER
create table if not exists ordrer (
  id                    text primary key,
  regnr                 text default '',
  kunde                 text default '',
  eier                  text default '',
  merke                 text default '',
  type                  text default '',
  modell                text default '',
  variant               text default '',
  versjon               text default '',
  chassis               text default '',
  ankomstdato           text default null,
  status                text default 'aktiv',
  ordre_status          text default 'ikke_paabegynt',
  kalender_dato         text default null,
  kalender_tid          text default '',
  vekter                jsonb default '{}',
  drivstoff             jsonb default '{}',
  utstyr                jsonb default '{}',
  bilder_ankomst        jsonb default '[]',
  bilder_levering       jsonb default '[]',
  ansatte_signert       jsonb default '[]',
  signatur              text default null,
  godkjent              boolean default false,
  godkjenner_navn       text default '',
  fakturert             boolean default false,
  fakturert_av          text default '',
  ordre_start           text default null,
  ordre_stopp           text default null,
  notater               text default '',
  endringer             jsonb default '[]',
  utstyr_sjekkliste     jsonb default '[]',
  utstyr_mal_navn       text default '',
  visnings_sjekkliste   jsonb default '[]',
  visnings_mal_navn     text default '',
  updated_at            timestamptz default now(),
  created_at            timestamptz default now()
);

-- 3. TIMER-REGISTRERINGER
create table if not exists timer_entries (
  id          text primary key,
  ansatt_id   integer not null,
  ansatt      text not null default '',
  dato        text not null default '',
  type        text not null default 'arbeid',
  start       text default '',
  stopp       text default '',
  mins        integer default 0,
  created_at  timestamptz default now()
);

-- 4. INNSTILLINGER (alltid én rad med id=1)
create table if not exists innstillinger (
  id          integer primary key default 1,
  dagens_pin  text default '1234',
  gps_lat     double precision default null,
  gps_lng     double precision default null,
  gps_radius  integer default 300
);

-- Sett inn standard innstillingsrad hvis den ikke finnes
insert into innstillinger (id, dagens_pin)
values (1, '1234')
on conflict (id) do nothing;

-- ============================================================
-- Aktiver Realtime for alle tabeller
-- ============================================================
alter publication supabase_realtime add table ansatte;
alter publication supabase_realtime add table ordrer;
alter publication supabase_realtime add table timer_entries;

-- ============================================================
-- Row Level Security (RLS) – åpent for anon-nøkkel
-- (Alle med appen kan lese/skrive – PINkode er sikkerhet)
-- ============================================================
alter table ansatte        enable row level security;
alter table ordrer         enable row level security;
alter table timer_entries  enable row level security;
alter table innstillinger  enable row level security;

create policy "Alle kan lese ansatte"        on ansatte        for all using (true) with check (true);
create policy "Alle kan lese ordrer"         on ordrer         for all using (true) with check (true);
create policy "Alle kan lese timer_entries"  on timer_entries  for all using (true) with check (true);
create policy "Alle kan lese innstillinger"  on innstillinger  for all using (true) with check (true);

-- ============================================================
-- Hvis tabellene allerede finnes: legg til nye kolonner
-- (Trygt å kjøre selv om tabellen er ny – feiler ikke)
-- ============================================================
alter table ordrer add column if not exists merke  text default '';
alter table ordrer add column if not exists modell text default '';
