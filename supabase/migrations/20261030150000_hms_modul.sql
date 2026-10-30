-- ============================================================
-- Salmaker'n – HMS-modul (internkontrollforskriften §5, stoffkartotek,
-- risikovurdering, avvik, vernerunder, HMS-håndbok).
--
-- Erstatter den gamle, enkle "HMS-logg"-funksjonen som lå som et jsonb-felt
-- (innstillinger.hms, se hms_upsert() fra migrasjon 20261022170000) - den
-- var tom (0 saker, sjekket 2026-10-30) ved overgangen, så ingen
-- datamigrering var nødvendig. Selve kolonnen/funksjonen i databasen røres
-- ikke her (harmløs og ubrukt), men klientkoden slutter å bruke den.
--
-- Ingen av disse tabellene er lagt i supabase_realtime-publikasjonen med
-- vilje - se den dokumenterte realtime/egress-hendelsen 2026-10
-- (reconnect-loop ga ~54GB/døgn). HMS-data er ikke tidskritisk nok til å
-- rettferdiggjøre enda flere sanntidsabonnement; sidene henter ferske data
-- når HMS-fanen åpnes/etter lagring i stedet.
-- ============================================================

-- ---------- Avvik ----------
create table if not exists hms_avvik (
  id bigint generated always as identity primary key,
  meldt_av integer not null references ansatte(id),
  meldt_av_navn text not null,
  tittel text not null,
  beskrivelse text not null,
  kategori text not null default 'Annet',
  sted text,
  bilder jsonb not null default '[]'::jsonb,
  status text not null default 'meldt',
  tiltak text,
  lukket_av integer references ansatte(id),
  lukket_av_navn text,
  lukket_at timestamptz,
  created_at timestamptz not null default now()
);

alter table hms_avvik enable row level security;

create policy "hms_avvik_lese" on hms_avvik for select
  using (exists (select 1 from current_ansatt()));

create policy "hms_avvik_melde" on hms_avvik for insert
  with check (exists (select 1 from current_ansatt() where id = hms_avvik.meldt_av));

create policy "hms_avvik_oppdatere" on hms_avvik for update
  using (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

create policy "hms_avvik_slette" on hms_avvik for delete
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

-- ---------- Risikovurderinger ----------
create table if not exists hms_risikovurdering (
  id bigint generated always as identity primary key,
  aktivitet text not null,
  fare text not null,
  sannsynlighet smallint not null check (sannsynlighet between 1 and 5),
  konsekvens smallint not null check (konsekvens between 1 and 5),
  tiltak text,
  ansvarlig_id integer references ansatte(id),
  ansvarlig_navn text,
  neste_gjennomgang date,
  laget_av integer not null references ansatte(id),
  laget_av_navn text not null,
  oppdatert_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table hms_risikovurdering enable row level security;

create policy "hms_risiko_lese" on hms_risikovurdering for select
  using (exists (select 1 from current_ansatt()));

create policy "hms_risiko_skrive" on hms_risikovurdering for insert
  with check (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

create policy "hms_risiko_oppdatere" on hms_risikovurdering for update
  using (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

create policy "hms_risiko_slette" on hms_risikovurdering for delete
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

-- ---------- Stoffkartotek ----------
create table if not exists hms_stoffkartotek (
  id bigint generated always as identity primary key,
  produktnavn text not null,
  leverandor text,
  bruksomrade text,
  verneutstyr text,
  oppbevaring text,
  sikkerhetsdatablad jsonb not null default '[]'::jsonb,
  aktiv boolean not null default true,
  lagt_til_av integer not null references ansatte(id),
  lagt_til_av_navn text not null,
  created_at timestamptz not null default now()
);

alter table hms_stoffkartotek enable row level security;

create policy "hms_stoff_lese" on hms_stoffkartotek for select
  using (exists (select 1 from current_ansatt()));

create policy "hms_stoff_skrive" on hms_stoffkartotek for insert
  with check (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

create policy "hms_stoff_oppdatere" on hms_stoffkartotek for update
  using (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

create policy "hms_stoff_slette" on hms_stoffkartotek for delete
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

-- ---------- Vernerunde-mal (ett-rads sjekkpunktliste, admin/verneombud redigerer) ----------
create table if not exists hms_vernerunde_mal (
  id integer primary key default 1,
  sjekkpunkter jsonb not null default '[]'::jsonb,
  oppdatert_av integer references ansatte(id),
  oppdatert_av_navn text,
  oppdatert_at timestamptz not null default now(),
  constraint hms_vernerunde_mal_enkelt_rad check (id = 1)
);

insert into hms_vernerunde_mal (id, sjekkpunkter) values (1, '[
  "Rømningsveier og nødutganger er frie for hindringer",
  "Brannslukningsutstyr er tilgjengelig og ikke utløpt",
  "Førstehjelpsskrin er fylt opp",
  "Verneutstyr (hansker, briller, hørselsvern) er tilgjengelig og i god stand",
  "Kjemikalier er forsvarlig oppbevart og merket",
  "Maskiner/utstyr har fungerende sikkerhetsinnretninger",
  "Elektrisk utstyr/ledninger er uten synlig skade",
  "Orden og ryddighet på arbeidsplassen",
  "Ventilasjon fungerer der det brukes lim/løsemidler"
]'::jsonb)
on conflict (id) do nothing;

alter table hms_vernerunde_mal enable row level security;

create policy "hms_vernerunde_mal_lese" on hms_vernerunde_mal for select
  using (exists (select 1 from current_ansatt()));

create policy "hms_vernerunde_mal_oppdatere" on hms_vernerunde_mal for update
  using (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

-- ---------- Vernerunde-gjennomføringer ----------
create table if not exists hms_vernerunde_gjennomforing (
  id bigint generated always as identity primary key,
  dato date not null default current_date,
  utfort_av integer not null references ansatte(id),
  utfort_av_navn text not null,
  resultat jsonb not null default '[]'::jsonb,
  notat text,
  created_at timestamptz not null default now()
);

alter table hms_vernerunde_gjennomforing enable row level security;

create policy "hms_vernerunde_lese" on hms_vernerunde_gjennomforing for select
  using (exists (select 1 from current_ansatt()));

create policy "hms_vernerunde_registrere" on hms_vernerunde_gjennomforing for insert
  with check (exists (select 1 from current_ansatt() where id = hms_vernerunde_gjennomforing.utfort_av));

create policy "hms_vernerunde_oppdatere" on hms_vernerunde_gjennomforing for update
  using (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

create policy "hms_vernerunde_slette" on hms_vernerunde_gjennomforing for delete
  using (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

-- ---------- HMS-håndbok (ett-rads tabell, som innstillinger) ----------
create table if not exists hms_handbok (
  id integer primary key default 1,
  mal text not null default '',
  ansvarsfordeling text not null default '',
  arlige_gjennomganger jsonb not null default '[]'::jsonb,
  oppdatert_av integer references ansatte(id),
  oppdatert_av_navn text,
  oppdatert_at timestamptz not null default now(),
  constraint hms_handbok_enkelt_rad check (id = 1)
);

insert into hms_handbok (id) values (1) on conflict (id) do nothing;

alter table hms_handbok enable row level security;

create policy "hms_handbok_lese" on hms_handbok for select
  using (exists (select 1 from current_ansatt()));

create policy "hms_handbok_oppdatere" on hms_handbok for update
  using (exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));

-- ---------- Storage: avviksbilder + sikkerhetsdatablad ----------
insert into storage.buckets (id, name, public)
values ('hms-vedlegg', 'hms-vedlegg', true)
on conflict (id) do nothing;

drop policy if exists "hms_vedlegg_lese" on storage.objects;
drop policy if exists "hms_vedlegg_opplasting" on storage.objects;
drop policy if exists "hms_vedlegg_sletting" on storage.objects;

create policy "hms_vedlegg_lese" on storage.objects
  for select
  using (bucket_id = 'hms-vedlegg' and exists (select 1 from current_ansatt()));

-- Alle innloggede kan laste opp (en ansatt skal kunne legge ved bilde når de melder et avvik selv)
create policy "hms_vedlegg_opplasting" on storage.objects
  for insert
  with check (bucket_id = 'hms-vedlegg' and exists (select 1 from current_ansatt()));

create policy "hms_vedlegg_sletting" on storage.objects
  for delete
  using (bucket_id = 'hms-vedlegg' and exists (select 1 from current_ansatt() where rolle in ('admin','verneombud')));
