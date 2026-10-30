-- Test av portal_bekreft_ordre / portal_avvis_ordre (migrasjon 20261030230000). ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, ingen åpen app ser noe.
-- Bruker EKTE ansatte (en admin, en godkjenner, en vanlig ansatt) KUN til lesing for å lage innloggingsutsagn (request.jwt.claims) - ingen ansatt-rader endres.
-- Ordrene lages med portal_koble_bestilling (må være kjørt, med modellen kia-ev9 i portal_modell_kobling) mot AK Auto AS (k_portal_akauto, org.nr 831862122).
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261030230000_portal_bekreft_avvis.sql; cat supabase/tester/portal_bekreft_avvis_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha resultat OK.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  c_a constant text := 'k_portal_akauto'; c_org_a constant text := '831862122';
  v_admin bigint; v_admin_tok text; v_godk bigint; v_godk_tok text; v_ans bigint; v_ans_tok text;
  v_ref_ordre text;
  r jsonb; o public.ordrer%rowtype; v_id text; v_feil text; v_n int; v_antall_for int; i int;
  v_endr_for int;
  v_variant text[] := array['kalender', 'status', 'endring', 'bilde', 'dokumenter', 'godkjent', 'signatur', 'timer', 'utstyr', 'vekter', 'ombygging', 'drivstoff', 'regnr', 'farge', 'notater', 'mal', 'ankomst', 'hengerfeste', 'lager', 'nullstatus'];
begin
  select id, coalesce(session_token, '') into v_admin, v_admin_tok from public.ansatte where aktiv and rolle = 'admin' order by id limit 1;
  select id, coalesce(session_token, '') into v_godk, v_godk_tok from public.ansatte where aktiv and rolle = 'godkjenner' order by id limit 1;
  select id, coalesce(session_token, '') into v_ans, v_ans_tok from public.ansatte where aktiv and rolle = 'ansatt' order by id limit 1;
  insert into _res(navn, ok, info) values ('Forutsetning: fant en aktiv admin, godkjenner og ansatt å lage innlogging av', v_admin is not null and v_godk is not null and v_ans is not null, coalesce(v_admin::text, '-') || '/' || coalesce(v_godk::text, '-') || '/' || coalesce(v_ans::text, '-'));
  select id into v_ref_ordre from public.ordrer where portal_bestilling_id is null order by created_at desc limit 1;

  -- Hjelper: lag en portal-ordre og gi id-en.
  -- (inline under: portal_koble_bestilling er kjørt som postgres, ikke som ansatt)

  -- ===== T1 Ikke innlogget =====
  perform set_config('request.jwt.claims', '', true);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbk0000001', 'nr', 'B-TEST-BK01', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000081',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  v_id := r->>'ordre_id';
  insert into _res(navn, ok, info) values ('T1 portal-ordre opprettet (ny_ordre, ikke bekreftet)', r->>'status' = 'ny_ordre' and (select portal_bekreftet_at is null from public.ordrer where id = v_id), r::text);
  begin perform public.portal_bekreft_ordre(v_id); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T1 bekreft uten innlogging: IKKE_INNLOGGET', v_feil = 'IKKE_INNLOGGET', v_feil);
  begin perform public.portal_avvis_ordre(v_id); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T1 avvis uten innlogging: IKKE_INNLOGGET', v_feil = 'IKKE_INNLOGGET', v_feil);
  insert into _res(navn, ok, info) values ('T1 ordren er uendret etter de to avviste kallene', (select portal_bekreftet_at is null and jsonb_array_length(endringer) = 1 from public.ordrer where id = v_id), '');

  -- ===== T2 Bekreft som vanlig ansatt (alle ansatte kan bekrefte) =====
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans, 'session_token', v_ans_tok)::text, true);
  r := public.portal_bekreft_ordre(v_id);
  select * into o from public.ordrer where id = v_id;
  insert into _res(navn, ok, info) values ('T2 bekreft som ansatt: kode ok, tidspunkt og navn satt, én ny logglinje',
    r->>'kode' = 'ok' and o.portal_bekreftet_at is not null and o.portal_bekreftet_av = (select navn from public.ansatte where id = v_ans)
    and jsonb_array_length(o.endringer) = 2 and o.endringer->1->>'txt' = 'Bekreftet som bestilling fra Forhandlerportalen' and o.endringer->1->>'av' = o.portal_bekreftet_av
    and (o.endringer->1) ?& array['av', 'tid', 'txt'] and r->'endringer' = o.endringer, r::text);
  insert into _res(navn, ok, info) values ('T2 portal_bestillinger er «bekreftet»', (select status from public.portal_bestillinger where portal_bestilling_id = 'testbk0000001') = 'bekreftet', '');
  v_endr_for := jsonb_array_length(o.endringer);
  r := public.portal_bekreft_ordre(v_id);
  select * into o from public.ordrer where id = v_id;
  insert into _res(navn, ok, info) values ('T2 ny bekreftelse er idempotent (allerede_bekreftet, ingen ny logglinje, samme tidspunkt)', r->>'kode' = 'allerede_bekreftet' and jsonb_array_length(o.endringer) = v_endr_for, r::text);
  begin perform public.portal_avvis_ordre(v_id); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T2 en bekreftet ordre kan IKKE avvises (selv av ansatt får IKKE_TILLATT først, så testes admin under)', v_feil = 'IKKE_TILLATT', v_feil);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin, 'session_token', v_admin_tok)::text, true);
  begin perform public.portal_avvis_ordre(v_id); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T2 bekreftet ordre: admin får ALLEREDE_BEKREFTET og ordren står', v_feil = 'ALLEREDE_BEKREFTET' and exists (select 1 from public.ordrer where id = v_id), v_feil);
  -- Portalens nye forsøk etter bekreftelse (cron/retry) skal fortsatt svare ok, og en slettet bekreftet ordre blir aldri gjenopprettet (gravstein).
  perform set_config('request.jwt.claims', '', true);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbk0000001', 'nr', 'B-TEST-BK01', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000081',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  insert into _res(navn, ok, info) values ('T2 nytt kall fra portalen etter bekreftelse: ok, status bekreftet, samme ordre', r->>'kode' = 'ok' and r->>'status' = 'bekreftet' and r->>'ordre_id' = v_id, r::text);
  delete from public.ordrer where id = v_id;
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbk0000001', 'nr', 'B-TEST-BK01', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000081',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  insert into _res(navn, ok, info) values ('T2 bekreftet ordre slettet: nytt kall gir avvist og lager ikke ordren på nytt', r->>'status' = 'avvist' and not exists (select 1 from public.ordrer where upper(btrim(chassis)) = 'TESTWXYZ000000081'), r::text);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin, 'session_token', v_admin_tok)::text, true);

  -- ===== T3 Avvis: rolle, urørt ordre, gravstein =====
  perform set_config('request.jwt.claims', '', true);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbk0000002', 'nr', 'B-TEST-BK02', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000082',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  v_id := r->>'ordre_id';
  -- en senere bestilling på samme chassis kobles til samme ordre
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbk0000003', 'nr', 'B-TEST-BK03', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000082',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  insert into _res(navn, ok, info) values ('T3 forutsetning: andre bestilling på samme chassis ble koblet', r->>'status' = 'koblet' and r->>'ordre_id' = v_id, r::text);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans, 'session_token', v_ans_tok)::text, true);
  begin perform public.portal_avvis_ordre(v_id); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T3 vanlig ansatt kan ikke avvise (IKKE_TILLATT), ordren står', v_feil = 'IKKE_TILLATT' and exists (select 1 from public.ordrer where id = v_id), v_feil);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_godk, 'session_token', v_godk_tok)::text, true);
  r := public.portal_avvis_ordre(v_id);
  insert into _res(navn, ok, info) values ('T3 godkjenner kan avvise en urørt, ubekreftet portal-ordre: ordren er slettet', r->>'kode' = 'ok' and not exists (select 1 from public.ordrer where id = v_id), r::text);
  insert into _res(navn, ok, info) values ('T3 begge bestillingene (opprettende og koblet) står som «avvist» med forklaring', (select count(*) from public.portal_bestillinger where portal_bestilling_id in ('testbk0000002', 'testbk0000003') and status = 'avvist' and detalj like 'Avvist av %') = 2, '');
  perform set_config('request.jwt.claims', '', true);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbk0000002', 'nr', 'B-TEST-BK02', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000082',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  insert into _res(navn, ok, info) values ('T3 GRAVSTEIN: nytt kall fra portalen for den avviste bestillingen gir avvist og lager IKKE ordren på nytt',
    r->>'status' = 'avvist' and not exists (select 1 from public.ordrer where upper(btrim(chassis)) = 'TESTWXYZ000000082'), r::text);
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin, 'session_token', v_admin_tok)::text, true);
  begin perform public.portal_avvis_ordre(v_id); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T3 avvis av en ordre som ikke finnes: ORDRE_FINNES_IKKE', v_feil = 'ORDRE_FINNES_IKKE', v_feil);

  -- ===== T4 Berørt ordre kan ikke avvises (hver endring en ansatt kan ha gjort stopper den) =====
  for i in 1 .. array_length(v_variant, 1) loop
    perform set_config('request.jwt.claims', '', true);
    r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbk00001' || lpad(i::text, 2, '0'), 'nr', 'B-TEST-V' || i, 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ0000001' || lpad(i::text, 2, '0'),
          'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
    v_id := r->>'ordre_id';
    if v_variant[i] = 'kalender' then update public.ordrer set kalender_dato = current_date where id = v_id;
    elsif v_variant[i] = 'status' then update public.ordrer set ordre_status = 'ikke_paabegynt' where id = v_id;
    elsif v_variant[i] = 'endring' then update public.ordrer set endringer = endringer || jsonb_build_array(jsonb_build_object('av', 'x', 'tid', 'x', 'txt', 'Farge endret')) where id = v_id;
    elsif v_variant[i] = 'bilde' then update public.ordrer set bilder_ankomst = '["https://eksempel.test/a.jpg",null,null,null,null,null]'::jsonb where id = v_id;
    elsif v_variant[i] = 'dokumenter' then update public.ordrer set dokumenter = '[{"navn":"a"},{"navn":"b"}]'::jsonb where id = v_id;
    elsif v_variant[i] = 'godkjent' then update public.ordrer set godkjent = true where id = v_id;
    elsif v_variant[i] = 'signatur' then update public.ordrer set signatur = 'data:x' where id = v_id;
    elsif v_variant[i] = 'timer' then update public.ordrer set ordre_timer_sessions = '[{"start":"x"}]'::jsonb where id = v_id;
    elsif v_variant[i] = 'utstyr' then update public.ordrer set utstyr = utstyr || '{"skalHa":"Ekstra utstyr"}'::jsonb where id = v_id;
    elsif v_variant[i] = 'vekter' then update public.ordrer set vekter = jsonb_set(vekter, '{totalvekt,a}', '"1000"') where id = v_id;
    elsif v_variant[i] = 'ombygging' then update public.ordrer set ombygging = jsonb_set(ombygging, '{lafinto}', 'true') where id = v_id;
    elsif v_variant[i] = 'drivstoff' then update public.ordrer set drivstoff = jsonb_set(drivstoff, '{totalpris}', '"500"') where id = v_id;
    elsif v_variant[i] = 'regnr' then update public.ordrer set regnr = 'AB12345' where id = v_id;
    elsif v_variant[i] = 'farge' then update public.ordrer set farge = 'Hvit' where id = v_id;
    elsif v_variant[i] = 'notater' then update public.ordrer set notater = 'noe skrevet inn' where id = v_id;
    elsif v_variant[i] = 'mal' then update public.ordrer set utstyr_mal_navn = 'KIA EV9' where id = v_id;
    elsif v_variant[i] = 'ankomst' then update public.ordrer set ankomstdato = current_date where id = v_id;
    elsif v_variant[i] = 'hengerfeste' then update public.ordrer set utstyr = utstyr || '{"hengerfeste":"skal_ha"}'::jsonb where id = v_id;
    elsif v_variant[i] = 'lager' then insert into public.lagerhistorikk (id, vare_id, ordre_id) values ('testlh' || i, 'testvare', v_id);
    elsif v_variant[i] = 'nullstatus' then update public.ordrer set status = null where id = v_id;
    end if;
    perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin, 'session_token', v_admin_tok)::text, true);
    begin perform public.portal_avvis_ordre(v_id); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
    insert into _res(navn, ok, info) values ('T4 berørt ordre (' || v_variant[i] || '): IKKE_URORT og ordren står', v_feil = 'IKKE_URORT' and exists (select 1 from public.ordrer where id = v_id), v_feil);
    delete from public.ordrer where id = v_id;   -- fjernes så taket på 10 ubekreftede ordrer per forhandler ikke nås
  end loop;

  -- ===== T4b En urørt ordre med nøyaktig ÉN dokument-rad (forhandlerens automatiske fullmakt) KAN avvises =====
  perform set_config('request.jwt.claims', '', true);
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testbk0000200', 'nr', 'B-TEST-BK200', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000200',
        'kontakt_id', c_a, 'orgnr', c_org_a, 'selger_navn', 'Zzyzx Test Selger', 'modell_slug', 'kia-ev9'));
  v_id := r->>'ordre_id';
  update public.ordrer set dokumenter = '[{"navn":"Fullmakt.pdf","url":"https://eksempel.test/f.pdf","lastetOppAv":"Automatisk (forhandlerfullmakt)"}]'::jsonb, fullmakt = 'har' where id = v_id;
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_admin, 'session_token', v_admin_tok)::text, true);
  r := public.portal_avvis_ordre(v_id);
  insert into _res(navn, ok, info) values ('T4b urørt ordre med bare den automatiske fullmakten kan avvises', r->>'kode' = 'ok' and not exists (select 1 from public.ordrer where id = v_id), r::text);

  -- ===== T5 Vanlige ordrer røres aldri =====
  select count(*) into v_antall_for from public.ordrer;
  begin perform public.portal_avvis_ordre(v_ref_ordre); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T5 avvis av en vanlig ordre (ikke fra portalen): IKKE_PORTAL_ORDRE, ordren står', v_feil = 'IKKE_PORTAL_ORDRE' and exists (select 1 from public.ordrer where id = v_ref_ordre), v_feil);
  begin perform public.portal_bekreft_ordre(v_ref_ordre); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T5 bekreft av en vanlig ordre: IKKE_PORTAL_ORDRE, ingen portal-kolonner satt', v_feil = 'IKKE_PORTAL_ORDRE' and (select portal_bekreftet_at is null from public.ordrer where id = v_ref_ordre), v_feil);
  begin perform public.portal_bekreft_ordre('ord_finnes_ikke_999'); v_feil := 'ingen feil'; exception when others then v_feil := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T5 bekreft av en ordre som ikke finnes: ORDRE_FINNES_IKKE', v_feil = 'ORDRE_FINNES_IKKE', v_feil);

  -- ===== T6 Rettigheter =====
  insert into _res(navn, ok, info) values ('T6 anon og public kan IKKE kjøre funksjonene; authenticated kan',
    not has_function_privilege('anon', 'public.portal_bekreft_ordre(text)', 'execute') and not has_function_privilege('anon', 'public.portal_avvis_ordre(text)', 'execute')
    and has_function_privilege('authenticated', 'public.portal_bekreft_ordre(text)', 'execute') and has_function_privilege('authenticated', 'public.portal_avvis_ordre(text)', 'execute'), '');
end
$test$;

select n, case when ok then 'OK  ' else 'FEIL' end resultat, navn, info from _res order by n;
