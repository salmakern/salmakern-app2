-- ============================================================
-- Fiken-integrasjon: kobling mellom kundenavn slik det brukes i Salmakern-
-- appen (kortnavn/kallenavn, f.eks. "BOS Drammen") og riktig kontakt i
-- Fiken (f.eks. "Bertel O. Steen Drammen"). Appen har ingen organisasjons-
-- nummer å matche på, bare fritekst - derfor bekreftes koblingen manuelt av
-- en admin FØRSTE gang en ukjent kundetekst dukker opp ved fakturering,
-- og huskes her permanent slik at senere ordre for samme kunde løses
-- automatisk uten å spørre på nytt.
-- ============================================================

create table if not exists fiken_kunde_alias (
  id bigint generated always as identity primary key,
  alias text not null unique,
  fiken_contact_id bigint not null,
  fiken_navn text not null,
  bekreftet_av text,
  created_at timestamptz not null default now()
);

alter table fiken_kunde_alias enable row level security;

create policy "lese_fiken_kunde_alias" on fiken_kunde_alias for select
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "skrive_fiken_kunde_alias" on fiken_kunde_alias for insert
  with check (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "oppdatere_fiken_kunde_alias" on fiken_kunde_alias for update
  using (exists (select 1 from current_ansatt() where rolle = 'admin'))
  with check (exists (select 1 from current_ansatt() where rolle = 'admin'));

create policy "slette_fiken_kunde_alias" on fiken_kunde_alias for delete
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));
