-- Ikke kjørt ennå (skrives 16.11, kjøres etter Henriks eget ja).
--
-- Gir Forhandlerportalens Kalkyle «lønnsomhet per forhandler» et SKRIVEBESKYTTET, aggregert øyeblikksbilde av faktisk fakturerte bil-ordre, gruppert på
-- forhandler + modell. Portalen bruker dette til å sammenligne faktisk fakturert beløp mot Kalkyle sin beregnede kostnad for modellen (Henrik 16.11:
-- «faktisk fakturert beløp», ikke Excel sin planlagte salgspris; «alt som er i ordre appen», ikke et avgrenset tidsrom). Appen skriver aldri til portalen,
-- og denne funksjonen skriver aldri noe - samme konstruksjon som portal_import_fakta (20261110200000): STABLE + SECURITY INVOKER (Postgres avviser en
-- INSERT/UPDATE/DELETE i en stable-funksjon), bare service_role kan kalle den (revoke fra public/anon/authenticated).
--
-- Bevisst MINDRE data enn portal_import_fakta: ingen ordre-id, chassis, kundenavn eller dato - bare forhandler_kontakt_id, modell og summerte kronebeløp.
-- Dette er aggregert forretningsinformasjon (omsetning per forhandler/modell), ikke personopplysninger, og trenger derfor ikke samme detaljnivå som
-- import-funksjonen (som MÅ ha kundenavn/chassis for å matche enkeltbiler). Grupperingen skjer selv i SQL (group by forhandler_kontakt_id, merke, modell),
-- så portalen aldri ser enkeltordre.
--
-- Hva den returnerer (kontrakt versjon 1):
--   grupper: én rad per (forhandler_kontakt_id, merke, modell, portal_modell_slug) med minst én fakturert bil-ordre. Hver rad har ALLTID de samme seks
--   feltene: forhandler_kontakt_id, merke, modell, portal_modell_slug (null hvis ordren ikke kom fra portalen - de fleste eldre ordre), antall_ordre,
--   fakturert_belop_eks_mva (summen av fiken_linjer sine linjebeløp, eks. mva - samme skala som Kalkyle sin salgspris og KalkyleModell.rabattFaktor).
--
-- Valgene og hvorfor:
--  * Bare ordretype = 'bil' og fakturert = true telles. Ingen tidsfilter (Henrik: «alt som er i ordre appen»).
--  * forhandler_kontakt_id IS NOT NULL og ikke tom streng - ordre uten kjent forhandler kan ikke telles til noen (sees ikke i det hele tatt).
--  * Linjebeløp leses fra ordrer.fiken_linjer (samme kolonne fiken-fakturer selv bruker, allerede fakturert eks. mva): hver linje har enten `belop`
--    (fast beløp, f.eks. drivstoffsats) eller `pris` x `antall` (vanlig produktlinje). Et felt som ikke er et gyldig tall (skal aldri skje, men appen
--    stoler aldri blindt på en JSONB-kolonne) regnes som 0 for DEN linjen i stedet for å kaste og avvise HELE svaret - urelatert til hvorvidt tallet
--    er riktig, bare at funksjonen aldri krasjer på én rar rad.
--  * merke/modell renses likt som i portal_import_fakta (samme tegnklasse c_skjult, hvitt mellomrom til ett mellomrom, kappet til 200 tegn): samme
--    fritekst-kilde (ansatte skriver dette inn), samme risiko for usynlige tegn.
--  * p_forhandler_kontakt_ider (valgfri): begrenser til bestemte forhandlere (samme validering som portal_import_fakta sin p_ider: høyst 500,
--    hvert element ^[A-Za-z0-9_.-]{1,64}$). Utelatt (NULL) = alle forhandlere.
--
-- Rollback: supabase/rollback-referanser/portal_forhandler_salg_ROLLBACK.sql (migrasjonen endrer ingen data). Test: supabase/tester/portal_forhandler_salg_TEST_body.sql
-- (alltid i en transaksjon som rulles tilbake; kjøring står øverst i filen).

create or replace function public.portal_forhandler_salg(p_forhandler_kontakt_ider text[] default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  c_ider_maks   constant int  := 500;
  c_tall        constant text := '^-?[0-9]+(\.[0-9]+)?$';
  -- Tegn som aldri hører hjemme i en tekst: samme sett som portal_import_fakta (tekst() i portalens lib/salmakernFelles.ts).
  c_skjult      constant text := '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿￹-￻]';
  c_mellomrom   constant text := '[\s   -     　]+';
  v_ider text[];
  v_grupper jsonb;
begin
  v_ider := p_forhandler_kontakt_ider;
  if v_ider is not null and (
       cardinality(v_ider) > c_ider_maks
       or exists (select 1 from unnest(v_ider) x(id) where x.id is null or x.id !~ '^[A-Za-z0-9_.-]{1,64}$')
     ) then
    raise exception 'UGYLDIG_INPUT: forhandler_kontakt_ider';
  end if;

  with
  linjer as (
    select
      o.id,
      btrim(o.forhandler_kontakt_id) as forhandler_kontakt_id,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.merke, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as merke,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.modell, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as modell,
      nullif(btrim(coalesce(o.portal_modell_slug, '')), '') as portal_modell_slug,
      coalesce(
        case when l->>'belop' ~ c_tall then (l->>'belop')::numeric end,
        case when l->>'pris' ~ c_tall then (l->>'pris')::numeric end
          * case when l->>'antall' ~ c_tall then (l->>'antall')::numeric else 1 end,
        0
      ) as linjebelop
    from public.ordrer o,
         jsonb_array_elements(case when jsonb_typeof(o.fiken_linjer) = 'array' then o.fiken_linjer else '[]'::jsonb end) l
    where o.ordretype = 'bil'
      and o.fakturert = true
      and o.forhandler_kontakt_id is not null and btrim(o.forhandler_kontakt_id) <> ''
      and (v_ider is null or btrim(o.forhandler_kontakt_id) = any (v_ider))
  ),
  gruppert as (
    select forhandler_kontakt_id, merke, modell, portal_modell_slug,
           count(distinct id) as antall_ordre,
           sum(linjebelop) as fakturert_belop
    from linjer
    group by forhandler_kontakt_id, merke, modell, portal_modell_slug
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'forhandler_kontakt_id', g.forhandler_kontakt_id,
           'merke', g.merke,
           'modell', g.modell,
           'portal_modell_slug', g.portal_modell_slug,
           'antall_ordre', g.antall_ordre,
           'fakturert_belop_eks_mva', round(g.fakturert_belop, 2)
         ) order by g.forhandler_kontakt_id, g.merke, g.modell), '[]'::jsonb)
  into v_grupper
  from gruppert g;

  return jsonb_build_object(
    'versjon', 1,
    'generert', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'grupper', v_grupper
  );
end;
$function$;

revoke all on function public.portal_forhandler_salg(text[]) from public, anon, authenticated;
grant execute on function public.portal_forhandler_salg(text[]) to service_role;
