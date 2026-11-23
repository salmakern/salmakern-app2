-- Utvidelse av «Én produktliste» trinn 2 (Henrik 20.11.2026): en tidligere gjennomgang trengte bilde og pris per produkt for å sjekke
-- at alt har bilde+pris satt i portalen, og måtte gi opp fordi hente-ruten (GET /api/salmakern/produktnumre) ikke ga dem. Portalsiden er
-- utvidet til å sende bilde_url (første bilde, eller null) og pris_kr (listepris, null hvis ikke satt/0) per variant/tillegg/løsning,
-- additivt i versjon 1 (valgfrie felt: en eldre portal uten dem gir fortsatt null her, ikke en avvisning av hele svaret - se
-- hent-produkter-fra-portalen/logikk.ts). IKKE brukt til fakturering (den bruker fortsatt Fikens egne priser via fiken_priser).
--
-- Rollback:
--   create or replace function public.portal_produkter_synk(p jsonb) ... (kjør body fra 20261117230000_portal_produkter_synk_safeupdate.sql på nytt)
--   alter table public.portal_produkter drop column if exists bilde_url, drop column if exists pris_kr;

alter table public.portal_produkter
  add column if not exists bilde_url text,
  add column if not exists pris_kr numeric;

alter table public.portal_produkter
  drop constraint if exists portal_produkter_pris_kr_positiv,
  add constraint portal_produkter_pris_kr_positiv check (pris_kr is null or pris_kr > 0);

create or replace function public.portal_produkter_synk(p jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  v_modeller int; v_rader int; v_roller int; v_for_roller jsonb; v_etter_roller jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 or jsonb_array_length(p) > 5000 then
    raise exception 'UGYLDIG_INPUT';
  end if;

  -- Uten begrensninger (validert under, så feilen alltid blir UGYLDIG_INPUT og ikke en rå constraint-feil).
  create temp table if not exists _pp_inn (portal_id text, type text, modell_slug text, modell_navn text, variant_portal_id text, produktnummer text,
    fiken_nummer text, nummer_status text, navn text, prisgruppe text, app_rolle text, bilde_url text, pris_kr numeric, hentet_at timestamptz) on commit drop;
  truncate _pp_inn;
  insert into _pp_inn (portal_id, type, modell_slug, modell_navn, variant_portal_id, produktnummer, fiken_nummer, nummer_status, navn, prisgruppe,
    app_rolle, bilde_url, pris_kr, hentet_at)
  select nullif(btrim(x.portal_id), ''), x.type, nullif(btrim(x.modell_slug), ''), coalesce(x.modell_navn, ''), nullif(btrim(x.variant_portal_id), ''),
         coalesce(x.produktnummer, ''), nullif(btrim(x.fiken_nummer), ''), x.nummer_status, coalesce(x.navn, ''), x.prisgruppe, x.app_rolle,
         nullif(btrim(x.bilde_url), ''), x.pris_kr, now()
  from jsonb_to_recordset(p) as x(portal_id text, type text, modell_slug text, modell_navn text, variant_portal_id text, produktnummer text,
                                  fiken_nummer text, nummer_status text, navn text, prisgruppe text, app_rolle text, bilde_url text, pris_kr numeric);

  if exists (select 1 from _pp_inn where portal_id is null or modell_slug is null
               or type is null or type not in ('variant', 'tillegg', 'losning')
               or nummer_status is null or nummer_status not in ('ok', 'intervall', 'mangler', 'ugyldig')
               or (nummer_status = 'ok') <> (fiken_nummer is not null)
               or (fiken_nummer is not null and fiken_nummer !~ '^[1-9][0-9]{0,9}$')
               or (app_rolle is not null and (app_rolle not in ('ombygging', 'personbil', 'lafinto') or type <> 'variant'))
               or (type <> 'variant' and variant_portal_id is null)
               or (bilde_url is not null and length(bilde_url) > 2000)
               or (pris_kr is not null and pris_kr <= 0)) then
    raise exception 'UGYLDIG_INPUT';
  end if;
  if (select count(*) from _pp_inn) <> (select count(distinct portal_id) from _pp_inn) then raise exception 'UGYLDIG_INPUT'; end if;
  if exists (select 1 from _pp_inn where app_rolle is not null group by modell_slug, app_rolle having count(*) > 1) then
    raise exception 'DOBBEL_ROLLE';
  end if;

  select coalesce(jsonb_object_agg(modell_slug || ':' || app_rolle, coalesce(fiken_nummer, '-')), '{}') into v_for_roller
    from portal_produkter where app_rolle is not null;

  delete from portal_produkter where true;  -- «where true»: pg_safeupdate (aktiv for kall via API-et) avviser DELETE uten WHERE med 21000
  -- Eksplisitt kolonneliste (ikke «select *»): _pp_inn og portal_produkter har ulik fysisk kolonnerekkefølge siden bilde_url/pris_kr
  -- ble lagt til med ALTER TABLE (append til slutt), mens _pp_inn har dem før hentet_at - en posisjonsbasert select ville satt verdiene
  -- i feil kolonner.
  insert into portal_produkter (portal_id, type, modell_slug, modell_navn, variant_portal_id, produktnummer, fiken_nummer, nummer_status,
    navn, prisgruppe, app_rolle, bilde_url, pris_kr, hentet_at)
  select portal_id, type, modell_slug, modell_navn, variant_portal_id, produktnummer, fiken_nummer, nummer_status,
    navn, prisgruppe, app_rolle, bilde_url, pris_kr, hentet_at
  from _pp_inn;

  select count(distinct modell_slug), count(*), count(*) filter (where app_rolle is not null) into v_modeller, v_rader, v_roller from portal_produkter;
  select coalesce(jsonb_object_agg(modell_slug || ':' || app_rolle, coalesce(fiken_nummer, '-')), '{}') into v_etter_roller
    from portal_produkter where app_rolle is not null;

  return jsonb_build_object('modeller', v_modeller, 'rader', v_rader, 'roller', v_roller,
    -- Roller som er nye eller har fått et annet nummer siden forrige henting (vises for admin).
    'endredeRoller', (select coalesce(jsonb_agg(e.key order by e.key), '[]') from jsonb_each_text(v_etter_roller) e where (v_for_roller ->> e.key) is distinct from e.value),
    'fjernedeRoller', (select coalesce(jsonb_agg(f.key order by f.key), '[]') from jsonb_each_text(v_for_roller) f where not (v_etter_roller ? f.key)));
end;
$$;
