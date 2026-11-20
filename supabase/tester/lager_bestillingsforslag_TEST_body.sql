-- Test av 20261120090000_lager_bestillingsforslag.sql: automatiske bestillingsforslag (cron, AVSLÅTT som standard via
-- innstillinger.lager_forslag_aktiv), godkjenning (kun admin) og avvisning (kun admin).
-- ALLTID i en transaksjon som rulles tilbake: testen setter inn TEST-varer (id-prefiks v_test_lof_, navn "TEST - ...")
-- og TEST-bestillinger, og endrer innstillinger.lager_forslag_aktiv MIDLERTIDIG i SAMME transaksjon (ingen andre
-- sesjoner ser en uncommitted endring, og alt rulles tilbake til slutt - se kjøringen under). Ansatt-radene LESES
-- bare (for å lage innloggingsutsagn med request.jwt.claims, samme mønster som produkt_rettelse_oppskrift_id_TEST_
-- body.sql); ingen ansatt endres.
-- Kjøring (fra rotmappen). Dette er et SKRIVENDE steg mot den delte databasen (create or replace function,
-- cron.schedule, rullet tilbake): bare etter Henriks ja, og ALDRI uten rollback-linjen:
--   ( echo "begin;"; cat supabase/migrations/20261120090000_lager_bestillingsforslag.sql; cat supabase/tester/lager_bestillingsforslag_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader skal være OK.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_admin_id bigint; v_admin_tok text; v_admin_navn text;
  v_ans_id bigint; v_ans_tok text;
  v1 constant text := 'v_test_lof_med_lev';  -- under minimum, leverandør satt, ingen bestilling fra før -> SKAL få forslag
  v2 constant text := 'v_test_lof_uten_lev'; -- under minimum, leverandor = NULL -> skal ALDRI få forslag
  v3 constant text := 'v_test_lof_apen';     -- under minimum, leverandør satt, men har alt en ÅPEN bestilling -> ingen ny
  v4 constant text := 'v_test_lof_over';     -- over minimum (til K16: settes under minimum der) -> ingen forslag ennå
  v5 constant text := 'v_test_lof_tom_lev';  -- under minimum, leverandor = '   ' (blank, ikke null) -> skal ikke få forslag
  r jsonb; v_feil text; v_forslag_v1 text; v_forslag_v4 text; v_n int;
begin
  select id, coalesce(session_token,''), navn into v_admin_id, v_admin_tok, v_admin_navn from public.ansatte where aktiv and rolle='admin' and not flere_enheter order by id limit 1;
  select id, coalesce(session_token,'') into v_ans_id, v_ans_tok from public.ansatte where aktiv and rolle='ansatt' and not flere_enheter order by id limit 1;
  insert into _res(navn, ok, info) values ('Forutsetning: fant en admin og en vanlig ansatt å lage innlogging av',
    v_admin_id is not null and v_ans_id is not null, format('admin=%s ansatt=%s', v_admin_id, v_ans_id));

  -- K1: bryteren finnes riktig (boolean, not null, default false)
  insert into _res(navn, ok, info) select 'K1 innstillinger.lager_forslag_aktiv finnes: boolean, not null, default false',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='innstillinger' and column_name='lager_forslag_aktiv'
      and data_type='boolean' and is_nullable='NO' and column_default='false'), null;
  insert into _res(navn, ok, info) select 'K1b bryteren er AV i databasen akkurat nå (ikke rørt av en tidligere kjøring)',
    not exists (select 1 from innstillinger where id=1 and lager_forslag_aktiv), null;

  insert into public.lagervarer (id, navn, kategori, antall, enhet, min_antall, leverandor) values
    (v1, 'TEST - under min, med leverandør', 'TEST', 1, 'stk', 5, 'TEST Leverandør'),
    (v2, 'TEST - under min, uten leverandør', 'TEST', 1, 'stk', 5, null),
    (v3, 'TEST - under min, åpen bestilling fra før', 'TEST', 1, 'stk', 5, 'TEST Leverandør'),
    (v4, 'TEST - over minimum (for nå)', 'TEST', 50, 'stk', 5, 'TEST Leverandør'),
    (v5, 'TEST - under min, blank leverandørstreng', 'TEST', 1, 'stk', 5, '   ');
  insert into public.lager_bestillinger (id, vare_id, antall, leverandor, status) values ('lb_test_lof_apen', v3, 3, 'TEST Leverandør', 'apen');

  -- K2: AVSLÅTT (default false): ingen forslag genereres for noen av TEST-varene, uansett hvor under minimum de er
  r := public.lager_generer_bestillingsforslag();
  insert into _res(navn, ok, info) select 'K2 avslått (default): svar sier aktiv=false, generert=0, ingen forslagsrad for noen TEST-vare',
    (r->>'aktiv')='false' and (r->>'generert')='0' and not exists (select 1 from lager_bestillinger where vare_id in (v1,v2,v3,v4,v5) and status='forslag'), r::text;

  update public.innstillinger set lager_forslag_aktiv = true where id = 1;

  -- K3: PÅSLÅTT: v1 får forslag; v2 (uten leverandør), v3 (åpen fra før), v4 (over minimum) og v5 (blank leverandør) gjør IKKE
  r := public.lager_generer_bestillingsforslag();
  insert into _res(navn, ok, info) select 'K3 påslått: svar sier aktiv=true, v1 er med i vareIder',
    (r->>'aktiv')='true' and (r->'vareIder') @> jsonb_build_array(v1), r::text;

  select id into v_forslag_v1 from lager_bestillinger where vare_id = v1 and status = 'forslag';
  insert into _res(navn, ok, info) select 'K4 forslagsraden: antall=4 (5 minus 1), ukjent_antall=false, leverandør kopiert fra varen, status=forslag',
    exists (select 1 from lager_bestillinger where id=v_forslag_v1 and antall=4 and not ukjent_antall and leverandor='TEST Leverandør' and status='forslag'), null;
  insert into _res(navn, ok, info) select 'K5 varen er merket bestilt=true etter forslaget (hindrer dobbel manuell registrering)', (select bestilt from lagervarer where id=v1), null;
  insert into _res(navn, ok, info) select 'K6 v2 (uten leverandør) fikk ALDRI noe forslag eller bestilling', not exists (select 1 from lager_bestillinger where vare_id = v2), null;
  insert into _res(navn, ok, info) select 'K7 v5 (blank leverandørstreng) fikk ALDRI noe forslag', not exists (select 1 from lager_bestillinger where vare_id = v5), null;
  insert into _res(navn, ok, info) select 'K8 v3 fikk ikke et NYTT forslag (hadde allerede en åpen bestilling) - fortsatt bare 1 rad', (select count(*) from lager_bestillinger where vare_id = v3) = 1, null;
  insert into _res(navn, ok, info) select 'K9 v4 (over minimum) fikk ikke noe forslag ennå', not exists (select 1 from lager_bestillinger where vare_id = v4), null;

  -- K10: kjøres på nytt samme dag (idempotent) - v1 har alt et forslag, ingen ny rad for den
  r := public.lager_generer_bestillingsforslag();
  insert into _res(navn, ok, info) select 'K10 ny kjøring: v1 får IKKE et nytt/ekstra forslag (fortsatt nøyaktig 1 rad)', (select count(*) from lager_bestillinger where vare_id = v1) = 1, r::text;

  -- Godkjenning/avvisning: uten innlogging
  perform set_config('request.jwt.claims', '', true);
  begin perform public.lager_godkjenn_bestillingsforslag(v_forslag_v1, 'Noen'); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) select 'K11 godkjenn uten innlogging: KUN_ADMIN', v_feil = 'KUN_ADMIN', v_feil;
  begin perform public.lager_avvis_bestillingsforslag(v_forslag_v1); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) select 'K12 avvis uten innlogging: KUN_ADMIN', v_feil = 'KUN_ADMIN', v_feil;

  -- Godkjenning/avvisning: innlogget som VANLIG ansatt (ikke admin) - skal også avvises
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans_id, 'session_token', v_ans_tok)::text, true);
  begin perform public.lager_godkjenn_bestillingsforslag(v_forslag_v1, 'Ansatt'); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) select 'K13 godkjenn som vanlig ansatt: KUN_ADMIN (bare admin godkjenner)', v_feil = 'KUN_ADMIN', v_feil;
  begin perform public.lager_avvis_bestillingsforslag(v_forslag_v1); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) select 'K14 avvis som vanlig ansatt: KUN_ADMIN', v_feil = 'KUN_ADMIN', v_feil;
  insert into _res(navn, ok, info) select 'K15 forslaget står fortsatt som forslag etter begge avslåtte forsøk', (select status from lager_bestillinger where id=v_forslag_v1) = 'forslag', null;

  -- Godkjenning: som admin
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin_id, 'session_token', v_admin_tok)::text, true);
  r := public.lager_godkjenn_bestillingsforslag(v_forslag_v1, v_admin_navn);
  insert into _res(navn, ok, info) select 'K16 admin godkjenner: svar har riktig vareId', (r->>'vareId') = v1, r::text;
  insert into _res(navn, ok, info) select 'K17 raden er nå en ekte ÅPEN bestilling (bestilt_av=admins navn, bestilt_dato satt, antall uendret)',
    exists (select 1 from lager_bestillinger where id=v_forslag_v1 and status='apen' and bestilt_av=v_admin_navn and bestilt_dato is not null and antall=4), null;

  -- Godkjenne en rad som IKKE lenger er et forslag (alt godkjent) og en ukjent id
  begin perform public.lager_godkjenn_bestillingsforslag(v_forslag_v1, v_admin_navn); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) select 'K18 godkjenne en allerede godkjent rad på nytt: IKKE_FORSLAG', v_feil = 'IKKE_FORSLAG', v_feil;
  begin perform public.lager_godkjenn_bestillingsforslag('lb_finnes_ikke_test', v_admin_navn); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) select 'K19 ukjent id ved godkjenning: FORSLAG_FINNES_IKKE', v_feil = 'FORSLAG_FINNES_IKKE', v_feil;

  -- Avvisning: gjør v4 under minimum, generer et nytt forslag for DEN, og avvis det
  update public.lagervarer set antall = 1 where id = v4;
  r := public.lager_generer_bestillingsforslag();
  select id into v_forslag_v4 from lager_bestillinger where vare_id = v4 and status = 'forslag';
  insert into _res(navn, ok, info) select 'K20 v4 (nå under minimum) fikk et nytt forslag', v_forslag_v4 is not null, r::text;

  r := public.lager_avvis_bestillingsforslag(v_forslag_v4);
  insert into _res(navn, ok, info) select 'K21 avvisning som admin: svar sier bestilt=false, raden er slettet (var aldri en ekte bestilling)',
    (r->>'bestilt')='false' and not exists (select 1 from lager_bestillinger where id=v_forslag_v4), r::text;
  insert into _res(navn, ok, info) select 'K22 varen er ikke lenger merket bestilt etter avvisningen', not (select bestilt from lagervarer where id=v4), null;

  -- Dagen etter (fortsatt under minimum, ingen bestilling): foreslås på nytt - bevisst, se toppkommentaren i migrasjonen
  r := public.lager_generer_bestillingsforslag();
  insert into _res(navn, ok, info) select 'K23 v4 foreslås på nytt neste kjøring (fortsatt under minimum, ingen åpen/forslag igjen)',
    exists (select 1 from lager_bestillinger where vare_id = v4 and status = 'forslag'), r::text;

  -- Avvise noe som ikke er et forslag (v1 er nå 'apen', ikke 'forslag')
  begin perform public.lager_avvis_bestillingsforslag(v_forslag_v1); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) select 'K24 avvise en rad som er apen (ikke forslag): IKKE_FORSLAG', v_feil = 'IKKE_FORSLAG', v_feil;
  begin perform public.lager_avvis_bestillingsforslag('lb_finnes_ikke_test'); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) select 'K25 avvise en ukjent id: FORSLAG_FINNES_IKKE', v_feil = 'FORSLAG_FINNES_IKKE', v_feil;

  -- CHECK-regelen på status
  insert into _res(navn, ok, info) select 'K26 CHECK på status inneholder forslag, i tillegg til apen/mottatt/kansellert',
    (select pg_get_constraintdef(oid) from pg_constraint where conname='lager_bestillinger_status_check') ~ 'forslag', null;

  -- Rettigheter: generer-funksjonen kan BARE kjøres av cron/postgres (revoke fra public/anon/authenticated); godkjenn/avvis er åpne for anon/authenticated (den egentlige sperren er admin-sjekken inni)
  insert into _res(navn, ok, info) select 'K27 lager_generer_bestillingsforslag(): anon og authenticated kan IKKE kjøre den',
    not has_function_privilege('anon', 'public.lager_generer_bestillingsforslag()', 'execute')
    and not has_function_privilege('authenticated', 'public.lager_generer_bestillingsforslag()', 'execute'), null;
  insert into _res(navn, ok, info) select 'K28 lager_godkjenn_bestillingsforslag/lager_avvis_bestillingsforslag: authenticated KAN kjøre dem (admin-sjekken er inni funksjonen)',
    has_function_privilege('authenticated', 'public.lager_godkjenn_bestillingsforslag(text,text,numeric,date)', 'execute')
    and has_function_privilege('authenticated', 'public.lager_avvis_bestillingsforslag(text)', 'execute'), null;
  insert into _res(navn, ok, info) select 'K29 alle tre funksjonene er security definer', (select bool_and(p.prosecdef) from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname in ('lager_generer_bestillingsforslag','lager_godkjenn_bestillingsforslag','lager_avvis_bestillingsforslag')), null;

  -- Cron-jobben
  insert into _res(navn, ok, info) select 'K30 cron-jobben «lager-bestillingsforslag-kl-0630» er lagt inn, kl. 04:30/05:30 UTC (06:30 Oslo), kaller lager_generer_bestillingsforslag()',
    exists (select 1 from cron.job where jobname='lager-bestillingsforslag-kl-0630' and schedule='30 4,5 * * *' and command ~ 'lager_generer_bestillingsforslag'), null;
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
