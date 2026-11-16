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
-- Hva den returnerer (kontrakt versjon 1, se supabase/README.md «Faktiske timer til portalen»):
--   { versjon: 1, generert, antall, biler: [ { merke, modell, ordre_status, arkivert, hentet, minutter_ombygging, okter_ombygging, okter_ombygging_glemt,
--                                              minutter_klargjoring, pagaar, frossen_effektiv_minutter } ] }
--   ÉN rad per bil-ordre (ordretype = 'bil') som har minst én gyldig økt i en av de to klokkene, eller en brukbar frossen effektiv tid. Ingen id, ordrenummer,
--   chassis, kunde, kontaktperson eller ansattnavn/-id i svaret (portalen trenger dem ikke): bare tall og merke/modell/status per bil.
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
--  * Åpen økt (uten stopp): `pagaar = true` for bilen (i en av de to klokkene). Aldri med i minuttene.
--  * Lukket økt: varighet = stopp - start.
--      - `autoStopp = 'glemt'` (opprydningsjobben stoppet den på start + 14 t), ELLER varighet over 14 timer: holdt UTENFOR minuttene og telt i
--        okter_ombygging_glemt (bare Ombygging har glemt-teller; Klargjøring har ingen i kontrakten). Faktiske data har ti slike over 14 t (maks ca. 97 t,
--        fra før opprydningen kom 4.11), så regelen treffer reelt.
--      - varighet over 0 og høyst 14 timer (nøyaktig 14 t teller): telt med i minuttene (og i okter_ombygging for Ombygging). `autoStopp = 'ikke_stemplet_inn'` teller som vanlig.
--      - varighet 0 eller negativ (stopp <= start) uten glemt-merke: ikke tellet og ikke glemt (men en gyldig økt, så bilen får likevel rad med nuller).
--  * minutter_* = SUMMEN av varigheter / 60000, avrundet til hele minutter på summen (ikke per økt; 3 økter à 30 s gir 2 minutter, ikke 3).
--  * frossen_effektiv_minutter = round(effektiv_tid_frossen.totalMs / 60000), eller null. totalMs må være et JSON-tall (siffer, evt. desimaler); alt annet
--    (tekst, negativt, manglende) gir null og gir ikke rad alene. Settes av appen når en bil settes til Hentet (se CLAUDE.md «Timesats og frosset effektiv ordretid»).
--  * ordre_status er `coalesce(nullif(btrim(ordre_status), ''), 'ikke_paabegynt')` (som portal_import_fakta; portalen regner «hentet» av denne, aldri med <> som utelater NULL);
--    hentet = (ordre_status = 'hentet'). arkivert = coalesce(nullif(btrim(status), ''), 'aktiv') = 'arkivert' (samme uttrykk som portal_import_fakta, så de to
--    endepunktene alltid er enige om hvilke biler som er arkivert; ingen forskjell fra `status = 'arkivert'` i dagens data).
--  * merke og modell renses likt som i portal_import_fakta (tegnklassen c_skjult fjernes, hvitt mellomrom blir ett mellomrom, trimmet, kappet til 100 tegn og
--    trimmet på nytt) og er '' når de mangler. Tegnklassen er skrevet med \u-escapes, IKKE med rå tegn (rå usynlige tegn forsvinner ved kopiering, og et rått U+2028 i et
--    regex er en syntaksfeil). Filen skal ALDRI inneholde rå usynlige tegn: kontroller etter enhver redigering (Write/Edit kan gjøre om \u-escapes til rå tegn).
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
  per_ordre as (
    select k.id,
      count(*) filter (where k.felt = 'ombygging' and k.art = 'teller')::int as okter_ombygging,
      count(*) filter (where k.felt = 'ombygging' and k.art = 'glemt')::int  as okter_ombygging_glemt,
      coalesce(sum(k.varighet_ms) filter (where k.felt = 'ombygging'   and k.art = 'teller'), 0) as ms_ombygging,
      coalesce(sum(k.varighet_ms) filter (where k.felt = 'klargjoring' and k.art = 'teller'), 0) as ms_klargjoring,
      bool_or(k.art = 'apen') as pagaar
    from klassifisert k
    group by k.id
  ),
  rader as (
    select o.id,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.merke, ''),  c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 100)) as merke,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.modell, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 100)) as modell,
      coalesce(nullif(btrim(o.ordre_status), ''), 'ikke_paabegynt') as ordre_status,
      (coalesce(nullif(btrim(o.status), ''), 'aktiv') = 'arkivert') as arkivert,
      round(coalesce(p.ms_ombygging, 0)   / 60000)::bigint as minutter_ombygging,
      coalesce(p.okter_ombygging, 0)                       as okter_ombygging,
      coalesce(p.okter_ombygging_glemt, 0)                 as okter_ombygging_glemt,
      round(coalesce(p.ms_klargjoring, 0) / 60000)::bigint as minutter_klargjoring,
      coalesce(p.pagaar, false) as pagaar,
      case when jsonb_typeof(o.effektiv_tid_frossen->'totalMs') = 'number' and (o.effektiv_tid_frossen->>'totalMs') ~ '^\d{1,15}(\.\d+)?$'
           then round((o.effektiv_tid_frossen->>'totalMs')::numeric / 60000)::bigint end as frossen_effektiv_minutter,
      (p.id is not null) as har_okter
    from public.ordrer o
    left join per_ordre p on p.id = o.id
    where o.ordretype = 'bil'
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'merke', r.merke, 'modell', r.modell, 'ordre_status', r.ordre_status, 'arkivert', r.arkivert, 'hentet', (r.ordre_status = 'hentet'),
        'minutter_ombygging', r.minutter_ombygging, 'okter_ombygging', r.okter_ombygging, 'okter_ombygging_glemt', r.okter_ombygging_glemt,
        'minutter_klargjoring', r.minutter_klargjoring, 'pagaar', r.pagaar, 'frossen_effektiv_minutter', r.frossen_effektiv_minutter
      )
      order by r.merke collate "C", r.modell collate "C", r.ordre_status collate "C", r.minutter_ombygging desc,
               r.okter_ombygging desc, r.minutter_klargjoring desc, r.okter_ombygging_glemt desc, r.pagaar desc,
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
