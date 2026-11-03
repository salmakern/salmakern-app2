-- Test av 20261103200000_lager_hyller_og_bestillinger.sql. ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, og ingen åpen app ser noe (realtime sender først ved commit).
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261103200000_lager_hyller_og_bestillinger.sql; cat supabase/tester/lager_hyller_og_bestillinger_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok = true.
-- RPC-ene krever en innlogget ansatt: testen logger inn som en eksisterende admin INNE I transaksjonen (JWT-claims settes lokalt; token leses og brukes bare i databasen).

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_n int; v_ans record; r jsonb; v_feil text; v_v1 text := 'TEST-vare-1'; v_v2 text := 'TEST-vare-2'; v_h text := 'TEST-hylle-1'; v_antall numeric; v_bestilt boolean; v_hist int; v_kom text;
begin
  -- T1: eksisterende varer er urørt
  select count(*) into v_n from lagervarer where hylle_id is not null;
  insert into _res(navn, ok, info) values ('T1 ingen eksisterende vare har fått en hylle', v_n = 0, v_n::text);

  -- T2: hylle-regler
  insert into lager_hyller (id, kode, navn) values (v_h, 'A1', 'TEST hylle');
  begin insert into lager_hyller (id, kode) values ('TEST-hylle-2', 'a1'); insert into _res(navn, ok, info) values ('T2 samme kode med andre store/små bokstaver avvises', false, 'ingen feil');
  exception when unique_violation then insert into _res(navn, ok, info) values ('T2 samme kode med andre store/små bokstaver avvises', true, null); end;
  begin insert into lager_hyller (id, kode) values ('TEST-hylle-3', 'A 1!'); insert into _res(navn, ok, info) values ('T2 ugyldig kode (mellomrom/tegn) avvises', false, 'ingen feil');
  exception when check_violation then insert into _res(navn, ok, info) values ('T2 ugyldig kode (mellomrom/tegn) avvises', true, null); end;
  begin insert into lager_hyller (id, kode) values ('TEST-hylle-4', repeat('X', 21)); insert into _res(navn, ok, info) values ('T2 for lang kode (21 tegn) avvises', false, 'ingen feil');
  exception when check_violation then insert into _res(navn, ok, info) values ('T2 for lang kode (21 tegn) avvises', true, null); end;

  -- T3: vare på hylle, og hylla kan slettes uten å slette varen
  insert into lagervarer (id, navn, antall, enhet, min_antall, hylle_id) values (v_v1, 'TEST vare 1', 2, 'stk', 5, v_h), (v_v2, 'TEST vare 2', 10, 'stk', 5, null);
  delete from lager_hyller where id = v_h;
  select count(*) into v_n from lagervarer where id = v_v1 and hylle_id is null;
  insert into _res(navn, ok, info) values ('T3 hylle slettet: varen står igjen, uten hylle', v_n = 1, v_n::text);

  -- T4: bestillings-regler
  begin insert into lager_bestillinger (id, vare_id, antall) values ('TEST-b-0', v_v1, 0); insert into _res(navn, ok, info) values ('T4 antall 0 uten «ukjent antall» avvises', false, 'ingen feil');
  exception when check_violation then insert into _res(navn, ok, info) values ('T4 antall 0 uten «ukjent antall» avvises', true, null); end;
  begin insert into lager_bestillinger (id, vare_id, antall, status) values ('TEST-b-x', v_v1, 3, 'ukjent'); insert into _res(navn, ok, info) values ('T4 ukjent status avvises', false, 'ingen feil');
  exception when check_violation then insert into _res(navn, ok, info) values ('T4 ukjent status avvises', true, null); end;

  -- Logg inn som en eksisterende aktiv admin inne i transaksjonen
  select id, session_token into v_ans from ansatte where aktiv and rolle = 'admin' and id < 990000 order by id limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans.id, 'session_token', v_ans.session_token, 'role', 'authenticated')::text, true);

  -- T5: registrer to bestillinger (én med kjent og én med ukjent antall) på vare 1
  r := lager_registrer_bestillinger(jsonb_build_array(
    jsonb_build_object('id', 'TEST-b-1', 'vareId', v_v1, 'antall', 10, 'leverandor', 'TEST Lev', 'forventetDato', '2026-12-01', 'bestiltAv', 'TEST'),
    jsonb_build_object('id', 'TEST-b-2', 'vareId', v_v1, 'ukjentAntall', true, 'leverandor', 'TEST Lev 2')));
  select bestilt into v_bestilt from lagervarer where id = v_v1;
  select count(*) into v_n from lager_bestillinger where vare_id = v_v1 and status = 'apen';
  insert into _res(navn, ok, info) values ('T5 to åpne bestillinger er lagt inn og varen er merket bestilt', v_n = 2 and v_bestilt, v_n::text);
  insert into _res(navn, ok, info) values ('T5 «ukjent antall» lagres med antall 0', (select antall = 0 and ukjent_antall from lager_bestillinger where id = 'TEST-b-2'), null);

  -- T6: ugyldig innlegging avvises (ingenting lagt inn, ingen halv tilstand)
  begin perform lager_registrer_bestillinger(jsonb_build_array(jsonb_build_object('id', 'TEST-b-3', 'vareId', v_v2, 'antall', 0))); insert into _res(navn, ok, info) values ('T6 antall 0 uten ukjent antall avvises av RPC-en', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T6 antall 0 uten ukjent antall avvises av RPC-en', sqlerrm = 'UGYLDIG_ANTALL', sqlerrm); end;
  begin perform lager_registrer_bestillinger(jsonb_build_array(jsonb_build_object('id', 'TEST-b-4', 'vareId', 'finnes-ikke', 'antall', 1))); insert into _res(navn, ok, info) values ('T6 ukjent vare avvises', false, 'ingen feil');
  exception when foreign_key_violation then insert into _res(navn, ok, info) values ('T6 ukjent vare avvises', true, null); end;
  begin perform lager_registrer_bestillinger('[]'::jsonb); insert into _res(navn, ok, info) values ('T6 tom liste avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T6 tom liste avvises', sqlerrm = 'INGEN_BESTILLINGER', sqlerrm); end;

  -- T7: mottak av den ene (mindre enn bestilt): beholdning opp, lukket, historikk med mangel, og varen er FORTSATT bestilt (den andre er åpen)
  r := lager_motta_bestilling('TEST-b-1', 6, 'TEST Mottaker', 'Mottatt fra lager');
  select antall, bestilt into v_antall, v_bestilt from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T7 mottak: beholdning økte fra 2 til 8', v_antall = 8, v_antall::text);
  insert into _res(navn, ok, info) values ('T7 svaret sier forventet 10, mottatt 6, mangler 4', (r->>'forventet')::numeric = 10 and (r->>'mottatt')::numeric = 6 and (r->>'mangler')::numeric = 4, r::text);
  insert into _res(navn, ok, info) values ('T7 varen er fortsatt bestilt (en annen bestilling er åpen)', v_bestilt and (r->>'bestilt')::boolean, null);
  select count(*), max(kommentar) into v_hist, v_kom from lagerhistorikk where vare_id = v_v1;
  insert into _res(navn, ok, info) values ('T7 én lagerhistorikk-rad (inn, 6) med manglende-tekst', v_hist = 1 and v_kom like '%Forventet 10%mottatt 6%mangler 4%' and (select endring = 6 and type = 'inn' from lagerhistorikk where vare_id = v_v1), v_kom);
  insert into _res(navn, ok, info) values ('T7 bestillingen er lukket med mottatt antall og mottaker', (select status = 'mottatt' and mottatt_antall = 6 and mottatt_av = 'TEST Mottaker' and mottatt_at is not null from lager_bestillinger where id = 'TEST-b-1'), null);

  -- T8: samme bestilling kan ikke mottas to ganger
  begin perform lager_motta_bestilling('TEST-b-1', 6, 'TEST'); insert into _res(navn, ok, info) values ('T8 en lukket bestilling kan ikke mottas på nytt', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T8 en lukket bestilling kan ikke mottas på nytt', sqlerrm = 'IKKE_APEN', sqlerrm); end;
  select antall into v_antall from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T8 beholdningen er uendret etter forsøket', v_antall = 8, v_antall::text);

  -- T9: mottak av bestilling med ukjent antall: ingen mangel, og siste åpne bestilling lukket gir bestilt = false
  r := lager_motta_bestilling('TEST-b-2', 4, 'TEST', '');
  select antall, bestilt into v_antall, v_bestilt from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T9 ukjent antall: ingen mangel, beholdning 12, og varen er ikke lenger bestilt', (r->>'mangler')::numeric = 0 and v_antall = 12 and not v_bestilt, r::text);

  -- T10: kansellering, og mottak av 0 (ingenting kom) uten historikkrad
  perform lager_registrer_bestillinger(jsonb_build_array(jsonb_build_object('id', 'TEST-b-5', 'vareId', v_v2, 'antall', 3)));
  r := lager_kanseller_bestilling('TEST-b-5');
  select bestilt, antall into v_bestilt, v_antall from lagervarer where id = v_v2;
  insert into _res(navn, ok, info) values ('T10 kansellert: ingen beholdningsendring, og varen er ikke lenger bestilt', not v_bestilt and v_antall = 10 and (select status = 'kansellert' from lager_bestillinger where id = 'TEST-b-5'), r::text);
  perform lager_registrer_bestillinger(jsonb_build_array(jsonb_build_object('id', 'TEST-b-6', 'vareId', v_v2, 'antall', 3)));
  perform lager_motta_bestilling('TEST-b-6', 0, 'TEST');
  select count(*) into v_hist from lagerhistorikk where vare_id = v_v2;
  insert into _res(navn, ok, info) values ('T10 mottak av 0: ingen lagerhistorikk-rad og beholdningen er uendret', v_hist = 0 and (select antall = 10 from lagervarer where id = v_v2), v_hist::text);

  -- T11: den eksisterende atomiske lagerendringen nullstiller IKKE bestilt mens en bestilling er åpen (selv over minimum), men gjør det når ingen er åpen
  perform lager_registrer_bestillinger(jsonb_build_array(jsonb_build_object('id', 'TEST-b-7', 'vareId', v_v1, 'antall', 5)));
  perform endre_lagervare_antall_batch(jsonb_build_array(jsonb_build_object('vareId', v_v1, 'endring', 10)));
  select bestilt, antall into v_bestilt, v_antall from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T11 over minimum men med åpen bestilling: fortsatt bestilt', v_bestilt and v_antall = 22, v_antall::text);
  perform lager_kanseller_bestilling('TEST-b-7');
  perform endre_lagervare_antall_batch(jsonb_build_array(jsonb_build_object('vareId', v_v1, 'endring', 1)));
  select bestilt into v_bestilt from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T11 uten åpen bestilling og over minimum: bestilt nullstilles som før', not v_bestilt, null);
  update lagervarer set antall = 1, bestilt = true where id = v_v2;
  perform endre_lagervare_antall_batch(jsonb_build_array(jsonb_build_object('vareId', v_v2, 'endring', -0)));
  select bestilt into v_bestilt from lagervarer where id = v_v2;
  insert into _res(navn, ok, info) values ('T11 under minimum uten åpen bestilling: bestilt beholdes (som før)', v_bestilt, null);

  -- T12: krever innlogget ansatt
  perform set_config('request.jwt.claims', '', true);
  begin perform lager_motta_bestilling('TEST-b-6', 1, 'X'); insert into _res(navn, ok, info) values ('T12 uten innlogging avvises RPC-ene', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T12 uten innlogging avvises RPC-ene', sqlerrm = 'IKKE_INNLOGGET', sqlerrm); end;

  -- T13: RLS og Realtime
  insert into _res(navn, ok, info) values ('T13 RLS er på for begge tabellene og policy finnes', (select count(*) from pg_policy where polrelid in ('public.lager_hyller'::regclass, 'public.lager_bestillinger'::regclass) and polname = 'krever_innlogget_ansatt') = 2
    and (select bool_and(relrowsecurity) from pg_class where oid in ('public.lager_hyller'::regclass, 'public.lager_bestillinger'::regclass)), null);
  insert into _res(navn, ok, info) values ('T13 begge tabellene er med i Realtime-publikasjonen', (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('lager_hyller', 'lager_bestillinger')) = 2, null);
end;
$test$;

select n, navn, ok, info from _res order by n;
