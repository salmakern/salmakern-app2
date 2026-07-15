-- ============================================================
-- Salmaker'n – Flåtegodkjenning
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

create table if not exists flater (
  id           text primary key,
  flatenummer  text not null default '',
  kunde        text default '',
  status       text not null default 'aktiv',
  created_at   timestamptz default now()
);

alter table ordrer add column if not exists flate_id text default null;
alter table flater add column if not exists primaer_ordre_id text default null;

alter publication supabase_realtime add table flater;

alter table flater enable row level security;
create policy "Alle kan lese flater" on flater for all using (true) with check (true);
