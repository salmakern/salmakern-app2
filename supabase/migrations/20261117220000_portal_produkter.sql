-- Trinn 2 av «Én produktliste» (Henrik 17.11.2026): appen henter produktlista fra Forhandlerportalen (GET /api/salmakern/produktnumre)
-- i stedet for å stole på den hardkodede FIKEN_OMBYGGING_MODELLER i js/ordre-detalj.js. Portalen er fasit for navn og produktnummer.
-- Hver variant kan i portalen merkes med «Brukes i Salmaker'n som» (app_rolle): ombygging, personbil eller lafinto. Klienten slår opp
-- ombyggingsnumrene for ordrens modell (portal-slug) her, og faller tilbake på den hardkodede lista bare når portalen ikke har rollen
-- med et gyldig Fiken-nummer (f.eks. Dodge Durango, som ikke finnes i portalen ennå).
--
-- portal_produkter er et SPEIL: hele lista byttes ut atomisk ved hver henting (portal_produkter_synk, bare service_role, kalt av
-- edge-funksjonen hent-produkter-fra-portalen). Innloggede ansatte kan lese; ingen kan skrive fra klienten.
-- Vern: en tom eller ugyldig liste avvises (UGYLDIG_INPUT), og to varianter med samme rolle på samme modell avvises (DOBBEL_ROLLE),
-- så en feil i portalen aldri kan tømme lista eller gjøre ombyggingsnummeret tvetydig.
--
-- Rollback:
--   drop function if exists public.portal_produkter_synk(jsonb);
--   drop table if exists public.portal_produkter;

create table if not exists public.portal_produkter (
  portal_id          text primary key,
  type               text not null check (type in ('variant', 'tillegg', 'losning')),
  modell_slug        text not null,
  modell_navn        text not null default '',
  variant_portal_id  text,                      -- for tillegg/løsning: varianten de hører til
  produktnummer      text not null default '',  -- teksten i portalen (kan være «1600-1601» eller tom)
  fiken_nummer       text,                      -- bare satt når nummer_status = 'ok'
  nummer_status      text not null check (nummer_status in ('ok', 'intervall', 'mangler', 'ugyldig')),
  navn               text not null default '',
  prisgruppe         text,
  app_rolle          text check (app_rolle in ('ombygging', 'personbil', 'lafinto')),
  hentet_at          timestamptz not null default now(),
  check ((nummer_status = 'ok') = (fiken_nummer is not null)),
  check (app_rolle is null or type = 'variant')
);
create unique index if not exists portal_produkter_rolle_per_modell on public.portal_produkter (modell_slug, app_rolle) where app_rolle is not null;

alter table public.portal_produkter enable row level security;
drop policy if exists portal_produkter_lese on public.portal_produkter;
create policy portal_produkter_lese on public.portal_produkter for select using (exists (select 1 from current_ansatt()));
revoke insert, update, delete, truncate on public.portal_produkter from anon, authenticated;

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
    fiken_nummer text, nummer_status text, navn text, prisgruppe text, app_rolle text, hentet_at timestamptz) on commit drop;
  truncate _pp_inn;
  insert into _pp_inn (portal_id, type, modell_slug, modell_navn, variant_portal_id, produktnummer, fiken_nummer, nummer_status, navn, prisgruppe, app_rolle, hentet_at)
  select nullif(btrim(x.portal_id), ''), x.type, nullif(btrim(x.modell_slug), ''), coalesce(x.modell_navn, ''), nullif(btrim(x.variant_portal_id), ''),
         coalesce(x.produktnummer, ''), nullif(btrim(x.fiken_nummer), ''), x.nummer_status, coalesce(x.navn, ''), x.prisgruppe, x.app_rolle, now()
  from jsonb_to_recordset(p) as x(portal_id text, type text, modell_slug text, modell_navn text, variant_portal_id text, produktnummer text,
                                  fiken_nummer text, nummer_status text, navn text, prisgruppe text, app_rolle text);

  if exists (select 1 from _pp_inn where portal_id is null or modell_slug is null
               or type is null or type not in ('variant', 'tillegg', 'losning')
               or nummer_status is null or nummer_status not in ('ok', 'intervall', 'mangler', 'ugyldig')
               or (nummer_status = 'ok') <> (fiken_nummer is not null)
               or (fiken_nummer is not null and fiken_nummer !~ '^[1-9][0-9]{0,9}$')
               or (app_rolle is not null and (app_rolle not in ('ombygging', 'personbil', 'lafinto') or type <> 'variant'))
               or (type <> 'variant' and variant_portal_id is null)) then
    raise exception 'UGYLDIG_INPUT';
  end if;
  if (select count(*) from _pp_inn) <> (select count(distinct portal_id) from _pp_inn) then raise exception 'UGYLDIG_INPUT'; end if;
  if exists (select 1 from _pp_inn where app_rolle is not null group by modell_slug, app_rolle having count(*) > 1) then
    raise exception 'DOBBEL_ROLLE';
  end if;

  select coalesce(jsonb_object_agg(modell_slug || ':' || app_rolle, coalesce(fiken_nummer, '-')), '{}') into v_for_roller
    from portal_produkter where app_rolle is not null;

  delete from portal_produkter;
  insert into portal_produkter select * from _pp_inn;

  select count(distinct modell_slug), count(*), count(*) filter (where app_rolle is not null) into v_modeller, v_rader, v_roller from portal_produkter;
  select coalesce(jsonb_object_agg(modell_slug || ':' || app_rolle, coalesce(fiken_nummer, '-')), '{}') into v_etter_roller
    from portal_produkter where app_rolle is not null;

  return jsonb_build_object('modeller', v_modeller, 'rader', v_rader, 'roller', v_roller,
    -- Roller som er nye eller har fått et annet nummer siden forrige henting (vises for admin).
    'endredeRoller', (select coalesce(jsonb_agg(e.key order by e.key), '[]') from jsonb_each_text(v_etter_roller) e where (v_for_roller ->> e.key) is distinct from e.value),
    'fjernedeRoller', (select coalesce(jsonb_agg(f.key order by f.key), '[]') from jsonb_each_text(v_for_roller) f where not (v_etter_roller ? f.key)));
end;
$$;

revoke all on function public.portal_produkter_synk(jsonb) from public, anon, authenticated;
grant execute on function public.portal_produkter_synk(jsonb) to service_role;
