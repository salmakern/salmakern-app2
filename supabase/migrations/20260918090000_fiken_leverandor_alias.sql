-- ============================================================
-- Fiken-integrasjon: kobling mellom leverandørnavn slik det står på et bilag
-- i Fiken sin regnskapsinnboks og riktig leverandørkontakt i Fiken. Samme
-- mønster som fiken_kunde_alias (20260912150000) - Fiken sitt kontaktsøk er
-- eksakt match, ikke fuzzy, så et ukjent leverandørnavn bekreftes manuelt av
-- en admin første gang og huskes her permanent.
-- ============================================================

create table if not exists fiken_leverandor_alias (
  id bigint generated always as identity primary key,
  alias text not null unique,
  fiken_contact_id bigint not null,
  fiken_navn text not null,
  bekreftet_av text,
  created_at timestamptz not null default now()
);

alter table fiken_leverandor_alias enable row level security;

create policy "lese_fiken_leverandor_alias" on fiken_leverandor_alias for select
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "skrive_fiken_leverandor_alias" on fiken_leverandor_alias for insert
  with check (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "oppdatere_fiken_leverandor_alias" on fiken_leverandor_alias for update
  using (exists (select 1 from current_ansatt() where rolle = 'admin'))
  with check (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "slette_fiken_leverandor_alias" on fiken_leverandor_alias for delete
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));
