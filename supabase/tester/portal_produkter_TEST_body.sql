-- Test av 20261117220000_portal_produkter.sql. ALLTID i en transaksjon som rulles tilbake.
--   (echo "begin;"; cat supabase/migrations/20261117220000_portal_produkter.sql; cat supabase/tester/portal_produkter_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
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
end;
$test$;

select navn, ok, info from _res order by n;
