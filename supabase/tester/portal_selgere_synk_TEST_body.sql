-- Test av 20261105120000_portal_selgere_synk.sql. ALLTID i en transaksjon som rulles tilbake
-- (bytter HELE innstillinger.kontakter ut med testdata for enkelhets skyld - rulles uansett
-- tilbake, rører aldri ekte data).
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261105120000_portal_selgere_synk.sql; cat supabase/tester/portal_selgere_synk_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  r jsonb; v_kontakter jsonb; v_kp jsonb; v_rapport jsonb;
begin
  -- T1: kun service_role kan kalle funksjonen
  insert into _res(navn, ok, info) values ('T1 bare service_role har kjøretillatelse (ikke anon/authenticated/public)',
    has_function_privilege('service_role', 'public.portal_selgere_synk(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.portal_selgere_synk(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_selgere_synk(jsonb)', 'execute'), null);

  -- Oppsett: bytt HELE kontakter-arrayet med testdata (rulles tilbake uansett)
  update innstillinger set kontakter = jsonb_build_array(
    jsonb_build_object('id', 'k_test_a', 'navn', 'TEST Forhandler A', 'type', 'Forhandler', 'kontaktpersoner', jsonb_build_array(
      jsonb_build_object('id', 'kp_a1', 'navn', 'Ola Nordmann', 'epost', 'ola@test.no', 'tlf', '', 'notat', '', 'portalId', 'p_1'),
      jsonb_build_object('id', 'kp_a2', 'navn', 'Kari Nordmann', 'epost', 'kari@test.no', 'tlf', '', 'notat', ''),
      jsonb_build_object('id', 'kp_a3', 'navn', 'Bjarne', 'epost', '', 'tlf', '', 'notat', ''),
      jsonb_build_object('id', 'kp_a4', 'navn', 'Ambiguous', 'epost', '', 'tlf', '', 'notat', ''),
      jsonb_build_object('id', 'kp_a5', 'navn', 'Ambiguous', 'epost', '', 'tlf', '', 'notat', ''),
      jsonb_build_object('id', 'kp_a6', 'navn', 'Per Hansen', 'epost', 'per.old@test.no', 'tlf', '', 'notat', '')
    )),
    jsonb_build_object('id', 'k_test_b', 'navn', 'TEST Forhandler B', 'type', 'Forhandler', 'kontaktpersoner', '[]'::jsonb)
  ) where id = 1;

  -- T2: ugyldig input (ikke en liste) avvises
  begin perform portal_selgere_synk('{}'::jsonb); insert into _res(navn, ok, info) values ('T2 ugyldig input (objekt, ikke liste) avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2 ugyldig input (objekt, ikke liste) avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  -- T3: ukjent kontakt_id og navn-mismatch hoppes over, rapportert, intet skrevet
  r := portal_selgere_synk(jsonb_build_array(
    jsonb_build_object('kontakt_id', 'k_finnes_ikke', 'kontakt_navn', 'Hvem som helst', 'selgere', '[]'::jsonb),
    jsonb_build_object('kontakt_id', 'k_test_b', 'kontakt_navn', 'FEIL NAVN', 'selgere', '[]'::jsonb)
  ));
  insert into _res(navn, ok, info) values ('T3 ukjent kontakt_id telles', (r->>'ukjentKontaktId')::int = 1, r::text);
  insert into _res(navn, ok, info) values ('T3 navn-mismatch telles', (r->>'navnMismatch')::int = 1, r::text);

  -- T4: hovedkjøringen med alle fem regler på Forhandler A
  r := portal_selgere_synk(jsonb_build_array(jsonb_build_object(
    'kontakt_id', 'k_test_a', 'kontakt_navn', 'TEST Forhandler A', 'selgere', jsonb_build_array(
      jsonb_build_object('portal_id', 'p_1', 'navn', 'Ola Nordmann', 'epost', 'ola@nyadresse.no'),       -- regel 1: alt koblet, e-post endret
      jsonb_build_object('portal_id', 'p_2', 'navn', 'Kari Nordmann', 'epost', 'KARI@test.no'),          -- regel 2: match på e-post (case)
      jsonb_build_object('portal_id', 'p_3', 'navn', 'Bjarne Hellestø', 'epost', 'bjarne@test.no'),      -- regel 3: fornavn-match, overtar
      jsonb_build_object('portal_id', 'p_4', 'navn', 'Ambiguous', 'epost', 'amb@test.no'),               -- regel 3 flertydig -> regel 5
      jsonb_build_object('portal_id', 'p_5', 'navn', 'Per Hansen', 'epost', 'per.new@test.no'),          -- regel 4: samme navn, annen e-post
      jsonb_build_object('portal_id', 'p_6', 'navn', 'Helt Ny Selger', 'epost', 'ny@test.no')            -- regel 5: helt ny
    )
  )));

  select k->'kontaktpersoner' into v_kontakter from jsonb_array_elements(
    (select kontakter from innstillinger where id = 1)
  ) k where k->>'id' = 'k_test_a';

  -- Regel 1
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_a1';
  insert into _res(navn, ok, info) values ('T4 regel 1: e-post oppdatert, navn urørt', v_kp->>'epost' = 'ola@nyadresse.no' and v_kp->>'navn' = 'Ola Nordmann', v_kp::text);

  -- Regel 2
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_a2';
  insert into _res(navn, ok, info) values ('T4 regel 2: portalId satt, e-post urørt (kun case endret i portalen)', v_kp->>'portalId' = 'p_2' and v_kp->>'epost' = 'kari@test.no', v_kp::text);

  -- Regel 3 (fornavn-match)
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_a3';
  insert into _res(navn, ok, info) values ('T4 regel 3: Bjarne overtatt - navn utvidet, e-post og portalId satt', v_kp->>'navn' = 'Bjarne Hellestø' and v_kp->>'epost' = 'bjarne@test.no' and v_kp->>'portalId' = 'p_3', v_kp::text);

  -- Regel 3 flertydig -> regel 5 (kp_a4/kp_a5 urørt, ny lagt til)
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_a4';
  insert into _res(navn, ok, info) values ('T4 flertydig kandidat kp_a4 er UENDRET', v_kp->>'epost' = '' and v_kp->>'portalId' is null, v_kp::text);
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_a5';
  insert into _res(navn, ok, info) values ('T4 flertydig kandidat kp_a5 er UENDRET', v_kp->>'epost' = '' and v_kp->>'portalId' is null, v_kp::text);
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_portal_p_4';
  insert into _res(navn, ok, info) values ('T4 flertydig -> ny kontaktperson lagt til i stedet', v_kp->>'navn' = 'Ambiguous' and v_kp->>'epost' = 'amb@test.no', v_kp::text);

  -- Regel 4 (samme navn, annen e-post - urørt, ingen dublett)
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_a6';
  insert into _res(navn, ok, info) values ('T4 regel 4: Per Hansen UENDRET (fortsatt gammel e-post)', v_kp->>'epost' = 'per.old@test.no' and v_kp->>'portalId' is null, v_kp::text);
  insert into _res(navn, ok, info) values ('T4 regel 4: ingen dublett "Per Hansen" lagt til',
    (select count(*) from jsonb_array_elements(v_kontakter) kp where kp->>'navn' = 'Per Hansen') = 1, null);

  -- Regel 5 (helt ny)
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_portal_p_6';
  insert into _res(navn, ok, info) values ('T4 regel 5: helt ny selger lagt til med riktig id-format', v_kp->>'navn' = 'Helt Ny Selger' and v_kp->>'epost' = 'ny@test.no' and v_kp->>'portalId' = 'p_6' and v_kp->>'notat' = 'Fra portalen' and v_kp->>'tlf' = '', v_kp::text);

  -- Rapporten inneholder ALDRI e-postadresser
  insert into _res(navn, ok, info) values ('T4 rapporten inneholder aldri e-postadresser', r::text not like '%@%', null);
  -- "x ? 'opprettet'" skiller selve oppsummeringslinjen fra en eventuell "flere_navnekandidater"-
  -- advarselslinje som også har forhandler = 'TEST Forhandler A' (regel 3 sin flertydig-gren over).
  insert into _res(navn, ok, info) values ('T4 ett rapport-innslag for forhandleren med riktige tall', (
    select (x->>'opprettet')::int = 2 and (x->>'oppdatert')::int = 1 and (x->>'koblet')::int = 2 and (x->>'konflikt')::int = 2
    from jsonb_array_elements(r->'rapport') x where x->>'forhandler' = 'TEST Forhandler A' and x ? 'opprettet'
  ), r::text);

  -- T5: idempotens - samme kjøring på nytt endrer ingenting mer (ingen nye rader, ingen nye oppdateringer)
  r := portal_selgere_synk(jsonb_build_array(jsonb_build_object(
    'kontakt_id', 'k_test_a', 'kontakt_navn', 'TEST Forhandler A', 'selgere', jsonb_build_array(
      jsonb_build_object('portal_id', 'p_1', 'navn', 'Ola Nordmann', 'epost', 'ola@nyadresse.no'),
      jsonb_build_object('portal_id', 'p_2', 'navn', 'Kari Nordmann', 'epost', 'KARI@test.no'),
      jsonb_build_object('portal_id', 'p_3', 'navn', 'Bjarne Hellestø', 'epost', 'bjarne@test.no'),
      jsonb_build_object('portal_id', 'p_6', 'navn', 'Helt Ny Selger', 'epost', 'ny@test.no')
    )
  )));
  select k->'kontaktpersoner' into v_kontakter from jsonb_array_elements(
    (select kontakter from innstillinger where id = 1)
  ) k where k->>'id' = 'k_test_a';
  insert into _res(navn, ok, info) values ('T5 idempotens: ingen dubletter etter andre kjøring (6 opprinnelige + 2 nye = 8)', jsonb_array_length(v_kontakter) = 8, jsonb_array_length(v_kontakter)::text);
  insert into _res(navn, ok, info) values ('T5 idempotens: andre kjøring gjorde 0 nytt (alt alt koblet/uendret)', (
    select (x->>'opprettet')::int = 0 and (x->>'oppdatert')::int = 0 and (x->>'koblet')::int = 0
    from jsonb_array_elements(r->'rapport') x where x->>'forhandler' = 'TEST Forhandler A'
  ), r::text);

  -- T6: hoppede/manglende felt i en selger-rad telles og rører ingenting
  r := portal_selgere_synk(jsonb_build_array(jsonb_build_object(
    'kontakt_id', 'k_test_b', 'kontakt_navn', 'TEST Forhandler B', 'selgere', jsonb_build_array(
      jsonb_build_object('portal_id', '', 'navn', 'Ugyldig', 'epost', 'x@test.no'),
      jsonb_build_object('portal_id', 'p_9', 'navn', '', 'epost', 'x@test.no'),
      jsonb_build_object('portal_id', 'p_9', 'navn', 'Ugyldig', 'epost', '')
    )
  )));
  insert into _res(navn, ok, info) values ('T6 tre ugyldige selger-rader hoppet over, ingen lagt til', (
    select (x->>'hoppetOver')::int = 3 and (x->>'opprettet')::int = 0
    from jsonb_array_elements(r->'rapport') x where x->>'forhandler' = 'TEST Forhandler B'
  ), r::text);

  -- T7: en selger UTEN navn (portalen sender nå alltid en streng, aldri NULL) kobles fortsatt
  -- via e-post-match (regel 2) - rettet 5.11 etter portal-øktas presisering.
  -- Indeks 1 = "TEST Forhandler B" (opprettet som element nr. 2 i oppsettet øverst i filen).
  update innstillinger set kontakter = jsonb_set(kontakter, '{1,kontaktpersoner}',
    (kontakter->1->'kontaktpersoner') || jsonb_build_array(jsonb_build_object('id', 'kp_b1', 'navn', 'Navnløs Fra Før', 'epost', 'navnlos@test.no', 'tlf', '', 'notat', ''))
  ) where id = 1;
  r := portal_selgere_synk(jsonb_build_array(jsonb_build_object(
    'kontakt_id', 'k_test_b', 'kontakt_navn', 'TEST Forhandler B', 'selgere', jsonb_build_array(
      jsonb_build_object('portal_id', 'p_navnlos', 'navn', '', 'epost', 'NAVNLOS@test.no')
    )
  )));
  select k->'kontaktpersoner' into v_kontakter from jsonb_array_elements((select kontakter from innstillinger where id = 1)) k where k->>'id' = 'k_test_b';
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_b1';
  insert into _res(navn, ok, info) values ('T7 navnløs selger kobles via e-post-match (portalId satt, navn URØRT)', v_kp->>'portalId' = 'p_navnlos' and v_kp->>'navn' = 'Navnløs Fra Før', v_kp::text);
  insert into _res(navn, ok, info) values ('T7 rapporten sier koblet=1, opprettet=0 for denne kjøringen', (
    select (x->>'koblet')::int = 1 and (x->>'opprettet')::int = 0 from jsonb_array_elements(r->'rapport') x where x->>'forhandler' = 'TEST Forhandler B'
  ), r::text);

  -- T8: en selger UTEN navn og UTEN noe å matche mot: hoppes over, INGEN ny kontaktperson med tomt navn opprettes
  r := portal_selgere_synk(jsonb_build_array(jsonb_build_object(
    'kontakt_id', 'k_test_b', 'kontakt_navn', 'TEST Forhandler B', 'selgere', jsonb_build_array(
      jsonb_build_object('portal_id', 'p_helt_ukjent', 'navn', '', 'epost', 'helt-ukjent@test.no')
    )
  )));
  select k->'kontaktpersoner' into v_kontakter from jsonb_array_elements((select kontakter from innstillinger where id = 1)) k where k->>'id' = 'k_test_b';
  insert into _res(navn, ok, info) values ('T8 ingen kontaktperson med tomt navn finnes etterpå', not exists (select 1 from jsonb_array_elements(v_kontakter) kp where kp->>'navn' = ''), v_kontakter::text);
  insert into _res(navn, ok, info) values ('T8 rapporten sier hoppetOver=1, opprettet=0', (
    select (x->>'hoppetOver')::int = 1 and (x->>'opprettet')::int = 0 from jsonb_array_elements(r->'rapport') x where x->>'forhandler' = 'TEST Forhandler B'
  ), r::text);

  -- T9: navn-normalisering (rettet 5.11) - doble mellomrom og en usynlig zero-width-space i
  -- APPENS lagrede navn skal fortsatt matche portalens RENE navn, både på forhandler- og selger-nivå.
  update innstillinger set kontakter = kontakter || jsonb_build_array(
    jsonb_build_object('id', 'k_test_c', 'navn', 'TEST  Forhandler' || chr(8203) || ' C', 'type', 'Forhandler', 'kontaktpersoner', jsonb_build_array(
      jsonb_build_object('id', 'kp_c1', 'navn', 'Kari' || chr(8203) || '  Spaces', 'epost', '', 'tlf', '', 'notat', '')
    ))
  );
  r := portal_selgere_synk(jsonb_build_array(jsonb_build_object(
    'kontakt_id', 'k_test_c', 'kontakt_navn', 'TEST Forhandler C', 'selgere', jsonb_build_array(
      jsonb_build_object('portal_id', 'p_norm', 'navn', 'Kari Spaces', 'epost', 'kari.spaces@test.no')
    )
  )));
  insert into _res(navn, ok, info) values ('T9 forhandler med doble mellomrom/usynlig tegn MATCHER portalens rene navn (ikke navn_stemmer_ikke)', (
    select not exists (select 1 from jsonb_array_elements(r->'rapport') x where x->>'status' = 'navn_stemmer_ikke')
       and exists (select 1 from jsonb_array_elements(r->'rapport') x where x ? 'koblet') -- den ekte oppsummerings-linjen (ikke en hoppet-over/konflikt-rapportlinje) finnes
  ), r::text);
  select k->'kontaktpersoner' into v_kontakter from jsonb_array_elements((select kontakter from innstillinger where id = 1)) k where k->>'id' = 'k_test_c';
  select kp into v_kp from jsonb_array_elements(v_kontakter) kp where kp->>'id' = 'kp_c1';
  insert into _res(navn, ok, info) values ('T9 selger med doble mellomrom/usynlig tegn i appens navn MATCHER portalens rene navn (regel 3, ikke en ny dublett)', v_kp->>'portalId' = 'p_norm' and v_kp->>'epost' = 'kari.spaces@test.no', v_kp::text);
  insert into _res(navn, ok, info) values ('T9 ingen dublett-kontaktperson opprettet for Kari', jsonb_array_length(v_kontakter) = 1, v_kontakter::text);
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
