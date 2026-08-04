-- ============================================================
-- Salmaker'n – PDF-vedlegg på ordre
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================

-- Ny kolonne på ordrer: liste over opplastede PDF-er
alter table ordrer add column if not exists dokumenter jsonb not null default '[]'::jsonb;

-- Ny, egen bucket for PDF-vedlegg (atskilt fra bilder-bucketen siden
-- tilgangsreglene er strengere her - kun admin/godkjenner kan endre).
insert into storage.buckets (id, name, public)
values ('ordre-dokumenter', 'ordre-dokumenter', true)
on conflict (id) do nothing;

drop policy if exists "dokumenter_lese" on storage.objects;
drop policy if exists "dokumenter_opplasting" on storage.objects;
drop policy if exists "dokumenter_sletting" on storage.objects;

-- Alle innloggede ansatte kan se/åpne dokumenter (samme som at alle kan se ordre)
create policy "dokumenter_lese" on storage.objects
  for select
  using (bucket_id = 'ordre-dokumenter' and exists (select 1 from current_ansatt()));

-- Kun admin/godkjenner kan laste opp
create policy "dokumenter_opplasting" on storage.objects
  for insert
  with check (bucket_id = 'ordre-dokumenter' and exists (select 1 from current_ansatt() where rolle in ('admin','godkjenner')));

-- Kun admin/godkjenner kan slette
create policy "dokumenter_sletting" on storage.objects
  for delete
  using (bucket_id = 'ordre-dokumenter' and exists (select 1 from current_ansatt() where rolle in ('admin','godkjenner')));
