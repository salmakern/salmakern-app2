-- ============================================================
-- Salmaker'n – enkel chat mellom admin og godkjennere
-- Ett delt tråd, ikke separate en-til-en-samtaler: alle med rolle
-- admin/godkjenner ser og kan skrive i samme kanal.
-- ============================================================

create table if not exists godkjenner_meldinger (
  id bigint generated always as identity primary key,
  avsender_id integer not null references ansatte(id),
  avsender_navn text not null,
  tekst text not null,
  created_at timestamptz not null default now()
);

alter table godkjenner_meldinger enable row level security;

create policy "lese_godkjenner_meldinger" on godkjenner_meldinger for select
  using (exists (select 1 from current_ansatt() where rolle in ('admin','godkjenner')));

-- Kan bare sende som seg selv (avsender_id må matche innlogget ansatt),
-- og bare hvis man faktisk har admin/godkjenner-rollen.
create policy "sende_godkjenner_melding" on godkjenner_meldinger for insert
  with check (
    exists (select 1 from current_ansatt() where rolle in ('admin','godkjenner') and id = godkjenner_meldinger.avsender_id)
  );

alter publication supabase_realtime add table godkjenner_meldinger;
