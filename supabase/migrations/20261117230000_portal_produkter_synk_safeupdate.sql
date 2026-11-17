-- Retting av portal_produkter_synk (trinn 2, 17.11.2026): første ekte henting feilet med SQLSTATE 21000. Supabase kjører pg_safeupdate for
-- kall via API-et (PostgREST/rpc), og den avviser «delete from portal_produkter» uten WHERE. SQL-testen kjørte direkte (db query) og fanget det
-- ikke. Eneste endring: «where true». Lærdom: en DELETE/UPDATE uten WHERE i en funksjon som kalles via rpc feiler i produksjon.
-- Rollback: kjør funksjonen fra 20261117220000_portal_produkter.sql på nytt (den feiler da igjen ved rpc).

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

  delete from portal_produkter where true;  -- «where true»: pg_safeupdate (aktiv for kall via API-et) avviser DELETE uten WHERE med 21000
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

