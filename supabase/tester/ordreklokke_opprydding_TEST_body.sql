-- Test av 20261104100000_ordreklokke_opprydding.sql. ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, og ingen åpen app ser noe (realtime sender først ved commit).
-- Kjøring (fra rotmappen), UTENOM natta (00-03 norsk tid: testen lager timeføringer i dag og bruker «nå minus 3 timer»):
--   (echo "begin;"; cat supabase/migrations/20261104100000_ordreklokke_opprydding.sql; cat supabase/tester/ordreklokke_opprydding_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok = true.
-- NB: stopp_forlatte_ordreklokker() kjøres her mot ALLE ordrer (også ekte), men alt rulles tilbake. Testene sjekker derfor bare TEST-ordrene, og tallene den returnerer vises bare som info.
-- Testen logger inn som en eksisterende admin INNE I transaksjonen (JWT-claims settes lokalt), og lager TEST-ansatte (990201-990207) og TEST-ordrer (TEST-okl-*) som forsvinner ved rollback.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_adm record; v_now bigint := (extract(epoch from now()) * 1000)::bigint; r jsonb; v_s jsonb; v_feil text; v_n int; v_txt text; v_siste_slutt timestamptz; v_ctid1 text; v_ctid2 text;
  v_sluttstart timestamptz := now() - interval '3 hours'; v_sluttstopp timestamptz := now() - interval '1 hour';
begin
  select id, session_token into v_adm from ansatte where aktiv and rolle = 'admin' and id < 990000 order by id limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);

  -- TEST-ansatte: A = ikke stemplet inn, B = stemplet inn (kan logge inn uten token), C = fører ikke lønn (kan ikke stemple)
  insert into ansatte (id, navn, rolle, aktiv, flere_enheter) values (990201, 'TEST - A ikke stemplet', 'ansatt', true, true), (990202, 'TEST - B stemplet', 'ansatt', true, true), (990203, 'TEST - C uten lonn', 'ansatt', true, true),
    (990204, 'TEST - D gammel stempling', 'ansatt', true, true), (990205, 'TEST - E darlig timeforing', 'ansatt', true, true),
    (990206, 'TEST - F stemplet 15 t', 'ansatt', true, true), (990207, 'TEST - G stemplet 17 t', 'ansatt', true, true);
  update ansatte set stemplet_inn_siden = now() - interval '2 hours' where id = 990202;
  update ansatte set stemplet_inn_siden = now() - interval '20 hours' where id = 990204;   -- D: glemt utstempling (over 16 t), teller ikke som stemplet inn
  update ansatte set stemplet_inn_siden = now() - interval '15 hours' where id = 990206;   -- F: rett under 16 t-grensen
  update ansatte set stemplet_inn_siden = now() - interval '17 hours' where id = 990207;   -- G: rett over
  update ansatte set kan_fore_lonn = false where id = 990203;

  -- ===== T1 Hjelperen =====
  insert into _res(navn, ok, info) values ('T1 ikke stemplet (A) = nei, stemplet (B) = ja, fører ikke lønn (C) = ja, ukjent = nei, null = nei',
    not ansatt_kan_ha_ordreklokke(990201) and ansatt_kan_ha_ordreklokke(990202) and ansatt_kan_ha_ordreklokke(990203) and not ansatt_kan_ha_ordreklokke(999999) and not ansatt_kan_ha_ordreklokke(null), null);
  insert into _res(navn, ok, info) values ('T1 en innstempling eldre enn 16 timer (D, glemt utstempling) teller IKKE som stemplet inn',
    not ansatt_kan_ha_ordreklokke(990204), null);
  insert into _res(navn, ok, info) values ('T1 16 t-grensen ligger riktig: 15 t gammel innstempling (F) teller, 17 t (G) teller ikke',
    ansatt_kan_ha_ordreklokke(990206) and not ansatt_kan_ha_ordreklokke(990207), null);

  -- ===== T2 Manuell start (oppdater_ordre_timer_sesjon) =====
  insert into ordrer (id, status, ordre_status, ansatte_signert) values ('TEST-okl-1', 'aktiv', 'paabegynt', '[]'::jsonb);
  begin perform oppdater_ordre_timer_sesjon('TEST-okl-1', 'ordre_timer_sessions', 'start', 990201, 'TEST - A'); insert into _res(navn, ok, info) values ('T2 start for en som IKKE er stemplet inn avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2 start for en som IKKE er stemplet inn avvises (IKKE_STEMPLET_INN)', sqlerrm = 'IKKE_STEMPLET_INN', sqlerrm); end;
  r := oppdater_ordre_timer_sesjon('TEST-okl-1', 'ordre_timer_sessions', 'start', 990202, 'TEST - B');
  insert into _res(navn, ok, info) values ('T2 start for en som er stemplet inn virker', jsonb_array_length(r->'sessions') = 1 and (r->'sessions'->0->>'stopp') is null, r::text);
  r := oppdater_ordre_timer_sesjon('TEST-okl-1', 'ordre_timer_sessions', 'start', 990202, 'TEST - B');
  insert into _res(navn, ok, info) values ('T2 ny start for samme person er idempotent (fortsatt én økt)', jsonb_array_length(r->'sessions') = 1, null);
  r := oppdater_ordre_timer_sesjon('TEST-okl-1', 'ordre_timer_sessions', 'start', 990203, 'TEST - C');
  insert into _res(navn, ok, info) values ('T2 start for en som ikke fører lønn (kan ikke stemple) virker', jsonb_array_length(r->'sessions') = 2, null);
  r := oppdater_ordre_timer_sesjon('TEST-okl-1', 'klargjoring_timer_sessions', 'start', 990201, 'TEST - A');
  insert into _res(navn, ok, info) values ('T2 Klargjøring (manuell klokke) krever IKKE innstempling', jsonb_array_length(r->'sessions') = 1, null);
  r := oppdater_ordre_timer_sesjon('TEST-okl-1', 'ordre_timer_sessions', 'stopp', 990203, 'TEST - C');
  insert into _res(navn, ok, info) values ('T2 stopp virker som før', (r->'sessions'->1->>'stopp') is not null and (r->'sessions'->0->>'stopp') is null, null);

  -- ===== T2b En vanlig ansatt kan bare starte/stoppe SIN EGEN klokke (gjennomgang 2026-11-04) =====
  insert into ordrer (id, status, ordre_status) values ('TEST-okl-1b', 'aktiv', 'paabegynt');
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990202, 'role', 'authenticated')::text, true);   -- logget inn som B (stemplet inn, vanlig ansatt)
  begin perform oppdater_ordre_timer_sesjon('TEST-okl-1b', 'ordre_timer_sessions', 'start', 990203, 'TEST - C'); insert into _res(navn, ok, info) values ('T2b en vanlig ansatt kan ikke STARTE en kollegas klokke', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2b en vanlig ansatt kan ikke STARTE en kollegas klokke (IKKE_TILLATT)', sqlerrm = 'IKKE_TILLATT', sqlerrm); end;
  begin perform oppdater_ordre_timer_sesjon('TEST-okl-1', 'ordre_timer_sessions', 'stopp', 990203, 'TEST - C'); insert into _res(navn, ok, info) values ('T2b en vanlig ansatt kan ikke STOPPE en kollegas klokke', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2b en vanlig ansatt kan ikke STOPPE en kollegas klokke (IKKE_TILLATT)', sqlerrm = 'IKKE_TILLATT', sqlerrm); end;
  r := oppdater_ordre_timer_sesjon('TEST-okl-1b', 'ordre_timer_sessions', 'start', 990202, 'TEST - B');
  insert into _res(navn, ok, info) values ('T2b en vanlig ansatt kan starte og stoppe sin EGEN klokke', jsonb_array_length(r->'sessions') = 1, r::text);
  r := oppdater_ordre_timer_sesjon('TEST-okl-1b', 'ordre_timer_sessions', 'stopp', 990202, 'TEST - B');
  insert into _res(navn, ok, info) values ('T2b ... og stoppe den', (r->'sessions'->0->>'stopp') is not null, r::text);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);   -- tilbake til admin
  r := oppdater_ordre_timer_sesjon('TEST-okl-1b', 'ordre_timer_sessions', 'start', 990203, 'TEST - C');
  insert into _res(navn, ok, info) values ('T2b admin kan starte en annens klokke (C fører ikke lønn)', jsonb_array_length(r->'sessions') = 2, r::text);

  -- ===== T2c Ugyldig (null) ansatt-id avvises (en sammenligning mot null slipper ellers gjennom «seg selv eller admin»-sperren) =====
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990202, 'role', 'authenticated')::text, true);
  begin perform oppdater_ordre_timer_sesjon('TEST-okl-1b', 'klargjoring_timer_sessions', 'start', null::integer, 'Spokelse'); insert into _res(navn, ok, info) values ('T2c start med null som ansatt-id avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2c start med null som ansatt-id avvises (UGYLDIG_ANSATT)', sqlerrm = 'UGYLDIG_ANSATT', sqlerrm); end;
  begin perform stopp_ordreklokker_for_ansatt(null::bigint); insert into _res(navn, ok, info) values ('T2c stopp_ordreklokker_for_ansatt med null avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2c stopp_ordreklokker_for_ansatt med null avvises (UGYLDIG_ANSATT)', sqlerrm = 'UGYLDIG_ANSATT', sqlerrm); end;
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);   -- tilbake til admin

  -- ===== T3 Fasestart for alle påmeldte (oppdater_ordre_timer_fase) =====
  insert into ordrer (id, status, ordre_status, ansatte_signert) values ('TEST-okl-2', 'aktiv', 'paabegynt',
    jsonb_build_array(jsonb_build_object('id', 990201, 'navn', 'TEST - A ikke stemplet'), jsonb_build_object('id', 990202, 'navn', 'TEST - B stemplet'), jsonb_build_object('id', 990203, 'navn', 'TEST - C uten lonn')));
  r := oppdater_ordre_timer_fase('TEST-okl-2', 'ordre_timer_sessions', 'start_alle_paameldte');
  insert into _res(navn, ok, info) values ('T3 fasestart starter bare for B og C, ikke for A',
    jsonb_array_length(r->'sessions') = 2 and (select bool_and((e->>'ansattId')::int in (990202, 990203)) from jsonb_array_elements(r->'sessions') e), r->>'sessions');
  insert into _res(navn, ok, info) values ('T3 fasestart melder tilbake hvem som ikke ble startet (ikkeStemplet = [A])', (r->'ikkeStemplet') = jsonb_build_array('TEST - A ikke stemplet'), (r->'ikkeStemplet')::text);
  r := oppdater_ordre_timer_fase('TEST-okl-2', 'ordre_timer_sessions', 'start_alle_paameldte');
  insert into _res(navn, ok, info) values ('T3 en ny fasestart gir ingen dobbeltøkter', jsonb_array_length(r->'sessions') = 2, null);
  insert into ordrer (id, status, ordre_status, ansatte_signert) values ('TEST-okl-3', 'aktiv', 'vist_biltilsyn', jsonb_build_array(jsonb_build_object('id', 990201, 'navn', 'TEST - A ikke stemplet')));
  r := oppdater_ordre_timer_fase('TEST-okl-3', 'klargjoring_timer_sessions', 'start_alle_paameldte');
  insert into _res(navn, ok, info) values ('T3 fasestart for Klargjøring starter også for en som ikke er stemplet inn (uendret oppførsel)', jsonb_array_length(r->'sessions') = 1 and jsonb_array_length(r->'ikkeStemplet') = 0, null);
  r := oppdater_ordre_timer_fase('TEST-okl-2', 'ordre_timer_sessions', 'avslutt_fase');
  insert into _res(navn, ok, info) values ('T3 avslutt_fase stopper alle og melder alle av som før', (select bool_and((e->>'stopp') is not null) from jsonb_array_elements(r->'sessions') e) and jsonb_array_length(r->'ansatteSignert') = 0, null);

  -- ===== T4 Stopp for en ansatt (egen utstempling og admin) =====
  insert into ordrer (id, status, ordre_status) values ('TEST-okl-4', 'aktiv', 'paabegynt'), ('TEST-okl-5', 'arkivert', 'hentet');
  update ordrer set ordre_timer_sessions = jsonb_build_array(
      jsonb_build_object('start', v_now - 4 * 3600000, 'stopp', null, 'ansattId', 990202, 'ansatt', 'TEST - B'),
      jsonb_build_object('start', v_now - 4 * 3600000, 'stopp', null, 'ansattId', 990203, 'ansatt', 'TEST - C')) where id = 'TEST-okl-4';
  update ordrer set ordre_timer_sessions = jsonb_build_array(jsonb_build_object('start', v_now - 5 * 3600000, 'stopp', null, 'ansattId', 990202, 'ansatt', 'TEST - B')) where id = 'TEST-okl-5';
  -- logget inn som B (vanlig ansatt)
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990202, 'role', 'authenticated')::text, true);
  begin perform stopp_ordreklokker_for_ansatt(990203); insert into _res(navn, ok, info) values ('T4 en vanlig ansatt kan ikke stoppe en annens klokke', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T4 en vanlig ansatt kan ikke stoppe en annens klokke (IKKE_TILLATT)', sqlerrm = 'IKKE_TILLATT', sqlerrm); end;
  begin perform stopp_ordreklokker_for_ansatt(990202, null, v_now - 60000); insert into _res(navn, ok, info) values ('T4 en vanlig ansatt kan ikke velge klokkeslett selv', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T4 en vanlig ansatt kan ikke velge klokkeslett selv (IKKE_TILLATT)', sqlerrm = 'IKKE_TILLATT', sqlerrm); end;
  r := stopp_ordreklokker_for_ansatt(990202);
  insert into _res(navn, ok, info) values ('T4 egen utstempling stopper ALLE mine åpne økter på alle ordrer (3: T2-ordren, TEST-okl-4 og den arkiverte), og ingen andres', (r->>'antall')::int = 3
    and (select count(*) from ordrer where id in ('TEST-okl-1', 'TEST-okl-4', 'TEST-okl-5') and not exists (select 1 from jsonb_array_elements(ordre_timer_sessions) e where e->>'ansattId' = '990202' and (e->>'stopp') is null)) = 3
    and (select (e->>'stopp') is null from ordrer o, jsonb_array_elements(o.ordre_timer_sessions) e where o.id = 'TEST-okl-4' and e->>'ansattId' = '990203'), r::text);
  r := stopp_ordreklokker_for_ansatt(990202);
  insert into _res(navn, ok, info) values ('T4 nytt kall er trygt (0 økter å stoppe)', (r->>'antall')::int = 0 and jsonb_array_length(r->'ordrer') = 0, null);
  -- logget inn som admin
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);
  begin perform stopp_ordreklokker_for_ansatt(990203, 'TEST-okl-4', v_now + 3600000); insert into _res(navn, ok, info) values ('T4 admin kan ikke stoppe i fremtiden', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T4 admin kan ikke stoppe i fremtiden (STOPP_I_FREMTIDEN)', sqlerrm = 'STOPP_I_FREMTIDEN', sqlerrm); end;
  r := stopp_ordreklokker_for_ansatt(990203, 'TEST-okl-4', v_now - 3600000);
  select e into v_s from ordrer o, jsonb_array_elements(o.ordre_timer_sessions) e where o.id = 'TEST-okl-4' and e->>'ansattId' = '990203';
  insert into _res(navn, ok, info) values ('T4 admin stopper en annens klokke på valgt klokkeslett (nå minus 1 t), merket stoppetAvAdmin', (r->>'antall')::int = 1 and (v_s->>'stopp')::bigint = v_now - 3600000 and (v_s->>'stoppetAvAdmin')::boolean, v_s::text);
  select endringer->-1->>'txt' into v_txt from ordrer where id = 'TEST-okl-4';
  insert into _res(navn, ok, info) values ('T4 admin-stopp logges på ordren', v_txt like '%TEST - C uten lonn%stoppet av administrator%', v_txt);
  update ordrer set ordre_timer_sessions = jsonb_build_array(jsonb_build_object('start', v_now - 600000, 'stopp', null, 'ansattId', 990203, 'ansatt', 'TEST - C')) where id = 'TEST-okl-4';
  perform stopp_ordreklokker_for_ansatt(990203, 'TEST-okl-4', v_now - 3600000);
  select e into v_s from ordrer o, jsonb_array_elements(o.ordre_timer_sessions) e where o.id = 'TEST-okl-4';
  insert into _res(navn, ok, info) values ('T4 stopp settes aldri før økta startet (klemmes til starten)', (v_s->>'stopp')::bigint = (v_s->>'start')::bigint, v_s::text);
  perform set_config('request.jwt.claims', '', true);
  begin perform stopp_ordreklokker_for_ansatt(990202); insert into _res(navn, ok, info) values ('T4 uten innlogging avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T4 uten innlogging avvises (IKKE_INNLOGGET)', sqlerrm = 'IKKE_INNLOGGET', sqlerrm); end;

  -- ===== T5 Opprydding (cron-funksjonen) =====
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);
  insert into timer_entries (id, ansatt_id, ansatt, dato, type, start, stopp, mins)
  values ('TEST-okl-te-1', 990201, 'TEST - A', (v_sluttstopp at time zone 'Europe/Oslo')::date::text, 'normal', to_char(v_sluttstart at time zone 'Europe/Oslo', 'HH24:MI'), to_char(v_sluttstopp at time zone 'Europe/Oslo', 'HH24:MI'), 120);
  insert into ordrer (id, status, ordre_status) values ('TEST-okl-6', 'aktiv', 'paabegynt'), ('TEST-okl-7', 'aktiv', 'paabegynt');
  update ordrer set ordre_timer_sessions = jsonb_build_array(
      jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A'),                -- 0: A, ikke stemplet, 30 min gammel, ingen timeføring å slå opp: stopp = start
      jsonb_build_object('start', v_now - 2 * 3600000, 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A'),               -- 1: A, ikke stemplet, timeføring som slutter for en time siden: stopp = slutten på den
      jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990202, 'ansatt', 'TEST - B'),                -- 2: B stemplet inn, 30 min: urørt
      jsonb_build_object('start', v_now - 15 * 3600000, 'stopp', null, 'ansattId', 990202, 'ansatt', 'TEST - B'),              -- 3: B (stemplet «siden i går»), 15 t: regel 2, stopp = start + 14 t
      jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990203, 'ansatt', 'TEST - C'),                -- 4: C fører ikke lønn: urørt
      jsonb_build_object('start', v_now - 5 * 60000, 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A'),                 -- 5: A, ikke stemplet, men bare 5 min gammel: urørt (nåde)
      jsonb_build_object('start', v_now - 6 * 3600000, 'stopp', v_now - 5 * 3600000, 'ansattId', 990201, 'ansatt', 'TEST - A') -- 6: allerede stoppet: urørt
    ), klargjoring_timer_sessions = jsonb_build_array(jsonb_build_object('start', v_now - 20 * 3600000, 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A')) where id = 'TEST-okl-6';
  update ordrer set ordre_timer_sessions = jsonb_build_array(jsonb_build_object('start', v_now - 3600000, 'stopp', v_now - 1800000, 'ansattId', 990202, 'ansatt', 'TEST - B')) where id = 'TEST-okl-7';
  select count(*) into v_n from ordrer where id = 'TEST-okl-7' and jsonb_array_length(endringer) > 0;
  -- TEST-okl-8: (0) A ikke stemplet, økta startet for 60 t siden og A har en timeføring som sluttet for en time siden (cron har «ligget etter»): stopp skal begrenses til start + 14 t, ikke strekkes til den nyeste føringen
  --             (1) en økt uten ansattId (gamle data): kaster ikke, stoppes ved starten
  insert into ordrer (id, status, ordre_status) values ('TEST-okl-8', 'aktiv', 'paabegynt');
  update ordrer set ordre_timer_sessions = jsonb_build_array(
      jsonb_build_object('start', v_now - 60 * 3600000, 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A'),
      jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansatt', 'Ukjent uten id'),
      jsonb_build_object('start', v_now - 15 * 3600000, 'stopp', null, 'ansattId', 990204, 'ansatt', 'TEST - D')) where id = 'TEST-okl-8';   -- (2) D: GAMMEL innstempling (20 t, glemt utstempling): hører under regel 2 (start + 14 t), ikke regel 1
  -- TEST-okl-9: dårlig data skal ikke velte opprydningen (feilisolasjon). E er ikke stemplet inn og har timeføringer med tom dato og umulig dato (cast-feil); ordren har i tillegg økter med start som tekst, et tall der en økt skulle vært, og en gyldig økt for A.
  insert into timer_entries (id, ansatt_id, ansatt, dato, type, start, stopp, mins) values
    ('TEST-okl-te-2', 990205, 'TEST - E', '', 'normal', '07:00', '08:00', 60), ('TEST-okl-te-3', 990205, 'TEST - E', '2026-13-45', 'normal', '09:00', '10:00', 60);
  insert into ordrer (id, status, ordre_status) values ('TEST-okl-9', 'aktiv', 'paabegynt');
  update ordrer set ordre_timer_sessions = jsonb_build_array(
      jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990205, 'ansatt', 'TEST - E'),     -- 0: E, dårlige timeføringer: stoppes ved starten (ingen føring kunne brukes)
      jsonb_build_object('start', 'abc', 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A start tekst'),     -- 1: start er tekst: røres ikke, kaster ikke
      to_jsonb(5),                                                                                                  -- 2: et tall i stedet for en økt: røres ikke, kaster ikke
      jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A'),    -- 3: gyldig økt for A: stoppes
      jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990206, 'ansatt', 'TEST - F'),    -- 4: F er stemplet inn for 15 t siden (under grensen): urørt
      jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990204, 'ansatt', 'TEST - D')     -- 5: D har en GAMMEL, ikke-tom stempling: regel 1 gjelder bare tom stempling, så økta er urørt (under 14 t)
    ) where id = 'TEST-okl-9';
  -- TEST-okl-10: en ordre som FEILER ved oppdatering (BEFORE UPDATE-trigger som kaster, bare for denne ordren, lagd inne i transaksjonen): den ytre delblokka skal hoppe over akkurat den, og alle andre ordrer behandles likevel.
  insert into ordrer (id, status, ordre_status) values ('TEST-okl-10', 'aktiv', 'paabegynt');
  update ordrer set ordre_timer_sessions = jsonb_build_array(jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A')) where id = 'TEST-okl-10';
  execute 'create function public.okl_test_kast() returns trigger language plpgsql as $f$ begin raise exception ''TEST-feil'' ; end; $f$';
  execute 'create trigger okl_test_kast before update on ordrer for each row when (old.id = ''TEST-okl-10'') execute function public.okl_test_kast()';
  -- TEST-okl-11: en ordre med en gyldig åpen økt (B stemplet inn): cron skal ikke skrive til den (ctid endres ved enhver oppdatering, også uten synlig endring)
  insert into ordrer (id, status, ordre_status) values ('TEST-okl-11', 'aktiv', 'paabegynt');
  update ordrer set ordre_timer_sessions = jsonb_build_array(jsonb_build_object('start', v_now - 30 * 60000, 'stopp', null, 'ansattId', 990202, 'ansatt', 'TEST - B')) where id = 'TEST-okl-11';
  select ctid::text into v_ctid1 from ordrer where id = 'TEST-okl-11';

  perform set_config('request.jwt.claims', '', true);   -- cron kjører uten innlogging
  r := stopp_forlatte_ordreklokker();
  insert into _res(navn, ok, info) values ('T5 funksjonen returnerer tellere (info: gjelder også eventuelle ekte økter, rullet tilbake)', r ? 'ikkeStemplet' and r ? 'glemt', r::text);

  select ordre_timer_sessions into v_s from ordrer where id = 'TEST-okl-6';
  insert into _res(navn, ok, info) values ('T5 regel 1, ingen timeføring: A sin økt stoppes ved starten og merkes ikke_stemplet_inn',
    (v_s->0->>'stopp')::bigint = (v_s->0->>'start')::bigint and v_s->0->>'autoStopp' = 'ikke_stemplet_inn', (v_s->0)::text);
  insert into _res(navn, ok, info) values ('T5 regel 1, med timeføring: stopp = slutten på timeføringen (nå minus 1 t, avrundet til minutt)',
    abs((v_s->1->>'stopp')::bigint - (extract(epoch from date_trunc('minute', v_sluttstopp)) * 1000)::bigint) <= 60000 and v_s->1->>'autoStopp' = 'ikke_stemplet_inn', (v_s->1)::text);
  insert into _res(navn, ok, info) values ('T5 B (stemplet inn, 30 min) røres ikke', (v_s->2->>'stopp') is null and not (v_s->2 ? 'autoStopp'), (v_s->2)::text);
  insert into _res(navn, ok, info) values ('T5 regel 2: en økt over 14 t stoppes ved start + 14 t og merkes glemt',
    (v_s->3->>'stopp')::bigint = (v_s->3->>'start')::bigint + 14 * 3600000 and v_s->3->>'autoStopp' = 'glemt', (v_s->3)::text);
  insert into _res(navn, ok, info) values ('T5 C (fører ikke lønn) røres ikke av regel 1', (v_s->4->>'stopp') is null, (v_s->4)::text);
  insert into _res(navn, ok, info) values ('T5 en økt yngre enn 10 min røres ikke', (v_s->5->>'stopp') is null, (v_s->5)::text);
  insert into _res(navn, ok, info) values ('T5 en allerede stoppet økt er uendret', (v_s->6->>'stopp')::bigint = v_now - 5 * 3600000 and not (v_s->6 ? 'autoStopp'), (v_s->6)::text);
  insert into _res(navn, ok, info) values ('T5 antall økter og rekkefølgen er bevart', jsonb_array_length(v_s) = 7 and v_s->0->>'ansattId' = '990201' and v_s->3->>'ansattId' = '990202' and v_s->6->>'ansattId' = '990201', null);
  select count(*) into v_n from ordrer where id = 'TEST-okl-6' and klargjoring_timer_sessions->0->>'stopp' is null;
  insert into _res(navn, ok, info) values ('T5 Klargjøring-klokka (manuell) røres aldri, selv om den er 20 t gammel', v_n = 1, null);
  select ordre_timer_sessions into v_s from ordrer where id = 'TEST-okl-8';
  insert into _res(navn, ok, info) values ('T5 regel 1 stopper aldri senere enn start + 14 t, selv om en nyere timeføring finnes (cron lå etter)',
    (v_s->0->>'stopp')::bigint = (v_s->0->>'start')::bigint + 14 * 3600000 and v_s->0->>'autoStopp' = 'ikke_stemplet_inn', (v_s->0)::text);
  insert into _res(navn, ok, info) values ('T5 en økt uten ansattId gir ingen feil og stoppes ved starten',
    (v_s->1->>'stopp')::bigint = (v_s->1->>'start')::bigint and v_s->1->>'autoStopp' = 'ikke_stemplet_inn', (v_s->1)::text);
  insert into _res(navn, ok, info) values ('T5 en GAMMEL innstempling (glemt utstempling) gir regel 2, ikke regel 1: økta stoppes ved start + 14 t (ikke null varighet) og merkes glemt',
    (v_s->2->>'stopp')::bigint = (v_s->2->>'start')::bigint + 14 * 3600000 and v_s->2->>'autoStopp' = 'glemt', (v_s->2)::text);
  select ordre_timer_sessions into v_s from ordrer where id = 'TEST-okl-9';
  insert into _res(navn, ok, info) values ('T5 feilisolasjon: timeføringer med tom/umulig dato gir ingen feil, og E sin økt stoppes ved starten',
    (v_s->0->>'stopp')::bigint = (v_s->0->>'start')::bigint and v_s->0->>'autoStopp' = 'ikke_stemplet_inn', (v_s->0)::text);
  insert into _res(navn, ok, info) values ('T5 feilisolasjon: en økt med start som tekst og et tall i lista røres ikke og velter ikke opprydningen',
    (v_s->1->>'stopp') is null and jsonb_typeof(v_s->2) = 'number', v_s::text);
  insert into _res(navn, ok, info) values ('T5 feilisolasjon: den gyldige økta på samme ordre stoppes likevel', (v_s->3->>'stopp') is not null and v_s->3->>'autoStopp' = 'ikke_stemplet_inn', (v_s->3)::text);
  insert into _res(navn, ok, info) values ('T5 F (stemplet inn for 15 t siden) og D (gammel stempling, under 14 t) sine økter på TEST-okl-9 er urørte',
    (v_s->4->>'stopp') is null and (v_s->5->>'stopp') is null and not (v_s->4 ? 'autoStopp') and not (v_s->5 ? 'autoStopp'), v_s::text);
  select ordre_timer_sessions into v_s from ordrer where id = 'TEST-okl-10';
  insert into _res(navn, ok, info) values ('T5 delblokk-isolasjon: en ordre som kaster ved oppdatering hoppes over (økta urørt, feil = 1), mens de andre ordrene ble behandlet som vanlig',
    (v_s->0->>'stopp') is null and (r->>'feil')::int = 1, r::text);
  execute 'drop trigger okl_test_kast on ordrer';
  select ctid::text into v_ctid2 from ordrer where id = 'TEST-okl-11';
  insert into _res(navn, ok, info) values ('T5 cron skriver ikke til en ordre der ingenting skal stoppes (ctid uendret)', v_ctid1 = v_ctid2, v_ctid1 || ' -> ' || v_ctid2);
  select count(*) into v_n from jsonb_array_elements((select endringer from ordrer where id = 'TEST-okl-6')) e where e->>'av' = 'System';
  insert into _res(navn, ok, info) values ('T5 hver automatiske stopp er logget på ordren (3 økter: A, A og B)', v_n = 3, v_n::text);
  insert into _res(navn, ok, info) values ('T5 en ordre uten noe å rydde får ingen ny logglinje og er uendret', (select jsonb_array_length(coalesce(endringer, '[]'::jsonb)) from ordrer where id = 'TEST-okl-7') = 0, null);
  r := stopp_forlatte_ordreklokker();
  select count(*) into v_n from jsonb_array_elements((select endringer from ordrer where id = 'TEST-okl-6')) e where e->>'av' = 'System';
  insert into _res(navn, ok, info) values ('T5 neste kjøring gjør ingenting mer på TEST-ordrene (idempotent): fortsatt 3 logglinjer', v_n = 3, v_n::text);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);
  update ansatte set stemplet_inn_siden = now() where id = 990201;
  update ordrer set ordre_timer_sessions = jsonb_build_array(jsonb_build_object('start', v_now - 3600000, 'stopp', null, 'ansattId', 990201, 'ansatt', 'TEST - A')) where id = 'TEST-okl-7';
  perform set_config('request.jwt.claims', '', true);
  perform stopp_forlatte_ordreklokker();
  insert into _res(navn, ok, info) values ('T5 stemples A inn, røres hens åpne økt ikke lenger', (select (ordre_timer_sessions->0->>'stopp') is null from ordrer where id = 'TEST-okl-7'), null);

  -- ===== T6 Rettigheter og planlegging =====
  insert into _res(navn, ok, info) values ('T6 opprydningsfunksjonen kan ikke kalles av anon/authenticated (bare cron)',
    not has_function_privilege('anon', 'public.stopp_forlatte_ordreklokker()', 'execute') and not has_function_privilege('authenticated', 'public.stopp_forlatte_ordreklokker()', 'execute'), null);
  insert into _res(navn, ok, info) values ('T6 RPC-ene for appen kan kalles av innloggede (de sjekker innloggingen selv)',
    has_function_privilege('authenticated', 'public.stopp_ordreklokker_for_ansatt(bigint, text, bigint)', 'execute') and has_function_privilege('authenticated', 'public.oppdater_ordre_timer_sesjon(text, text, text, integer, text)', 'execute'), null);
  insert into _res(navn, ok, info) values ('T6 hjelperen ansatt_kan_ha_ordreklokke kan IKKE kalles av anon/authenticated/PUBLIC (ellers kan hvem som helst se hvem som er stemplet inn)',
    not has_function_privilege('anon', 'public.ansatt_kan_ha_ordreklokke(bigint)', 'execute') and not has_function_privilege('authenticated', 'public.ansatt_kan_ha_ordreklokke(bigint)', 'execute')
    and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.ansatt_kan_ha_ordreklokke(bigint)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), null);
  insert into _res(navn, ok, info) values ('T6 cron-jobben er planlagt hvert 10. minutt', (select count(*) from cron.job where jobname = 'stopp-forlatte-ordreklokker' and schedule = '*/10 * * * *') = 1, null);
end;
$test$;

select n, navn, ok, info from _res order by n;
