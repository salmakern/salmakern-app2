-- s09-012 steg 2 (2026-10-31, Henrik: "ta i bruk modellnøkkelen i matchingen nå, ikke bare lagre
-- den"): kartlagt i workflow-run wf_b96d2178-0b8 (se Henger igjen-lista). I dag matcher
-- Fiken-ombygging (finnFikenOmbyggingModell i js/ordre-detalj.js) og Vegvesen-dokumentene på
-- ordrens FRITEKST merke/modell - en skrivefeil, eller en ansatt som retter teksten i etterkant,
-- kan stille gi feil (eller manglende) fakturalinje. portal_modell_kobling (14 rader, godkjent av
-- Henrik 2026-10-30) er allerede en stabil, kuratert nøkkel (slug -> merke/modell) for ordre som
-- kommer fra en portal-bestilling - portal_koble_bestilling slår den opp (v_merke/v_modell,
-- linje ~236), men kastet den bort igjen i stedet for å lagre den på selve ordren.
--
-- Steg 1 (lagre): ny, valgfri kolonne ordrer.portal_modell_slug, satt av portal_koble_bestilling
-- (egen endring i samme migrasjon som opprettet funksjonen, se ...210000-filen). FK mot
-- portal_modell_kobling: portal_koble_bestilling validerer allerede at sluggen finnes FØR den
-- oppretter ordren (venter_modell ellers), så en FK her kan aldri slå feil for den banen.
-- Lest av dbToOrdre, ALDRI skrevet av ordreToDb/save() - samme mønster som portal_bekreftet_*
-- (håndhevet av test/portal-ordre-visning.test.js, utvidet til å dekke denne kolonnen også).
--
-- Steg 2 (bruk): js/ordre-detalj.js sin finnFikenOmbyggingModell kalles nå med den KANONISKE
-- merke/modell-teksten fra portal_modell_kobling når en slug finnes (kanoniskMerkeModell()),
-- med fallback til ordrens egen fritekst for alle ordre UTEN slug (uendret oppførsel - manuelt
-- opprettede ordre og alle historiske ordre). Et synlig varsel vises i ombyggingBoksHTML() hvis
-- fritekst-feltene avviker fra portalens opprinnelige modell (noen har rettet Merke/Modell i
-- etterkant) - varsler, blokkerer ingenting.
--
-- Klienten trenger derfor portal_modell_kobling-tabellen i nettleseren, men tabellen har i dag
-- "kun_admin_leser" (SELECT bare for admin) - ikke bredere enn det, siden vi ikke vet HVORFOR den
-- ble satt slik uten å spørre den økta som satte den. Løsning: en smal, egen lese-RPC for ALLE
-- innloggede ansatte (samme navn/mønster som andre narrow read-RPC-er i appen) i stedet for å
-- løsne selve tabell-policyen.
--
-- Rollback: alter table public.ordrer drop column portal_modell_slug; drop function
-- public.hent_portal_modell_kobling();
-- Test: supabase/tester/portal_modell_slug_matching_TEST_body.sql (rulles alltid tilbake).

alter table public.ordrer
  add column portal_modell_slug text references public.portal_modell_kobling(portal_modell_slug);

create or replace function public.hent_portal_modell_kobling()
returns table(portal_modell_slug text, merke text, modell text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  return query select pmk.portal_modell_slug, pmk.merke, pmk.modell from public.portal_modell_kobling pmk;
end;
$$;

revoke all on function public.hent_portal_modell_kobling() from public;
grant execute on function public.hent_portal_modell_kobling() to anon, authenticated;
