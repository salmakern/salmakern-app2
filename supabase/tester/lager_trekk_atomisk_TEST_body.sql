-- Test av 20261105110000_lager_trekk_atomisk.sql. ALLTID i en transaksjon som rulles tilbake.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261105110000_lager_trekk_atomisk.sql; cat supabase/tester/lager_trekk_atomisk_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok = true.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_ans record; r jsonb; v_feil text;
  v_o1 text := 'TEST-ordre-1'; v_o2 text := 'TEST-ordre-2';
  v_ops1 text := 'TEST-oppskrift-1'; v_ops_tom text := 'TEST-oppskrift-tom';
  v_v1 text := 'TEST-trekk-vare-1'; v_v2 text := 'TEST-trekk-vare-2';
  v_antall numeric; v_bestilt boolean; v_hist int; v_batch text;
begin
  -- Oppsett: to ordre, to lagervarer, én oppskrift med to ingredienser (én refererer en vare som IKKE finnes), én tom oppskrift (rent arbeid)
  insert into ordrer (id) values (v_o1), (v_o2);
  insert into lagervarer (id, navn, antall, enhet, min_antall) values (v_v1, 'TEST trekk-vare 1', 10, 'stk', 3), (v_v2, 'TEST trekk-vare 2', 5, 'stk', 2);
  insert into lager_oppskrifter (id, navn, biltype, ingredienser, type) values
    (v_ops1, 'TEST Oppskrift 1', 'test', jsonb_build_array(
      jsonb_build_object('vareId', v_v1, 'antall', 3),
      jsonb_build_object('vareId', v_v2, 'antall', 1),
      jsonb_build_object('vareId', 'finnes-ikke-' || v_ops1, 'antall', 1)
    ), 'ombygging'),
    (v_ops_tom, 'TEST Oppskrift uten deler', 'test', '[]'::jsonb, 'ekstra_utstyr');

  -- Logg inn som en eksisterende aktiv admin inne i transaksjonen
  select id, session_token into v_ans from ansatte where aktiv and rolle = 'admin' and id < 990000 order by id limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans.id, 'session_token', v_ans.session_token, 'role', 'authenticated')::text, true);

  -- T1: anonym (ingen innlogget ansatt-claim) avvises
  perform set_config('request.jwt.claims', '{}', true);
  begin perform lager_trekk_oppskrift(v_o1, v_ops1, 'TEST'); insert into _res(navn, ok, info) values ('T1 uinnlogget avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T1 uinnlogget avvises', sqlerrm = 'IKKE_INNLOGGET', sqlerrm); end;
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans.id, 'session_token', v_ans.session_token, 'role', 'authenticated')::text, true);

  -- T2: ukjent ordre / ukjent oppskrift avvises
  begin perform lager_trekk_oppskrift('finnes-ikke', v_ops1, 'TEST'); insert into _res(navn, ok, info) values ('T2 ukjent ordre avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2 ukjent ordre avvises', sqlerrm = 'ORDRE_FINNES_IKKE', sqlerrm); end;
  begin perform lager_trekk_oppskrift(v_o1, 'finnes-ikke', 'TEST'); insert into _res(navn, ok, info) values ('T2 ukjent oppskrift avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2 ukjent oppskrift avvises', sqlerrm = 'OPPSKRIFT_FINNES_IKKE', sqlerrm); end;

  -- T3: trekk fungerer atomisk - beholdning ned, historikk skrevet med batch-id, manglende ingrediens telt men stopper ikke resten
  r := lager_trekk_oppskrift(v_o1, v_ops1, 'TEST Ansatt');
  select antall into v_antall from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T3 vare 1: beholdning 10 -> 7', v_antall = 7, v_antall::text);
  select antall into v_antall from lagervarer where id = v_v2;
  insert into _res(navn, ok, info) values ('T3 vare 2: beholdning 5 -> 4', v_antall = 4, v_antall::text);
  insert into _res(navn, ok, info) values ('T3 svaret sier 1 ikke funnet, 2 trukket', (r->>'ikkeFunnet')::int = 1 and (r->>'antallTrukket')::int = 2, r::text);
  select count(*), max(batch_id) into v_hist, v_batch from lagerhistorikk where ordre_id = v_o1 and oppskrift_id = v_ops1;
  insert into _res(navn, ok, info) values ('T3 to lagerhistorikk-rader med SAMME batch-id', v_hist = 2 and v_batch = (r->>'batchId'), v_batch);
  insert into _res(navn, ok, info) values ('T3 historikk-radene er type ut med ansattnavn og oppskriftens navn', (select bool_and(type='ut' and ansatt_navn='TEST Ansatt' and kommentar='TEST Oppskrift 1') from lagerhistorikk where batch_id = v_batch), null);

  -- T4: idempotens - samme ordre+oppskrift kan IKKE trekkes på nytt (lukker nøyaktig bugen som ga to dobbelttrukne par i ekte data)
  begin perform lager_trekk_oppskrift(v_o1, v_ops1, 'TEST'); insert into _res(navn, ok, info) values ('T4 ny trekk av SAMME ordre+oppskrift avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T4 ny trekk av SAMME ordre+oppskrift avvises', sqlerrm = 'ALLEREDE_TRUKKET', sqlerrm); end;
  select antall into v_antall from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T4 beholdningen er UENDRET etter det avviste forsøket (ikke trukket to ganger)', v_antall = 7, v_antall::text);

  -- T5: samme oppskrift på en ANNEN ordre trekkes helt normalt (sperren er per ordre+oppskrift, ikke global på oppskriften)
  r := lager_trekk_oppskrift(v_o2, v_ops1, 'TEST');
  select antall into v_antall from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T5 samme oppskrift på en annen ordre: beholdning 7 -> 4', v_antall = 4, v_antall::text);

  -- T6: oppskrift uten ingredienser (rent arbeid) er en no-op - ingen historikk, ingen feil
  r := lager_trekk_oppskrift(v_o1, v_ops_tom, 'TEST');
  select count(*) into v_hist from lagerhistorikk where ordre_id = v_o1 and oppskrift_id = v_ops_tom;
  insert into _res(navn, ok, info) values ('T6 tom oppskrift: ingen historikk skrevet, batchId null', v_hist = 0 and r->>'batchId' is null, r::text);

  -- T7: angre reverserer beholdning OG sletter historikken, atomisk
  r := lager_angre_oppskrift_trekk(v_o1, v_ops1);
  select antall into v_antall from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T7 angre vare 1: beholdning 4 -> 7 igjen', v_antall = 7, v_antall::text);
  -- vare 2 er DELT av samme oppskrift på o1 OG o2 (T5 trakk den en gang til: 4 -> 3) - å angre
  -- o1 sin trekk legger tilbake KUN o1 sin andel (1 stk): 3 -> 4, IKKE tilbake til 5.
  select antall into v_antall from lagervarer where id = v_v2;
  insert into _res(navn, ok, info) values ('T7 angre vare 2: beholdning 3 -> 4 (kun o1 sin andel, o2 sitt trekk er fortsatt aktivt)', v_antall = 4, v_antall::text);
  select count(*) into v_hist from lagerhistorikk where ordre_id = v_o1 and oppskrift_id = v_ops1;
  insert into _res(navn, ok, info) values ('T7 historikken er borte etter angre', v_hist = 0, v_hist::text);
  insert into _res(navn, ok, info) values ('T7 svaret sier 2 rader reversert', (r->>'antallRader')::int = 2, r::text);

  -- T8: angre uten noe å angre avvises
  begin perform lager_angre_oppskrift_trekk(v_o1, v_ops1); insert into _res(navn, ok, info) values ('T8 angre uten forutgående trekk avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T8 angre uten forutgående trekk avvises', sqlerrm = 'IKKE_TRUKKET', sqlerrm); end;

  -- T9: etter angre kan DEN SAMME ordren+oppskriften trekkes på nytt (angre+trekk på nytt skal fortsatt virke, bare ikke "trekk to ganger uten å angre")
  r := lager_trekk_oppskrift(v_o1, v_ops1, 'TEST');
  select antall into v_antall from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T9 trekk etter angre virker igjen: beholdning 7 -> 4', v_antall = 4, v_antall::text);

  -- T10: "bestilt" ryddes ved angre når beholdningen krysser opp over minimum OG ingen åpen bestilling finnes
  update lagervarer set antall = 1, bestilt = true where id = v_v1; -- under min_antall (3), merket bestilt
  perform lager_angre_oppskrift_trekk(v_o2, v_ops1); -- legger tilbake 3 stk -> 4, over min_antall (3)
  select antall, bestilt into v_antall, v_bestilt from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T10 bestilt ryddes når beholdningen krysser opp over minimum', v_antall = 4 and not v_bestilt, format('antall=%s bestilt=%s', v_antall, v_bestilt));

  -- T11: "bestilt" IKKE ryddet ved angre hvis en åpen bestilling fortsatt finnes (samme regel som endre_lagervare_antall_batch)
  update lagervarer set antall = 1, bestilt = true where id = v_v1; -- under min_antall (3)
  insert into lager_bestillinger (id, vare_id, antall, leverandor) values ('TEST-trekk-best-1', v_v1, 5, 'TEST Lev'); -- åpen bestilling
  insert into lager_oppskrifter (id, navn, biltype, ingredienser, type) values ('TEST-oppskrift-2', 'TEST Oppskrift 2', 'test', jsonb_build_array(jsonb_build_object('vareId', v_v1, 'antall', 3)), 'ombygging');
  perform lager_trekk_oppskrift(v_o1, 'TEST-oppskrift-2', 'TEST'); -- 1 -> -2
  update lagervarer set antall = 10 where id = v_v1; -- simulerer at varen fylles opp uavhengig av dette trekket/angre
  perform lager_angre_oppskrift_trekk(v_o1, 'TEST-oppskrift-2'); -- legger 3 tilbake -> 13, godt over minimum (3)
  select bestilt into v_bestilt from lagervarer where id = v_v1;
  insert into _res(navn, ok, info) values ('T11 bestilt forblir true ved angre når en åpen bestilling finnes, selv langt over minimum', v_bestilt, v_bestilt::text);
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
