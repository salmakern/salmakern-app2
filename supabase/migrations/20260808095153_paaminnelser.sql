-- ============================================================
-- Salmaker'n – Påminnelser: Time på biltilsynet (30 min før) og møter
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

-- Sporer om 30-minutters-varselet allerede er sendt for GJELDENDE
-- tid_biltilsynet/tid_biltilsynet_tid - nullstilles av klienten når tiden endres,
-- slik at en flyttet time gir et nytt, friskt varsel.
alter table ordrer add column if not exists biltilsyn_varslet boolean not null default false;

-- Møter satt under "Sett møter" på Mer-siden - vises i kalenderen og gir
-- et varsel kl. 18:00 kvelden før.
create table if not exists moter (
  id text primary key,
  tittel text not null,
  dato date not null,
  tid text not null,
  opprettet_av text not null default '',
  varslet boolean not null default false,
  created_at timestamptz not null default now()
);
alter table moter enable row level security;
drop policy if exists "moter_alle_ansatte" on moter;
create policy "moter_alle_ansatte" on moter
  for all
  using (exists (select 1 from current_ansatt()))
  with check (exists (select 1 from current_ansatt()));
