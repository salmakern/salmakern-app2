-- Test av 20261116120000_portal_timer_fakta.sql. ALLTID i en transaksjon som rulles tilbake: testen setter inn TEST-ordrer (id-prefiks ord_test_tim_, merke TESTTIM...,
-- scenarioet står i modellfeltet: «T01 teller», «T13 ugyldig» osv.) - alt rulles tilbake og rører aldri ekte data. Svaret har ingen id, så testradene finnes igjen på merke og
-- modell; de ekte radene i svaret telles bare (og kontrolleres for form), aldri vist. Ingen UPDATE på ordrer (triggerne «ordre-push», «ordre-status-*» og «ordre-frakt-forbered»
-- er AFTER UPDATE; ingen trigger finnes på INSERT): radene settes inn med riktige verdier fra starten. Tegnene som skal fjernes bygges med chr(...) (aldri rå usynlige tegn i filen).
-- Kjøring (fra rotmappen). Dette er et SKRIVENDE steg (midlertidige funksjoner, tabeller og rader i en transaksjon): krever Henriks ja, og ikke mellom 00:00 og 03:00:
--   ( echo "begin;"; cat supabase/migrations/20261116120000_portal_timer_fakta.sql; cat supabase/tester/portal_timer_fakta_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader skal være OK. Etterpå: to_regprocedure('public.portal_timer_fakta()') er fortsatt null (transaksjonen ble rullet tilbake).

create temp table _res (n serial, navn text, ok boolean, info text);
create temp table _all (pos int, j jsonb);                   -- ALLE rader i svaret fra siste hovedkall, i svarets rekkefølge (ekte rader brukes bare til formsjekker)
create temp table _r (modell text, j jsonb);                 -- TEST-radene (merke som begynner på TESTTIM), per modell-etikett
create temp table _cp (n int primary key, cp int not null);  -- de 92 tegnene som skal fjernes fra merke/modell (kodepunkter)
create temp table _sc (
  n serial, merke text default 'TESTTIM', modell text, ordretype text default 'bil', ordre_status text default 'ikke_paabegynt', status text default 'aktiv',
  omb jsonb default '[]'::jsonb, klarg jsonb default '[]'::jsonb, frossen jsonb, kunde text default '', chassis text default '', eier text default ''
);

insert into _cp (n, cp)
select (row_number() over (order by cp))::int, cp from (
  select generate_series(1, 8) as cp                      -- U+0001-U+0008
  union all select 11 union all select 12                -- U+000B, U+000C (tab, linjeskift og CR er IKKE i settet)
  union all select generate_series(14, 31)                -- U+000E-U+001F
  union all select generate_series(127, 159)              -- DEL og C1: U+007F-U+009F
  union all select 173                                    -- U+00AD (myk bindestrek)
  union all select generate_series(8203, 8207)            -- U+200B-U+200F
  union all select generate_series(8234, 8238)            -- U+202A-U+202E
  union all select generate_series(8288, 8303)            -- U+2060-U+206F
  union all select 65279                                  -- U+FEFF
  union all select generate_series(65529, 65531)          -- U+FFF9-U+FFFB
) s;

-- Én økt: start = 1790000000000 + forskyvning (ms), varighet i ms, ansatt-id (navn «TESTANSATT <id>»), valgfri autoStopp. jsonb_strip_nulls fjerner autoStopp når den er null.
create function pg_temp.okt(p_forskyvning bigint, p_varighet bigint, p_ansatt int default 1, p_auto text default null) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('start', 1790000000000 + p_forskyvning, 'stopp', 1790000000000 + p_forskyvning + p_varighet,
                                              'ansattId', p_ansatt, 'ansatt', 'TESTANSATT ' || p_ansatt, 'autoStopp', p_auto))
$$;
-- Forventet rad: standardverdier (en bil uten tid) overstyrt av det scenarioet skal avvike på. Sammenlignes med raden UTEN merke og modell (de er etiketten).
create function pg_temp.forv(p jsonb default '{}'::jsonb) returns jsonb language sql immutable as $$
  select '{"ordre_status":"ikke_paabegynt","arkivert":false,"hentet":false,"minutter_ombygging":0,"okter_ombygging":0,"okter_ombygging_glemt":0,"minutter_klargjoring":0,"pagaar":false,"frossen_effektiv_minutter":null}'::jsonb || p
$$;
create function pg_temp.rad(p_modell text) returns jsonb language sql stable as $$ select j - 'merke' - 'modell' from _r where modell = p_modell $$;
create function pg_temp.sjekk(p_navn text, p_ok boolean, p_info text default null) returns void language sql as $$
  insert into _res(navn, ok, info) values (p_navn, coalesce(p_ok, false), p_info)
$$;

-- ===== Scenarioer =====
-- Tid som teller, summering og avrunding
insert into _sc (modell, omb, klarg) values
  ('T01 teller',            jsonb_build_array(pg_temp.okt(0, 3600000, 1), pg_temp.okt(0, 5400000, 1)), '[]'),
  ('T02 samtidig',          jsonb_build_array(pg_temp.okt(0, 7200000, 1), pg_temp.okt(0, 7200000, 2)), '[]'),
  ('T03 rund sum',          jsonb_build_array(pg_temp.okt(0, 30000), pg_temp.okt(100000, 30000), pg_temp.okt(200000, 30000)), '[]'),
  ('T04 rund ned',          jsonb_build_array(pg_temp.okt(0, 29999)), jsonb_build_array(pg_temp.okt(0, 90000))),
  ('T05 klarg rund sum',    '[]', jsonb_build_array(pg_temp.okt(0, 30000), pg_temp.okt(100000, 30000), pg_temp.okt(200000, 30000))),
  ('T20 begge klokker',     jsonb_build_array(pg_temp.okt(0, 3600000)), jsonb_build_array(pg_temp.okt(0, 1800000)));
-- Glemt og over 14 timer
insert into _sc (modell, omb, klarg) values
  ('T06 glemt',             jsonb_build_array(pg_temp.okt(0, 3600000, 1), pg_temp.okt(0, 50400000, 2, 'glemt')), '[]'),
  ('T07 over 14t',          jsonb_build_array(pg_temp.okt(0, 50400001), pg_temp.okt(0, 349200000), pg_temp.okt(0, 50400000)), '[]'),
  ('T08 glemt kort',        jsonb_build_array(pg_temp.okt(0, 3600000, 1, 'glemt')), '[]'),
  ('T09 ikke stemplet',     jsonb_build_array(pg_temp.okt(0, 3600000, 1, 'ikke_stemplet_inn'), pg_temp.okt(0, 3600000, 1, 'noe annet')), '[]'),
  ('T09b autoStopp true',   jsonb_build_array(pg_temp.okt(0, 3600000) || '{"autoStopp":true}'::jsonb), '[]'),
  ('T09c autoStopp GLEMT',  jsonb_build_array(pg_temp.okt(0, 3600000) || '{"autoStopp":"GLEMT"}'::jsonb), '[]'),
  ('T19 glemt klargjoring', '[]', jsonb_build_array(pg_temp.okt(0, 3600000), pg_temp.okt(0, 50400000, 1, 'glemt'), pg_temp.okt(0, 60000000)));
-- Åpne økter
insert into _sc (modell, omb, klarg) values
  ('T10 apen',              jsonb_build_array(pg_temp.okt(0, 3600000)) || '[{"start":1790000100000,"stopp":null,"ansattId":3}]'::jsonb, '[]'),
  ('T11 apen klargjoring',  '[]', '[{"start":1790000000000,"stopp":null}]'::jsonb),
  ('T12 apen uten stopp',   '[{"start":1790000000000}]'::jsonb, '[]');
-- Ugyldige økter: hoppes over uten feil. Den ene gyldige (60 min) er alt som teller.
insert into _sc (modell, omb, klarg) values
  ('T13 ugyldig', jsonb_build_array(pg_temp.okt(0, 3600000)) ||
     '[{"start":"abc","stopp":1790000100000},{"start":1790000000000,"stopp":"x"},{"start":null,"stopp":5},{"start":-5,"stopp":10},{"start":1790000000000,"stopp":-1},
       {"start":"1790000000000","stopp":1790000100000},{"start":1790000000000.5,"stopp":1790000100000},{"start":1e20,"stopp":1e21},42,"tekst",null,[1,2],{},
       {"stopp":1790000100000},{"start":true,"stopp":false},{"start":1790000000000,"stopp":{"a":1}}]'::jsonb, '[]'),
  ('T17 null og negativ',   jsonb_build_array(pg_temp.okt(0, 3600000)) || '[{"start":1790000000010,"stopp":1790000000010},{"start":1790000000020,"stopp":1790000000005}]'::jsonb, '[]'),
  ('T18 bare null varighet', '[{"start":1790000000000,"stopp":1790000000000}]'::jsonb, '[]');
-- Ingen rad: bare ugyldig, ikke liste, tom
insert into _sc (modell, omb, klarg) values
  ('T14 bare ugyldig',      '[{"start":"abc","stopp":5},42,null,"x",{"start":-1,"stopp":5}]'::jsonb, '[]'),
  ('T15 ikke liste',        '{"a":1}'::jsonb, '"x"'::jsonb),
  ('T16 tom',               '[]', '[]');
insert into _sc (modell, omb, klarg) values ('T15b null liste', null, '[]');
-- Frossen effektiv tid
insert into _sc (modell, frossen) values
  ('T21 frossen',           '{"totalMs":28800000,"perAnsatt":{"1":28800000},"frossetVed":"2026-11-10T10:00:00.000Z"}'),
  ('T22 frossen rund',      '{"totalMs":90000}'),
  ('T23 frossen desimal opp', '{"totalMs":30000.5}'),
  ('T23b frossen desimal ned', '{"totalMs":29999.5}'),
  ('T25a frossen tekst',    '{"totalMs":"123"}'),
  ('T25b frossen negativ',  '{"totalMs":-5}'),
  ('T25c frossen tomt obj', '{}'),
  ('T25d frossen liste',    '[]'),
  ('T25e frossen streng',   '"x"'),
  ('T25f frossen null tall', '{"totalMs":null}'),
  ('T25g frossen for stor', '{"totalMs":1e20}'),
  ('T25h frossen bool',     '{"totalMs":true}');
insert into _sc (modell, omb, frossen) values
  ('T24 frossen json-null', jsonb_build_array(pg_temp.okt(0, 3600000)), 'null'::jsonb),
  ('T26 frossen og okter',  jsonb_build_array(pg_temp.okt(0, 3600000)), '{"totalMs":3000000}');
-- Status, arkivert, hentet
insert into _sc (modell, ordre_status, status, omb, frossen) values
  ('T40 hentet arkivert',   'hentet', 'arkivert', '[]', '{"totalMs":60000}'),
  ('T41 null status',       null, null, jsonb_build_array(pg_temp.okt(0, 3600000)), null),
  ('T42 blank status',      '   ', '', jsonb_build_array(pg_temp.okt(0, 3600000)), null),
  ('T43 polstret status',   '  hentet  ', ' arkivert ', jsonb_build_array(pg_temp.okt(0, 3600000)), null),
  ('T44 paabegynt aktiv',   'paabegynt', 'aktiv', jsonb_build_array(pg_temp.okt(0, 3600000)), null),
  ('T46 annen status',      'paabegynt', 'utkast', jsonb_build_array(pg_temp.okt(0, 3600000)), null);
insert into _sc (modell, ordre_status, omb)
select 'T45 ' || s, s, jsonb_build_array(pg_temp.okt(0, 60000))
from unnest(array['paa_vei', 'ikke_paabegynt', 'paabegynt', 'ikke_veid', 'klar_visning', 'vist_biltilsyn', 'klar_henting', 'hentet']) s;
-- Ordretype leveranse gir ingen rad, selv med økter og frossen tid
insert into _sc (modell, ordretype, omb, frossen) values
  ('T50 leveranse', 'leveranse', jsonb_build_array(pg_temp.okt(0, 3600000)), '{"totalMs":60000}');
-- Ingen id, chassis, kunde, kontaktperson eller ansattnavn i svaret
insert into _sc (modell, omb, klarg, kunde, chassis, eier) values
  ('T60 privat', jsonb_build_array(pg_temp.okt(0, 3600000, 7)), jsonb_build_array(pg_temp.okt(0, 1800000, 8)), 'TESTKUNDE-HEMMELIG', 'TESTCHASSIS00000001', 'TESTEIER-HEMMELIG');
-- Rensing av merke og modell: det skitne merket renses til nøyaktig «TESTTIM» (så raden finnes igjen), og modellen til etiketten
insert into _sc (merke, modell, frossen) values
  (chr(8203) || chr(9) || ' TESTTIM' || chr(160) || chr(8232) || chr(10), 'T70 ' || chr(8203) || chr(160) || '  rens ' || chr(9), '{"totalMs":60000}'),
  ('TESTTIM' || repeat('q', 200), 'T72 ' || repeat('x', 200), '{"totalMs":60000}'),
  ('TESTTIM', 'T73 ' || repeat('a', 95) || ' bbb', '{"totalMs":60000}'),
  ('TESTTIM', 'T75 ' || chr(198) || chr(216) || chr(197) || chr(230) || chr(248) || chr(229), '{"totalMs":60000}');
insert into _sc (merke, modell, ordre_status, frossen) values (null, null, 'test_tom_tim', '{"totalMs":60000}');
-- De 92 tegnene, ett om gangen (i både merke og modell, med bokstaver på begge sider i modellen)
insert into _sc (merke, modell, frossen)
select 'TESTTIM' || chr(cp), 'T71 ' || lpad(n::text, 3, '0') || 'a' || chr(cp) || 'b', '{"totalMs":60000}' from _cp;
-- Sortering: modell stigende, status stigende, minutter synkende; «C»-rekkefølge (stor bokstav før liten); likt på alle fire nøkler -> øvrige tall
insert into _sc (modell, ordre_status, omb) values
  ('T80 b', 'hentet',       jsonb_build_array(pg_temp.okt(0, 6000000))),
  ('T80 a', 'klar_henting', jsonb_build_array(pg_temp.okt(0, 600000))),
  ('T80 a', 'hentet',       jsonb_build_array(pg_temp.okt(0, 300000))),
  ('T80 a', 'hentet',       jsonb_build_array(pg_temp.okt(0, 3000000)));
insert into _sc (merke, modell, omb) values
  ('TESTTIMa', 'T81 x', jsonb_build_array(pg_temp.okt(0, 60000))),
  ('TESTTIMB', 'T81 x', jsonb_build_array(pg_temp.okt(0, 60000))),
  ('TESTTIM',  'T81 x', jsonb_build_array(pg_temp.okt(0, 60000)));
insert into _sc (modell, omb, klarg) values
  ('T82 tie', jsonb_build_array(pg_temp.okt(0, 3600000)), '[]'),                                                  -- 60 min, 1 økt, 0 klargjøring
  ('T82 tie', jsonb_build_array(pg_temp.okt(0, 1800000), pg_temp.okt(0, 1800000)), '[]'),                         -- 60 min, 2 økter
  ('T82 tie', jsonb_build_array(pg_temp.okt(0, 3600000)), jsonb_build_array(pg_temp.okt(0, 1800000)));            -- 60 min, 1 økt, 30 min klargjøring

insert into public.ordrer (id, ordretype, merke, modell, ordre_status, status, ordre_timer_sessions, klargjoring_timer_sessions, effektiv_tid_frossen, kunde, chassis, eier)
select 'ord_test_tim_' || lpad(n::text, 5, '0'), ordretype, merke, modell, ordre_status, status, omb, klarg, frossen, kunde, chassis, eier from _sc;

do $test$
declare
  r jsonb; r2 jsonb; v_n int; v_n2 int; v_o1 int; v_o2 int; v_o3 int; v_tekst text; v_ok boolean;
begin
  -- ===== S1 Bare service_role kan kalle funksjonen =====
  perform pg_temp.sjekk('S1 bare service_role har kjøretillatelse (ikke anon, authenticated eller public)',
    has_function_privilege('service_role', 'public.portal_timer_fakta()', 'execute')
    and not has_function_privilege('anon', 'public.portal_timer_fakta()', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_timer_fakta()', 'execute')
    and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.portal_timer_fakta()'::regprocedure and a.grantee = 0));

  -- ===== S2 Stable og security invoker (kan ikke skrive, ingen utvidede rettigheter) =====
  perform pg_temp.sjekk('S2 stable (provolatile = s) og security invoker (prosecdef = false)',
    (select p.provolatile = 's' and p.prosecdef = false from pg_proc p where p.oid = 'public.portal_timer_fakta()'::regprocedure));

  -- ===== Hovedkall =====
  select count(*) into v_o1 from public.ordrer; select count(*) into v_o2 from public.innstillinger; select count(*) into v_o3 from public.portal_bestillinger;
  r := public.portal_timer_fakta();
  insert into _all select ord::int, e from jsonb_array_elements(r->'biler') with ordinality t(e, ord);
  insert into _r select j->>'modell', j from _all where left(j->>'merke', 7) = 'TESTTIM';
  insert into _r select 'T74 tom', j from _all where j->>'ordre_status' = 'test_tom_tim';

  -- ===== S3 Svarets form =====
  perform pg_temp.sjekk('S3 toppnivået har nøyaktig versjon, generert, antall og biler; versjon er 1; antall = lengden på biler',
    (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['antall', 'biler', 'generert', 'versjon'] and r->>'versjon' = '1' and jsonb_typeof(r->'versjon') = 'number'
    and jsonb_typeof(r->'antall') = 'number' and (r->>'antall')::int = jsonb_array_length(r->'biler'), r->>'antall');
  perform pg_temp.sjekk('S3 generert er et UTC-tidspunkt med millisekunder', (r->>'generert') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$', null);
  perform pg_temp.sjekk('S3 HVER rad (ekte og test) har nøyaktig de 11 feltene i kontrakten og ingen andre',
    (select count(*) > 0 and bool_and((select array_agg(k order by k) from jsonb_object_keys(a.j) k) =
       array['arkivert', 'frossen_effektiv_minutter', 'hentet', 'merke', 'minutter_klargjoring', 'minutter_ombygging', 'modell', 'okter_ombygging', 'okter_ombygging_glemt', 'ordre_status', 'pagaar']) from _all a));
  perform pg_temp.sjekk('S3 HVER rad har riktige typer: tekst, boolsk, hele tall >= 0 (frossen: hele tall >= 0 eller null)',
    (select bool_and(jsonb_typeof(j->'merke') = 'string' and jsonb_typeof(j->'modell') = 'string' and jsonb_typeof(j->'ordre_status') = 'string' and (j->>'ordre_status') <> ''
       and jsonb_typeof(j->'arkivert') = 'boolean' and jsonb_typeof(j->'hentet') = 'boolean' and jsonb_typeof(j->'pagaar') = 'boolean'
       and (j->>'hentet')::boolean = ((j->>'ordre_status') = 'hentet')
       and jsonb_typeof(j->'minutter_ombygging') = 'number' and (j->>'minutter_ombygging') ~ '^\d+$'
       and jsonb_typeof(j->'okter_ombygging') = 'number' and (j->>'okter_ombygging') ~ '^\d+$'
       and jsonb_typeof(j->'okter_ombygging_glemt') = 'number' and (j->>'okter_ombygging_glemt') ~ '^\d+$'
       and jsonb_typeof(j->'minutter_klargjoring') = 'number' and (j->>'minutter_klargjoring') ~ '^\d+$'
       and (jsonb_typeof(j->'frossen_effektiv_minutter') = 'null' or (jsonb_typeof(j->'frossen_effektiv_minutter') = 'number' and (j->>'frossen_effektiv_minutter') ~ '^\d+$'))
       and length(j->>'merke') <= 100 and length(j->>'modell') <= 100) from _all));

  -- ===== S4 Tid som teller, summering og avrunding =====
  perform pg_temp.sjekk('S4 to økter for samme ansatt summeres (60 + 90 min = 150, 2 økter)', pg_temp.rad('T01 teller') = pg_temp.forv('{"minutter_ombygging":150,"okter_ombygging":2}'), pg_temp.rad('T01 teller')::text);
  perform pg_temp.sjekk('S4 to ansatte samtidig = PERSON-timer lagt sammen (2 t + 2 t = 240 min, 2 økter)', pg_temp.rad('T02 samtidig') = pg_temp.forv('{"minutter_ombygging":240,"okter_ombygging":2}'), pg_temp.rad('T02 samtidig')::text);
  perform pg_temp.sjekk('S4 summen avrundes, ikke hver økt: 3 økter à 30 s = 90 s = 2 min (ikke 3), 3 økter', pg_temp.rad('T03 rund sum') = pg_temp.forv('{"minutter_ombygging":2,"okter_ombygging":3}'), pg_temp.rad('T03 rund sum')::text);
  perform pg_temp.sjekk('S4 en økt på 29,999 s gir 0 min men telles som økt; klargjøring på 90 s gir 2 min', pg_temp.rad('T04 rund ned') = pg_temp.forv('{"minutter_ombygging":0,"okter_ombygging":1,"minutter_klargjoring":2}'), pg_temp.rad('T04 rund ned')::text);
  perform pg_temp.sjekk('S4 klargjøring: summen avrundes også (3 x 30 s = 2 min); ingen ombygging-økter', pg_temp.rad('T05 klarg rund sum') = pg_temp.forv('{"minutter_klargjoring":2}'), pg_temp.rad('T05 klarg rund sum')::text);
  perform pg_temp.sjekk('S4 begge klokker hver for seg (60 min ombygging, 30 min klargjøring)', pg_temp.rad('T20 begge klokker') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1,"minutter_klargjoring":30}'), pg_temp.rad('T20 begge klokker')::text);

  -- ===== S5 Glemt og over 14 timer holdes utenfor =====
  perform pg_temp.sjekk('S5 autoStopp glemt holdes utenfor minuttene og telles i okter_ombygging_glemt (60 min, 1 økt, 1 glemt)', pg_temp.rad('T06 glemt') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1,"okter_ombygging_glemt":1}'), pg_temp.rad('T06 glemt')::text);
  perform pg_temp.sjekk('S5 over 14 t (14 t + 1 ms og 97 t) er utenfor og telt som glemt; nøyaktig 14 t teller (840 min, 1 økt, 2 glemt)', pg_temp.rad('T07 over 14t') = pg_temp.forv('{"minutter_ombygging":840,"okter_ombygging":1,"okter_ombygging_glemt":2}'), pg_temp.rad('T07 over 14t')::text);
  perform pg_temp.sjekk('S5 glemt-merket økt på bare 1 t er likevel utenfor (0 min, 0 økter, 1 glemt), og bilen får rad', pg_temp.rad('T08 glemt kort') = pg_temp.forv('{"okter_ombygging_glemt":1}'), pg_temp.rad('T08 glemt kort')::text);
  perform pg_temp.sjekk('S5 autoStopp ikke_stemplet_inn og annen tekst teller som vanlig (120 min, 2 økter, 0 glemt)', pg_temp.rad('T09 ikke stemplet') = pg_temp.forv('{"minutter_ombygging":120,"okter_ombygging":2}'), pg_temp.rad('T09 ikke stemplet')::text);
  perform pg_temp.sjekk('S5 autoStopp som ikke er teksten «glemt» (true, «GLEMT») gjør ingenting', pg_temp.rad('T09b autoStopp true') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1}')
    and pg_temp.rad('T09c autoStopp GLEMT') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1}'), null);
  perform pg_temp.sjekk('S5 glemt og over 14 t i KLARGJØRING holdes utenfor minuttene (60 min) og røres ikke i okter_ombygging_glemt (0)', pg_temp.rad('T19 glemt klargjoring') = pg_temp.forv('{"minutter_klargjoring":60}'), pg_temp.rad('T19 glemt klargjoring')::text);

  -- ===== S6 Åpne økter =====
  perform pg_temp.sjekk('S6 åpen økt (stopp = null) gir pagaar og teller ikke med (60 min, 1 økt)', pg_temp.rad('T10 apen') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1,"pagaar":true}'), pg_temp.rad('T10 apen')::text);
  perform pg_temp.sjekk('S6 åpen klargjøring-økt gir pagaar og en rad med nuller', pg_temp.rad('T11 apen klargjoring') = pg_temp.forv('{"pagaar":true}'), pg_temp.rad('T11 apen klargjoring')::text);
  perform pg_temp.sjekk('S6 økt uten stopp-nøkkel er også åpen (pagaar)', pg_temp.rad('T12 apen uten stopp') = pg_temp.forv('{"pagaar":true}'), pg_temp.rad('T12 apen uten stopp')::text);

  -- ===== S7 Ugyldige verdier hoppes over uten å velte svaret =====
  perform pg_temp.sjekk('S7 16 ugyldige økter (tekst, null, negativ, streng-tall, desimal, for stort tall, ikke-objekt, stopp som tekst/objekt ...) hoppes over: bare den gyldige teller, ingen pagaar, ingen glemt',
    pg_temp.rad('T13 ugyldig') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1}'), pg_temp.rad('T13 ugyldig')::text);
  perform pg_temp.sjekk('S7 økt med stopp = start og økt med stopp før start er gyldige men teller ikke (60 min, 1 økt, ikke glemt)', pg_temp.rad('T17 null og negativ') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1}'), pg_temp.rad('T17 null og negativ')::text);
  perform pg_temp.sjekk('S7 en gyldig økt uten varighet gir rad med nuller (bilen har timedata, men ingen tid)', pg_temp.rad('T18 bare null varighet') = pg_temp.forv(), pg_temp.rad('T18 bare null varighet')::text);
  perform pg_temp.sjekk('S7 bil med bare ugyldige økter gir INGEN rad', not exists (select 1 from _r where modell = 'T14 bare ugyldig'), null);
  perform pg_temp.sjekk('S7 økt-kolonner som ikke er lister (objekt, streng, NULL) gir ingen rad og ingen feil', not exists (select 1 from _r where modell in ('T15 ikke liste', 'T15b null liste')), null);
  perform pg_temp.sjekk('S7 bil uten timedata (tomme lister, ingen frossen tid) gir INGEN rad', not exists (select 1 from _r where modell = 'T16 tom'), null);

  -- ===== S8 Frossen effektiv tid =====
  perform pg_temp.sjekk('S8 frossen effektiv tid 28 800 000 ms = 480 min, bilen får rad uten økter', pg_temp.rad('T21 frossen') = pg_temp.forv('{"frossen_effektiv_minutter":480}'), pg_temp.rad('T21 frossen')::text);
  perform pg_temp.sjekk('S8 frossen avrundes: 90 000 ms = 1,5 min = 2; 30 000,5 ms = 1; 29 999,5 ms = 0',
    pg_temp.rad('T22 frossen rund') = pg_temp.forv('{"frossen_effektiv_minutter":2}') and pg_temp.rad('T23 frossen desimal opp') = pg_temp.forv('{"frossen_effektiv_minutter":1}')
    and pg_temp.rad('T23b frossen desimal ned') = pg_temp.forv('{"frossen_effektiv_minutter":0}'), null);
  perform pg_temp.sjekk('S8 frossen tid som ikke er brukbar (tekst, negativ, {}, [], streng, null, for stor, boolsk) gir verken verdi eller rad',
    (select count(*) = 0 from _r where modell like 'T25_ %'), (select count(*)::text from _r where modell like 'T25_ %'));
  perform pg_temp.sjekk('S8 JSON-null som frossen tid gir null (JSON null), og tiden fra øktene står uberørt (60 min)', pg_temp.rad('T24 frossen json-null') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1}')
    and jsonb_typeof(pg_temp.rad('T24 frossen json-null')->'frossen_effektiv_minutter') = 'null', pg_temp.rad('T24 frossen json-null')::text);
  perform pg_temp.sjekk('S8 frossen tid og økter sammen (60 min + 50 min frossen)', pg_temp.rad('T26 frossen og okter') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1,"frossen_effektiv_minutter":50}'), pg_temp.rad('T26 frossen og okter')::text);

  -- ===== S9 Status, arkivert og hentet =====
  perform pg_temp.sjekk('S9 hentet + arkivert: hentet = true og arkivert = true', pg_temp.rad('T40 hentet arkivert') = pg_temp.forv('{"ordre_status":"hentet","hentet":true,"arkivert":true,"frossen_effektiv_minutter":1}'), pg_temp.rad('T40 hentet arkivert')::text);
  perform pg_temp.sjekk('S9 NULL og blank ordre_status/status gir ikke_paabegynt, ikke arkivert, ikke hentet',
    pg_temp.rad('T41 null status') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1}') and pg_temp.rad('T42 blank status') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1}'), null);
  perform pg_temp.sjekk('S9 polstret «  hentet  » og « arkivert » trimmes (samme uttrykk som portal_import_fakta)', pg_temp.rad('T43 polstret status') = pg_temp.forv('{"ordre_status":"hentet","hentet":true,"arkivert":true,"minutter_ombygging":60,"okter_ombygging":1}'), pg_temp.rad('T43 polstret status')::text);
  perform pg_temp.sjekk('S9 påbegynt/aktiv og ukjent status gir arkivert = false', pg_temp.rad('T44 paabegynt aktiv') = pg_temp.forv('{"ordre_status":"paabegynt","minutter_ombygging":60,"okter_ombygging":1}')
    and pg_temp.rad('T46 annen status') = pg_temp.forv('{"ordre_status":"paabegynt","minutter_ombygging":60,"okter_ombygging":1}'), null);
  perform pg_temp.sjekk('S9 alle 8 statuskodene i appen går uendret gjennom, og bare hentet gir hentet = true',
    (select count(*) = 8 and bool_and((j->>'ordre_status') = substr(m, 5) and (j->>'hentet')::boolean = (substr(m, 5) = 'hentet')) from (select modell as m, j from _r where modell like 'T45 %') x), null);

  -- ===== S10 Bare bil-ordrer =====
  perform pg_temp.sjekk('S10 ordretype leveranse gir ingen rad, selv med økter og frossen tid', not exists (select 1 from _r where modell = 'T50 leveranse'), null);

  -- ===== S11 Ingen id, chassis, kunde, kontaktperson eller ansattnavn i svaret =====
  v_tekst := r::text;
  perform pg_temp.sjekk('S11 raden til en bil med kunde, chassis, kontaktperson, ansattnavn og -id har bare de 10 kontraktsfeltene (summert 60 + 30 min)',
    pg_temp.rad('T60 privat') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1,"minutter_klargjoring":30}'), pg_temp.rad('T60 privat')::text);
  perform pg_temp.sjekk('S11 ingen av testens id-er, kunde-, chassis-, eier- eller ansattverdier finnes noe sted i svaret (hele teksten gjennomsøkt)',
    position('ord_test_tim' in v_tekst) = 0 and position('TESTKUNDE' in v_tekst) = 0 and position('TESTCHASSIS' in v_tekst) = 0 and position('TESTEIER' in v_tekst) = 0
    and position('TESTANSATT' in v_tekst) = 0 and position('ansattId' in v_tekst) = 0 and position('"ansatt"' in v_tekst) = 0 and position('"id"' in v_tekst) = 0, null);

  -- ===== S12 Rensing av merke og modell =====
  perform pg_temp.sjekk('S12 skittent merke (usynlige tegn, tab, nbsp, linjeskift) renses til «TESTTIM», og modellen til «T70 rens» (mellomrom slås sammen, trimmet)', exists (select 1 from _r where modell = 'T70 rens'), null);
  perform pg_temp.sjekk('S12 alle 92 tegn i tegnklassen fjernes fra merke og modell (ett tegn om gangen: «T71 NNNab», merke «TESTTIM»)',
    (select count(*) = 92 from _cp c join _r on _r.modell = 'T71 ' || lpad(c.n::text, 3, '0') || 'ab' and _r.j->>'merke' = 'TESTTIM'), null);
  perform pg_temp.sjekk('S12 modell kappes til 100 tegn og merke til 100 tegn', exists (select 1 from _r where modell = 'T72 ' || repeat('x', 96) and length(j->>'merke') = 100 and (j->>'merke') = 'TESTTIM' || repeat('q', 93)), null);
  perform pg_temp.sjekk('S12 kappet modell trimmes på nytt (mellomrommet på plass 100 fjernes)', exists (select 1 from _r where modell = 'T73 ' || repeat('a', 95)), null);
  perform pg_temp.sjekk('S12 norske bokstaver ÆØÅæøå står urørt', exists (select 1 from _r where modell = 'T75 ' || chr(198) || chr(216) || chr(197) || chr(230) || chr(248) || chr(229)), null);
  perform pg_temp.sjekk('S12 NULL i merke og modell gir tom tekst (aldri null)', (select j->>'merke' = '' and j->>'modell' = '' and jsonb_typeof(j->'merke') = 'string' from _r where modell = 'T74 tom'), null);

  -- ===== S13 Sortering: merke, modell, ordre_status (bytevis), minutter_ombygging synkende, så øvrige tall =====
  perform pg_temp.sjekk('S13 hele svaret er sortert på (merke, modell, ordre_status bytevis, minutter_ombygging synkende) (bare ja/nei: ekte rader vises ikke)',
    (select coalesce(bool_and(row(a.m collate "C", a.o collate "C", a.s collate "C", -a.min) >= row(a.pm collate "C", a.po collate "C", a.ps collate "C", -a.pmin)), true)
       from (select j->>'merke' as m, j->>'modell' as o, j->>'ordre_status' as s, (j->>'minutter_ombygging')::bigint as min,
                    lag(j->>'merke') over w as pm, lag(j->>'modell') over w as po, lag(j->>'ordre_status') over w as ps, lag((j->>'minutter_ombygging')::bigint) over w as pmin
               from _all window w as (order by pos)) a where a.pm is not null), null);
  perform pg_temp.sjekk('S13 modell stigende, så status stigende, så minutter synkende (T80: a/hentet 50, a/hentet 5, a/klar_henting 10, b/hentet 100)',
    (select array_agg((j->>'modell') || '/' || (j->>'ordre_status') || '/' || (j->>'minutter_ombygging') order by pos) from _all where left(j->>'merke', 7) = 'TESTTIM' and j->>'modell' like 'T80 %')
      = array['T80 a/hentet/50', 'T80 a/hentet/5', 'T80 a/klar_henting/10', 'T80 b/hentet/100'], null);
  perform pg_temp.sjekk('S13 merke sorteres bytevis (collate "C"): TESTTIM, TESTTIMB (stor B) før TESTTIMa (liten a), uavhengig av databasens locale',
    (select array_agg(j->>'merke' order by pos) from _all where j->>'modell' = 'T81 x' and left(j->>'merke', 7) = 'TESTTIM') = array['TESTTIM', 'TESTTIMB', 'TESTTIMa'], null);
  perform pg_temp.sjekk('S13 likt på de fire nøklene: flest økter først, så mest klargjøring (2 økter, så 1 økt + 30 min klargjøring, så 1 økt + 0)',
    (select array_agg((j->>'okter_ombygging') || '/' || (j->>'minutter_klargjoring') order by pos) from _all where j->>'modell' = 'T82 tie') = array['2/0', '1/30', '1/0'], null);
  r2 := public.portal_timer_fakta();
  perform pg_temp.sjekk('S13 to kall på rad gir byte-lik biler-liste (stabil rekkefølge)', (r2->'biler') = (r->'biler') and (r2->'biler')::text = (r->'biler')::text, null);
  perform pg_temp.sjekk('S13 hver test-etikett finnes høyst én gang unntatt de bevisste (T80, T81, T82)',
    (select count(*) = 0 from (select modell from _r where modell !~ '^T8[012] ' group by modell having count(*) > 1) x), null);

  -- ===== S14 Funksjonen skriver ingenting: radantall er likt før og etter kallene =====
  -- (En stable-funksjon KAN ikke inneholde en insert: Postgres avviser den ved opprettelse, så S2 er selve beviset; dette er et ekstra, ytre bevis.)
  perform pg_temp.sjekk('S14 radantallet i ordrer, innstillinger og portal_bestillinger er likt før og etter kallene',
    v_o1 = (select count(*) from public.ordrer) and v_o2 = (select count(*) from public.innstillinger) and v_o3 = (select count(*) from public.portal_bestillinger), null);

  -- ===== S15 Tak: nøyaktig 2000 rader er greit, 2001 gir FOR_MANGE_BILER (SIST: setter inn mange rader) =====
  v_n := (public.portal_timer_fakta()->>'antall')::int;
  insert into public.ordrer (id, ordretype, merke, modell, effektiv_tid_frossen)
    select 'ord_test_tim_bulk_' || g, 'bil', 'TESTTIMBULK', 'B' || g, '{"totalMs":60000}'::jsonb from generate_series(1, greatest(2000 - v_n, 0)) g;
  v_n2 := (public.portal_timer_fakta()->>'antall')::int;
  perform pg_temp.sjekk('S15 nøyaktig 2000 rader er greit (svaret er ikke avkortet)', v_n2 = 2000 and jsonb_array_length(public.portal_timer_fakta()->'biler') = 2000, v_n2::text);
  begin
    insert into public.ordrer (id, ordretype, merke, modell, effektiv_tid_frossen) values ('ord_test_tim_bulk_siste', 'bil', 'TESTTIMBULK', 'B-siste', '{"totalMs":60000}');
    perform public.portal_timer_fakta();
    perform pg_temp.sjekk('S15 2001 rader gir FOR_MANGE_BILER (aldri et avkortet svar)', false, 'ingen feil');
  exception when others then
    perform pg_temp.sjekk('S15 2001 rader gir FOR_MANGE_BILER (aldri et avkortet svar)', sqlerrm = 'FOR_MANGE_BILER', sqlerrm);
  end;
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
