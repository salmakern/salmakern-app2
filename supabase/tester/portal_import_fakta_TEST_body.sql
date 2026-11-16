-- Test av 20261110200000_portal_import_fakta.sql (sjekkene S1-S15 i spesifikasjonen 4.9). ALLTID i en transaksjon som rulles tilbake: testen bytter HELE
-- innstillinger.kontakter ut med testdata og setter inn TEST-ordrer (id-prefiks ord_test_imp_) og TEST-bestillinger (pb_test_) - alt rulles tilbake,
-- rører aldri ekte data (sjekkene leter bare etter de egne test-radene; de ekte radene i svaret telles bare, aldri vist).
-- Ingen UPDATE på ordrer (triggerne «ordre-push»/«ordre-status-*» er AFTER UPDATE): radene settes inn med riktige verdier fra starten.
-- Tegnene som skal fjernes bygges med chr(...) (aldri rå usynlige tegn i testfila).
-- Kjøring (fra rotmappen). Dette er et SKRIVENDE steg (en midlertidig funksjon og rader i en transaksjon): krever Henriks ja, og ikke mellom 00:00 og 03:00:
--   ( echo "begin;"; cat supabase/migrations/20261110200000_portal_import_fakta.sql; cat supabase/tester/portal_import_fakta_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader skal være OK. Etterpå: to_regprocedure('public.portal_import_fakta(text[])') er fortsatt null (transaksjonen ble rullet tilbake).

create temp table _res (n serial, navn text, ok boolean, info text);
create temp table _a (id text primary key, j jsonb);    -- aktive-rader fra siste hovedkall, per ordre_id
create temp table _u (id text primary key, j jsonb);    -- utvalgte-rader fra siste hovedkall, per ordre_id
create temp table _cp (n int primary key, cp int not null);  -- de 92 tegnene funksjonen skal fjerne (kodepunkter)

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

do $test$
declare
  r jsonb; v_n int; v_n2 int; v_o1 int; v_o2 int; v_o3 int; v_x jsonb; v_nokler text[]; v_ider text[]; v_feil text; v_ok boolean;
begin
  v_nokler := array(select k from unnest(array['ordre_id', 'ordretype', 'kunde', 'chassis', 'eier', 'merke', 'modell', 'ordre_status', 'status', 'opprettet',
                                               'kontakt_treff', 'kontakt_id', 'kontakt_navn', 'kontakt_orgnr', 'portal_bestilling_ider']) k order by k);

  -- ===== S1 Bare service_role kan kalle funksjonen =====
  insert into _res(navn, ok, info) values ('S1 bare service_role har kjøretillatelse (ikke anon, authenticated eller public)',
    has_function_privilege('service_role', 'public.portal_import_fakta(text[])', 'execute')
    and not has_function_privilege('anon', 'public.portal_import_fakta(text[])', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_import_fakta(text[])', 'execute')
    and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.portal_import_fakta(text[])'::regprocedure and a.grantee = 0), null);

  -- ===== S2 Stable og security invoker (kan ikke skrive, ingen utvidede rettigheter) =====
  insert into _res(navn, ok, info) values ('S2 stable (provolatile = s) og security invoker (prosecdef = false)',
    (select p.provolatile = 's' and p.prosecdef = false from pg_proc p where p.oid = 'public.portal_import_fakta(text[])'::regprocedure), null);

  -- ===== Oppsett: HELE kontakter-arrayet byttes ut med testdata (rulles tilbake uansett) =====
  update public.innstillinger set kontakter = jsonb_build_array(
    jsonb_build_object('id', 'k_test_a', 'navn', 'TEST Forhandler A', 'type', 'Forhandler', 'orgnr', '123 456 789'),
    jsonb_build_object('id', 'k_test_ae', 'navn', 'TEST ' || chr(198) || chr(216) || chr(197) || ' Bil AS', 'type', 'Forhandler', 'orgnr', '987654321'),
    jsonb_build_object('id', 'k_test_d1', 'navn', 'TEST Dobbel', 'type', 'Forhandler', 'orgnr', '111111111'),
    jsonb_build_object('id', 'k_test_d2', 'navn', 'TEST Dobbel', 'type', 'Forhandler', 'orgnr', '222222222'),
    jsonb_build_object('id', 'k_test_lev', 'navn', 'TEST Leverandor', 'type', 'Leverand' || chr(248) || 'r', 'orgnr', '333333333'),
    jsonb_build_object('id', 'k_test_tom', 'navn', 'TEST Uten Orgnr', 'type', 'Forhandler', 'orgnr', ''),
    jsonb_build_object('id', 'k_test_mr', 'navn', 'TEST  Mellom   Rom ', 'type', 'Forhandler', 'orgnr', 'NO 555 666 777 MVA'),
    jsonb_build_object('id', repeat('k', 121), 'navn', 'TEST Lang Id', 'type', 'Forhandler', 'orgnr', '444444444'),
    jsonb_build_object('id', '', 'navn', 'TEST Tom Id', 'type', 'Forhandler', 'orgnr', '444444444'),
    jsonb_build_object('navn', 'TEST Uten Id', 'type', 'Forhandler', 'orgnr', '444444444'),
    jsonb_build_object('id', repeat('j', 120), 'navn', 'TEST Id 120', 'type', 'Forhandler', 'orgnr', '666666666'),
    jsonb_build_object('id', 'k_test_langorg', 'navn', 'TEST Lang Orgnr', 'type', 'Forhandler', 'orgnr', '1234567890123456789012345'),
    jsonb_build_object('id', 'k_test_langnavn', 'navn', repeat('N', 250), 'type', 'Forhandler', 'orgnr', '777777777'),
    jsonb_build_object('id', 'k_test_utentype', 'navn', 'TEST Uten Type'),
    'null'::jsonb, '"streng"'::jsonb, '42'::jsonb, '[]'::jsonb
  ) where id = 1;
  -- De 92 tegnene: én kontakt per tegn, med unikt navn (K001aXb, ...) så hvert tegn gir nøyaktig ett treff.
  update public.innstillinger set kontakter = kontakter || (
    select jsonb_agg(jsonb_build_object('id', 'k_test_cp_' || n, 'navn', 'K' || lpad(n::text, 3, '0') || 'a' || chr(cp) || 'b', 'type', 'Forhandler', 'orgnr', '')) from _cp
  ) where id = 1;

  -- ===== Oppsett: TEST-ordrer (ingen UPDATE: riktige verdier fra starten) =====
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, created_at, updated_at, portal_bestilling_id) values
    ('ord_test_imp_a',        'bil', 'test forhandler a', 'TESTWXYZ000000001', 'Test Selger', 'Kia', 'EV9', 'paabegynt', 'aktiv', '2026-11-03 09:15:30.123+01', '2026-11-03 10:00:00+01', null),
    ('ord_test_imp_ae',       'bil', 'test ' || chr(230) || chr(248) || chr(229) || ' bil as', 'TESTWXYZ000000002', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_dobbel',   'bil', 'TEST Dobbel', 'TESTWXYZ000000003', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_ingen',    'bil', 'Finnes Ikke', 'TESTWXYZ000000004', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_levkont',  'bil', 'TEST Leverandor', 'TESTWXYZ000000005', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_tom',      'bil', 'TEST Uten Orgnr', 'TESTWXYZ000000006', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_mr',       'bil', 'TEST Mellom Rom', 'TESTWXYZ000000007', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_langid',   'bil', 'TEST Lang Id', 'TESTWXYZ000000008', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_tomid',    'bil', 'TEST Tom Id', 'TESTWXYZ000000009', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_utenid',   'bil', 'TEST Uten Id', 'TESTWXYZ000000010', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_id120',    'bil', 'TEST Id 120', 'TESTWXYZ000000011', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_langorg',  'bil', 'TEST Lang Orgnr', 'TESTWXYZ000000012', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_langnavn', 'bil', repeat('N', 250), 'TESTWXYZ000000013', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_utentype', 'bil', 'TEST Uten Type', 'TESTWXYZ000000014', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null);

  -- Statuser, ordretype, tidspunkt, id utenfor mønsteret og NULL i alle nullable kolonner.
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, created_at, updated_at, portal_bestilling_id) values
    ('ord_test_imp_nullfelt',   'bil', null, null, null, null, null, null, null, null, null, null),
    ('ord_test_imp_tomstatus',  'bil', '', '', '', '', '', '', '', now(), now(), null),
    ('ord_test_imp_blankstat',  'bil', 'x', 'TESTWXYZ000000020', '', '', '', '  paabegynt  ', '', now(), now(), null),
    ('ord_test_imp_hentet',     'bil', 'x', 'TESTWXYZ000000021', '', '', '', 'hentet', 'aktiv', now(), now(), null),
    ('ord_test_imp_arkivert',   'bil', 'x', 'TESTWXYZ000000022', '', '', '', 'hentet', 'arkivert', now(), now(), null),
    ('ord_test_imp_arkpad',     'bil', 'x', 'TESTWXYZ000000023', '', '', '', 'paabegynt', ' arkivert ', now(), now(), null),
    ('ord_test_imp_lev',        'leveranse', 'x', 'TESTWXYZ000000024', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_u_c',        'bil', 'x', 'TESTWXYZ000000025', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_opp_upd',    'bil', 'x', 'TESTWXYZ000000026', '', '', '', 'ikke_paabegynt', 'aktiv', null, '2026-11-02 10:00:00+00', null),
    ('ord_test_imp_a:b',        'bil', 'x', 'TESTWXYZ000000027', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null);

  -- Normalisering (S4): hvitt mellomrom, kapping og chassis.
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, created_at, updated_at, portal_bestilling_id) values
    ('ord_test_imp_ws',     'bil', chr(9) || '  A   ' || chr(10) || 'B' || chr(13) || chr(160) || 'C  ' || chr(9),
                            ' tes twxyz-000 000030 ', '  ' || chr(198) || 'rlig  ' || chr(216) || 'stby   ' || chr(197) || 'S  ', 'M' || chr(9) || 'M', 'O  O',
                            'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_lang',   'bil', repeat('x', 250), repeat('abcd', 15), repeat('e', 201), repeat('a', 199) || ' bbb', repeat('m', 200),
                            'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_ws2',    'bil', 'A' || chr(8195) || 'B' || chr(8232) || 'C' || chr(12288) || 'D' || chr(8239) || 'E',
                            'TESTWXYZ' || chr(160) || '000000032', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null),
    ('ord_test_imp_norsk',  'bil', chr(198) || chr(216) || chr(197) || chr(230) || chr(248) || chr(229) || ' 123', 'TESTWXYZ000000031', '', '', '',
                            'ikke_paabegynt', 'aktiv', now(), now(), null);
  -- Ett tegn om gangen, med bokstaver på begge sider, i kunde, eier, merke og modell (og i kontaktnavnet over).
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, created_at, updated_at, portal_bestilling_id)
  select 'ord_test_imp_cp_' || lpad(n::text, 3, '0'), 'bil',
         'K' || lpad(n::text, 3, '0') || 'a' || chr(cp) || 'b', 'TESTCP' || lpad(n::text, 11, '0'),
         'E' || lpad(n::text, 3, '0') || 'a' || chr(cp) || 'b', 'M' || lpad(n::text, 3, '0') || 'a' || chr(cp) || 'b', 'O' || lpad(n::text, 3, '0') || 'a' || chr(cp) || 'b',
         'ikke_paabegynt', 'aktiv', now(), now(), null
  from _cp;

  -- portal_bestilling_ider (S8): tre kilder, gravsteiner og serienummer teller ikke.
  insert into public.ordrer (id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, created_at, updated_at, portal_bestilling_id) values
    ('ord_test_imp_pb',  'bil', 'x', 'testwxyz-000 000005', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), 'pb_test_1'),
    ('ord_test_imp_pb2', 'bil', 'x', 'TESTWXYZ000000041', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), 'pb_test_8'),
    ('ord_test_imp_pb3', 'bil', 'x', '', '', '', '', 'ikke_paabegynt', 'aktiv', now(), now(), null);
  insert into public.portal_bestillinger (portal_bestilling_id, portal_nr, status, ident_type, ident, ordre_id) values
    ('pb_test_2', 'B-TEST-2', 'koblet',   'CHASSIS',     'TESTWXYZ000000099', 'ord_test_imp_pb'),    -- via ordre_id
    ('pb_test_3', 'B-TEST-3', 'mottatt',  'CHASSIS',     'TESTWXYZ000000005', null),                 -- via chassis (ordrens chassis normaliseres)
    ('pb_test_4', 'B-TEST-4', 'avvist',   'CHASSIS',     'TESTWXYZ000000098', 'ord_test_imp_pb'),    -- gravstein via ordre_id: teller ikke
    ('pb_test_5', 'B-TEST-5', 'avvist',   'CHASSIS',     'TESTWXYZ000000005', null),                 -- gravstein via chassis: teller ikke
    ('pb_test_6', 'B-TEST-6', 'mottatt',  'SERIENUMMER', 'TESTWXYZ000000005', null),                 -- serienummer med samme tekst: teller ikke
    ('pb_test_7', 'B-TEST-7', 'mottatt',  'CHASSIS',     '',                  null),                 -- tom ident mot ordre uten chassis: teller ikke
    ('pb_test_8', 'B-TEST-8', 'ny_ordre', 'CHASSIS',     'TESTWXYZ000000097', 'ord_test_imp_pb2');   -- samme id som ordrens egen kolonne: slås sammen

  -- ===== Hovedkall: aktive + utvalgte (dubletter, manglende, arkivert, leveranse) =====
  r := public.portal_import_fakta(array['ord_test_imp_u_c', 'ord_test_imp_u_a', 'ord_test_imp_u_a', 'ord_test_imp_u_b', 'ord_test_imp_arkivert', 'ord_test_imp_arkpad', 'ord_test_imp_lev', 'ord_test_imp_a']);
  delete from _a; delete from _u;
  insert into _a select e->>'ordre_id', e from jsonb_array_elements(r->'aktive') e;
  insert into _u select e->>'ordre_id', e from jsonb_array_elements(r->'utvalgte') e;

  -- ===== S3 Inndata: null og tom liste er greit; for mange id-er og ugyldige id-er avvises =====
  v_n := jsonb_array_length(public.portal_import_fakta(null)->'utvalgte');
  v_n2 := jsonb_array_length(public.portal_import_fakta('{}'::text[])->'utvalgte');
  v_o1 := jsonb_array_length(public.portal_import_fakta()->'utvalgte');
  insert into _res(navn, ok, info) values ('S3 p_ider = null, {} og uten argument gir tom utvalgte-liste uten feil', v_n = 0 and v_n2 = 0 and v_o1 = 0, null);
  v_n := jsonb_array_length(public.portal_import_fakta(array(select 'ord_test_imp_zz' || g from generate_series(1, 500) g))->'utvalgte');
  insert into _res(navn, ok, info) values ('S3 nøyaktig 500 id-er er greit (500 utvalgte, finnes:false)', v_n = 500, v_n::text);
  v_n := jsonb_array_length(public.portal_import_fakta(array[repeat('a', 64), 'a.b-c_D1'])->'utvalgte');
  insert into _res(navn, ok, info) values ('S3 en id på nøyaktig 64 tegn og tegnene . - _ er greit', v_n = 2, v_n::text);
  begin
    perform public.portal_import_fakta(array(select 'ord_test_imp_zz' || g from generate_series(1, 501) g));
    insert into _res(navn, ok, info) values ('S3 501 id-er gir UGYLDIG_INPUT: ider', false, 'ingen feil');
  exception when others then
    insert into _res(navn, ok, info) values ('S3 501 id-er gir UGYLDIG_INPUT: ider', sqlerrm = 'UGYLDIG_INPUT: ider', sqlerrm);
  end;
  begin
    perform public.portal_import_fakta(array['ord_test_imp_a', null]);
    insert into _res(navn, ok, info) values ('S3 en null-id gir UGYLDIG_INPUT: ider', false, 'ingen feil');
  exception when others then
    insert into _res(navn, ok, info) values ('S3 en null-id gir UGYLDIG_INPUT: ider', sqlerrm = 'UGYLDIG_INPUT: ider', sqlerrm);
  end;
  begin
    perform public.portal_import_fakta(array['ord a']);
    insert into _res(navn, ok, info) values ('S3 en id med mellomrom gir UGYLDIG_INPUT: ider', false, 'ingen feil');
  exception when others then
    insert into _res(navn, ok, info) values ('S3 en id med mellomrom gir UGYLDIG_INPUT: ider', sqlerrm = 'UGYLDIG_INPUT: ider', sqlerrm);
  end;
  begin
    perform public.portal_import_fakta(array['ord;a']);
    insert into _res(navn, ok, info) values ('S3 en id med semikolon gir UGYLDIG_INPUT: ider', false, 'ingen feil');
  exception when others then
    insert into _res(navn, ok, info) values ('S3 en id med semikolon gir UGYLDIG_INPUT: ider', sqlerrm = 'UGYLDIG_INPUT: ider', sqlerrm);
  end;
  begin
    perform public.portal_import_fakta(array[repeat('a', 65)]);
    insert into _res(navn, ok, info) values ('S3 en id på 65 tegn gir UGYLDIG_INPUT: ider', false, 'ingen feil');
  exception when others then
    insert into _res(navn, ok, info) values ('S3 en id på 65 tegn gir UGYLDIG_INPUT: ider', sqlerrm = 'UGYLDIG_INPUT: ider', sqlerrm);
  end;
  begin
    perform public.portal_import_fakta(array['']);
    insert into _res(navn, ok, info) values ('S3 en tom id gir UGYLDIG_INPUT: ider', false, 'ingen feil');
  exception when others then
    insert into _res(navn, ok, info) values ('S3 en tom id gir UGYLDIG_INPUT: ider', sqlerrm = 'UGYLDIG_INPUT: ider', sqlerrm);
  end;

  -- ===== S4 Normalisering =====
  insert into _res(navn, ok, info) values ('S4 alle 92 tegn i tegnklassen fjernes fra kunde, eier, merke og modell (ett tegn om gangen)', (
    select count(*) = 92 from _cp c join _a a on a.id = 'ord_test_imp_cp_' || lpad(c.n::text, 3, '0')
     where a.j->>'kunde' = 'K' || lpad(c.n::text, 3, '0') || 'ab' and a.j->>'eier' = 'E' || lpad(c.n::text, 3, '0') || 'ab'
       and a.j->>'merke' = 'M' || lpad(c.n::text, 3, '0') || 'ab' and a.j->>'modell' = 'O' || lpad(c.n::text, 3, '0') || 'ab'
  ), 'kodepunkter som feilet: ' || coalesce((
    select string_agg(c.cp::text, ',' order by c.cp) from _cp c left join _a a on a.id = 'ord_test_imp_cp_' || lpad(c.n::text, 3, '0')
     where a.id is null or not (a.j->>'kunde' = 'K' || lpad(c.n::text, 3, '0') || 'ab' and a.j->>'eier' = 'E' || lpad(c.n::text, 3, '0') || 'ab'
       and a.j->>'merke' = 'M' || lpad(c.n::text, 3, '0') || 'ab' and a.j->>'modell' = 'O' || lpad(c.n::text, 3, '0') || 'ab')), 'ingen'));
  insert into _res(navn, ok, info) values ('S4 klassen dekker nøyaktig 92 tegn (kontrollerer testens egen tabell)', (select count(*) from _cp) = 92 and (select count(distinct cp) from _cp) = 92, null);
  insert into _res(navn, ok, info) values ('S4 alle 92 tegn fjernes også fra kontaktnavnet (kontakten treffes og navnet er renset)', (
    select count(*) = 92 from _cp c join _a a on a.id = 'ord_test_imp_cp_' || lpad(c.n::text, 3, '0')
     where (a.j->>'kontakt_treff')::int = 1 and a.j->>'kontakt_id' = 'k_test_cp_' || c.n and a.j->>'kontakt_navn' = 'K' || lpad(c.n::text, 3, '0') || 'ab'
  ), null);
  insert into _res(navn, ok, info) values ('S4 tab, linjeskift, CR og nbsp blir ett mellomrom, endene trimmes (ord slås aldri sammen)', (select j->>'kunde' from _a where id = 'ord_test_imp_ws') = 'A B C',
    (select j->>'kunde' from _a where id = 'ord_test_imp_ws'));
  insert into _res(navn, ok, info) values ('S4 andre Unicode-mellomrom (em-mellomrom, linjeskilletegn, ideografisk, smalt nbsp) blir også ett mellomrom, uansett databasens locale', (select j->>'kunde' from _a where id = 'ord_test_imp_ws2') = 'A B C D E',
    (select j->>'kunde' from _a where id = 'ord_test_imp_ws2'));
  insert into _res(navn, ok, info) values ('S4 nbsp inni et chassis.nr fjernes (som mellomrom og bindestrek)', (select j->>'chassis' from _a where id = 'ord_test_imp_ws2') = 'TESTWXYZ000000032',
    (select j->>'chassis' from _a where id = 'ord_test_imp_ws2'));
  insert into _res(navn, ok, info) values ('S4 dobbelt mellomrom og endemellomrom trimmes i eier, merke og modell',
    (select j->>'eier' = chr(198) || 'rlig ' || chr(216) || 'stby ' || chr(197) || 'S' and j->>'merke' = 'M M' and j->>'modell' = 'O O' from _a where id = 'ord_test_imp_ws'), null);
  insert into _res(navn, ok, info) values ('S4 æ, ø, å og de store bokstavene (og sifre) står urørt', (select j->>'kunde' from _a where id = 'ord_test_imp_norsk') = chr(198) || chr(216) || chr(197) || chr(230) || chr(248) || chr(229) || ' 123', null);
  insert into _res(navn, ok, info) values ('S4 tekst over 200 tegn kappes til 200, og trimmes på nytt etter kappingen', (
    select length(j->>'kunde') = 200 and length(j->>'eier') = 200 and length(j->>'merke') = 199 and length(j->>'modell') = 200 from _a where id = 'ord_test_imp_lang'
  ), (select row(length(j->>'kunde'), length(j->>'eier'), length(j->>'merke'), length(j->>'modell'))::text from _a where id = 'ord_test_imp_lang'));
  insert into _res(navn, ok, info) values ('S4 chassis: store bokstaver uten mellomrom og bindestrek', (select j->>'chassis' from _a where id = 'ord_test_imp_ws') = 'TESTWXYZ000000030', null);
  insert into _res(navn, ok, info) values ('S4 chassis kappes til 40 tegn', (select j->>'chassis' from _a where id = 'ord_test_imp_lang') = repeat('ABCD', 10), null);
  insert into _res(navn, ok, info) values ('S4 NULL i kunde, eier, chassis, merke og modell gir tom tekst', (
    select j->>'kunde' = '' and j->>'eier' = '' and j->>'chassis' = '' and j->>'merke' = '' and j->>'modell' = ''
      and jsonb_typeof(j->'kunde') = 'string' and jsonb_typeof(j->'chassis') = 'string' from _a where id = 'ord_test_imp_nullfelt'), null);

  -- ===== S5 Status =====
  insert into _res(navn, ok, info) values ('S5 status NULL, tom og aktiv gir «aktiv» og står i aktive', (
    select count(*) = 3 and bool_and(j->>'status' = 'aktiv') from _a where id in ('ord_test_imp_nullfelt', 'ord_test_imp_tomstatus', 'ord_test_imp_a')), null);
  insert into _res(navn, ok, info) values ('S5 arkivert (også med mellomrom rundt) står ikke i aktive, men i utvalgte med status arkivert', (
    not exists (select 1 from _a where id in ('ord_test_imp_arkivert', 'ord_test_imp_arkpad'))
    and (select count(*) = 2 and bool_and(j->>'status' = 'arkivert' and (j->>'finnes')::boolean) from _u where id in ('ord_test_imp_arkivert', 'ord_test_imp_arkpad'))), null);
  insert into _res(navn, ok, info) values ('S5 ordre_status NULL eller tom gir ikke_paabegynt; mellomrom rundt trimmes; hentet beholdes', (
    (select j->>'ordre_status' from _a where id = 'ord_test_imp_nullfelt') = 'ikke_paabegynt'
    and (select j->>'ordre_status' from _a where id = 'ord_test_imp_tomstatus') = 'ikke_paabegynt'
    and (select j->>'ordre_status' from _a where id = 'ord_test_imp_blankstat') = 'paabegynt'
    and (select j->>'ordre_status' from _a where id = 'ord_test_imp_hentet') = 'hentet'
    and (select j->>'status' from _a where id = 'ord_test_imp_hentet') = 'aktiv'), null);

  -- ===== S6 Ordretype =====
  insert into _res(navn, ok, info) values ('S6 en leveranse står ikke i aktive, men i utvalgte med finnes:true og ordretype leveranse', (
    not exists (select 1 from _a where id = 'ord_test_imp_lev')
    and (select j->>'ordretype' = 'leveranse' and (j->>'finnes')::boolean from _u where id = 'ord_test_imp_lev')), null);
  insert into _res(navn, ok, info) values ('S6 alle rader i aktive er biler med status aktiv (også de ekte; bare antallet vises)', (
    select not exists (select 1 from _a where j->>'ordretype' <> 'bil' or j->>'status' <> 'aktiv')), (select count(*)::text || ' aktive rader totalt' from _a));

  -- ===== S7 Kontakttreff =====
  insert into _res(navn, ok, info) values ('S7 nøyaktig ett treff (også ulik store/små bokstaver): treff 1 med id, navn og org.nr (bare siffer)', (
    select (j->>'kontakt_treff')::int = 1 and j->>'kontakt_id' = 'k_test_a' and j->>'kontakt_navn' = 'TEST Forhandler A' and j->>'kontakt_orgnr' = '123456789'
    from _a where id = 'ord_test_imp_a'), (select j::text from _a where id = 'ord_test_imp_a'));
  insert into _res(navn, ok, info) values ('S7 treff uavhengig av store/små bokstaver også for Æ, Ø og Å', (
    select (j->>'kontakt_treff')::int = 1 and j->>'kontakt_id' = 'k_test_ae' and j->>'kontakt_orgnr' = '987654321' from _a where id = 'ord_test_imp_ae'), (select j::text from _a where id = 'ord_test_imp_ae'));
  insert into _res(navn, ok, info) values ('S7 to kontakter med samme navn: treff 2 og alle kontakt_* er null', (
    select (j->>'kontakt_treff')::int = 2 and jsonb_typeof(j->'kontakt_id') = 'null' and jsonb_typeof(j->'kontakt_navn') = 'null' and jsonb_typeof(j->'kontakt_orgnr') = 'null'
    from _a where id = 'ord_test_imp_dobbel'), (select j::text from _a where id = 'ord_test_imp_dobbel'));
  insert into _res(navn, ok, info) values ('S7 ingen kontakt med navnet: treff 0 og alle kontakt_* er null', (
    select (j->>'kontakt_treff')::int = 0 and jsonb_typeof(j->'kontakt_id') = 'null' and jsonb_typeof(j->'kontakt_navn') = 'null' and jsonb_typeof(j->'kontakt_orgnr') = 'null'
    from _a where id = 'ord_test_imp_ingen'), (select j::text from _a where id = 'ord_test_imp_ingen'));
  insert into _res(navn, ok, info) values ('S7 en kontakt av en annen type enn Forhandler teller ikke', (select (j->>'kontakt_treff')::int = 0 from _a where id = 'ord_test_imp_levkont'), null);
  insert into _res(navn, ok, info) values ('S7 en kontakt uten type teller ikke', (select (j->>'kontakt_treff')::int = 0 from _a where id = 'ord_test_imp_utentype'), null);
  insert into _res(navn, ok, info) values ('S7 en kontakt med tomt org.nr gir kontakt_orgnr null (treffet gjelder fortsatt)', (
    select (j->>'kontakt_treff')::int = 1 and j->>'kontakt_id' = 'k_test_tom' and jsonb_typeof(j->'kontakt_orgnr') = 'null' from _a where id = 'ord_test_imp_tom'), (select j::text from _a where id = 'ord_test_imp_tom'));
  insert into _res(navn, ok, info) values ('S7 dobbelt mellomrom i kontaktens navn renses før sammenligning; org.nr med bokstaver og mellomrom blir bare siffer', (
    select (j->>'kontakt_treff')::int = 1 and j->>'kontakt_navn' = 'TEST Mellom Rom' and j->>'kontakt_orgnr' = '555666777' from _a where id = 'ord_test_imp_mr'), (select j::text from _a where id = 'ord_test_imp_mr'));
  -- (Uten treff gjelder også en tom kunde: «x» i resten av testen treffer ingen kontakt.)
  insert into _res(navn, ok, info) values ('S7 en tom kunde gir treff 0 (en kontakt med tomt navn finnes ikke)', (select (j->>'kontakt_treff')::int = 0 from _a where id = 'ord_test_imp_nullfelt'), null);

  -- ===== S8 portal_bestilling_ider =====
  insert into _res(navn, ok, info) values ('S8 tre kilder (ordrens kolonne, ordre_id, CHASSIS-ident), gravsteiner og serienummer utelates, sortert', (
    select (j->'portal_bestilling_ider') = '["pb_test_1", "pb_test_2", "pb_test_3"]'::jsonb from _a where id = 'ord_test_imp_pb'), (select (j->'portal_bestilling_ider')::text from _a where id = 'ord_test_imp_pb'));
  insert into _res(navn, ok, info) values ('S8 samme id fra to kilder slås sammen (én forekomst)', (
    select (j->'portal_bestilling_ider') = '["pb_test_8"]'::jsonb from _a where id = 'ord_test_imp_pb2'), (select (j->'portal_bestilling_ider')::text from _a where id = 'ord_test_imp_pb2'));
  insert into _res(navn, ok, info) values ('S8 en ordre uten chassis treffer aldri en CHASSIS-rad med tom ident; tom liste er en liste, ikke null', (
    select (j->'portal_bestilling_ider') = '[]'::jsonb and jsonb_typeof(j->'portal_bestilling_ider') = 'array' from _a where id = 'ord_test_imp_pb3'), (select (j->'portal_bestilling_ider')::text from _a where id = 'ord_test_imp_pb3'));
  insert into _res(navn, ok, info) values ('S8 ordrens chassis (med mellomrom og bindestrek) matcher portalens normaliserte ident', (
    select (j->'portal_bestilling_ider') ? 'pb_test_3' from _a where id = 'ord_test_imp_pb'), null);

  -- ===== S9 Utvalgte =====
  insert into _res(navn, ok, info) values ('S9 en id som ikke finnes gir bare {ordre_id, finnes:false}', (
    select count(*) = 2 and bool_and((select array_agg(k order by k) from jsonb_object_keys(j) k) = array['finnes', 'ordre_id'] and j->'finnes' = 'false'::jsonb)
    from _u where id in ('ord_test_imp_u_a', 'ord_test_imp_u_b')), null);
  insert into _res(navn, ok, info) values ('S9 dubletter i p_ider gir én oppføring per id (7 ulike id-er)', jsonb_array_length(r->'utvalgte') = 7, jsonb_array_length(r->'utvalgte')::text);
  insert into _res(navn, ok, info) values ('S9 utvalgte er sortert på ordre_id', (
    select array_agg(e->>'ordre_id' order by ord) = array_agg(e->>'ordre_id' order by e->>'ordre_id') from jsonb_array_elements(r->'utvalgte') with ordinality t(e, ord)), null);
  insert into _res(navn, ok, info) values ('S9 aktive er sortert på ordre_id', (
    select array_agg(e->>'ordre_id' order by ord) = array_agg(e->>'ordre_id' order by e->>'ordre_id') from jsonb_array_elements(r->'aktive') with ordinality t(e, ord)), null);
  insert into _res(navn, ok, info) values ('S9 en funnet rad har alle 15 felt pluss finnes (16 nøkler), og finnes er true', (
    select (select array_agg(k order by k) from jsonb_object_keys(j) k) = array(select k from unnest(array_append(v_nokler, 'finnes')) k order by k) and j->'finnes' = 'true'::jsonb
    from _u where id = 'ord_test_imp_a'), null);

  -- ===== S10 opprettet =====
  insert into _res(navn, ok, info) values ('S10 created_at brukes og vises i UTC med millisekunder (2026-11-03 09:15:30.123+01 gir 08:15:30.123Z)', (
    select j->>'opprettet' = '2026-11-03T08:15:30.123Z' from _a where id = 'ord_test_imp_a'), (select j->>'opprettet' from _a where id = 'ord_test_imp_a'));
  insert into _res(navn, ok, info) values ('S10 created_at NULL gir updated_at', (select j->>'opprettet' = '2026-11-02T10:00:00.000Z' from _a where id = 'ord_test_imp_opp_upd'), (select j->>'opprettet' from _a where id = 'ord_test_imp_opp_upd'));
  insert into _res(navn, ok, info) values ('S10 begge NULL gir JSON null', (select jsonb_typeof(j->'opprettet') = 'null' from _a where id = 'ord_test_imp_nullfelt'), null);
  insert into _res(navn, ok, info) values ('S10 formatet er alltid YYYY-MM-DDTHH:MM:SS.mmmZ (eller null) for alle rader', (
    select not exists (select 1 from _a where jsonb_typeof(j->'opprettet') <> 'null' and (j->>'opprettet') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')), null);

  -- ===== S13 Kontrakten: nøkkelsettet og typene =====
  insert into _res(navn, ok, info) values ('S13 hver rad i aktive har nøyaktig de 15 feltene i kontrakten (også de ekte; bare antall vises)', (
    select not exists (select 1 from _a where (select array_agg(k order by k) from jsonb_object_keys(j) k) <> v_nokler)), (select count(*)::text || ' rader sjekket' from _a));
  insert into _res(navn, ok, info) values ('S13 typene: kontakt_treff er tall, portal_bestilling_ider er liste, tekstfeltene er tekst (aldri null)', (
    select not exists (select 1 from _a where jsonb_typeof(j->'kontakt_treff') <> 'number' or jsonb_typeof(j->'portal_bestilling_ider') <> 'array'
      or jsonb_typeof(j->'kunde') <> 'string' or jsonb_typeof(j->'chassis') <> 'string' or jsonb_typeof(j->'eier') <> 'string' or jsonb_typeof(j->'merke') <> 'string'
      or jsonb_typeof(j->'modell') <> 'string' or jsonb_typeof(j->'ordre_status') <> 'string' or jsonb_typeof(j->'status') <> 'string')), null);
  insert into _res(navn, ok, info) values ('S13 toppnivået har versjon 1, generert (UTC med millisekunder), aktive og utvalgte (og ingen ok-nøkkel: den settes av edge-funksjonen)', (
    r->'versjon' = '1'::jsonb and (r->>'generert') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' and jsonb_typeof(r->'aktive') = 'array' and jsonb_typeof(r->'utvalgte') = 'array'
    and (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['aktive', 'generert', 'utvalgte', 'versjon']), null);

  -- ===== S14 Grenser og kapping =====
  insert into _res(navn, ok, info) values ('S14 en kontakt med id over 120 tegn, tom id eller uten id utelates (ingen feil, ingen treff)', (
    select bool_and((j->>'kontakt_treff')::int = 0) and count(*) = 3 from _a where id in ('ord_test_imp_langid', 'ord_test_imp_tomid', 'ord_test_imp_utenid')), null);
  insert into _res(navn, ok, info) values ('S14 en kontakt med id på nøyaktig 120 tegn er med', (
    select (j->>'kontakt_treff')::int = 1 and length(j->>'kontakt_id') = 120 from _a where id = 'ord_test_imp_id120'), null);
  insert into _res(navn, ok, info) values ('S14 org.nr kappes til 20 siffer', (select j->>'kontakt_orgnr' = '12345678901234567890' from _a where id = 'ord_test_imp_langorg'), (select j->>'kontakt_orgnr' from _a where id = 'ord_test_imp_langorg'));
  insert into _res(navn, ok, info) values ('S14 kunde og kontaktnavn over 200 tegn kappes (og treffer hverandre); funksjonen kaster aldri på lang tekst', (
    select length(j->>'kunde') = 200 and (j->>'kontakt_treff')::int = 1 and length(j->>'kontakt_navn') = 200 from _a where id = 'ord_test_imp_langnavn'), null);

  -- ===== S15 En ordre med id utenfor mønsteret står i aktive uten feil (portalen håndterer den; funksjonen validerer bare INNDATA) =====
  insert into _res(navn, ok, info) values ('S15 en ordre med kolon i id står i aktive uten feil', exists (select 1 from _a where id = 'ord_test_imp_a:b'), null);

  -- ===== S7 (forts.) kontakter som ikke er en liste gir 0 treff uten feil =====
  -- beskytt_innstillinger_lister_fn() (rettet 2026-11-16, se 20261116100000_beskytt_innstillinger_lister_type_vakt.sql)
  -- beskytter nå ALLE disse ugyldige verdiene (objekt/streng/JSON null/SQL NULL) ved å beholde den
  -- gamle, gyldige lista - så UPDATE-ene under ville ellers stille blitt stående som den fulle
  -- testkontakt-lista, og S7 ville aldri fått testet portal_import_fakta sin EGEN forsvarskode mot en
  -- faktisk ugyldig kolonneverdi. Triggeren skrus derfor AV kun for denne blokken (kun inni den
  -- rullede-tilbake testtransaksjonen; aldri utenfor en test), og PÅ igjen rett etter.
  alter table public.innstillinger disable trigger beskytt_innstillinger_lister;
  update public.innstillinger set kontakter = '{}'::jsonb where id = 1;
  r := public.portal_import_fakta(null);
  insert into _res(navn, ok, info) values ('S7 kontakter = {} (objekt) gir 0 treff uten feil', (
    select bool_and((e->>'kontakt_treff')::int = 0) and count(*) > 0 from jsonb_array_elements(r->'aktive') e where e->>'ordre_id' like 'ord_test_imp_%'), null);
  update public.innstillinger set kontakter = '"tekst"'::jsonb where id = 1;
  r := public.portal_import_fakta(null);
  insert into _res(navn, ok, info) values ('S7 kontakter = en JSON-streng gir 0 treff uten feil', (
    select bool_and((e->>'kontakt_treff')::int = 0) and count(*) > 0 from jsonb_array_elements(r->'aktive') e where e->>'ordre_id' like 'ord_test_imp_%'), null);
  update public.innstillinger set kontakter = 'null'::jsonb where id = 1;
  r := public.portal_import_fakta(null);
  insert into _res(navn, ok, info) values ('S7 kontakter = JSON null gir 0 treff uten feil', (
    select bool_and((e->>'kontakt_treff')::int = 0) and count(*) > 0 from jsonb_array_elements(r->'aktive') e where e->>'ordre_id' like 'ord_test_imp_%'), null);
  begin
    update public.innstillinger set kontakter = null where id = 1;
    r := public.portal_import_fakta(null);
    insert into _res(navn, ok, info) values ('S7 kontakter = SQL NULL gir 0 treff uten feil', (
      select bool_and((e->>'kontakt_treff')::int = 0) and count(*) > 0 from jsonb_array_elements(r->'aktive') e where e->>'ordre_id' like 'ord_test_imp_%'), null);
  exception when not_null_violation then
    insert into _res(navn, ok, info) values ('S7 kontakter = SQL NULL gir 0 treff uten feil', true, 'kolonnen tillater ikke NULL, så tilfellet kan ikke oppstå');
  end;
  alter table public.innstillinger enable trigger beskytt_innstillinger_lister;

  -- ===== S12 Funksjonen skriver ingenting: radantall er likt før og etter et kall =====
  -- (En stable-funksjon KAN ikke inneholde en insert: Postgres avviser den ved opprettelse, så S2 er selve beviset; dette er et ekstra, ytre bevis.)
  select count(*) into v_o1 from public.ordrer; select count(*) into v_o2 from public.innstillinger; select count(*) into v_o3 from public.portal_bestillinger;
  perform public.portal_import_fakta(array['ord_test_imp_a', 'ord_test_imp_u_a']);
  insert into _res(navn, ok, info) values ('S12 radantallet i ordrer, innstillinger og portal_bestillinger er likt før og etter et kall',
    v_o1 = (select count(*) from public.ordrer) and v_o2 = (select count(*) from public.innstillinger) and v_o3 = (select count(*) from public.portal_bestillinger), null);

  -- ===== S11 Tak på aktive: nøyaktig 500 er greit, 501 gir FOR_MANGE_AKTIVE (SIST: setter inn mange rader) =====
  v_n := jsonb_array_length(public.portal_import_fakta(null)->'aktive');
  insert into public.ordrer (id, ordretype, kunde, chassis, status)
    select 'ord_test_imp_bulk_' || g, 'bil', 'x', 'TESTBULK' || lpad(g::text, 9, '0'), 'aktiv' from generate_series(1, greatest(500 - v_n, 0)) g;
  v_n2 := jsonb_array_length(public.portal_import_fakta(null)->'aktive');
  insert into _res(navn, ok, info) values ('S11 nøyaktig 500 aktive bil-ordrer er greit', v_n2 = 500, v_n2::text);
  begin
    insert into public.ordrer (id, ordretype, kunde, chassis, status) values ('ord_test_imp_bulk_siste', 'bil', 'x', 'TESTBULK999999999', 'aktiv');
    perform public.portal_import_fakta(null);
    insert into _res(navn, ok, info) values ('S11 501 aktive bil-ordrer gir FOR_MANGE_AKTIVE', false, 'ingen feil');
  exception when others then
    insert into _res(navn, ok, info) values ('S11 501 aktive bil-ordrer gir FOR_MANGE_AKTIVE', sqlerrm = 'FOR_MANGE_AKTIVE', sqlerrm);
  end;
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
