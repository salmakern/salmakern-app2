-- Ikke kjørt ennå (skrives 16.11, kjøres etter Henriks eget ja).
--
-- Gir Forhandlerportalen et SKRIVEBESKYTTET øyeblikksbilde av FAKTISKE timer per bil (ordreklokka: ordrer.ordre_timer_sessions = Ombygging og
-- ordrer.klargjoring_timer_sessions = Klargjøring), til kalkylesiden i portalen (/admin/kalkyle) som sammenligner kalkulerte timer per modell med det som
-- faktisk er brukt. Portalen HENTER (pull) via edge-funksjonen portal-timer-fakta og eier all matching mot kalkylemodellene (merke + modell -> modellnavn);
-- appen leverer bare tall per bil og skriver aldri til portalen. Samme mønster som portal_import_fakta (20261110200000) og samme hemmelighet i døra inn.
--
-- Skrivebeskyttet av konstruksjon: STABLE (Postgres avviser en INSERT/UPDATE/DELETE i en stable-funksjon) og SECURITY INVOKER (ingen utvidede rettigheter).
-- Kan BARE kalles av service_role (revoke fra public/anon/authenticated).
--
-- Hva den returnerer (kontrakt versjon 1, ENDRET PÅ STEDET 16.11 etter portalens gjennomgang: versjon 1 var ikke utrullet; se supabase/README.md «Faktiske timer til
-- portalen»; gullfila test/fixtures/portal-timer-fakta-svar.json skal være byte-lik portalens kopi):
--   { versjon: 1, generert, antall, biler: [ { merke, modell, ordre_status, arkivert, hentet, ankomst_dato, forste_okt, hentet_dato, minutter_ombygging, okter_ombygging,
--                                              okter_ombygging_glemt, minutter_klargjoring, pagaar_ombygging, pagaar_klargjoring, frossen_effektiv_minutter } ] }
--   ÉN rad per bil-ordre (ordretype = 'bil') som har minst én gyldig økt i en av de to klokkene, eller en brukbar frossen effektiv tid. Ingen id, ordrenummer,
--   chassis, kunde, kontaktperson eller ansattnavn/-id i svaret (portalen trenger dem ikke): bare tall, datoer og merke/modell/status per bil.
--
-- GARANTIER (portalen avviser HELE svaret ved første rad som bryter dem, så de er ikke valgfrie; edge-funksjonen validerer det samme i logikk.ts):
--   * Alle 15 felt står i HVER rad. merke og modell er tekst (aldri null). ordre_status er ALLTID nøyaktig én av de åtte kodene (paa_vei, ikke_paabegynt, paabegynt,
--     ikke_veid, klar_visning, vist_biltilsyn, klar_henting, hentet): ordrer.ordre_status er fri tekst uten CHECK, så alt annet (NULL, tom tekst, gamle verdier som
--     bestilt_frakt) blir ikke_paabegynt (appen gjør det samme: js/core.js leser r.ordre_status || 'ikke_paabegynt'). En ny kode er en ny kontraktsversjon, aldri en stille utvidelse.
--   * arkivert, hentet, pagaar_ombygging og pagaar_klargjoring er ALLTID true/false (aldri null): arkivert = coalesce(status = 'arkivert', false), hentet = (den AVBILDEDE
--     ordre_status = 'hentet'), pagaar_* = coalesce(bool_or(...), false) (en bil uten økter gir en TOM mengde, og bool_or over en tom mengde er NULL).
--   * minutter_* og okter_* er hele tall >= 0 (0 når ingenting teller). BARE ankomst_dato, forste_okt, hentet_dato og frossen_effektiv_minutter kan være null (= ukjent
--     eller ikke relevant, aldri gjettet).
--
-- TIMER ER PERSON-TIMER: økter for to ansatte samtidig legges sammen (to personer som jobber 2 timer på samme bil samtidig gir 4 timer). Det er samme
-- måte kalkylens kostlinjer teller på, og det er IKKE «effektiv tid» (Bil-effektivitet i appen slår sammen overlappende tid og regner mot stemplet tid).
-- Er man bare ute etter tid bilen har stått på verkstedet, er frossen_effektiv_minutter (bare for hentede biler) riktig tall; de to minutt-feltene er
-- rå klokketid per person.
--
-- Regler per økt (alt trygt: en ugyldig økt hoppes over, aldri feil, og ugyldige verdier velter aldri svaret for andre biler; hver cast er vokta av en CASE):
--  * En økt er et JSON-objekt med `start` som JSON-TALL (ms siden epoke, bare siffer, høyst 15) og `stopp` som enten JSON-tall (samme krav) eller manglende/JSON-null
--    (åpen økt). Alt annet er ugyldig og hoppes over helt (tekst, «123» som streng, null i start, negative tall, desimaler, tall over 15 siffer, ikke-objekt,
--    stopp som tekst): ikke tellet, ikke «glemt», ikke «pågår» og gir ikke i seg selv en rad.
--  * Åpen økt (uten stopp): pagaar_ombygging = true (i ordre_timer_sessions) eller pagaar_klargjoring = true (i klargjoring_timer_sessions). De er UAVHENGIGE: portalen
--    regner en bil som «ferdig» når den er hentet og pagaar_ombygging er false. Opprydningen stopp_forlatte_ordreklokker (20261104100000) leser bare
--    ordre_timer_sessions og rører ALDRI Klargjøring, så en glemt åpen Klargjøring-klokke blir stående for alltid; med ett samlet felt ville en hentet bil med full
--    Ombygging-tid falt ut av snittet for godt. Det finnes derfor INGEN samlet `pagaar` i svaret. Åpne økter er aldri med i minuttene.
--  * Lukket økt: varighet = stopp - start.
--      - `autoStopp = 'glemt'` (opprydningsjobben stoppet den på start + 14 t), ELLER varighet over 14 timer: holdt UTENFOR minuttene og telt i
--        okter_ombygging_glemt (bare Ombygging har glemt-teller; Klargjøring har ingen i kontrakten). Faktiske data har ti slike over 14 t (maks ca. 97 t,
--        fra før opprydningen kom 4.11), så regelen treffer reelt.
--      - varighet over 0 og høyst 14 timer (nøyaktig 14 t teller): telt med i minuttene (og i okter_ombygging for Ombygging). `autoStopp = 'ikke_stemplet_inn'` teller som vanlig.
--      - varighet 0 eller negativ (stopp <= start) uten glemt-merke: ikke tellet og ikke glemt (men en gyldig økt, så bilen får likevel rad med nuller).
--  * minutter_* = SUMMEN av varigheter / 60000, avrundet til hele minutter på summen (ikke per økt; 3 økter à 30 s gir 2 minutter, ikke 3).
--  * frossen_effektiv_minutter = round(effektiv_tid_frossen.totalMs / 60000), eller null. totalMs må være et JSON-tall (siffer, evt. desimaler); alt annet
--    (tekst, negativt, manglende) gir null og gir ikke rad alene. Settes av appen når en bil settes til Hentet (se CLAUDE.md «Timesats og frosset effektiv ordretid»).
--
-- DATOFELT (alle tre: tekst YYYY-MM-DD, en EKTE kalenderdato (år 0001-9999), norsk dato, dagspresisjon (aldri klokkeslett), ellers null; heltallsregning, aldri make_date på
-- uvaliderte verdier, så en rar verdi gir null og aldri en feil). HVORFOR: uten dem kan ikke portalen skille en hentet bil der klokka først ble tatt i bruk midt i jobben
-- (tiden er for lav, avviket ser ut som «-7 t») fra en bil som faktisk gikk raskt.
--  * ankomst_dato = ordrer.ankomstdato (text) når den er NØYAKTIG YYYY-MM-DD og en ekte dato, ellers null (tom, «—», andre formater). Appen setter den som UTC-dato
--    (toISOString().split('T')[0]) når bilen går til «Ikke påbegynt»; den brukes som den står (ingen omregning).
--  * forste_okt = datoen (Europe/Oslo) for den TIDLIGSTE start blant ALLE økter i ordre_timer_sessions med gyldig start (ordlyden i kontrakten: «med gyldig start»; også
--    glemte, åpne og økter uten varighet, og en økt med gyldig start men ugyldig stopp, som ellers hoppes over). Bare Ombygging, aldri Klargjøring. Null når ingen økt har
--    gyldig start, og når starten ligger etter år 9999 (en slik verdi ville ikke vært en YYYY-MM-DD-dato).
--  * hentet_dato = bare når hentet = true, ellers null. Datoen for den SISTE logglinjen i ordrens `endringer` (jsonb-liste av {av, tid, txt}, nye linjer legges til på slutten
--    av legg_til_ordre_endring, så siste plass er siste linje) der txt er NØYAKTIG «Status endret til: Hentet» (med eller uten « (arkivert automatisk)»), ellers datoen i
--    effektiv_tid_frossen->>'frossetVed', ellers null. Har den siste Hentet-linjen en tid som ikke kan tolkes, brukes frossetVed (en tidligere Hentet-linje er ikke den
--    siste: det ville vært å gjette). FORMATET (sett i ekte data 16.11, 133 slike linjer, alle samsvarer): `tid` er appens `new Date().toLocaleString('no')`, altså
--    «D.M.YYYY, HH:MM:SS» med dag og måned uten ledende null («9.9.2026, 14:43:18», «11.11.2026, 13:34:43»), i ENHETENS lokaltid (ingen tidssone i teksten): datoen brukes
--    slik den står (de ansatte bruker norske enheter; en enhet med annen tidssone kunne gitt en dag feil, uten at det kan sees her). frossetVed er toISOString (UTC,
--    «2026-11-10T10:00:00.000Z») og regnes om til norsk dato (Europe/Oslo, sommer- og vintertid). Dagspresisjon: portalen bruker datoen bare til å vise tidsrommet bilene er hentet i.
--
-- ordre_status er den avbildede statusen (se garantier); hentet regnes av DEN. arkivert er uten btrim (kontrakten: coalesce(status = 'arkivert', false)); portal_import_fakta
-- trimmer (btrim) status, så de to kan i teorien avvike for en status med mellomrom rundt, men ingen slike finnes (16.11: bare «aktiv» og «arkivert»).
--
-- Øvrige regler:
--  * merke og modell renses likt som i portal_import_fakta (tegnklassen c_skjult fjernes, hvitt mellomrom blir ett mellomrom, trimmet, kappet til 100 tegn og
--    trimmet på nytt) og er '' når de mangler. Tegnklassen er skrevet med unicode-escapes (backslash-u), IKKE med rå tegn (rå usynlige tegn forsvinner ved kopiering, og et
--    rått U+2028 i et regex er en syntaksfeil). Filen skal ALDRI inneholde rå usynlige tegn: kontroller etter enhver redigering (Write/Edit kan gjøre om escapes til rå tegn).
--  * Sortering: merke, modell, ordre_status (bytevis, collate "C", så rekkefølgen ikke avhenger av databasens locale), minutter_ombygging synkende, så de øvrige
--    tallfeltene og til sist ordre-id (brukes bare til sortering, vises aldri), slik at to like kall alltid gir byte-lik rekkefølge.
--  * Tak: høyst 2000 rader. Flere gir FOR_MANGE_BILER (aldri et avkortet svar). I dag (16.11) er det 34 rader.
--
-- Rollback: supabase/rollback-referanser/portal_timer_fakta_ROLLBACK.sql (migrasjonen endrer ingen data). Test: supabase/tester/portal_timer_fakta_TEST_body.sql
-- (alltid i en transaksjon som rulles tilbake; kjøring står øverst i filen).

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
    where o.ordretype = 'bil'
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
