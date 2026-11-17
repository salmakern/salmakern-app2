-- Trinn 3 av «Én produktliste» (Henrik 17.11.2026): appen velger selv ombygging og tillegg ut fra modell + bestilling + «Har ved ankomst»-
-- sjekklista. Reglene («velges når») ligger på varianten/tillegget i portalen og speiles hit (portal_produkter.velges_nar). På ordren lagres
-- bare RETTELSENE de ansatte gjør («Rett» / «+ Legg til utstyr»), som en logg: ordrer.produkt_rettelser, skrevet bare av
-- legg_til_ordre_produkt_rettelse (aldri av save(), samme regel som portal_*-kolonnene). Selve lista «Skal på bilen» regnes ut i klienten.
--
-- Rollback:
--   drop function if exists public.legg_til_ordre_produkt_rettelse(text, jsonb);
--   alter table public.ordrer drop column if exists produkt_rettelser;
--   alter table public.portal_produkter drop column if exists velges_nar;  (og kjør portal_produkter_synk fra 20261117230000 på nytt)

alter table public.portal_produkter add column if not exists velges_nar jsonb not null default '[]'::jsonb;
alter table public.ordrer add column if not exists produkt_rettelser jsonb not null default '[]'::jsonb;

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
    fiken_nummer text, nummer_status text, navn text, prisgruppe text, app_rolle text, hentet_at timestamptz, velges_nar jsonb) on commit drop;
  truncate _pp_inn;
  insert into _pp_inn (portal_id, type, modell_slug, modell_navn, variant_portal_id, produktnummer, fiken_nummer, nummer_status, navn, prisgruppe, app_rolle, hentet_at, velges_nar)
  select nullif(btrim(x.portal_id), ''), x.type, nullif(btrim(x.modell_slug), ''), coalesce(x.modell_navn, ''), nullif(btrim(x.variant_portal_id), ''),
         coalesce(x.produktnummer, ''), nullif(btrim(x.fiken_nummer), ''), x.nummer_status, coalesce(x.navn, ''), x.prisgruppe, x.app_rolle, now(), coalesce(x.velges_nar, '[]'::jsonb)
  from jsonb_to_recordset(p) as x(portal_id text, type text, modell_slug text, modell_navn text, variant_portal_id text, produktnummer text,
                                  fiken_nummer text, nummer_status text, navn text, prisgruppe text, app_rolle text, velges_nar jsonb);

  if exists (select 1 from _pp_inn where portal_id is null or modell_slug is null
               or type is null or type not in ('variant', 'tillegg', 'losning')
               or nummer_status is null or nummer_status not in ('ok', 'intervall', 'mangler', 'ugyldig')
               or (nummer_status = 'ok') <> (fiken_nummer is not null)
               or (fiken_nummer is not null and fiken_nummer !~ '^[1-9][0-9]{0,9}$')
               or (app_rolle is not null and (app_rolle not in ('ombygging', 'personbil', 'lafinto') or type <> 'variant'))
               or (type <> 'variant' and variant_portal_id is null)
               -- velges_nar: en liste med høyst 20 tekster à 1-100 tegn
               or jsonb_typeof(velges_nar) <> 'array' or jsonb_array_length(velges_nar) > 20
               or exists (select 1 from jsonb_array_elements(velges_nar) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 100)) then
    raise exception 'UGYLDIG_INPUT';
  end if;
  if (select count(*) from _pp_inn) <> (select count(distinct portal_id) from _pp_inn) then raise exception 'UGYLDIG_INPUT'; end if;
  if exists (select 1 from _pp_inn where app_rolle is not null group by modell_slug, app_rolle having count(*) > 1) then
    raise exception 'DOBBEL_ROLLE';
  end if;

  select coalesce(jsonb_object_agg(modell_slug || ':' || app_rolle, coalesce(fiken_nummer, '-')), '{}') into v_for_roller
    from portal_produkter where app_rolle is not null;

  delete from portal_produkter where true;  -- «where true»: pg_safeupdate (aktiv for kall via API-et) avviser DELETE uten WHERE med 21000
  insert into portal_produkter (portal_id, type, modell_slug, modell_navn, variant_portal_id, produktnummer, fiken_nummer, nummer_status, navn, prisgruppe, app_rolle, hentet_at, velges_nar)
    select portal_id, type, modell_slug, modell_navn, variant_portal_id, produktnummer, fiken_nummer, nummer_status, navn, prisgruppe, app_rolle, hentet_at, velges_nar from _pp_inn;

  select count(distinct modell_slug), count(*), count(*) filter (where app_rolle is not null) into v_modeller, v_rader, v_roller from portal_produkter;
  select coalesce(jsonb_object_agg(modell_slug || ':' || app_rolle, coalesce(fiken_nummer, '-')), '{}') into v_etter_roller
    from portal_produkter where app_rolle is not null;

  return jsonb_build_object('modeller', v_modeller, 'rader', v_rader, 'roller', v_roller,
    -- Roller som er nye eller har fått et annet nummer siden forrige henting (vises for admin).
    'endredeRoller', (select coalesce(jsonb_agg(e.key order by e.key), '[]') from jsonb_each_text(v_etter_roller) e where (v_for_roller ->> e.key) is distinct from e.value),
    'fjernedeRoller', (select coalesce(jsonb_agg(f.key order by f.key), '[]') from jsonb_each_text(v_for_roller) f where not (v_etter_roller ? f.key)));
end;
$$;


-- Én rettelse på «Skal på bilen»: { handling: 'fjern' | 'legg_til' | 'angre', produktnummer, portalId?, navn? }. Navnet på den som rettet
-- og tidspunktet settes HER (fra innloggingen og klokka i databasen), aldri fra klienten. Radlåst, så to samtidige rettelser ikke mister hverandre.
create or replace function public.legg_til_ordre_produkt_rettelse(p_ordre_id text, p_rettelse jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn text; v_liste jsonb; v_ny jsonb;
begin
  if not exists (select 1 from current_ansatt()) then raise exception 'IKKE_INNLOGGET'; end if;
  select coalesce(a.navn, '') into v_navn from ansatte a join current_ansatt() c on c.id = a.id limit 1;
  if p_rettelse is null or jsonb_typeof(p_rettelse) <> 'object'
     or coalesce(p_rettelse->>'handling', '') not in ('fjern', 'legg_til', 'angre')
     or coalesce(p_rettelse->>'produktnummer', '') !~ '^[1-9][0-9]{0,9}$'
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
