-- Test av 20261116120000_portal_timer_fakta.sql (kontrakt versjon 1, 15 felt per rad). ALLTID i en transaksjon som rulles tilbake: testen setter inn TEST-ordrer (id-prefiks ord_test_tim_,
-- merke TESTTIM..., scenarioet står i modellfeltet: «T01 teller», «T13 ugyldig» osv.) - alt rulles tilbake og rører aldri ekte data. Svaret har ingen id, så testradene finnes igjen på merke og
-- modell; de ekte radene i svaret telles bare (og kontrolleres for form), aldri vist. Ingen UPDATE på ordrer (triggerne «ordre-push», «ordre-status-*» og «ordre-frakt-forbered» er AFTER UPDATE;
-- ingen trigger finnes på INSERT): radene settes inn med riktige verdier fra starten. Tegnene som skal fjernes bygges med chr(...) (aldri rå usynlige tegn i filen).
-- Kjøring (fra rotmappen). Dette er et SKRIVENDE steg (midlertidige funksjoner, tabeller og rader i en transaksjon): krever Henriks ja, og ikke mellom 00:00 og 03:00:
--   ( echo "begin;"; cat supabase/migrations/20261116120000_portal_timer_fakta.sql; cat supabase/tester/portal_timer_fakta_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle rader skal være OK. Etterpå: to_regprocedure('public.portal_timer_fakta()') er fortsatt null (transaksjonen ble rullet tilbake).
-- Uten å røre den delte databasen: samme filer mot en lokal Postgres (PGlite) med stubbet ordrer-tabell, se supabase/README.md «Faktiske timer til portalen».
--
-- Dekning: S1-S3 tilgang, stable/invoker og svarets form (15 felt, typer, datoer), S4-S5 tid som teller og glemt, S6 åpne økter (pagaar_ombygging og pagaar_klargjoring hver for seg),
-- S7 ugyldige verdier, S8 frossen tid, S9 status (alle 8 koder, NULL og ukjente verdier blir ikke_paabegynt), S10-S12 bare bil, ingen id/ansatt, rensing, S13 sortering,
-- S14 skriver ingenting, S15 ankomst_dato, S16 forste_okt, S17 hentet_dato (logg og frossetVed), S18 midnatt i norsk tid (sommer, vinter og begge skiftedager), S19 ingen dato for ikke-hentet bil,
-- S20 taket på 2000 rader (SIST: setter inn mange rader).

create temp table _res (n serial, navn text, ok boolean, info text);
create temp table _all (pos int, j jsonb);                   -- ALLE rader i svaret fra siste hovedkall, i svarets rekkefølge (ekte rader brukes bare til formsjekker)
create temp table _r (modell text, j jsonb);                 -- TEST-radene (merke som begynner på TESTTIM), per modell-etikett
create temp table _cp (n int primary key, cp int not null);  -- de 92 tegnene som skal fjernes fra merke/modell (kodepunkter)
create temp table _sc (
  n serial, merke text default 'TESTTIM', modell text, ordretype text default 'bil', ordre_status text default 'ikke_paabegynt', status text default 'aktiv',
  omb jsonb default '[]'::jsonb, klarg jsonb default '[]'::jsonb, frossen jsonb, kunde text default '', chassis text default '', eier text default '',
  endr jsonb default '[]'::jsonb, ankomst text
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

-- Én økt: start = 1790000000000 (2026-09-21 14:13:20 UTC) + forskyvning (ms), varighet i ms, ansatt-id (navn «TESTANSATT <id>»), valgfri autoStopp. jsonb_strip_nulls fjerner autoStopp når den er null.
create function pg_temp.okt(p_forskyvning bigint, p_varighet bigint, p_ansatt int default 1, p_auto text default null) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('start', 1790000000000 + p_forskyvning, 'stopp', 1790000000000 + p_forskyvning + p_varighet,
                                              'ansattId', p_ansatt, 'ansatt', 'TESTANSATT ' || p_ansatt, 'autoStopp', p_auto))
$$;
-- ms siden epoke for et tidspunkt (UTC-tekst), og en økt med absolutt start (varighet 1 s som standard)
create function pg_temp.ms(p_ts text) returns bigint language sql stable as $$ select round(extract(epoch from p_ts::timestamptz) * 1000)::bigint $$;
create function pg_temp.okt_abs(p_start_ms bigint, p_varighet bigint default 1000, p_auto text default null) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('start', p_start_ms, 'stopp', p_start_ms + p_varighet, 'ansattId', 1, 'ansatt', 'TESTANSATT 1', 'autoStopp', p_auto))
$$;
-- En logglinje slik appen skriver den (legg_til_ordre_endring): {av, tid, txt}. av er et ansattnavn og skal aldri komme ut i svaret.
create function pg_temp.logg(p_tid text, p_txt text default 'Status endret til: Hentet') returns jsonb language sql immutable as $$
  select jsonb_build_object('av', 'TESTANSATT 1', 'tid', p_tid, 'txt', p_txt)
$$;
-- Frossen effektiv tid slik appen skriver den (totalMs, perAnsatt, frossetVed)
create function pg_temp.fr(p_ved text) returns jsonb language sql immutable as $$
  select jsonb_build_object('totalMs', 60000, 'perAnsatt', jsonb_build_object('1', 60000), 'frossetVed', p_ved)
$$;
-- En enkelt 60-sekunders Ombygging-økt: gir bilen en rad (og forste_okt = 2026-09-21)
create function pg_temp.omb1() returns jsonb language sql immutable as $$ select jsonb_build_array(pg_temp.okt(0, 60000)) $$;
-- Forventet rad: standardverdier (en bil uten tid) overstyrt av det scenarioet skal avvike på. Sammenlignes med raden UTEN merke, modell og de tre datofeltene (datoene har egne sjekker, S15-S19).
create function pg_temp.forv(p jsonb default '{}'::jsonb) returns jsonb language sql immutable as $$
  select '{"ordre_status":"ikke_paabegynt","arkivert":false,"hentet":false,"minutter_ombygging":0,"okter_ombygging":0,"okter_ombygging_glemt":0,"minutter_klargjoring":0,"pagaar_ombygging":false,"pagaar_klargjoring":false,"frossen_effektiv_minutter":null}'::jsonb || p
$$;
create function pg_temp.rad(p_modell text) returns jsonb language sql stable as $$ select j - 'merke' - 'modell' - 'ankomst_dato' - 'forste_okt' - 'hentet_dato' from _r where modell = p_modell $$;
-- Ett felt i en testrad (JSON-verdi; SQL NULL hvis raden mangler)
create function pg_temp.f(p_modell text, p_felt text) returns jsonb language sql stable as $$ select j -> p_felt from _r where modell = p_modell $$;
-- Er verdien null eller en EKTE YYYY-MM-DD-dato? (plpgsql med unntak: en ugyldig dato i ::date gir false i stedet for en feil)
create function pg_temp.er_dato(p_j jsonb) returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(p_j) = 'null' then return true; end if;
  if jsonb_typeof(p_j) <> 'string' then return false; end if;
  return (p_j #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and to_char((p_j #>> '{}')::date, 'YYYY-MM-DD') = (p_j #>> '{}');
exception when others then return false;
end
$$;
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
-- Åpne økter: pagaar_ombygging og pagaar_klargjoring er uavhengige (den ene klokka åpen sier ingenting om den andre)
insert into _sc (modell, omb, klarg) values
  ('T10 apen',              jsonb_build_array(pg_temp.okt(0, 3600000)) || '[{"start":1790000100000,"stopp":null,"ansattId":3}]'::jsonb, '[]'),
  ('T11 apen klargjoring',  '[]', '[{"start":1790000000000,"stopp":null}]'::jsonb),
  ('T12 apen uten stopp',   '[{"start":1790000000000}]'::jsonb, '[]'),
  ('T10b apen begge',       '[{"start":1790000000000,"stopp":null}]'::jsonb, '[{"start":1790000000000,"stopp":null}]'::jsonb),
  ('T10d apen klarg lukket omb', '[{"start":1790000000000,"stopp":null}]'::jsonb, jsonb_build_array(pg_temp.okt(0, 1800000)));
insert into _sc (modell, ordre_status, status, omb, klarg) values
  -- Nøkkelscenarioet: en HENTET bil med full, lukket Ombygging-tid og en glemt åpen Klargjøring-klokke (opprydningen rører aldri Klargjøring)
  ('T10c hentet apen klargjoring', 'hentet', 'arkivert', jsonb_build_array(pg_temp.okt(0, 3600000)), '[{"start":1790000000000,"stopp":null}]'::jsonb),
  ('T10e hentet apen ombygging',   'hentet', 'arkivert', '[{"start":1790000000000,"stopp":null}]'::jsonb, jsonb_build_array(pg_temp.okt(0, 1800000)));
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
-- Status, arkivert, hentet. ordre_status avbildes til de åtte kodene: alt annet (NULL, tom/blank tekst, polstret tekst, gamle verdier) blir ikke_paabegynt (kontraktens case-uttrykk, uten btrim).
-- arkivert = coalesce(status = 'arkivert', false), også uten btrim.
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
-- Gamle og ukjente verdier: alle blir ikke_paabegynt (og aldri hentet, heller ikke «Hentet»/«HENTET» med stor bokstav)
insert into _sc (modell, ordre_status, omb)
select 'T47 ' || lpad(n::text, 2, '0'), s, jsonb_build_array(pg_temp.okt(0, 60000))
from unnest(array['bestilt_frakt', 'Hentet', 'HENTET', 'klar_for_henting', ' paabegynt', 'paabegynt ', 'hentet' || chr(160), 'ukjent', 'arkivert', 'aktiv', '0', 'null']) with ordinality u(s, n);
-- Ordretype leveranse gir ingen rad, selv med økter og frossen tid
insert into _sc (modell, ordretype, omb, frossen) values
  ('T50 leveranse', 'leveranse', jsonb_build_array(pg_temp.okt(0, 3600000)), '{"totalMs":60000}');
-- Ingen id, chassis, kunde, kontaktperson eller ansattnavn i svaret
insert into _sc (modell, omb, klarg, kunde, chassis, eier, endr) values
  ('T60 privat', jsonb_build_array(pg_temp.okt(0, 3600000, 7)), jsonb_build_array(pg_temp.okt(0, 1800000, 8)), 'TESTKUNDE-HEMMELIG', 'TESTCHASSIS00000001', 'TESTEIER-HEMMELIG', jsonb_build_array(pg_temp.logg('1.1.2026, 10:00:00', 'TESTLOGGTEKST-HEMMELIG')));
-- Rensing av merke og modell: det skitne merket renses til nøyaktig «TESTTIM» (så raden finnes igjen), og modellen til etiketten
insert into _sc (merke, modell, frossen) values
  (chr(8203) || chr(9) || ' TESTTIM' || chr(160) || chr(8232) || chr(10), 'T70 ' || chr(8203) || chr(160) || '  rens ' || chr(9), '{"totalMs":60000}'),
  ('TESTTIM' || repeat('q', 200), 'T72 ' || repeat('x', 200), '{"totalMs":60000}'),
  ('TESTTIM', 'T73 ' || repeat('a', 95) || ' bbb', '{"totalMs":60000}'),
  ('TESTTIM', 'T75 ' || chr(198) || chr(216) || chr(197) || chr(230) || chr(248) || chr(229), '{"totalMs":60000}');
-- Raden uten merke og modell finnes igjen på en ankomstdato ingen ekte bil har (statuskoden test_tom_tim avbildes til ikke_paabegynt og kan ikke brukes)
insert into _sc (merke, modell, frossen, ankomst) values (null, null, '{"totalMs":60000}', '1234-05-06');
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

-- ===== Datoscenarioer =====
-- S15 ankomst_dato: tekst som er NØYAKTIG YYYY-MM-DD og en ekte dato (år 0001-9999), ellers null. Verdi og forventet verdi per etikett.
create temp table _ank (etikett text primary key, verdi text, forventet text);
insert into _ank values
  ('A01 vanlig',            '2026-11-10', '2026-11-10'),
  ('A02 skuddaar 2028',     '2028-02-29', '2028-02-29'),
  ('A03 skuddaar 2000',     '2000-02-29', '2000-02-29'),
  ('A04 ikke skuddaar 1900', '1900-02-29', null),
  ('A05 ikke skuddaar 2026', '2026-02-29', null),
  ('A06 30 feb',            '2026-02-30', null),
  ('A07 31 apr',            '2026-04-31', null),
  ('A08 31 nov',            '2026-11-31', null),
  ('A09 mnd 13',            '2026-13-01', null),
  ('A10 mnd 00',            '2026-00-10', null),
  ('A11 dag 00',            '2026-11-00', null),
  ('A12 aar 0000',          '0000-01-01', null),
  ('A13 aar 0001',          '0001-01-01', '0001-01-01'),
  ('A14 aar 9999',          '9999-12-31', '9999-12-31'),
  ('A15 kort aar',          '26-11-10', null),
  ('A16 uten null mnd',     '2026-1-10', null),
  ('A17 uten null dag',     '2026-11-1', null),
  ('A18 ledende mellomrom', ' 2026-11-10', null),
  ('A19 etterfolgende mellomrom', '2026-11-10 ', null),
  ('A20 med klokkeslett',   '2026-11-10T10:00:00Z', null),
  ('A21 skraastrek',        '2026/11/10', null),
  ('A22 norsk format',      '10.11.2026', null),
  ('A23 uten skilletegn',   '20261110', null),
  ('A24 tom',               '', null),
  ('A25 tankestrek',        chr(8212), null),
  ('A26 tekst',             'abc', null),
  ('A27 NULL',              null, null),
  ('A28 arabisk-indiske sifre', translate('2026-11-10', '0123456789', (select string_agg(chr(1632 + i), '' order by i) from generate_series(0, 9) i)), null),
  ('A29 for langt',         '2026-11-100', null),
  ('A30 linjeskift',        E'2026-11-10\n', null);
insert into _sc (modell, ankomst, omb) select 'T100 ' || etikett, verdi, pg_temp.omb1() from _ank;

-- S16 forste_okt: dato (Europe/Oslo) for den TIDLIGSTE gyldige start i Ombygging (også glemt, åpen, uten varighet og med ugyldig stopp); Klargjøring teller ikke.
create temp table _fo (etikett text primary key, omb jsonb, klarg jsonb, forventet text);
insert into _fo values
  ('O01 en okt',            jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-10 10:00:00+00'))), '[]', '2026-11-10'),
  ('O02 tidligste av flere (usortert)', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-12 10:00:00+00')), pg_temp.okt_abs(pg_temp.ms('2026-11-03 10:00:00+00')), pg_temp.okt_abs(pg_temp.ms('2026-11-07 10:00:00+00'))), '[]', '2026-11-03'),
  ('O03 glemt er tidligst', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-01 08:00:00+00'), 50400000, 'glemt'), pg_temp.okt_abs(pg_temp.ms('2026-11-05 08:00:00+00'))), '[]', '2026-11-01'),
  ('O04 over 14t er tidligst', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-02 08:00:00+00'), 349200000), pg_temp.okt_abs(pg_temp.ms('2026-11-06 08:00:00+00'))), '[]', '2026-11-02'),
  ('O05 apen er tidligst',  jsonb_build_array(jsonb_build_object('start', pg_temp.ms('2026-11-02 08:00:00+00'), 'stopp', null), pg_temp.okt_abs(pg_temp.ms('2026-11-06 08:00:00+00'))), '[]', '2026-11-02'),
  ('O06 uten varighet er tidligst', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-02 08:00:00+00'), 0), pg_temp.okt_abs(pg_temp.ms('2026-11-06 08:00:00+00'))), '[]', '2026-11-02'),
  ('O07 stopp for start er tidligst', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-02 08:00:00+00'), -5000), pg_temp.okt_abs(pg_temp.ms('2026-11-06 08:00:00+00'))), '[]', '2026-11-02'),
  ('O08 gyldig start, ugyldig stopp er tidligst', jsonb_build_array(jsonb_build_object('start', pg_temp.ms('2026-11-02 08:00:00+00'), 'stopp', 'x'), pg_temp.okt_abs(pg_temp.ms('2026-11-06 08:00:00+00'))), '[]', '2026-11-02'),
  ('O09 ugyldige starter hoppes over', jsonb_build_array('{"start":"abc","stopp":5}'::jsonb, '{"start":-1,"stopp":5}'::jsonb, '{"start":null}'::jsonb, '{"stopp":5}'::jsonb, '42'::jsonb, 'null'::jsonb, '{"start":1.5,"stopp":5}'::jsonb, '{"start":"1790000000000"}'::jsonb, pg_temp.okt_abs(pg_temp.ms('2026-11-09 10:00:00+00'))), '[]', '2026-11-09'),
  ('O10 bare klargjoring gir null', '[]', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-02 10:00:00+00'))), null),
  ('O11 klargjoring teller ikke (tidligere enn ombygging)', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-09 10:00:00+00'))), jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-02 10:00:00+00'))), '2026-11-09'),
  ('O12 bare ugyldig ombygging, klargjoring gir rad: null', '[{"start":"abc","stopp":5},42]'::jsonb, jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('2026-11-02 10:00:00+00'))), null),
  ('O13 start 0 er en gyldig start (1970-01-01)', jsonb_build_array(jsonb_build_object('start', 0, 'stopp', 60000), pg_temp.okt_abs(pg_temp.ms('2026-11-09 10:00:00+00'))), '[]', '1970-01-01'),
  ('O14 siste dag i aar 9999 (norsk tid)', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('9999-12-31 22:59:59.999+00'))), '[]', '9999-12-31'),
  ('O15 etter aar 9999 (norsk tid) gir null', jsonb_build_array(pg_temp.okt_abs(pg_temp.ms('9999-12-31 23:00:00+00'))), '[]', null),
  ('O16 15 siffer', jsonb_build_array(pg_temp.okt_abs(999999999999999 - 1000)), '[]', null);
insert into _sc (modell, omb, klarg) select 'T101 ' || etikett, omb, klarg from _fo;

-- S18 midnatt i norsk tid (Europe/Oslo: UTC+1 vinter, UTC+2 sommer; skiftedager 29.3 og 25.10.2026). Hvert par: sekundet før og selve midnatt. Brukes både for forste_okt (start) og hentet_dato (frossetVed).
create temp table _mid (etikett text primary key, utc text, forventet text);
insert into _mid values
  ('M01 sommer rett for midnatt',  '2026-06-30 21:59:59.999+00', '2026-06-30'),
  ('M02 sommer midnatt',           '2026-06-30 22:00:00.000+00', '2026-07-01'),
  ('M03 vinter rett for midnatt',  '2026-01-31 22:59:59.999+00', '2026-01-31'),
  ('M04 vinter midnatt',           '2026-01-31 23:00:00.000+00', '2026-02-01'),
  ('M05 vaarskifte for midnatt',   '2026-03-28 22:59:59.999+00', '2026-03-28'),
  ('M06 vaarskifte midnatt',       '2026-03-28 23:00:00.000+00', '2026-03-29'),
  ('M07 skiftedag sommertid slutt paa dagen', '2026-03-29 21:59:59.999+00', '2026-03-29'),
  ('M08 skiftedag sommertid midnatt', '2026-03-29 22:00:00.000+00', '2026-03-30'),
  ('M09 hoestskifte sommertid for midnatt', '2026-10-24 21:59:59.999+00', '2026-10-24'),
  ('M10 hoestskifte sommertid midnatt', '2026-10-24 22:00:00.000+00', '2026-10-25'),
  ('M11 skiftedag vintertid slutt paa dagen', '2026-10-25 22:59:59.999+00', '2026-10-25'),
  ('M12 skiftedag vintertid midnatt', '2026-10-25 23:00:00.000+00', '2026-10-26'),
  ('M13 aarsskifte',               '2026-12-31 23:30:00.000+00', '2027-01-01'),
  ('M14 skuddag inn',              '2028-02-28 23:30:00.000+00', '2028-02-29'),
  ('M15 skuddag ut',               '2028-02-29 23:30:00.000+00', '2028-03-01'),
  ('M16 midt paa dagen',           '2026-11-10 12:00:00.000+00', '2026-11-10');
insert into _sc (modell, omb) select 'T102 ' || etikett, jsonb_build_array(pg_temp.okt_abs(pg_temp.ms(utc))) from _mid;

-- S17 hentet_dato: (a) siste logglinje «Status endret til: Hentet», (b) ellers effektiv_tid_frossen.frossetVed, (c) ellers null. Bare for hentet bil. Etikett, status, endringer, frossen, forventet.
create temp table _hd (etikett text primary key, status text, endr jsonb, frossen jsonb, forventet text);
insert into _hd values
  -- logglinjen: formatet «D.M.YYYY, HH:MM:SS» (appens toLocaleString('no')), enhetens lokaltid, datoen brukes slik den står
  ('H01 en linje',              'hentet', jsonb_build_array(pg_temp.logg('9.9.2026, 14:43:18')), null, '2026-09-09'),
  ('H02 tosifrede dag og mnd',  'hentet', jsonb_build_array(pg_temp.logg('11.11.2026, 13:34:43')), null, '2026-11-11'),
  ('H03 arkivert automatisk',   'hentet', jsonb_build_array(pg_temp.logg('3.11.2026, 08:00:00', 'Status endret til: Hentet (arkivert automatisk)')), null, '2026-11-03'),
  ('H04 siste av flere',        'hentet', jsonb_build_array(pg_temp.logg('1.11.2026, 10:00:00'), pg_temp.logg('5.11.2026, 10:00:00', 'Status endret til: Klar for henting'), pg_temp.logg('10.11.2026, 10:00:00')), null, '2026-11-10'),
  ('H05 siste plass vinner, ikke nyeste dato', 'hentet', jsonb_build_array(pg_temp.logg('12.11.2026, 10:00:00'), pg_temp.logg('2.11.2026, 10:00:00')), null, '2026-11-02'),
  ('H06 logg foran frossetVed', 'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00')), pg_temp.fr('2026-11-12T10:00:00.000Z'), '2026-11-10'),
  ('H07 bare frossetVed',       'hentet', '[]', pg_temp.fr('2026-11-12T10:00:00.000Z'), '2026-11-12'),
  ('H08 hverken logg eller frossetVed', 'hentet', '[]', null, null),
  ('H09 siste linje ugyldig, tidligere gyldig, ingen frossen: aldri gjettet', 'hentet', jsonb_build_array(pg_temp.logg('1.11.2026, 10:00:00'), pg_temp.logg('31.2.2026, 10:00:00')), null, null),
  ('H10 siste linje ugyldig, frossetVed finnes', 'hentet', jsonb_build_array(pg_temp.logg('31.2.2026, 10:00:00')), pg_temp.fr('2026-11-12T10:00:00.000Z'), '2026-11-12'),
  ('H11 31.12 sent paa kvelden: ingen tidssoneomregning', 'hentet', jsonb_build_array(pg_temp.logg('31.12.2026, 23:59:59')), null, '2026-12-31'),
  ('H12 1.1 midnatt',           'hentet', jsonb_build_array(pg_temp.logg('1.1.2026, 00:00:00')), null, '2026-01-01'),
  ('H13 skuddag 2028',          'hentet', jsonb_build_array(pg_temp.logg('29.2.2028, 12:00:00')), null, '2028-02-29'),
  ('H14 29.2 uten skuddaar',    'hentet', jsonb_build_array(pg_temp.logg('29.2.2026, 12:00:00')), null, null),
  ('H15 31 april',              'hentet', jsonb_build_array(pg_temp.logg('31.4.2026, 10:00:00')), null, null),
  ('H16 dag 0',                 'hentet', jsonb_build_array(pg_temp.logg('0.5.2026, 10:00:00')), null, null),
  ('H17 mnd 0',                 'hentet', jsonb_build_array(pg_temp.logg('5.0.2026, 10:00:00')), null, null),
  ('H18 mnd 13',                'hentet', jsonb_build_array(pg_temp.logg('5.13.2026, 10:00:00')), null, null),
  ('H19 time 24',               'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 24:00:00')), null, null),
  ('H20 minutt 60',             'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:60:00')), null, null),
  ('H21 sekund 60',             'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:60')), null, null),
  ('H22 uten komma',            'hentet', jsonb_build_array(pg_temp.logg('10.11.2026 10:00:00')), null, null),
  ('H23 bare dato',             'hentet', jsonb_build_array(pg_temp.logg('10.11.2026')), null, null),
  ('H24 tosifret aar',          'hentet', jsonb_build_array(pg_temp.logg('10.11.26, 10:00:00')), null, null),
  ('H25 ISO-format',            'hentet', jsonb_build_array(pg_temp.logg('2026-11-10, 10:00:00')), null, null),
  ('H26 tresifret dag',         'hentet', jsonb_build_array(pg_temp.logg('010.11.2026, 10:00:00')), null, null),
  ('H27 aar 0000',              'hentet', jsonb_build_array(pg_temp.logg('10.11.0000, 10:00:00')), null, null),
  ('H28 tom tid',               'hentet', jsonb_build_array(pg_temp.logg('')), null, null),
  ('H29 tekst som tid',         'hentet', jsonb_build_array(pg_temp.logg('tirsdag')), null, null),
  ('H30 tid er et tall',        'hentet', jsonb_build_array(jsonb_build_object('av', 'TESTANSATT 1', 'tid', 20261110, 'txt', 'Status endret til: Hentet')), null, null),
  ('H31 uten tid-nokkel',       'hentet', jsonb_build_array(jsonb_build_object('av', 'TESTANSATT 1', 'txt', 'Status endret til: Hentet')), null, null),
  ('H32 tid med norsk mellomrom (nbsp) etter komma', 'hentet', jsonb_build_array(pg_temp.logg('10.11.2026,' || chr(160) || '10:00:00')), null, '2026-11-10'),
  -- bare NØYAKTIG teksten teller
  ('H40 liten h',               'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00', 'Status endret til: hentet')), null, null),
  ('H41 etterfolgende mellomrom', 'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00', 'Status endret til: Hentet ')), null, null),
  ('H42 ledende mellomrom',     'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00', ' Status endret til: Hentet')), null, null),
  ('H43 annet tillegg',         'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00', 'Status endret til: Hentet (arkivert)')), null, null),
  ('H44 mer tekst',             'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00', 'Status endret til: Hentet igjen')), null, null),
  ('H45 annen status',          'hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00', 'Status endret til: Klar for henting')), null, null),
  ('H46 txt er et tall',        'hentet', jsonb_build_array(jsonb_build_object('av', 'TESTANSATT 1', 'tid', '10.11.2026, 10:00:00', 'txt', 5)), null, null),
  ('H47 uten txt',              'hentet', jsonb_build_array(jsonb_build_object('av', 'TESTANSATT 1', 'tid', '10.11.2026, 10:00:00')), null, null),
  -- endringer som ikke er en liste av objekter
  ('H50 rare elementer rundt',  'hentet', jsonb_build_array(42, 'tekst', null, jsonb_build_array(1), pg_temp.logg('10.11.2026, 10:00:00'), '{}'::jsonb), null, '2026-11-10'),
  ('H51 endringer er et objekt', 'hentet', '{"a":1}'::jsonb, null, null),
  ('H52 endringer er en streng', 'hentet', '"x"'::jsonb, null, null),
  ('H53 endringer er JSON-null', 'hentet', 'null'::jsonb, null, null),
  ('H54 endringer er NULL',     'hentet', null, null, null),
  ('H55 endringer er NULL, frossetVed finnes', 'hentet', null, pg_temp.fr('2026-11-12T10:00:00.000Z'), '2026-11-12'),
  -- frossetVed: ISO i UTC (toISOString), regnes om til norsk dato
  ('F01 uten millisekunder',    'hentet', '[]', pg_temp.fr('2026-11-10T23:00:00Z'), '2026-11-11'),
  ('F02 uten millisekunder for midnatt', 'hentet', '[]', pg_temp.fr('2026-11-10T22:59:59Z'), '2026-11-10'),
  ('F03 med 6 sifre',           'hentet', '[]', pg_temp.fr('2026-11-10T22:59:59.999999Z'), '2026-11-10'),
  ('F10 dato alene',            'hentet', '[]', pg_temp.fr('2026-11-10'), null),
  ('F11 uten Z',                'hentet', '[]', pg_temp.fr('2026-11-10T10:00:00.000'), null),
  ('F12 med offset',            'hentet', '[]', pg_temp.fr('2026-11-10T10:00:00+01:00'), null),
  ('F13 mellomrom i stedet for T', 'hentet', '[]', pg_temp.fr('2026-11-10 10:00:00Z'), null),
  ('F14 30 feb',                'hentet', '[]', pg_temp.fr('2026-02-30T10:00:00.000Z'), null),
  ('F15 mnd 13',                'hentet', '[]', pg_temp.fr('2026-13-01T10:00:00.000Z'), null),
  ('F16 time 24',               'hentet', '[]', pg_temp.fr('2026-11-10T24:00:00.000Z'), null),
  ('F17 minutt 60',             'hentet', '[]', pg_temp.fr('2026-11-10T10:60:00.000Z'), null),
  ('F18 sekund 60',             'hentet', '[]', pg_temp.fr('2026-11-10T10:00:60.000Z'), null),
  ('F19 7 brøksifre',           'hentet', '[]', pg_temp.fr('2026-11-10T10:00:00.1234567Z'), null),
  ('F20 forran tekst',          'hentet', '[]', pg_temp.fr('x2026-11-10T10:00:00.000Z'), null),
  ('F21 aar 0000',              'hentet', '[]', pg_temp.fr('0000-11-10T10:00:00.000Z'), null),
  ('F22 tom',                   'hentet', '[]', pg_temp.fr(''), null),
  ('F23 tekst',                 'hentet', '[]', pg_temp.fr('abc'), null),
  ('F24 JSON-null',             'hentet', '[]', '{"totalMs":60000,"frossetVed":null}'::jsonb, null),
  ('F25 tall',                  'hentet', '[]', '{"totalMs":60000,"frossetVed":20261110}'::jsonb, null),
  ('F26 boolsk',                'hentet', '[]', '{"totalMs":60000,"frossetVed":true}'::jsonb, null),
  ('F27 objekt',                'hentet', '[]', '{"totalMs":60000,"frossetVed":{"a":1}}'::jsonb, null),
  ('F28 liste',                 'hentet', '[]', '{"totalMs":60000,"frossetVed":["2026-11-10T10:00:00.000Z"]}'::jsonb, null),
  ('F29 uten frossetVed',       'hentet', '[]', '{"totalMs":60000}'::jsonb, null),
  ('F30 frossen er en liste',   'hentet', '[]', '["2026-11-10T10:00:00.000Z"]'::jsonb, null),
  -- IKKE hentet: aldri dato, selv med logglinje og frossetVed (S19)
  ('N01 klar_henting med logg og frossetVed', 'klar_henting', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00')), pg_temp.fr('2026-11-10T10:00:00.000Z'), null),
  ('N02 paabegynt med logg',    'paabegynt', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00')), null, null),
  ('N03 gammel status bestilt_frakt med logg', 'bestilt_frakt', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00')), pg_temp.fr('2026-11-10T10:00:00.000Z'), null),
  ('N04 «Hentet» med stor bokstav er ikke hentet', 'Hentet', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00')), pg_temp.fr('2026-11-10T10:00:00.000Z'), null),
  ('N05 polstret status hentet er ikke hentet', '  hentet  ', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00')), pg_temp.fr('2026-11-10T10:00:00.000Z'), null),
  ('N06 NULL status',           null, jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00')), pg_temp.fr('2026-11-10T10:00:00.000Z'), null),
  ('N07 tom status',            '', jsonb_build_array(pg_temp.logg('10.11.2026, 10:00:00')), pg_temp.fr('2026-11-10T10:00:00.000Z'), null),
  ('N08 ikke_paabegynt med frossetVed', 'ikke_paabegynt', '[]', pg_temp.fr('2026-11-10T10:00:00.000Z'), null);
insert into _sc (modell, ordre_status, endr, frossen, omb) select 'T103 ' || etikett, status, endr, frossen, pg_temp.omb1() from _hd;
-- frossetVed i midnatt-tabellen (samme tidspunkter som for forste_okt; ingen økter, bare frossen tid)
insert into _sc (modell, ordre_status, frossen) select 'T104 ' || etikett, 'hentet', pg_temp.fr(to_char(utc::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) from _mid;

insert into public.ordrer (id, ordretype, merke, modell, ordre_status, status, ordre_timer_sessions, klargjoring_timer_sessions, effektiv_tid_frossen, kunde, chassis, eier, endringer, ankomstdato)
select 'ord_test_tim_' || lpad(n::text, 5, '0'), ordretype, merke, modell, ordre_status, status, omb, klarg, frossen, kunde, chassis, eier, endr, ankomst from _sc;

do $test$
declare
  r jsonb; r2 jsonb; v_n int; v_n2 int; v_o1 int; v_o2 int; v_o3 int; v_tekst text; v_ok boolean; v_feil text;
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
  insert into _r select 'T74 tom', j from _all where j->>'ankomst_dato' = '1234-05-06';

  -- ===== S3 Svarets form =====
  perform pg_temp.sjekk('S3 toppnivået har nøyaktig versjon, generert, antall og biler; versjon er 1; antall = lengden på biler',
    (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['antall', 'biler', 'generert', 'versjon'] and r->>'versjon' = '1' and jsonb_typeof(r->'versjon') = 'number'
    and jsonb_typeof(r->'antall') = 'number' and (r->>'antall')::int = jsonb_array_length(r->'biler'), r->>'antall');
  perform pg_temp.sjekk('S3 generert er et UTC-tidspunkt med millisekunder', (r->>'generert') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$', null);
  perform pg_temp.sjekk('S3 HVER rad (ekte og test) har nøyaktig de 15 feltene i kontrakten og ingen andre (ingen samlet «pagaar»)',
    (select count(*) > 0 and bool_and((select array_agg(k order by k) from jsonb_object_keys(a.j) k) =
       array['ankomst_dato', 'arkivert', 'forste_okt', 'frossen_effektiv_minutter', 'hentet', 'hentet_dato', 'merke', 'minutter_klargjoring', 'minutter_ombygging', 'modell',
             'okter_ombygging', 'okter_ombygging_glemt', 'ordre_status', 'pagaar_klargjoring', 'pagaar_ombygging']) from _all a));
  perform pg_temp.sjekk('S3 HVER rad har riktige typer: tekst, boolsk (aldri null), hele tall >= 0 (frossen: hele tall >= 0 eller null)',
    (select bool_and(jsonb_typeof(j->'merke') = 'string' and jsonb_typeof(j->'modell') = 'string' and jsonb_typeof(j->'ordre_status') = 'string'
       and jsonb_typeof(j->'arkivert') = 'boolean' and jsonb_typeof(j->'hentet') = 'boolean' and jsonb_typeof(j->'pagaar_ombygging') = 'boolean' and jsonb_typeof(j->'pagaar_klargjoring') = 'boolean'
       and (j->>'hentet')::boolean = ((j->>'ordre_status') = 'hentet')
       and jsonb_typeof(j->'minutter_ombygging') = 'number' and (j->>'minutter_ombygging') ~ '^\d+$'
       and jsonb_typeof(j->'okter_ombygging') = 'number' and (j->>'okter_ombygging') ~ '^\d+$'
       and jsonb_typeof(j->'okter_ombygging_glemt') = 'number' and (j->>'okter_ombygging_glemt') ~ '^\d+$'
       and jsonb_typeof(j->'minutter_klargjoring') = 'number' and (j->>'minutter_klargjoring') ~ '^\d+$'
       and (jsonb_typeof(j->'frossen_effektiv_minutter') = 'null' or (jsonb_typeof(j->'frossen_effektiv_minutter') = 'number' and (j->>'frossen_effektiv_minutter') ~ '^\d+$'))
       and length(j->>'merke') <= 100 and length(j->>'modell') <= 100) from _all));
  perform pg_temp.sjekk('S3 HVER rad har ordre_status = nøyaktig én av de åtte kodene (aldri null, tom eller en annen verdi)',
    (select count(*) > 0 and bool_and(j->>'ordre_status' in ('paa_vei', 'ikke_paabegynt', 'paabegynt', 'ikke_veid', 'klar_visning', 'vist_biltilsyn', 'klar_henting', 'hentet')) from _all));
  perform pg_temp.sjekk('S3 HVER rad: ankomst_dato, forste_okt og hentet_dato er null eller en EKTE YYYY-MM-DD-dato (kontrollert med ::date), og hentet_dato er null når hentet = false',
    (select bool_and(pg_temp.er_dato(j->'ankomst_dato') and pg_temp.er_dato(j->'forste_okt') and pg_temp.er_dato(j->'hentet_dato')
       and (jsonb_typeof(j->'hentet_dato') = 'null' or (j->>'hentet')::boolean)) from _all));

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

  -- ===== S6 Åpne økter: pagaar_ombygging og pagaar_klargjoring er uavhengige =====
  perform pg_temp.sjekk('S6 åpen økt (stopp = null) i Ombygging gir pagaar_ombygging (ikke pagaar_klargjoring) og teller ikke med (60 min, 1 økt)', pg_temp.rad('T10 apen') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1,"pagaar_ombygging":true}'), pg_temp.rad('T10 apen')::text);
  perform pg_temp.sjekk('S6 åpen klargjøring-økt gir pagaar_klargjoring (ikke pagaar_ombygging) og en rad med nuller', pg_temp.rad('T11 apen klargjoring') = pg_temp.forv('{"pagaar_klargjoring":true}'), pg_temp.rad('T11 apen klargjoring')::text);
  perform pg_temp.sjekk('S6 økt uten stopp-nøkkel er også åpen (pagaar_ombygging)', pg_temp.rad('T12 apen uten stopp') = pg_temp.forv('{"pagaar_ombygging":true}'), pg_temp.rad('T12 apen uten stopp')::text);
  perform pg_temp.sjekk('S6 åpen i begge klokker gir begge true', pg_temp.rad('T10b apen begge') = pg_temp.forv('{"pagaar_ombygging":true,"pagaar_klargjoring":true}'), pg_temp.rad('T10b apen begge')::text);
  perform pg_temp.sjekk('S6 NØKKELSCENARIO: en HENTET bil med lukket Ombygging (60 min) og åpen Klargjøring-klokke: pagaar_klargjoring = true og pagaar_ombygging = false',
    pg_temp.rad('T10c hentet apen klargjoring') = pg_temp.forv('{"ordre_status":"hentet","hentet":true,"arkivert":true,"minutter_ombygging":60,"okter_ombygging":1,"pagaar_klargjoring":true,"pagaar_ombygging":false}'),
    pg_temp.rad('T10c hentet apen klargjoring')::text);
  perform pg_temp.sjekk('S6 en hentet bil med åpen Ombygging og lukket Klargjøring: pagaar_ombygging = true, pagaar_klargjoring = false',
    pg_temp.rad('T10e hentet apen ombygging') = pg_temp.forv('{"ordre_status":"hentet","hentet":true,"arkivert":true,"minutter_klargjoring":30,"pagaar_ombygging":true,"pagaar_klargjoring":false}'),
    pg_temp.rad('T10e hentet apen ombygging')::text);
  perform pg_temp.sjekk('S6 åpen Ombygging og lukket Klargjøring på en bil som ikke er hentet gir bare pagaar_ombygging', pg_temp.rad('T10d apen klarg lukket omb') = pg_temp.forv('{"minutter_klargjoring":30,"pagaar_ombygging":true}'), pg_temp.rad('T10d apen klarg lukket omb')::text);
  perform pg_temp.sjekk('S6 en bil uten åpne økter har begge false (aldri null: bool_or over en tom mengde er NULL)',
    pg_temp.rad('T01 teller') -> 'pagaar_ombygging' = 'false'::jsonb and pg_temp.rad('T01 teller') -> 'pagaar_klargjoring' = 'false'::jsonb
    and pg_temp.rad('T05 klarg rund sum') -> 'pagaar_ombygging' = 'false'::jsonb and pg_temp.rad('T21 frossen') -> 'pagaar_klargjoring' = 'false'::jsonb, null);

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
  perform pg_temp.sjekk('S9 polstret «  hentet  » og « arkivert » er IKKE trimmet (kontraktens case-uttrykk og coalesce(status = ''arkivert'', false)): ikke_paabegynt, ikke hentet, ikke arkivert',
    pg_temp.rad('T43 polstret status') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1}'), pg_temp.rad('T43 polstret status')::text);
  perform pg_temp.sjekk('S9 påbegynt/aktiv og ukjent status gir arkivert = false', pg_temp.rad('T44 paabegynt aktiv') = pg_temp.forv('{"ordre_status":"paabegynt","minutter_ombygging":60,"okter_ombygging":1}')
    and pg_temp.rad('T46 annen status') = pg_temp.forv('{"ordre_status":"paabegynt","minutter_ombygging":60,"okter_ombygging":1}'), null);
  perform pg_temp.sjekk('S9 alle 8 statuskodene i appen går uendret gjennom, og bare hentet gir hentet = true',
    (select count(*) = 8 and bool_and((j->>'ordre_status') = substr(m, 5) and (j->>'hentet')::boolean = (substr(m, 5) = 'hentet')) from (select modell as m, j from _r where modell like 'T45 %') x), null);
  perform pg_temp.sjekk('S9 gamle og ukjente verdier (bestilt_frakt, «Hentet», «HENTET», klar_for_henting, polstret, hentet + nbsp, arkivert, aktiv, «0», «null») blir ikke_paabegynt og aldri hentet',
    (select count(*) = 12 and bool_and((j->>'ordre_status') = 'ikke_paabegynt' and (j->>'hentet')::boolean = false) from _r where modell like 'T47 %'),
    (select string_agg(modell || '=' || (j->>'ordre_status'), ', ') from _r where modell like 'T47 %' and (j->>'ordre_status') <> 'ikke_paabegynt'));

  -- ===== S10 Bare bil-ordrer =====
  perform pg_temp.sjekk('S10 ordretype leveranse gir ingen rad, selv med økter og frossen tid', not exists (select 1 from _r where modell = 'T50 leveranse'), null);

  -- ===== S11 Ingen id, chassis, kunde, kontaktperson eller ansattnavn i svaret =====
  v_tekst := r::text;
  perform pg_temp.sjekk('S11 raden til en bil med kunde, chassis, kontaktperson, ansattnavn og -id har bare de 15 kontraktsfeltene (summert 60 + 30 min)',
    pg_temp.rad('T60 privat') = pg_temp.forv('{"minutter_ombygging":60,"okter_ombygging":1,"minutter_klargjoring":30}')
    and (select count(*) from jsonb_object_keys((select j from _r where modell = 'T60 privat'))) = 15, pg_temp.rad('T60 privat')::text);
  perform pg_temp.sjekk('S11 ingen av testens id-er, kunde-, chassis-, eier-, logg- eller ansattverdier finnes noe sted i svaret (hele teksten gjennomsøkt)',
    position('ord_test_tim' in v_tekst) = 0 and position('TESTKUNDE' in v_tekst) = 0 and position('TESTCHASSIS' in v_tekst) = 0 and position('TESTEIER' in v_tekst) = 0
    and position('TESTLOGGTEKST' in v_tekst) = 0 and position('TESTANSATT' in v_tekst) = 0 and position('ansattId' in v_tekst) = 0 and position('"ansatt"' in v_tekst) = 0 and position('"id"' in v_tekst) = 0
    and position('"av"' in v_tekst) = 0 and position('"txt"' in v_tekst) = 0 and position('"endringer"' in v_tekst) = 0 and position('"tid"' in v_tekst) = 0, null);

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

  -- ===== S15 ankomst_dato =====
  select string_agg(a.etikett || ' (fikk ' || coalesce(pg_temp.f('T100 ' || a.etikett, 'ankomst_dato')::text, 'ingen rad') || ')', '; ') into v_feil
    from _ank a where pg_temp.f('T100 ' || a.etikett, 'ankomst_dato') is distinct from coalesce(to_jsonb(a.forventet), 'null'::jsonb);
  perform pg_temp.sjekk('S15 ankomst_dato: ' || (select count(*) from _ank) || ' verdier (ekte datoer, skuddår 2000/2028/1900, ugyldige dager/måneder/år, feil format, mellomrom, tom, tankestrek, NULL, arabisk-indiske sifre) gir forventet dato eller null', v_feil is null, v_feil);
  perform pg_temp.sjekk('S15 ankomst_dato brukes som den står (ingen omregning): 2026-11-10 gir 2026-11-10', pg_temp.f('T100 A01 vanlig', 'ankomst_dato') = '"2026-11-10"'::jsonb, null);

  -- ===== S16 forste_okt =====
  select string_agg(o.etikett || ' (fikk ' || coalesce(pg_temp.f('T101 ' || o.etikett, 'forste_okt')::text, 'ingen rad') || ')', '; ') into v_feil
    from _fo o where pg_temp.f('T101 ' || o.etikett, 'forste_okt') is distinct from coalesce(to_jsonb(o.forventet), 'null'::jsonb);
  perform pg_temp.sjekk('S16 forste_okt: ' || (select count(*) from _fo) || ' scenarioer (tidligste start, glemt, over 14 t, åpen, uten varighet, ugyldig stopp, ugyldige starter, bare Klargjøring, start 0, år 9999) gir forventet dato', v_feil is null, v_feil);
  perform pg_temp.sjekk('S16 standardøktene (2026-09-21 14:13:20 UTC) gir forste_okt 2026-09-21; en bil uten økter (bare frossen tid) gir null',
    pg_temp.f('T01 teller', 'forste_okt') = '"2026-09-21"'::jsonb and pg_temp.f('T10 apen', 'forste_okt') = '"2026-09-21"'::jsonb and pg_temp.f('T08 glemt kort', 'forste_okt') = '"2026-09-21"'::jsonb
    and pg_temp.f('T21 frossen', 'forste_okt') = 'null'::jsonb and pg_temp.f('T11 apen klargjoring', 'forste_okt') = 'null'::jsonb and pg_temp.f('T05 klarg rund sum', 'forste_okt') = 'null'::jsonb, null);
  perform pg_temp.sjekk('S16 ankomst_dato er null når ordrer.ankomstdato er NULL (de fleste testbilene) og forste_okt påvirkes ikke av den',
    pg_temp.f('T01 teller', 'ankomst_dato') = 'null'::jsonb and pg_temp.f('T01 teller', 'hentet_dato') = 'null'::jsonb, null);

  -- ===== S17 hentet_dato (logg først, så frossetVed, ellers null) =====
  select string_agg(h.etikett || ' (fikk ' || coalesce(pg_temp.f('T103 ' || h.etikett, 'hentet_dato')::text, 'ingen rad') || ')', '; ') into v_feil
    from _hd h where pg_temp.f('T103 ' || h.etikett, 'hentet_dato') is distinct from coalesce(to_jsonb(h.forventet), 'null'::jsonb);
  perform pg_temp.sjekk('S17 hentet_dato: ' || (select count(*) from _hd) || ' scenarioer (logg, flere linjer, ugyldige tider, feil tekst, rare elementer, frossetVed i alle former, ikke hentet) gir forventet dato eller null', v_feil is null, v_feil);
  perform pg_temp.sjekk('S17 logglinjens dato brukes uten tidssoneomregning (31.12.2026, 23:59:59 gir 2026-12-31), mens frossetVed regnes om (2026-12-31T23:30:00Z gir 2027-01-01)',
    pg_temp.f('T103 H11 31.12 sent paa kvelden: ingen tidssoneomregning', 'hentet_dato') = '"2026-12-31"'::jsonb and pg_temp.f('T104 M13 aarsskifte', 'hentet_dato') = '"2027-01-01"'::jsonb, null);
  perform pg_temp.sjekk('S17 en hentet bil med bare frossen tid (ingen økter) får datoen fra frossetVed, og forste_okt er null og minuttene 0',
    pg_temp.f('T104 M16 midt paa dagen', 'hentet_dato') = '"2026-11-10"'::jsonb and pg_temp.f('T104 M16 midt paa dagen', 'forste_okt') = 'null'::jsonb and pg_temp.f('T104 M16 midt paa dagen', 'minutter_ombygging') = '0'::jsonb, null);
  perform pg_temp.sjekk('S17 hentet_dato på den hentede bilen i S6 (T10c, hentet + arkivert, ingen logg eller frossetVed) er null', pg_temp.f('T10c hentet apen klargjoring', 'hentet_dato') = 'null'::jsonb, null);

  -- ===== S18 Midnatt i norsk tid =====
  select string_agg(m.etikett || ' (forste_okt fikk ' || coalesce(pg_temp.f('T102 ' || m.etikett, 'forste_okt')::text, 'ingen rad') || ')', '; ') into v_feil
    from _mid m where pg_temp.f('T102 ' || m.etikett, 'forste_okt') is distinct from to_jsonb(m.forventet);
  perform pg_temp.sjekk('S18 forste_okt: ' || (select count(*) from _mid) || ' tidspunkter rundt norsk midnatt (sommer, vinter, begge skiftedager, årsskifte, skuddag) gir riktig norsk dato', v_feil is null, v_feil);
  select string_agg(m.etikett || ' (hentet_dato fikk ' || coalesce(pg_temp.f('T104 ' || m.etikett, 'hentet_dato')::text, 'ingen rad') || ')', '; ') into v_feil
    from _mid m where pg_temp.f('T104 ' || m.etikett, 'hentet_dato') is distinct from to_jsonb(m.forventet);
  perform pg_temp.sjekk('S18 hentet_dato fra frossetVed: de samme ' || (select count(*) from _mid) || ' tidspunktene gir samme norske dato', v_feil is null, v_feil);

  -- ===== S19 Ingen dato for en bil som ikke er hentet =====
  perform pg_temp.sjekk('S19 en bil som ikke er hentet har ALDRI hentet_dato, selv med Hentet-logglinje og frossetVed (klar_henting, påbegynt, gamle verdier, «Hentet», polstret, NULL, tom)',
    (select count(*) = 8 and bool_and(j->'hentet_dato' = 'null'::jsonb and (j->>'hentet')::boolean = false) from _r where modell like 'T103 N0%'),
    (select string_agg(modell, ', ') from _r where modell like 'T103 N0%' and j->'hentet_dato' <> 'null'::jsonb));
  perform pg_temp.sjekk('S19 de samme bilene har fortsatt forste_okt 2026-09-21 (datoene er uavhengige av hverandre: bare hentet_dato krever hentet)',
    (select count(*) = 8 from _r where modell like 'T103 N0%' and j->'forste_okt' = '"2026-09-21"'::jsonb), null);

  -- ===== S20 Tak: nøyaktig 2000 rader er greit, 2001 gir FOR_MANGE_BILER (SIST: setter inn mange rader) =====
  v_n := (public.portal_timer_fakta()->>'antall')::int;
  insert into public.ordrer (id, ordretype, merke, modell, effektiv_tid_frossen)
    select 'ord_test_tim_bulk_' || g, 'bil', 'TESTTIMBULK', 'B' || g, '{"totalMs":60000}'::jsonb from generate_series(1, greatest(2000 - v_n, 0)) g;
  v_n2 := (public.portal_timer_fakta()->>'antall')::int;
  perform pg_temp.sjekk('S20 nøyaktig 2000 rader er greit (svaret er ikke avkortet)', v_n2 = 2000 and jsonb_array_length(public.portal_timer_fakta()->'biler') = 2000, v_n2::text);
  begin
    insert into public.ordrer (id, ordretype, merke, modell, effektiv_tid_frossen) values ('ord_test_tim_bulk_siste', 'bil', 'TESTTIMBULK', 'B-siste', '{"totalMs":60000}');
    perform public.portal_timer_fakta();
    perform pg_temp.sjekk('S20 2001 rader gir FOR_MANGE_BILER (aldri et avkortet svar)', false, 'ingen feil');
  exception when others then
    perform pg_temp.sjekk('S20 2001 rader gir FOR_MANGE_BILER (aldri et avkortet svar)', sqlerrm = 'FOR_MANGE_BILER', sqlerrm);
  end;
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
