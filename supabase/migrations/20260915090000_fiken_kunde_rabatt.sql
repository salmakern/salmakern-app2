-- Avtalt rabatt per kunde, delt i ombygging-linjer og ekstra utstyr-linjer (bekreftet av
-- Henrik: rabatt er en kundespesifikk avtale, ikke en fast regel basert på produkttype).
-- Koblet til Fiken sin contactId, ikke Salmakern-appens kortnavn - avtalen ligger på selve
-- kundeforholdet i Fiken, uavhengig av hvilket kortnavn som brukes internt.
--
-- Forhåndsutfylt KUN der historikken (595 fakturaer, fiken_kunde_rabatt_kilde-analysen) var
-- konsekvent (>=90% samme sats) - bevisst valg, se samtalen: en usikker "beste gjetning" ser
-- plausibel ut og kan glippe gjennom en rask godkjenning, mens et tydelig 0%/tomt felt tvinger
-- fram en bevisst sjekk. NULL = ingen sikker historikk, koden skal bruke 0% til Henrik setter
-- en verdi selv.
create table if not exists fiken_kunde_rabatt (
  id bigint generated always as identity primary key,
  fiken_contact_id bigint not null unique,
  fiken_navn text not null,
  rabatt_ombygging numeric,
  rabatt_ekstra_utstyr numeric,
  kilde text not null default 'historikk_konsekvent',
  notat text,
  oppdatert_av text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fiken_kunde_rabatt enable row level security;

create policy "lese_fiken_kunde_rabatt" on fiken_kunde_rabatt for select
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "skrive_fiken_kunde_rabatt" on fiken_kunde_rabatt for insert
  with check (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "oppdatere_fiken_kunde_rabatt" on fiken_kunde_rabatt for update
  using (exists (select 1 from current_ansatt() where rolle = 'admin'))
  with check (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "slette_fiken_kunde_rabatt" on fiken_kunde_rabatt for delete
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));
