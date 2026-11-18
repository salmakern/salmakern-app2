-- KIA EV9: «Dørbeskyttere» i «Skal på bilen» (Henrik 18.11.2026). Dørbeskyttere er en ombygging-oppskrift UTEN Fiken-produktnummer (bare deler, ingen
-- fakturalinje), så raden på lista har oppskriftens id som nøkkel i stedet for et produktnummer. Rettelsene («Fjern fra bilen», «Legg tilbake», «+ Legg
-- til utstyr») lagres i samme logg (ordrer.produkt_rettelser) via legg_til_ordre_produkt_rettelse, som til nå bare godtok et produktnummer
-- (^[1-9][0-9]{0,9}$) i feltet «produktnummer». Eneste endring her: regelen for det feltet godtar også en oppskrifts-id (oppskrift_<10-16 siffer>,
-- slik appen lager dem: oppskrift_<ms>). Alt annet i funksjonen er byte-likt 20261118100000_skal_paa_bilen.sql (samme navn, samme signatur, samme
-- rettigheter), og ingen data røres.
--
-- UTRULLINGSREKKEFØLGE: denne migrasjonen FØR klientkoden (js/skal-paa-bilen.js). Kommer klienten først, avviser databasen en rettelse på dørbeskyttere
-- med UGYLDIG_INPUT (toast «Kunne ikke lagre rettelsen»); rettelser på vanlige produkter og 180-spørsmålet (produktnummer 502) virker uansett. Ny database +
-- gammel klient er ufarlig (den gamle klienten sender aldri en oppskrifts-id).
--
-- Rollback (gjenoppretter regelen fra 20261118100000; en rettelse på en oppskrifts-id som alt ligger i loggen blir stående og ignoreres av gammel klient):
--   kjør blokken «create or replace function public.legg_til_ordre_produkt_rettelse» fra supabase/migrations/20261118100000_skal_paa_bilen.sql på nytt
--   (regelen der er: coalesce(p_rettelse->>'produktnummer', '') !~ '^[1-9][0-9]{0,9}$').

create or replace function public.legg_til_ordre_produkt_rettelse(p_ordre_id text, p_rettelse jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn text; v_liste jsonb; v_ny jsonb;
begin
  if not exists (select 1 from current_ansatt()) then raise exception 'IKKE_INNLOGGET'; end if;
  select coalesce(a.navn, '') into v_navn from ansatte a join current_ansatt() c on c.id = a.id limit 1;
  if p_rettelse is null or jsonb_typeof(p_rettelse) <> 'object'
     or coalesce(p_rettelse->>'handling', '') not in ('fjern', 'legg_til', 'angre')
     -- produktnummer = Fiken-nummeret, eller id-en til en oppskrift uten produktnummer (rad med bare deler, f.eks. dørbeskyttere)
     or coalesce(p_rettelse->>'produktnummer', '') !~ '^([1-9][0-9]{0,9}|oppskrift_[0-9]{10,16})$'
     or length(coalesce(p_rettelse->>'portalId', '')) > 64
     or length(coalesce(p_rettelse->>'navn', '')) > 200 then
    raise exception 'UGYLDIG_INPUT';
  end if;
  select coalesce(produkt_rettelser, '[]'::jsonb) into v_liste from ordrer where id = p_ordre_id for update;
  if not found then raise exception 'ORDRE_FINNES_IKKE'; end if;
  if jsonb_array_length(v_liste) >= 300 then raise exception 'FOR_MANGE_RETTELSER'; end if;
  v_ny := jsonb_strip_nulls(jsonb_build_object(
    'handling', p_rettelse->>'handling', 'produktnummer', p_rettelse->>'produktnummer',
    'portalId', nullif(p_rettelse->>'portalId', ''), 'navn', nullif(p_rettelse->>'navn', ''),
    'av', coalesce(v_navn, ''), 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  update ordrer set produkt_rettelser = v_liste || jsonb_build_array(v_ny) where id = p_ordre_id;
  return v_liste || jsonb_build_array(v_ny);
end;
$$;
revoke all on function public.legg_til_ordre_produkt_rettelse(text, jsonb) from public, anon;
grant execute on function public.legg_til_ordre_produkt_rettelse(text, jsonb) to authenticated, service_role;
