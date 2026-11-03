-- Test av 20261102150000_ordrer_vekter_default_og_rpc.sql. ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, og Realtime ser aldri TEST-ordren.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261102150000_ordrer_vekter_default_og_rpc.sql; cat supabase/tester/ordrer_vekter_default_og_rpc_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok = true.
-- RPC-en selv krever en innlogget ansatt (current_ansatt()) og kan ikke kalles herfra; testen dekker derfor strukturen den bygger på
-- (vekter_normalisert + jsonb_set), pluss at den nye RPC-teksten bruker normaliseringen. Selve RPC-en bekreftes etterpå fra appen med en TEST-ordre.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v jsonb; v_id text := 'TEST-vekter-' || to_char(clock_timestamp(), 'HH24MISSMS'); v_rad jsonb; v_def text; v_rpc text;
begin
  v := public.vekter_normalisert('{}'::jsonb);
  insert into _res(navn, ok, info) values ('tomt objekt gir fire felt med a/e/v', v = '{"totalvekt":{"a":"","e":"","v":""},"vogntog":{"a":"","e":"","v":""},"foraksel":{"a":"","e":"","v":""},"bakaksel":{"a":"","e":"","v":""}}'::jsonb, v::text);

  insert into _res(navn, ok, info) values ('null gir full struktur', public.vekter_normalisert(null) = v, null);
  insert into _res(navn, ok, info) values ('ikke-objekt (tekst, liste) gir full struktur', public.vekter_normalisert('"x"'::jsonb) = v and public.vekter_normalisert('[]'::jsonb) = v, null);

  insert into _res(navn, ok, info) values ('innfylte verdier beholdes og resten fylles inn',
    public.vekter_normalisert('{"totalvekt":{"a":"3500","e":"3490"},"vogntog":null,"foraksel":"x"}'::jsonb)
      = '{"totalvekt":{"a":"3500","e":"3490","v":""},"vogntog":{"a":"","e":"","v":""},"foraksel":{"a":"","e":"","v":""},"bakaksel":{"a":"","e":"","v":""}}'::jsonb, null);

  insert into _res(navn, ok, info) values ('ukjente nøkler beholdes', (public.vekter_normalisert('{"tilhenger":{"a":"750"}}'::jsonb) -> 'tilhenger') = '{"a":"750"}'::jsonb, null);

  insert into _res(navn, ok, info) values ('idempotent', public.vekter_normalisert(v) = v, null);

  -- Mekanismen bak den stille feilen: jsonb_set uten foreldrenøkkel gjør ingenting, med normalisering virker den.
  insert into _res(navn, ok, info) values ('jsonb_set på {} setter IKKE totalvekt.a (årsaken til de tapte vektene)', jsonb_set('{}'::jsonb, '{totalvekt,a}', '"3500"', true) = '{}'::jsonb, null);
  insert into _res(navn, ok, info) values ('jsonb_set på normalisert {} setter totalvekt.a', (jsonb_set(v, '{totalvekt,a}', '"3500"', true) -> 'totalvekt' ->> 'a') = '3500', null);

  -- Kolonne-defaulten gir full struktur: en ny TEST-ordre uten vekter-verdi.
  insert into ordrer (id) values (v_id);
  select vekter into v_rad from ordrer where id = v_id;
  insert into _res(navn, ok, info) values ('en ny ordre uten vekter får full struktur fra kolonne-defaulten', v_rad = v, v_rad::text);

  -- Reparasjonen: sett en TEST-rad tilbake til {} og kjør samme UPDATE-betingelse som migrasjonen.
  update ordrer set vekter = '{}'::jsonb where id = v_id;
  update ordrer set vekter = public.vekter_normalisert(vekter)
   where id = v_id and (vekter is null or not (vekter ?& array['totalvekt','vogntog','foraksel','bakaksel']));
  select vekter into v_rad from ordrer where id = v_id;
  insert into _res(navn, ok, info) values ('reparasjon av en {}-rad gir full struktur', v_rad = v, v_rad::text);

  -- RPC-en ende til ende: logg inn som en eksisterende aktiv admin INNE I transaksjonen (JWT-claims settes lokalt, token leses og brukes bare i databasen,
  -- ingenting skrives ut), og sett vekter på en ordre som har den gamle defaulten {} (årsaken til de tapte vektene 2026-11-02).
  declare v_ans record; v_ut jsonb;
    begin
      select id, session_token into v_ans from ansatte where aktiv and rolle = 'admin' and id < 990000 order by id limit 1;
      perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_ans.id, 'session_token', v_ans.session_token, 'role', 'authenticated')::text, true);
      update ordrer set vekter = '{}'::jsonb where id = v_id;
      v_ut := public.oppdater_ordre_vekter_felt(v_id, '{"totalvekt.a":"3500","vogntog.e":"7000"}'::jsonb);
      select vekter into v_rad from ordrer where id = v_id;
      insert into _res(navn, ok, info) values ('RPC: vekter satt på en ordre med {} blir LAGRET (totalvekt.a og vogntog.e)',
        v_rad -> 'totalvekt' ->> 'a' = '3500' and v_rad -> 'vogntog' ->> 'e' = '7000' and v_ut = v_rad, null);
      insert into _res(navn, ok, info) values ('RPC: øvrige felt og struktur er intakt', v_rad -> 'foraksel' = '{"a":"","e":"","v":""}'::jsonb and v_rad -> 'totalvekt' ->> 'e' = '', null);
      begin
        perform public.oppdater_ordre_vekter_felt('finnes-ikke-' || v_id, '{"totalvekt.a":"1"}'::jsonb);
        insert into _res(navn, ok, info) values ('RPC: ukjent ordre gir feil', false, 'ingen feil');
      exception when others then
        insert into _res(navn, ok, info) values ('RPC: ukjent ordre gir feil', sqlerrm = 'ORDRE_FINNES_IKKE', sqlerrm);
      end;
      perform set_config('request.jwt.claims', '', true);
      begin
        perform public.oppdater_ordre_vekter_felt(v_id, '{"totalvekt.a":"1"}'::jsonb);
        insert into _res(navn, ok, info) values ('RPC: uten innlogging avvises', false, 'ingen feil');
      exception when others then
        insert into _res(navn, ok, info) values ('RPC: uten innlogging avvises', sqlerrm = 'IKKE_INNLOGGET', sqlerrm);
      end;
    end;

  -- Ingen ekte rad har manglende struktur etter migrasjonen.
  insert into _res(navn, ok, info) values ('ingen ordre har manglende vekter-struktur etter migrasjonen',
    (select count(*) from ordrer where vekter is null or not (vekter ?& array['totalvekt','vogntog','foraksel','bakaksel'])) = 0, null);

  select column_default into v_def from information_schema.columns where table_schema = 'public' and table_name = 'ordrer' and column_name = 'vekter';
  insert into _res(navn, ok, info) values ('kolonne-defaulten bruker normaliseringen', v_def ilike '%vekter_normalisert%', v_def);

  select pg_get_functiondef('public.oppdater_ordre_vekter_felt(text,jsonb)'::regprocedure) into v_rpc;
  insert into _res(navn, ok, info) values ('RPC-en normaliserer vekter før feltene settes', v_rpc ilike '%vekter_normalisert(vekter)%', null);
  insert into _res(navn, ok, info) values ('RPC-en har radlås, innloggingssjekk og search_path', v_rpc ilike '%for update%' and v_rpc ilike '%IKKE_INNLOGGET%' and v_rpc ilike '%search_path%', null);
end;
$test$;

select n, navn, ok, info from _res order by n;
