-- Ikke kjørt ennå (skrevet 17.11, kjøres etter Henriks eget ja). Kjøres FØR klientkoden legges ut (se «Rekkefølge» under).
--
-- «Kun ekstrautstyr (ingen ombygging)» på vanlige bil-ordrer (Henrik 2026-11-17): en kunde skal bare ha montert litt ekstrautstyr (gummimatte, kasse) på en
-- bil som ble bygget om for lenge siden. Ordren er en vanlig bil-ordre (ordretype = 'bil'), men skal IKKE telle i portalen:
--   * ny kolonne ordrer.kun_ekstrautstyr boolean not null default false (ren tillegg: alle eksisterende rader får false, ingen annen rad endres).
--   * portal_import_fakta(): en ordre med kun_ekstrautstyr = true står ikke i `aktive` (selgernes «Mine bestillinger»). `utvalgte` er uendret (portalen spør der om
--     id-er den allerede har; en slik ordre kan bare ha kommet dit hvis avkrysningen ble slått på etter importen, og da svarer `utvalgte` som før). Kontrakten
--     (versjon 1, 15 felt) er uendret.
--   * portal_timer_fakta(): en ordre med kun_ekstrautstyr = true gir ingen rad (kalkylesidens faktiske timer per modell). Kontrakten (versjon 1) er uendret.
--   Begge funksjonene er ellers BYTE-LIKE kopier av 20261110200000_portal_import_fakta.sql og 20261116120000_portal_timer_fakta.sql (stable, security invoker,
--   bare service_role); bare linjene merket «kun_ekstrautstyr» er nye. Tegnklassene er \u-escapes (filen skal aldri ha rå usynlige tegn).
--
-- Klienten (js/core.js dbToOrdre) leser kolonnen; ordreToDb()/save() skriver den ALDRI (bare opprettelsen og den målrettede settKunEkstrautstyr()).
-- Rekkefølge: denne migrasjonen FØRST, så klienten. En gammel klient mot ny database er ufarlig (kolonnen har default). Ny klient mot gammel database: en ny ordre
-- med avkrysningen på, eller å slå avkrysningen på/av, feiler med en synlig feilmelding (ukjent kolonne); alt annet virker.
-- Rollback: drop kolonnen og kjør de to opprinnelige migrasjonsfilene på nytt (create or replace):
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file supabase/migrations/20261110200000_portal_import_fakta.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file supabase/migrations/20261116120000_portal_timer_fakta.sql
--   alter table public.ordrer drop column if exists kun_ekstrautstyr;   (ETTER at klienten er rullet tilbake)
-- Test: supabase/tester/kun_ekstrautstyr_TEST_body.sql (alltid i en transaksjon som rulles tilbake; kjøring står øverst i filen).

alter table public.ordrer add column if not exists kun_ekstrautstyr boolean not null default false;
comment on column public.ordrer.kun_ekstrautstyr is 'Kun ekstrautstyr (ingen ombygging): ingen tvangsflyt, ikke i Admin-ark, utelatt fra portal_import_fakta (aktive) og portal_timer_fakta. Skrives aldri av save().';

create or replace function public.portal_import_fakta(p_ider text[] default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  c_ider_maks   constant int  := 500;
  c_aktive_maks constant int  := 500;
  -- Tegn som aldri hører hjemme i en tekst: samme sett som tekst() i portalens lib/salmakernFelles.ts. Skrevet med \u-escapes (ikke rå tegn; standard_conforming_strings er på, så backslash står urørt til regex-motoren).
  c_skjult      constant text := '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]';
  -- Hvitt mellomrom: \s pluss uttrykkelig de Unicode-mellomrommene (nbsp m.fl.), fordi hva \s regner som mellomrom avhenger av databasens lc_ctype (målt: i PGlite matcher \s ikke nbsp).
  -- Da får tab, linjeskift, CR og nbsp samme resultat uansett locale: ett mellomrom, så ord aldri slås sammen.
  c_mellomrom   constant text := '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+';
  c_chassis_ut  constant text := '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000-]';
  v_ider text[];
  v_aktive jsonb;
  v_utvalgte jsonb;
begin
  v_ider := coalesce(p_ider, '{}'::text[]);
  if cardinality(v_ider) > c_ider_maks
     or exists (select 1 from unnest(v_ider) x(id) where x.id is null or x.id !~ '^[A-Za-z0-9_.-]{1,64}$') then
    raise exception 'UGYLDIG_INPUT: ider';
  end if;

  with
  rene as (
    select
      o.id,
      o.ordretype,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.kunde, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as kunde,
      left(upper(regexp_replace(coalesce(o.chassis, ''), c_chassis_ut, '', 'g')), 40) as chassis,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.eier, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as eier,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.merke, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as merke,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.modell, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as modell,
      coalesce(nullif(btrim(o.ordre_status), ''), 'ikke_paabegynt') as ordre_status,
      case when coalesce(nullif(btrim(o.status), ''), 'aktiv') = 'arkivert' then 'arkivert' else 'aktiv' end as status,
      coalesce(o.created_at, o.updated_at) as opprettet,
      o.portal_bestilling_id,
      o.kun_ekstrautstyr  -- kun_ekstrautstyr
    from public.ordrer o
    where (o.ordretype = 'bil' and coalesce(nullif(btrim(o.status), ''), 'aktiv') <> 'arkivert' and not o.kun_ekstrautstyr)  -- kun_ekstrautstyr
       or o.id = any (v_ider)
  ),
  kontakter as (
    select k->>'id' as id,
           btrim(left(btrim(regexp_replace(regexp_replace(coalesce(k->>'navn', ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as navn,
           left(regexp_replace(coalesce(k->>'orgnr', ''), '\D', '', 'g'), 20) as orgnr
    from public.innstillinger i,
         jsonb_array_elements(case when jsonb_typeof(i.kontakter) = 'array' then i.kontakter else '[]'::jsonb end) k
    where i.id = 1 and k->>'type' = 'Forhandler' and length(coalesce(k->>'id', '')) between 1 and 120
  ),
  fakta as (
    select r.*,
      t.antall as kontakt_treff,
      case when t.antall = 1 then t.id end as kontakt_id,
      case when t.antall = 1 then t.navn end as kontakt_navn,
      case when t.antall = 1 then nullif(t.orgnr, '') end as kontakt_orgnr,
      coalesce((
        select jsonb_agg(x.pid order by x.pid)
        from (
          select r.portal_bestilling_id as pid where r.portal_bestilling_id is not null
          union
          select pb.portal_bestilling_id from public.portal_bestillinger pb where pb.ordre_id = r.id and pb.status <> 'avvist'
          union
          select pb.portal_bestilling_id from public.portal_bestillinger pb
           where pb.ident_type = 'CHASSIS' and r.chassis <> '' and pb.ident = r.chassis and pb.status <> 'avvist'
        ) x
      ), '[]'::jsonb) as portal_bestilling_ider
    from rene r
    cross join lateral (
      select count(*)::int as antall, min(k.id) as id, min(k.navn) as navn, min(k.orgnr) as orgnr
      from kontakter k where r.kunde <> '' and lower(k.navn) = lower(r.kunde)
    ) t
  ),
  rad as (
    select f.id,
      jsonb_build_object(
        'ordre_id', f.id, 'ordretype', f.ordretype, 'kunde', f.kunde, 'chassis', f.chassis, 'eier', f.eier,
        'merke', f.merke, 'modell', f.modell, 'ordre_status', f.ordre_status, 'status', f.status,
        'opprettet', case when f.opprettet is null then null
                          else to_char(f.opprettet at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'kontakt_treff', f.kontakt_treff, 'kontakt_id', f.kontakt_id, 'kontakt_navn', f.kontakt_navn,
        'kontakt_orgnr', f.kontakt_orgnr, 'portal_bestilling_ider', f.portal_bestilling_ider
      ) as j,
      (f.ordretype = 'bil' and f.status = 'aktiv' and not f.kun_ekstrautstyr) as er_aktiv  -- kun_ekstrautstyr
    from fakta f
  )
  select
    coalesce((select jsonb_agg(r.j order by r.id) from rad r where r.er_aktiv), '[]'::jsonb),
    coalesce((
      select jsonb_agg(case when r.id is null then jsonb_build_object('ordre_id', u.id, 'finnes', false)
                            else r.j || jsonb_build_object('finnes', true) end order by u.id)
      from (select distinct unnest(v_ider) as id) u left join rad r on r.id = u.id
    ), '[]'::jsonb)
  into v_aktive, v_utvalgte;

  if jsonb_array_length(v_aktive) > c_aktive_maks then
    raise exception 'FOR_MANGE_AKTIVE';
  end if;

  return jsonb_build_object(
    'versjon', 1,
    'generert', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'aktive', v_aktive,
    'utvalgte', v_utvalgte
  );
end;
$function$;

revoke all on function public.portal_import_fakta(text[]) from public, anon, authenticated;
grant execute on function public.portal_import_fakta(text[]) to service_role;

create or replace function public.portal_timer_fakta()
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  c_biler_maks  constant int     := 2000;
  c_okt_maks_ms constant numeric := 14 * 3600000;
  -- Tegn som aldri hører hjemme i en tekst: samme sett som c_skjult i portal_import_fakta (og tekst() i portalens lib/salmakernFelles.ts). Skrevet med \u-escapes (ikke rå tegn).
  c_skjult      constant text := '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]';
  -- Hvitt mellomrom: \s pluss uttrykkelig de Unicode-mellomrommene (nbsp m.fl.), så resultatet ikke avhenger av databasens lc_ctype.
  c_mellomrom   constant text := '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+';
  v_biler  jsonb;
  v_antall int;
begin
  with
  -- Alle økter fra begge klokkene for bil-ordrer, én rad per element. Er en kolonne ikke en JSON-liste (ugyldig, aldri sett i data), behandles den som tom.
  okter as (
    select o.id, l.felt, e.elem
    from public.ordrer o
    cross join lateral (values
      ('ombygging',   case when jsonb_typeof(o.ordre_timer_sessions)       = 'array' then o.ordre_timer_sessions       else '[]'::jsonb end),
      ('klargjoring', case when jsonb_typeof(o.klargjoring_timer_sessions) = 'array' then o.klargjoring_timer_sessions else '[]'::jsonb end)
    ) l(felt, liste)
    cross join lateral jsonb_array_elements(l.liste) e(elem)
    where o.ordretype = 'bil'
  ),
  -- Tolker hver økt TRYGT: en cast skjer bare når en CASE-vakt har bekreftet at verdien er et JSON-tall av siffer (aldri en feil for en rar økt).
  tolket as (
    select ok.id, ok.felt,
      case when jsonb_typeof(ok.elem->'start') = 'number' and (ok.elem->>'start') ~ '^\d{1,15}$' then (ok.elem->>'start')::numeric end as start_ms,
      case when jsonb_typeof(ok.elem->'stopp') = 'number' and (ok.elem->>'stopp') ~ '^\d{1,15}$' then (ok.elem->>'stopp')::numeric end as stopp_ms,
      (ok.elem->'stopp' is null or jsonb_typeof(ok.elem->'stopp') = 'null') as stopp_apen,
      coalesce((ok.elem->>'autoStopp') = 'glemt', false) as glemt_merke
    from okter ok
  ),
  -- Bare gyldige økter går videre: gyldig start, og stopp som enten er gyldig eller mangler/er null. Alt annet er hoppet over.
  klassifisert as (
    select t.id, t.felt, t.stopp_ms - t.start_ms as varighet_ms,
      case
        when t.stopp_ms is null                                  then 'apen'
        when t.glemt_merke or t.stopp_ms - t.start_ms > c_okt_maks_ms then 'glemt'
        when t.stopp_ms - t.start_ms > 0                         then 'teller'
        else                                                          'ingen'
      end as art
    from tolket t
    where t.start_ms is not null and (t.stopp_ms is not null or t.stopp_apen)
  ),
  -- Per bil: tellere og «pågår» per klokke. coalesce(bool_or(..), false): en bil uten åpen økt (eller uten økter i klokka) skal gi false, aldri null.
  per_ordre as (
    select k.id,
      count(*) filter (where k.felt = 'ombygging' and k.art = 'teller')::int as okter_ombygging,
      count(*) filter (where k.felt = 'ombygging' and k.art = 'glemt')::int  as okter_ombygging_glemt,
      coalesce(sum(k.varighet_ms) filter (where k.felt = 'ombygging'   and k.art = 'teller'), 0) as ms_ombygging,
      coalesce(sum(k.varighet_ms) filter (where k.felt = 'klargjoring' and k.art = 'teller'), 0) as ms_klargjoring,
      coalesce(bool_or(k.art = 'apen') filter (where k.felt = 'ombygging'),   false) as pagaar_ombygging,
      coalesce(bool_or(k.art = 'apen') filter (where k.felt = 'klargjoring'), false) as pagaar_klargjoring
    from klassifisert k
    group by k.id
  ),
  -- forste_okt: TIDLIGSTE gyldige start i Ombygging (ikke Klargjøring), uansett om økta er åpen, glemt eller uten varighet (se DATOFELT over).
  forste as (
    select t.id, min(t.start_ms) as forste_ms
    from tolket t
    where t.felt = 'ombygging' and t.start_ms is not null
    group by t.id
  ),
  -- hentet_dato (1): den SISTE logglinjen «Status endret til: Hentet» i endringer-lista (siste plass = nyeste linje). Bare biler som er hentet nå.
  hentet_logg as (
    select distinct on (o.id) o.id, l.elem->>'tid' as tid
    from public.ordrer o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.endringer) = 'array' then o.endringer else '[]'::jsonb end) with ordinality l(elem, ord)
    where o.ordretype = 'bil' and o.ordre_status = 'hentet'
      and jsonb_typeof(l.elem) = 'object' and jsonb_typeof(l.elem->'txt') = 'string'
      and (l.elem->>'txt') ~ '^Status endret til: Hentet( \(arkivert automatisk\))?$'
    order by o.id, l.ord desc
  ),
  -- Datokandidater fra de tre tekstkildene. Hver er matchet med regexp_match (som gir NULL når formatet ikke stemmer), så ::int under bare kan treffe sifre og aldri feile.
  --   ankomst: YYYY-MM-DD (brukt som den står)   logg: D.M.YYYY, HH:MM:SS (enhetens lokaltid)   frossen: ISO-tid i UTC (regnes om til norsk dato under)
  dato_kandidater as (
    select s.id, 'ankomst'::text as kilde, s.g[1]::int as y, s.g[2]::int as m, s.g[3]::int as d, null::int as hh, null::int as mi, null::int as ss
    from (select o.id, regexp_match(o.ankomstdato, '^([0-9]{4})-([0-9]{2})-([0-9]{2})$') as g from public.ordrer o where o.ordretype = 'bil') s
    where s.g is not null
    union all
    select s.id, 'logg', s.g[3]::int, s.g[2]::int, s.g[1]::int, s.g[4]::int, s.g[5]::int, s.g[6]::int
    from (select h.id, regexp_match(h.tid, '^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4}),' || c_mellomrom || '([0-9]{1,2}):([0-9]{2}):([0-9]{2})$') as g from hentet_logg h) s
    where s.g is not null
    union all
    select s.id, 'frossen', s.g[1]::int, s.g[2]::int, s.g[3]::int, s.g[4]::int, s.g[5]::int, s.g[6]::int
    from (select o.id, regexp_match(o.effektiv_tid_frossen->>'frossetVed', '^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,6})?Z$') as g
            from public.ordrer o where o.ordretype = 'bil') s
    where s.g is not null
  ),
  -- Bare EKTE kalenderdatoer (og klokkeslett) går videre: heltallsregning for skuddår og månedslengde (aldri make_date på en uvalidert verdi). År 0000 finnes ikke.
  dato_gyldig as (
    select k.*
    from dato_kandidater k
    where k.y between 1 and 9999 and k.m between 1 and 12
      and k.d between 1 and (case k.m
                               when 2 then (case when (k.y % 4 = 0 and k.y % 100 <> 0) or k.y % 400 = 0 then 29 else 28 end)
                               when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30
                               else 31 end)
      and coalesce(k.hh <= 23 and k.mi <= 59 and k.ss <= 59, true)
  ),
  datoer as (
    select g.id,
      max(to_char(make_date(g.y, g.m, g.d), 'YYYY-MM-DD')) filter (where g.kilde = 'ankomst') as ankomst_dato,
      max(to_char(make_date(g.y, g.m, g.d), 'YYYY-MM-DD')) filter (where g.kilde = 'logg')    as logg_dato,
      max(to_char((make_timestamptz(g.y, g.m, g.d, g.hh, g.mi, g.ss::double precision, 'UTC') at time zone 'Europe/Oslo')::date, 'YYYY-MM-DD')) filter (where g.kilde = 'frossen') as frossen_dato
    from dato_gyldig g
    group by g.id
  ),
  rader as (
    select o.id,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.merke, ''),  c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 100)) as merke,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.modell, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 100)) as modell,
      case when o.ordre_status in ('paa_vei', 'ikke_paabegynt', 'paabegynt', 'ikke_veid', 'klar_visning', 'vist_biltilsyn', 'klar_henting', 'hentet')
           then o.ordre_status else 'ikke_paabegynt' end as ordre_status,
      coalesce(o.status = 'arkivert', false) as arkivert,
      round(coalesce(p.ms_ombygging, 0)   / 60000)::bigint as minutter_ombygging,
      coalesce(p.okter_ombygging, 0)                       as okter_ombygging,
      coalesce(p.okter_ombygging_glemt, 0)                 as okter_ombygging_glemt,
      round(coalesce(p.ms_klargjoring, 0) / 60000)::bigint as minutter_klargjoring,
      coalesce(p.pagaar_ombygging, false)                  as pagaar_ombygging,
      coalesce(p.pagaar_klargjoring, false)                as pagaar_klargjoring,
      case when jsonb_typeof(o.effektiv_tid_frossen->'totalMs') = 'number' and (o.effektiv_tid_frossen->>'totalMs') ~ '^\d{1,15}(\.\d+)?$'
           then round((o.effektiv_tid_frossen->>'totalMs')::numeric / 60000)::bigint end as frossen_effektiv_minutter,
      d.ankomst_dato,
      case when oslo.ts is not null and extract(year from oslo.ts) <= 9999 then to_char(oslo.ts, 'YYYY-MM-DD') end as forste_okt,
      d.logg_dato,
      d.frossen_dato,
      (p.id is not null) as har_okter
    from public.ordrer o
    left join per_ordre p on p.id = o.id
    left join forste f on f.id = o.id
    left join datoer d on d.id = o.id
    left join lateral (select to_timestamp(f.forste_ms / 1000.0) at time zone 'Europe/Oslo' as ts) oslo on true
    where o.ordretype = 'bil' and not o.kun_ekstrautstyr  -- kun_ekstrautstyr
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'merke', r.merke, 'modell', r.modell, 'ordre_status', r.ordre_status, 'arkivert', r.arkivert, 'hentet', (r.ordre_status = 'hentet'),
        'ankomst_dato', r.ankomst_dato, 'forste_okt', r.forste_okt,
        'hentet_dato', case when r.ordre_status = 'hentet' then coalesce(r.logg_dato, r.frossen_dato) end,
        'minutter_ombygging', r.minutter_ombygging, 'okter_ombygging', r.okter_ombygging, 'okter_ombygging_glemt', r.okter_ombygging_glemt,
        'minutter_klargjoring', r.minutter_klargjoring, 'pagaar_ombygging', r.pagaar_ombygging, 'pagaar_klargjoring', r.pagaar_klargjoring,
        'frossen_effektiv_minutter', r.frossen_effektiv_minutter
      )
      order by r.merke collate "C", r.modell collate "C", r.ordre_status collate "C", r.minutter_ombygging desc,
               r.okter_ombygging desc, r.minutter_klargjoring desc, r.okter_ombygging_glemt desc, r.pagaar_ombygging desc, r.pagaar_klargjoring desc,
               r.frossen_effektiv_minutter desc nulls last, r.arkivert, r.id collate "C"
    ), '[]'::jsonb),
    count(*)::int
  into v_biler, v_antall
  from rader r
  where r.har_okter or r.frossen_effektiv_minutter is not null;

  if v_antall > c_biler_maks then
    raise exception 'FOR_MANGE_BILER';
  end if;

  return jsonb_build_object(
    'versjon', 1,
    'generert', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'antall', v_antall,
    'biler', v_biler
  );
end;
$function$;

revoke all on function public.portal_timer_fakta() from public, anon, authenticated;
grant execute on function public.portal_timer_fakta() to service_role;
