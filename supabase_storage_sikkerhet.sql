-- ============================================================
-- Salmaker'n – Lås ned bilder-lagringen (Storage)
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================
-- Testet i kveld: hvem som helst med den offentlige nøkkelen kunne
-- LISTE, LASTE OPP og SLETTE filer i "bilder"-bucketen uten å logge inn
-- i det hele tatt - inkludert å slette leveringsbilder/signaturer
-- permanent. Dette låser ned det, mens vanlig bildevisning i appen
-- (<img>-tagger via offentlig URL) fortsatt fungerer som før, siden en
-- offentlig bucket alltid tillater ren nedlasting av kjente URL-er
-- uavhengig av disse reglene - det er kun listing/opplasting/sletting
-- som styres av policyene under.

drop policy if exists "krever_innlogget_ansatt_liste" on storage.objects;
drop policy if exists "krever_innlogget_ansatt_opplasting" on storage.objects;
drop policy if exists "krever_innlogget_ansatt_endring" on storage.objects;
drop policy if exists "krever_innlogget_ansatt_sletting" on storage.objects;

create policy "krever_innlogget_ansatt_liste" on storage.objects
  for select
  using (bucket_id = 'bilder' and exists (select 1 from current_ansatt()));

create policy "krever_innlogget_ansatt_opplasting" on storage.objects
  for insert
  with check (bucket_id = 'bilder' and exists (select 1 from current_ansatt()));

create policy "krever_innlogget_ansatt_endring" on storage.objects
  for update
  using (bucket_id = 'bilder' and exists (select 1 from current_ansatt()))
  with check (bucket_id = 'bilder' and exists (select 1 from current_ansatt()));

create policy "krever_innlogget_ansatt_sletting" on storage.objects
  for delete
  using (bucket_id = 'bilder' and exists (select 1 from current_ansatt()));
