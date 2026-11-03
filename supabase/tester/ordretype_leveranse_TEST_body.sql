-- Test av 20261103100000_ordretype_leveranse.sql. ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, og ingen åpen app ser noe (realtime sender først ved commit).
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261103100000_ordretype_leveranse.sql; cat supabase/tester/ordretype_leveranse_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok = true.

create temp table _res (n serial, navn text, ok boolean, info text);
insert into public.portal_modell_kobling (portal_modell_slug, merke, modell, godkjent_av) values ('testmodell', 'TESTMERKE', 'TESTMODELL', 'test');

do $test$
declare
  r jsonb; v_n int; v_id text := 'ord_TEST_lev_' || to_char(clock_timestamp(), 'HH24MISSMS'); v_chassis text := 'TESTLEV0000000001';
  v_antall_for int; o public.ordrer%rowtype; v_ok boolean;
begin
  -- ===== T1 Alle eksisterende ordrer er blitt «bil» med tom leveranse, og de nye kolonnene er tomme =====
  select count(*) into v_n from public.ordrer where ordretype is distinct from 'bil' or leveranse is distinct from '{}'::jsonb or frakt_bestilt_at is not null or frakt_bestilt_av is not null or frakt_bestilt_til is not null;
  insert into _res(navn, ok, info) values ('T1 ingen eksisterende ordre er endret: alle er bil, leveranse = {}, ingen fraktbestilling', v_n = 0, v_n::text);

  -- ===== T2 Bare bil og leveranse er lov =====
  begin
    insert into public.ordrer (id, ordretype) values ('ord_TEST_feil_' || v_id, 'annet');
    insert into _res(navn, ok, info) values ('T2 ukjent ordretype avvises', false, 'ingen feil');
  exception when check_violation then
    insert into _res(navn, ok, info) values ('T2 ukjent ordretype avvises av constraint', true, null);
  end;

  -- ===== T3 En leveranse kan opprettes (som klienten gjør det: bare det den kjenner) og leses tilbake =====
  insert into public.ordrer (id, kunde, chassis, status, ordre_status, ordretype, leveranse)
  values (v_id, 'TEST - Leveranse kunde', v_chassis, 'aktiv', 'under_arbeid', 'leveranse', jsonb_build_object('merking', 'TEST-merking', 'fraktselskap', 'TEST-selskap'));
  select * into o from public.ordrer where id = v_id;
  insert into _res(navn, ok, info) values ('T3 leveransen er lagret med ordretype, status og egne felt', o.ordretype = 'leveranse' and o.ordre_status = 'under_arbeid' and o.leveranse->>'merking' = 'TEST-merking', o.ordretype);
  insert into _res(navn, ok, info) values ('T3 en leveranse har samme kolonner som andre ordrer med sine standardverdier (dokumenter [], fiken_linjer [])', o.dokumenter = '[]'::jsonb and o.fiken_linjer = '[]'::jsonb, 'ok');

  -- ===== T4 Portal-kobling: en bil-bestilling på samme chassis kobles ALDRI til leveransen =====
  select count(*) into v_antall_for from public.ordrer where upper(btrim(chassis)) = v_chassis;
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbestlev1', 'nr', 'B-TEST-LEV1', 'ident_type', 'CHASSIS', 'ident', v_chassis,
        'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'forhandler_navn', 'AK Auto AS', 'selger_navn', 'andreas kåsa', 'selger_epost', 'Andreas.AKauto@gmail.com', 'modell_slug', 'testmodell'));
  select count(*) into v_n from public.ordrer where upper(btrim(chassis)) = v_chassis;
  insert into _res(navn, ok, info) values ('T4 bil-bestilling på samme chassis som en leveranse lager en NY bil-ordre (ikke koblet til leveransen)', r->>'status' = 'ny_ordre' and r->>'ordre_id' <> v_id and v_n = v_antall_for + 1, r::text);
  select * into o from public.ordrer where id = v_id;
  insert into _res(navn, ok, info) values ('T4 leveransen er urørt (fortsatt leveranse, ingen portalkobling)', o.ordretype = 'leveranse' and o.portal_bestilling_id is null, coalesce(o.portal_bestilling_id, 'ingen'));
  select ordretype into o.ordretype from public.ordrer where id = r->>'ordre_id';
  insert into _res(navn, ok, info) values ('T4 den nye ordren er en vanlig bil-ordre', o.ordretype = 'bil', o.ordretype);

  -- ===== T5 Fraktbestillingen kan tas («claim») bare én gang =====
  update public.ordrer set frakt_bestilt_at = now(), frakt_bestilt_av = 'TEST', frakt_bestilt_til = 'test@example.invalid' where id = v_id and frakt_bestilt_at is null;
  get diagnostics v_n = row_count;
  insert into _res(navn, ok, info) values ('T5 første claim treffer én rad', v_n = 1, v_n::text);
  update public.ordrer set frakt_bestilt_at = now(), frakt_bestilt_av = 'TEST2', frakt_bestilt_til = 'test2@example.invalid' where id = v_id and frakt_bestilt_at is null;
  get diagnostics v_n = row_count;
  insert into _res(navn, ok, info) values ('T5 andre claim treffer ingen rad (aldri to bestillinger)', v_n = 0, v_n::text);
  select * into o from public.ordrer where id = v_id;
  insert into _res(navn, ok, info) values ('T5 den første bestillingen står igjen', o.frakt_bestilt_av = 'TEST' and o.frakt_bestilt_til = 'test@example.invalid', coalesce(o.frakt_bestilt_av, 'null'));
end;
$test$;

select n, navn, ok, info from _res order by n;
