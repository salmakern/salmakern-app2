-- ============================================================
-- Salmaker'n – Varelager
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

create table if not exists lagervarer (
  id          text primary key,
  navn        text not null default '',
  kategori    text default '',
  leverandor  text default '',
  antall      numeric not null default 0,
  enhet       text not null default 'stk',
  min_antall  numeric not null default 0,
  notat       text default '',
  created_at  timestamptz default now()
);

create table if not exists lagerhistorikk (
  id           text primary key,
  vare_id      text not null,
  vare_navn    text default '',
  endring      numeric not null default 0,
  type         text not null default 'justering',
  ordre_id     text default null,
  batch_id     text default null,
  ansatt_navn  text default '',
  kommentar    text default '',
  created_at   timestamptz default now()
);

-- Oppskrifter: hvilke varer + antall som går med til å bygge om en gitt modell.
-- Når en ordre får satt en modell (f.eks. "KIA EV9") kan du trekke fra lageret
-- basert på oppskriften for den modellen.
create table if not exists lager_oppskrifter (
  id          text primary key,
  navn        text not null default '',
  biltype     text default '',
  variant     text default '',
  ingredienser jsonb not null default '[]'::jsonb,
  created_at  timestamptz default now()
);

alter publication supabase_realtime add table lagervarer;
alter publication supabase_realtime add table lagerhistorikk;
alter publication supabase_realtime add table lager_oppskrifter;

alter table lagervarer enable row level security;
create policy "Alle kan lese og endre lagervarer" on lagervarer for all using (true) with check (true);

alter table lagerhistorikk enable row level security;
create policy "Alle kan lese og endre lagerhistorikk" on lagerhistorikk for all using (true) with check (true);

alter table lager_oppskrifter enable row level security;
create policy "Alle kan lese og endre lager_oppskrifter" on lager_oppskrifter for all using (true) with check (true);
