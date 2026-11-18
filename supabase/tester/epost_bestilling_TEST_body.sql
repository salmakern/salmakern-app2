-- Test av 20261118200000_epost_bestilling.sql (trinn 5: bestilling på e-post). ALLTID i en transaksjon som rulles tilbake. Alt er syntetisk: forhandleren
-- k_test_epost_* legges midlertidig inn i innstillinger.kontakter, ordrene har id-prefiks ord_test_epost_ og chassis TESTWXYZ…, meldingene test_melding_*.
-- Testen OPPDATERER bare egne TEST-ordrer (ordre-push-triggeren kjører, men pg_net-køen rulles tilbake sammen med resten).
-- Kjøring mot den ekte databasen bare etter Henriks ja, utenom arbeidstid:
--   ( echo "begin;"; cat supabase/migrations/20261118200000_epost_bestilling.sql; cat supabase/tester/epost_bestilling_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Uten å røre databasen: samme filer mot PGlite med stubbet skjema (test.pglite = 1 slår på admin-delen, der current_ansatt() er stubbet).
-- Alle rader skal være OK.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v jsonb; v_ord text; v_n int; v_feil text;
  v_gammel_ord text := 'ord_test_epost_gammel';
  v_k jsonb := jsonb_build_array(
    jsonb_build_object('id', 'k_test_epost_a', 'navn', 'TEST Epost Forhandler A', 'type', 'Forhandler', 'orgnr', '999999991',
      'kontaktpersoner', jsonb_build_array(jsonb_build_object('navn', 'TEST Epost Selger', 'epost', 'selger@example.no'))),
    jsonb_build_object('id', 'k_test_epost_b', 'navn', 'TEST Epost Forhandler B', 'type', 'Forhandler', 'orgnr', '999999992', 'kontaktpersoner', '[]'::jsonb));
  rad_ok constant jsonb := '{"rad":1,"chassis":"TESTWXYZ000000061","modell_slug":"test-epost-modell","grunn_tekst":"TEST modell ombygning","tilvalg_tekst":"501 TEST tillegg","sikker":true,"grunner":[],"linjer":[{"produktnummer":"500","navn":"TEST ombygging","antall":1},{"produktnummer":"501","navn":"TEST tillegg","antall":2}]}';
  hode constant jsonb := '{"avsender":"selger@example.no","kontakt_id":"k_test_epost_a","kontakt_navn":"TEST Epost Forhandler A","selger_navn":"TEST Epost Selger"}';
begin
  update public.innstillinger set kontakter = coalesce(kontakter, '[]'::jsonb) || v_k where id = 1;
  insert into public.portal_modell_kobling (portal_modell_slug, merke, modell) values ('test-epost-modell', 'TESTMERKE', 'TESTMODELL') on conflict do nothing;

  -- E1: sikker rad uten ordre gir en ny ordre «På vei», ikke bekreftet, med linjene (kilde epost, antall, ingen rabatt)
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_1', 'rader', jsonb_build_array(rad_ok)));
  select ordre_id into v_ord from public.epost_bestillinger where melding_id = 'test_melding_1' and rad = 1;
  insert into _res(navn, ok, info) select 'E1 ny ordre fra e-post',
    v->'rader'->0->>'status' = 'ny_ordre' and exists (select 1 from public.ordrer o where o.id = v_ord and o.ordre_status = 'paa_vei' and o.status = 'aktiv'
      and o.kunde = 'TEST Epost Forhandler A' and o.eier = 'TEST Epost Selger' and o.chassis = 'TESTWXYZ000000061' and o.merke = 'TESTMERKE'
      and o.forhandler_kontakt_id = 'k_test_epost_a' and o.epost_bestilling_id is not null and o.epost_bekreftet_at is null and o.portal_bestilling_id is null
      and o.portal_linjer = '[{"produktnummer":"500","navn":"TEST ombygging","antall":1,"kilde":"epost"},{"produktnummer":"501","navn":"TEST tillegg","antall":2,"kilde":"epost"}]'::jsonb),
    v::text;

  -- E2: samme melding igjen: ingenting nytt
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_1', 'rader', jsonb_build_array(rad_ok)));
  select count(*) into v_n from public.ordrer where chassis = 'TESTWXYZ000000061';
  insert into _res(navn, ok, info) select 'E2 samme e-post to ganger gir én ordre', v_n = 1 and (v->'rader'->0->>'ny')::boolean = false, v::text;

  -- E3: sikker rad med en eksisterende ordre (samme kunde, etter 17.11, ingen bestilling) får linjene
  insert into public.ordrer (id, kunde, chassis, status, ordre_status, created_at) values ('ord_test_epost_e3', 'TEST Epost Forhandler A', 'TESTWXYZ000000063', 'aktiv', 'ikke_paabegynt', now());
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_3', 'rader', jsonb_build_array(rad_ok || '{"chassis":"TESTWXYZ000000063"}')));
  insert into _res(navn, ok, info) select 'E3 eksisterende ordre får linjene og en logglinje',
    v->'rader'->0->>'status' = 'lagt_paa' and exists (select 1 from public.ordrer where id = 'ord_test_epost_e3' and jsonb_array_length(portal_linjer) = 2
      and epost_bestilling_id is null and endringer::text like '%Bestilling på e-post fra TEST Epost Selger lagt på ordren: 500, 501 × 2.%'), v::text;

  -- E4: ordren tilhører en annen kunde
  insert into public.ordrer (id, kunde, chassis, status, ordre_status, created_at) values ('ord_test_epost_e4', 'TEST Annen Kunde', 'TESTWXYZ000000064', 'aktiv', 'ikke_paabegynt', now());
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_4', 'rader', jsonb_build_array(rad_ok || '{"chassis":"TESTWXYZ000000064"}')));
  insert into _res(navn, ok, info) select 'E4 annen kunde går til Innkommende',
    v->'rader'->0->>'status' = 'innkommende' and (select grunner::text like '%annen kunde (TEST Annen Kunde)%' from public.epost_bestillinger where melding_id = 'test_melding_4')
    and (select portal_linjer is null from public.ordrer where id = 'ord_test_epost_e4'), v::text;

  -- E5: ordren har allerede en annen bestilling
  insert into public.ordrer (id, kunde, chassis, status, ordre_status, created_at, portal_linjer) values ('ord_test_epost_e5', 'TEST Epost Forhandler A', 'TESTWXYZ000000065', 'aktiv', 'ikke_paabegynt', now(), '[{"produktnummer":"599","navn":"x","rabatt_prosent":0}]');
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_5', 'rader', jsonb_build_array(rad_ok || '{"chassis":"TESTWXYZ000000065"}')));
  insert into _res(navn, ok, info) select 'E5 ordre med annen bestilling går til Innkommende',
    v->'rader'->0->>'status' = 'innkommende' and (select grunner::text like '%allerede en bestilling%' from public.epost_bestillinger where melding_id = 'test_melding_5'), v::text;

  -- E6: ikke sikker: grunnene beholdes, ingen ordre
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_6', 'rader', jsonb_build_array(rad_ok || '{"chassis":"TESTWXYZ000000066","sikker":false,"grunner":["Summen går ikke opp"]}')));
  insert into _res(navn, ok, info) select 'E6 usikker rad blir stående i Innkommende med grunnen',
    v->'rader'->0->>'status' = 'innkommende' and not exists (select 1 from public.ordrer where chassis = 'TESTWXYZ000000066')
    and (select grunner = '["Summen går ikke opp"]'::jsonb from public.epost_bestillinger where melding_id = 'test_melding_6'), v::text;

  -- E7: ordre fra før «Skal på bilen»
  insert into public.ordrer (id, kunde, chassis, status, ordre_status, created_at) values (v_gammel_ord, 'TEST Epost Forhandler A', 'TESTWXYZ000000067', 'aktiv', 'ikke_paabegynt', '2026-11-01');
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_7', 'rader', jsonb_build_array(rad_ok || '{"chassis":"TESTWXYZ000000067"}')));
  insert into _res(navn, ok, info) select 'E7 gammel ordre går til Innkommende', v->'rader'->0->>'status' = 'innkommende'
    and (select grunner::text like '%fra før%' from public.epost_bestillinger where melding_id = 'test_melding_7'), v::text;

  -- E8: to aktive ordrer med samme chassis
  insert into public.ordrer (id, kunde, chassis, status, ordre_status, created_at) values ('ord_test_epost_e8a', 'TEST Epost Forhandler A', 'TESTWXYZ000000068', 'aktiv', 'ikke_paabegynt', now()), ('ord_test_epost_e8b', 'TEST Epost Forhandler A', 'TESTWXYZ000000068', 'aktiv', 'ikke_paabegynt', now());
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_8', 'rader', jsonb_build_array(rad_ok || '{"chassis":"TESTWXYZ000000068"}')));
  insert into _res(navn, ok, info) select 'E8 to ordrer med samme chassis går til Innkommende', v->'rader'->0->>'status' = 'innkommende', v::text;

  -- E9: ugyldige linjer avviser hele kallet (ingenting lagret)
  begin
    perform public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_9', 'rader', jsonb_build_array(rad_ok || '{"linjer":[{"produktnummer":"5x","navn":"x","antall":1}]}')));
    v_feil := 'ingen feil';
  exception when others then v_feil := sqlerrm;
  end;
  insert into _res(navn, ok, info) select 'E9 ugyldig linje avviser kallet', v_feil like 'UGYLDIG_INPUT%' and not exists (select 1 from public.epost_bestillinger where melding_id = 'test_melding_9'), v_feil;

  -- E10: ukjent forhandler (kontakt_id mangler) blir aldri en ordre selv om edge-funksjonen sa sikker
  v := public.epost_bestilling_lagre((hode - 'kontakt_id') || jsonb_build_object('melding_id', 'test_melding_10', 'rader', jsonb_build_array(rad_ok || '{"chassis":"TESTWXYZ000000060"}')));
  insert into _res(navn, ok, info) select 'E10 uten forhandler: Innkommende', v->'rader'->0->>'status' = 'innkommende' and not exists (select 1 from public.ordrer where chassis = 'TESTWXYZ000000060'), v::text;

  -- E11: uten innlogging stopper alle ansatt-funksjonene (i PGlite er current_ansatt() tom til test.ansatt settes)
  foreach v_feil in array array['legg_paa', 'lag_ordre', 'avvis', 'bekreft'] loop
    begin
      case v_feil
        when 'legg_paa' then perform public.epost_bestilling_legg_paa('x', 'y');
        when 'lag_ordre' then perform public.epost_bestilling_lag_ordre('x');
        when 'avvis' then perform public.epost_bestilling_avvis('x');
        else perform public.epost_bekreft_ordre(v_ord);
      end case;
      insert into _res(navn, ok, info) values ('E11 ' || v_feil || ' uten innlogging', false, 'ingen feil');
    exception when others then
      insert into _res(navn, ok, info) values ('E11 ' || v_feil || ' uten innlogging', sqlerrm in ('KUN_ADMIN', 'IKKE_INNLOGGET'), sqlerrm);
    end;
  end loop;

  -- E12: opprydding sletter behandlede rader eldre enn 60 dager, aldri innkommende
  update public.epost_bestillinger set mottatt_at = now() - interval '90 days', behandlet_at = now() - interval '90 days' where melding_id in ('test_melding_3', 'test_melding_6');
  perform public.epost_bestillinger_rydd();
  insert into _res(navn, ok, info) select 'E12 opprydding', not exists (select 1 from public.epost_bestillinger where melding_id = 'test_melding_3')
    and exists (select 1 from public.epost_bestillinger where melding_id = 'test_melding_6'), '';

  -- E13: taket på 10 ubekreftede e-postordrer per forhandler
  for v_n in 1..9 loop
    perform public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_tak_' || v_n, 'rader', jsonb_build_array(rad_ok || jsonb_build_object('chassis', 'TESTWXYZ0000001' || lpad(v_n::text, 2, '0')))));
  end loop;
  v := public.epost_bestilling_lagre(hode || jsonb_build_object('melding_id', 'test_melding_tak_10', 'rader', jsonb_build_array(rad_ok || '{"chassis":"TESTWXYZ000000110"}')));
  insert into _res(navn, ok, info) select 'E13 tak på 10 ubekreftede', v->'rader'->0->>'status' = 'innkommende'
    and (select grunner::text like '%10 ubekreftede%' from public.epost_bestillinger where melding_id = 'test_melding_tak_10'), v::text;

  -- Admin-delen (bare i PGlite, der current_ansatt() er stubbet via test.ansatt)
  if current_setting('test.pglite', true) = '1' then
    perform set_config('test.ansatt', '990101', true);
    -- A1: Bekreft
    v := public.epost_bekreft_ordre(v_ord);
    insert into _res(navn, ok, info) select 'A1 Bekreft setter tid og navn', v->>'kode' = 'ok' and (select epost_bekreftet_av = 'TEST Admin' and endringer::text like '%bekreftet%' from public.ordrer where id = v_ord), v::text;
    v := public.epost_bekreft_ordre(v_ord);
    insert into _res(navn, ok, info) select 'A1b Bekreft to ganger', v->>'kode' = 'allerede', v::text;
    -- A2: legg E4-raden (annen kunde) på en valgt ordre
    insert into public.ordrer (id, kunde, chassis, status, ordre_status, created_at) values ('ord_test_epost_a2', 'TEST Epost Forhandler A', 'TESTWXYZ000000072', 'aktiv', 'ikke_paabegynt', now());
    v := public.epost_bestilling_legg_paa((select id from public.epost_bestillinger where melding_id = 'test_melding_4'), 'ord_test_epost_a2');
    insert into _res(navn, ok, info) select 'A2 Legg på valgt ordre', v->>'kode' = 'ok' and (select status = 'lagt_paa' and behandlet_av = 'TEST Admin' from public.epost_bestillinger where melding_id = 'test_melding_4')
      and (select endringer::text like '%lagt på ordren av TEST Admin%' from public.ordrer where id = 'ord_test_epost_a2'), v::text;
    -- A3: lag ordre fra E6-raden (ingen ordre har chassis)
    v := public.epost_bestilling_lag_ordre((select id from public.epost_bestillinger where melding_id = 'test_melding_6'));
    insert into _res(navn, ok, info) select 'A3 Lag ordre fra Innkommende', v->>'kode' = 'ok' and exists (select 1 from public.ordrer where id = v->>'ordre_id' and chassis = 'TESTWXYZ000000066' and endringer::text like '%lagt inn av TEST Admin%'), v::text;
    -- A4: avvis, og ingen ny behandling etterpå
    v := public.epost_bestilling_avvis((select id from public.epost_bestillinger where melding_id = 'test_melding_5'));
    begin perform public.epost_bestilling_avvis((select id from public.epost_bestillinger where melding_id = 'test_melding_5')); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
    insert into _res(navn, ok, info) select 'A4 Avvis én gang', v->>'kode' = 'ok' and v_feil = 'ALLEREDE_BEHANDLET', v_feil;
    -- A5: lag ordre når chassis allerede finnes
    begin perform public.epost_bestilling_lag_ordre((select id from public.epost_bestillinger where melding_id = 'test_melding_8')); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
    insert into _res(navn, ok, info) select 'A5 Lag ordre stopper når chassis finnes', v_feil = 'CHASSIS_FINNES', v_feil;
  end if;
end $test$;

select n, case when ok then 'OK' else 'FEIL' end as resultat, navn, info from _res order by n;
