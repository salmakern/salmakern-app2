-- Test av 20261117220000_portal_produkter.sql + 20261117230000_portal_produkter_synk_safeupdate.sql + 20261120100000_portal_produkter_bilde_pris.sql
-- (bilde_url/pris_kr, T12-T15). ALLTID i en transaksjon som rulles tilbake.
--   (echo "begin;"; cat supabase/migrations/20261117220000_portal_produkter.sql supabase/migrations/20261117230000_portal_produkter_synk_safeupdate.sql \
--     supabase/migrations/20261120100000_portal_produkter_bilde_pris.sql; cat supabase/tester/portal_produkter_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  r jsonb;
  v jsonb := '[
    {"portal_id":"v_TEST_1","type":"variant","modell_slug":"TEST-ev9","modell_navn":"TEST EV9","produktnummer":"500","fiken_nummer":"500","nummer_status":"ok","navn":"Standard","prisgruppe":"standard","app_rolle":"ombygging"},
    {"portal_id":"v_TEST_2","type":"variant","modell_slug":"TEST-ev9","modell_navn":"TEST EV9","produktnummer":"524","fiken_nummer":"524","nummer_status":"ok","navn":"Personbil","prisgruppe":"standard","app_rolle":"personbil"},
    {"portal_id":"t_TEST_1","type":"tillegg","modell_slug":"TEST-ev9","variant_portal_id":"v_TEST_1","produktnummer":"502","fiken_nummer":"502","nummer_status":"ok","navn":"180","app_rolle":null},
    {"portal_id":"v_TEST_3","type":"variant","modell_slug":"TEST-eqv","produktnummer":"1600-1601","fiken_nummer":null,"nummer_status":"intervall","navn":"Std","prisgruppe":"standard","app_rolle":null}
  ]';
begin
  insert into _res(navn, ok, info) values ('T1 bare service_role kan synke; anon/authenticated kan ikke skrive tabellen',
    has_function_privilege('service_role', 'public.portal_produkter_synk(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_produkter_synk(jsonb)', 'execute')
    and not has_table_privilege('authenticated', 'public.portal_produkter', 'insert')
    and not has_table_privilege('anon', 'public.portal_produkter', 'delete')
    and (select relrowsecurity from pg_class where relname = 'portal_produkter'), null);

  r := portal_produkter_synk(v);
  insert into _res values (default, 'T2 synk lagrer alle rader', (r->>'rader')::int = 4 and (r->>'roller')::int = 2 and (r->>'modeller')::int = 2, r::text);
  insert into _res values (default, 'T2b nye roller meldes som endret', r->'endredeRoller' = '["TEST-ev9:ombygging","TEST-ev9:personbil"]'::jsonb, r->>'endredeRoller');

  r := portal_produkter_synk(v);
  insert into _res values (default, 'T3 samme liste igjen: ingen endrede roller', r->'endredeRoller' = '[]'::jsonb and r->'fjernedeRoller' = '[]'::jsonb, r::text);

  r := portal_produkter_synk(jsonb_set(v, '{0,fiken_nummer}', '"501"') #- '{1}');
  insert into _res values (default, 'T4 endret nummer og fjernet rolle meldes', r->'endredeRoller' = '["TEST-ev9:ombygging"]'::jsonb and r->'fjernedeRoller' = '["TEST-ev9:personbil"]'::jsonb, r::text);
  -- (rad 0 har nå fiken_nummer 501 men produktnummer 500: lov, portalen er fasit)

  begin perform portal_produkter_synk('[]'); insert into _res values (default, 'T5 tom liste avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T5 tom liste avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;
  insert into _res values (default, 'T5b lista står urørt etter avvist kall', (select count(*) from portal_produkter) = 3, null);

  begin perform portal_produkter_synk(jsonb_set(v, '{1,app_rolle}', '"ombygging"')); insert into _res values (default, 'T6 to ombygginger på samme modell avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T6 to ombygginger på samme modell avvises', sqlerrm = 'DOBBEL_ROLLE', sqlerrm); end;

  begin perform portal_produkter_synk(jsonb_set(v, '{3,fiken_nummer}', '"1600"')); insert into _res values (default, 'T7 fiken_nummer på et intervall avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T7 fiken_nummer på et intervall avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  begin perform portal_produkter_synk(jsonb_set(v, '{2,app_rolle}', '"personbil"')); insert into _res values (default, 'T8 rolle på et tillegg avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T8 rolle på et tillegg avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  begin perform portal_produkter_synk(jsonb_set(v, '{0,fiken_nummer}', '"05"')); insert into _res values (default, 'T9 nummer med ledende null avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T9 nummer med ledende null avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  begin perform portal_produkter_synk(v || jsonb_build_array(v->0)); insert into _res values (default, 'T10 samme portal-id to ganger avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T10 samme portal-id to ganger avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  begin perform portal_produkter_synk(v #- '{2,variant_portal_id}'); insert into _res values (default, 'T11 tillegg uten variant avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T11 tillegg uten variant avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  -- T12-T15: bilde_url/pris_kr (20261120100000, additivt i versjon 1) - KUN til kontroll av at et produkt har bilde+pris i portalen,
  -- aldri brukt i fakturering. Bygget på den uendrede `v` (deklarert øverst), ikke på tilstanden fra T4/T6-T11.
  r := portal_produkter_synk(jsonb_set(jsonb_set(v, '{0,bilde_url}', '"https://img.example/ev9-500.jpg"'), '{0,pris_kr}', '20310'));
  insert into _res values (default, 'T12 gyldig bilde_url/pris_kr lagres og leses tilbake',
    (select (bilde_url, pris_kr) = ('https://img.example/ev9-500.jpg', 20310) from portal_produkter where portal_id = 'v_TEST_1'), r::text);

  begin perform portal_produkter_synk(jsonb_set(v, '{0,bilde_url}', to_jsonb(repeat('x', 2001))));
    insert into _res values (default, 'T13 for lang bilde_url avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T13 for lang bilde_url avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  begin perform portal_produkter_synk(jsonb_set(v, '{0,pris_kr}', '0'));
    insert into _res values (default, 'T14 pris_kr 0 avvises (edge-funksjonen sender aldri dette, men databasen er selv vernet)', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T14 pris_kr 0 avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;

  -- `v` mangler bilde_url/pris_kr på alle rader fra før (slik en eldre portalversjon ville gjort): dette er allerede
  -- dekket implisitt av T1-T11 over, men gjøres eksplisitt her.
  r := portal_produkter_synk(v);
  insert into _res values (default, 'T15 uten bilde_url/pris_kr-felt (eldre portal) er lov og gir null - avvises IKKE',
    (select bilde_url is null and pris_kr is null from portal_produkter where portal_id = 'v_TEST_1'), r::text);
end;
$test$;

select navn, ok, info from _res order by n;
