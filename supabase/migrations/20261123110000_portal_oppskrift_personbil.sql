-- Utvider portal_oppskrift_lagre til å godta prisgruppen PERSONBIL (Forhandlerportalens nye priskategori "Personbil",
-- 2026-11-23, gren henger/personbil-priskategori i forhandlerportal-app - IKKE merget/utlagt der ennå).
--
-- Bakgrunn: uten denne endringen avviser funksjonen (og edge-funksjonen portal-oppskrift sin egen validering,
-- logikk.ts PRISGRUPPER) ethvert forsøk på å lagre deler/oppskrift for en variant med priceGroup "PERSONBIL" med
-- UGYLDIG_INPUT:prisgruppe - portalsiden ville vist en misvisende "Lageret i appen svarer ikke akkurat nå"-melding i
-- stedet for den egentlige årsaken. PERSONBIL er en HEL ombygging (som Standard ombygging), men får samme behandling
-- som Ekstrautstyr/Modul-system her (type = 'ekstra_utstyr'): en egen "ombygging"-kategorisering for Personbil er
-- bevisst utenfor scope (portalsidens egen kommentar i src/lib/appOppskrift.ts sier det samme).
--
-- Eneste endring mot 20261117200000: v_gruppe-sjekken har fått 'PERSONBIL' i listen. Resten av funksjonen er
-- byte-lik. Rollback: kjør 20261117200000-filens create-or-replace på nytt (fjerner PERSONBIL fra listen igjen).

create or replace function public.portal_oppskrift_lagre(p jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  v_variant text; v_tillegg text; v_nr text; v_navn text; v_gruppe text; v_slug text; v_modell text;
  v_deler jsonb := '[]'::jsonb; v_del jsonb; v_antall numeric; v_vare text; v_sett text[] := '{}';
  v_type text; v_biltype text; v_fra_kobling boolean := false;
  r public.lager_oppskrifter%rowtype; v_treff int; v_id text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'UGYLDIG_INPUT:body'; end if;

  v_variant := nullif(btrim(coalesce(p->>'variantId', '')), '');
  v_tillegg := nullif(btrim(coalesce(p->>'tilleggId', '')), '');
  if (v_variant is null) = (v_tillegg is null) then raise exception 'UGYLDIG_INPUT:id'; end if;
  if length(coalesce(v_variant, v_tillegg)) > 64 then raise exception 'UGYLDIG_INPUT:id'; end if;

  v_nr := btrim(coalesce(p->>'produktnummer', ''));
  if v_nr = '' or length(v_nr) > 20 or v_nr ~ '[[:space:],;]' then raise exception 'UGYLDIG_INPUT:produktnummer'; end if;
  v_navn := btrim(coalesce(p->>'navn', ''));
  if v_navn = '' or length(v_navn) > 200 then raise exception 'UGYLDIG_INPUT:navn'; end if;
  v_gruppe := coalesce(p->>'prisgruppe', '');
  if v_gruppe not in ('STANDARD', 'EKSTRAUTSTYR', 'MODUL_SYSTEM', 'PERSONBIL') then raise exception 'UGYLDIG_INPUT:prisgruppe'; end if;
  v_slug := nullif(btrim(coalesce(p->>'modellSlug', '')), '');
  v_modell := btrim(coalesce(p->>'modellNavn', ''));
  if v_modell = '' or length(v_modell) > 200 then raise exception 'UGYLDIG_INPUT:modellNavn'; end if;

  if jsonb_typeof(p->'deler') is distinct from 'array' then raise exception 'UGYLDIG_INPUT:deler'; end if;
  if jsonb_array_length(p->'deler') > 100 then raise exception 'UGYLDIG_INPUT:deler'; end if;
  for v_del in select * from jsonb_array_elements(p->'deler') loop
    if jsonb_typeof(v_del) is distinct from 'object' or jsonb_typeof(v_del->'vareId') is distinct from 'string'
       or jsonb_typeof(v_del->'antall') is distinct from 'number' then
      raise exception 'UGYLDIG_INPUT:deler';
    end if;
    v_vare := btrim(v_del->>'vareId');
    v_antall := (v_del->>'antall')::numeric;
    if v_vare = '' or length(v_vare) > 64 or v_antall <= 0 or v_antall > 10000 or v_antall <> round(v_antall, 3) or v_vare = any (v_sett) then
      raise exception 'UGYLDIG_INPUT:deler';
    end if;
    v_sett := v_sett || v_vare;
    v_deler := v_deler || jsonb_build_array(jsonb_build_object('vareId', v_vare, 'antall', v_antall));
  end loop;
  if exists (select 1 from unnest(v_sett) s(id) where not exists (select 1 from lagervarer l where l.id = s.id)) then
    raise exception 'UKJENT_VARE';
  end if;

  -- Standard ombygging (selve varianten) faktureres via Ombygging-boksene i ordren; alt annet (tillegg, løsninger, ekstrautstyr, Modul-System, Personbil) som utstyr.
  v_type := case when v_variant is not null and v_gruppe = 'STANDARD' then 'ombygging' else 'ekstra_utstyr' end;
  select k.modell into v_biltype from portal_modell_kobling k where k.portal_modell_slug = v_slug;
  v_fra_kobling := v_biltype is not null;
  v_biltype := coalesce(v_biltype, v_modell);

  -- Finn oppskriften: koblet først, ellers én ukoblet med samme nummer. Låst for å stå imot to samtidige lagringer.
  if v_variant is not null then
    select * into r from lager_oppskrifter where portal_variant_id = v_variant for update;
  else
    select * into r from lager_oppskrifter where portal_tillegg_id = v_tillegg for update;
  end if;

  if r.id is not null then
    -- En oppskrift portalen selv har laget følger portalens produktnummer (endres nummeret i portalen, endres det her ved neste lagring).
    -- En oppskrift som fantes i appen fra før (kan ha flere numre, «500, 502») får aldri nummeret endret herfra.
    update lager_oppskrifter set ingredienser = v_deler,
      fiken_produktnummer = case when kilde = 'portal' then v_nr else fiken_produktnummer end
     where id = r.id;
    return jsonb_build_object('status', 'oppdatert', 'oppskriftId', r.id, 'antallDeler', jsonb_array_length(v_deler), 'biltypeFraKobling', v_fra_kobling);
  end if;

  select count(*) into v_treff from lager_oppskrifter
   where portal_variant_id is null and portal_tillegg_id is null and oppskrift_har_produktnummer(fiken_produktnummer, v_nr);
  if v_treff > 1 then raise exception 'FLERE_OPPSKRIFTER'; end if;
  if v_treff = 1 then
    select * into r from lager_oppskrifter
     where portal_variant_id is null and portal_tillegg_id is null and oppskrift_har_produktnummer(fiken_produktnummer, v_nr) for update;
    update lager_oppskrifter set ingredienser = v_deler, portal_variant_id = v_variant, portal_tillegg_id = v_tillegg where id = r.id;
    return jsonb_build_object('status', 'koblet', 'oppskriftId', r.id, 'antallDeler', jsonb_array_length(v_deler), 'biltypeFraKobling', v_fra_kobling);
  end if;

  -- Ingen oppskrift fra før og ingen deler: ingenting å lagre (en oppskrift uten deler er «rent arbeid» og lages ikke automatisk).
  if jsonb_array_length(v_deler) = 0 then
    return jsonb_build_object('status', 'ingen_deler', 'oppskriftId', null, 'antallDeler', 0, 'biltypeFraKobling', v_fra_kobling);
  end if;

  v_id := 'oppskrift_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_p' || floor(random() * 1000)::int;
  insert into lager_oppskrifter (id, navn, biltype, type, ingredienser, fiken_produktnummer, kilde, portal_variant_id, portal_tillegg_id)
  values (v_id, v_navn, v_biltype, v_type, v_deler, v_nr, 'portal', v_variant, v_tillegg);
  return jsonb_build_object('status', 'opprettet', 'oppskriftId', v_id, 'antallDeler', jsonb_array_length(v_deler), 'biltypeFraKobling', v_fra_kobling);
exception
  when unique_violation then raise exception 'SAMTIDIG_LAGRING';
end;
$$;

revoke all on function public.portal_oppskrift_lagre(jsonb) from public, anon, authenticated;
grant execute on function public.portal_oppskrift_lagre(jsonb) to service_role;
