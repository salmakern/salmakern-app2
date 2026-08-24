-- ============================================================
-- Salmaker'n – Admin-ark (excel-lignende oversikt, admin-only)
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

-- Egen tabell for feltene som KUN skal ligge i Admin-arket, ikke på selve ordren.
-- Radene er koblet til en ordre via chassis_nr, gruppert per år (arkivering).
create table if not exists admin_ark (
  id text primary key,
  chassis_nr text not null,
  aar integer not null,
  rekkefolge integer not null default 0,
  serienummer text not null default '',
  papirer text not null default '',
  dokumenter text not null default '',
  fraktselskap text not null default '',
  merknader text not null default '',
  time_bekreftet date,
  ventende_timer text not null default '',
  arkivert boolean not null default false,
  created_at timestamptz not null default now()
);

-- Nytt felt på selve ordren - fylles automatisk fra admin_ark.time_bekreftet
-- når den datoen settes/endres for raden med samme chassis.nr.
alter table ordrer add column if not exists tid_biltilsynet date;

alter table admin_ark enable row level security;

drop policy if exists "admin_ark_admin_only" on admin_ark;
create policy "admin_ark_admin_only" on admin_ark
  for all
  using (exists (select 1 from current_ansatt() where rolle = 'admin'))
  with check (exists (select 1 from current_ansatt() where rolle = 'admin'));
