-- Trinn 1 av «Én produktliste» (Henrik 17.11.2026, valg A: «Ny variant» i portalen med deler fra appens lager).
-- Portalen er stedet for nye varianter, tillegg og løsninger (navn og pris). DELENE (oppskriften) bor fortsatt her i appen:
-- portalen leser lagervarene og eventuell oppskrift (portal_oppskrift_hent) og sender delene tilbake (portal_oppskrift_lagre),
-- begge via edge-funksjonen portal-oppskrift med service_role. Ingen andre roller kan kalle funksjonene.
--
-- Koblingen: lager_oppskrifter.portal_variant_id ELLER portal_tillegg_id (tillegg og løsninger er samme tabell i portalen).
-- Tilleggets produktnummer er ikke unikt i portalen, derfor kobles det på id, aldri på nummeret.
-- En oppskrift som fantes FØR koblingen (lagt inn for hånd i appen) kobles på produktnummer (fiken_produktnummer kan ha flere
-- numre, «500, 502», delt på komma/semikolon/mellomrom som oppskriftProduktnumre() i js/lager.js), men bare når nøyaktig én
-- ukoblet oppskrift har nummeret. Flere treff = FLERE_OPPSKRIFTER (ryddes i appen først), aldri en gjetning, så samme jobb aldri
-- får to oppskrifter (dobbelt lagertrekk).
--
-- Navnet på en oppskrift som finnes settes ALDRI om herfra: navnet brukes til å finne eldre lagertrekk (uten oppskrift_id) og
-- linjer i «Skal ha etter visning» (js/lager.js, erOppskriftHuket). Bare en NY oppskrift får portalens navn.
--
-- Rollback:
--   drop function if exists public.portal_oppskrift_lagre(jsonb);
--   drop function if exists public.portal_oppskrift_hent(text, text, text);
--   drop function if exists public.oppskrift_har_produktnummer(text, text);
--   drop index if exists lager_oppskrifter_portal_variant_uniq; drop index if exists lager_oppskrifter_portal_tillegg_uniq;
--   alter table public.lager_oppskrifter drop constraint if exists lager_oppskrifter_portal_en_kobling;
--   alter table public.lager_oppskrifter drop constraint if exists lager_oppskrifter_kilde_check;
--   alter table public.lager_oppskrifter drop column if exists portal_variant_id, drop column if exists portal_tillegg_id, drop column if exists kilde;

alter table public.lager_oppskrifter
  add column if not exists portal_variant_id text,
  add column if not exists portal_tillegg_id text,
  add column if not exists kilde text not null default 'app';

alter table public.lager_oppskrifter drop constraint if exists lager_oppskrifter_kilde_check;
alter table public.lager_oppskrifter add constraint lager_oppskrifter_kilde_check check (kilde in ('app', 'portal'));
alter table public.lager_oppskrifter drop constraint if exists lager_oppskrifter_portal_en_kobling;
alter table public.lager_oppskrifter add constraint lager_oppskrifter_portal_en_kobling
  check (portal_variant_id is null or portal_tillegg_id is null);

create unique index if not exists lager_oppskrifter_portal_variant_uniq on public.lager_oppskrifter (portal_variant_id) where portal_variant_id is not null;
create unique index if not exists lager_oppskrifter_portal_tillegg_uniq on public.lager_oppskrifter (portal_tillegg_id) where portal_tillegg_id is not null;

-- Har oppskriftens fiken_produktnummer-felt (ett eller flere numre) akkurat dette nummeret? Samme deling som oppskriftProduktnumre() i js/lager.js.
create or replace function public.oppskrift_har_produktnummer(p_felt text, p_nr text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(btrim(p_nr), '') <> ''
     and btrim(p_nr) = any (regexp_split_to_array(btrim(coalesce(p_felt, '')), '[[:space:],;]+'));
$$;

-- LESER: lagervarene (til delevelgeren) og oppskriften for en variant/et tillegg. Uten id og nummer: bare varene.
-- Svar: { varer: [{id, navn, enhet, antall, modell, kategori}], oppskrift: null | {id, navn, biltype, type, ingredienser, koblet}, flere: <antall ukoblede treff på nummeret> }
-- koblet = false betyr at oppskriften ble funnet på produktnummer og kobles først når portalen lagrer.
create or replace function public.portal_oppskrift_hent(p_variant_id text, p_tillegg_id text, p_produktnummer text)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_oppskrift jsonb := null;
  v_flere int := 0;
  r public.lager_oppskrifter%rowtype;
begin
  if p_variant_id is not null and p_tillegg_id is not null then
    raise exception 'UGYLDIG_INPUT:id';
  end if;

  if nullif(btrim(coalesce(p_variant_id, '')), '') is not null then
    select * into r from lager_oppskrifter where portal_variant_id = btrim(p_variant_id);
  elsif nullif(btrim(coalesce(p_tillegg_id, '')), '') is not null then
    select * into r from lager_oppskrifter where portal_tillegg_id = btrim(p_tillegg_id);
  end if;

  if r.id is not null then
    v_oppskrift := jsonb_build_object('id', r.id, 'navn', coalesce(r.navn, ''), 'biltype', coalesce(r.biltype, ''), 'type', coalesce(r.type, 'ombygging'),
      'ingredienser', case when jsonb_typeof(r.ingredienser) = 'array' then r.ingredienser else '[]'::jsonb end, 'koblet', true);
  elsif nullif(btrim(coalesce(p_produktnummer, '')), '') is not null then
    select count(*) into v_flere from lager_oppskrifter
     where portal_variant_id is null and portal_tillegg_id is null and oppskrift_har_produktnummer(fiken_produktnummer, p_produktnummer);
    if v_flere = 1 then
      select * into r from lager_oppskrifter
       where portal_variant_id is null and portal_tillegg_id is null and oppskrift_har_produktnummer(fiken_produktnummer, p_produktnummer);
      v_oppskrift := jsonb_build_object('id', r.id, 'navn', coalesce(r.navn, ''), 'biltype', coalesce(r.biltype, ''), 'type', coalesce(r.type, 'ombygging'),
        'ingredienser', case when jsonb_typeof(r.ingredienser) = 'array' then r.ingredienser else '[]'::jsonb end, 'koblet', false);
      v_flere := 0;
    end if;
  end if;

  return jsonb_build_object(
    'varer', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'navn', coalesce(v.navn, ''), 'enhet', coalesce(nullif(v.enhet, ''), 'stk'),
               'antall', coalesce(v.antall, 0), 'modell', coalesce(v.modell, ''), 'kategori', coalesce(v.kategori, ''))
             order by lower(coalesce(v.modell, '')), lower(coalesce(v.navn, '')), v.id)
      from lagervarer v), '[]'::jsonb),
    'oppskrift', v_oppskrift,
    'flere', v_flere);
end;
$$;

-- SKRIVER: lagrer delene for en variant/et tillegg. Input (jsonb):
--   { variantId | tilleggId (nøyaktig én), produktnummer (1-20), navn (1-200), prisgruppe ('STANDARD'|'EKSTRAUTSTYR'|'MODUL_SYSTEM'),
--     modellSlug (valgfri), modellNavn (1-200), deler: [{vareId, antall}] (0-100, antall > 0 og <= 10000, ingen vare to ganger) }
-- Svar: { status: 'opprettet'|'oppdatert'|'koblet'|'ingen_deler', oppskriftId, antallDeler, biltypeFraKobling }
-- Feil (exception-tekst): UGYLDIG_INPUT:<felt>, UKJENT_VARE, FLERE_OPPSKRIFTER.
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
  if v_gruppe not in ('STANDARD', 'EKSTRAUTSTYR', 'MODUL_SYSTEM') then raise exception 'UGYLDIG_INPUT:prisgruppe'; end if;
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

  -- Standard ombygging (selve varianten) faktureres via Ombygging-boksene i ordren; alt annet (tillegg, løsninger, ekstrautstyr, Modul-System) som utstyr.
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

revoke all on function public.oppskrift_har_produktnummer(text, text) from public, anon, authenticated;
revoke all on function public.portal_oppskrift_hent(text, text, text) from public, anon, authenticated;
revoke all on function public.portal_oppskrift_lagre(jsonb) from public, anon, authenticated;
grant execute on function public.oppskrift_har_produktnummer(text, text) to service_role;
grant execute on function public.portal_oppskrift_hent(text, text, text) to service_role;
grant execute on function public.portal_oppskrift_lagre(jsonb) to service_role;
