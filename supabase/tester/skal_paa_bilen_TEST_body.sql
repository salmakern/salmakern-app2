-- Test av 20261118100000_skal_paa_bilen.sql. ALLTID i en transaksjon som rulles tilbake.
--   (echo "begin;"; cat supabase/migrations/20261118100000_skal_paa_bilen.sql; cat supabase/tester/skal_paa_bilen_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
create temp table _res (n serial, navn text, ok boolean, info text);
do $test$
declare r jsonb;
  v jsonb := '[{"portal_id":"v_TEST_1","type":"variant","modell_slug":"TEST-ev9","produktnummer":"500","fiken_nummer":"500","nummer_status":"ok","navn":"Std","app_rolle":"ombygging","velges_nar":[]},
               {"portal_id":"t_TEST_1","type":"tillegg","modell_slug":"TEST-ev9","variant_portal_id":"v_TEST_1","produktnummer":"501","fiken_nummer":"501","nummer_status":"ok","navn":"Takluke","velges_nar":["Panorama glasstak"]}]';
begin
  r := portal_produkter_synk(v);
  insert into _res values (default, 'T1 synk lagrer velges_nar', (select velges_nar from portal_produkter where portal_id = 't_TEST_1') = '["Panorama glasstak"]'::jsonb, r::text);
  r := portal_produkter_synk(v #- '{0,velges_nar}');
  insert into _res values (default, 'T2 manglende velges_nar blir tom liste', (select velges_nar from portal_produkter where portal_id = 'v_TEST_1') = '[]'::jsonb, null);
  begin perform portal_produkter_synk(jsonb_set(v, '{1,velges_nar}', '"Panorama"')); insert into _res values (default, 'T3 velges_nar som tekst avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3 velges_nar som tekst avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;
  begin perform portal_produkter_synk(jsonb_set(v, '{1,velges_nar}', '[""]')); insert into _res values (default, 'T4 tom tekst i velges_nar avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T4 tom tekst i velges_nar avvises', sqlerrm = 'UGYLDIG_INPUT', sqlerrm); end;
  insert into _res values (default, 'T5 ordrer.produkt_rettelser finnes med default []', exists (select 1 from information_schema.columns where table_name = 'ordrer' and column_name = 'produkt_rettelser' and column_default like '''[]''%'), null);
  insert into _res values (default, 'T6 rettelse-RPC: anon kan ikke, authenticated kan', has_function_privilege('authenticated', 'public.legg_til_ordre_produkt_rettelse(text,jsonb)', 'execute') and not has_function_privilege('anon', 'public.legg_til_ordre_produkt_rettelse(text,jsonb)', 'execute'), null);
  begin perform legg_til_ordre_produkt_rettelse('ord_finnes_ikke', '{"handling":"fjern","produktnummer":"501"}'); insert into _res values (default, 'T7 uten innlogging avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T7 uten innlogging avvises', sqlerrm = 'IKKE_INNLOGGET', sqlerrm); end;
end; $test$;
select navn, ok, info from _res order by n;
