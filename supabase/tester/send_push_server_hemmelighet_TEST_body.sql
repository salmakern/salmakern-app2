-- Test av 20261031124000_send_push_server_hemmelighet.sql. ALLTID i en transaksjon som rulles tilbake: ingenting blir stående, pg_net-køen rulles tilbake (ingen forespørsel sendes), og Realtime ser aldri TEST-ordren.
-- Hemmeligheter leses KUN inne i databasen og sammenlignes; bare ja/nei skrives ut. Forutsetter at Vault-hemmelighetene ordre_push_service_role_key og send_push_server_secret finnes.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261031124000_send_push_server_hemmelighet.sql; cat supabase/tester/send_push_server_hemmelighet_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha resultat OK.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_for int; v_etter int; v_h jsonb; v_sec text; v_nokkel text; v_id text := 'TEST-sendpush-' || to_char(clock_timestamp(), 'HH24MISSMS');
  v_cron jsonb;
begin
  select decrypted_secret into v_sec from vault.decrypted_secrets where name = 'send_push_server_secret';
  select decrypted_secret into v_nokkel from vault.decrypted_secrets where name = 'ordre_push_service_role_key';
  insert into _res(navn, ok, info) values ('Forutsetning: begge Vault-hemmelighetene finnes og er lange nok', v_sec is not null and length(v_sec) >= 32 and v_nokkel is not null, 'lengde=' || coalesce(length(v_sec), 0));

  -- Cron-jobbene
  select jsonb_object_agg(jobname, jsonb_build_object(
    'har_hemmelighet_header', command ilike '%x-server-secret%' and command ilike '%send_push_server_secret%',
    'har_vault_nokkel', command ilike '%ordre_push_service_role_key%',
    'ingen_klartekst_nokkel', not (command ~ 'eyJ[A-Za-z0-9_-]{10,}' or command ilike '%sb_publishable_%'),
    'aktiv', active)) into v_cron
  from cron.job where jobname in ('paaminnelser-sjekk', 'daglig-paaminnelse');
  insert into _res(navn, ok, info) values ('Begge cron-jobbene sender x-server-secret fra Vault, beholder Vault-nøkkelen i Authorization og har ingen nøkkel i klartekst',
    (select bool_and((v->>'har_hemmelighet_header')::boolean and (v->>'har_vault_nokkel')::boolean and (v->>'ingen_klartekst_nokkel')::boolean and (v->>'aktiv')::boolean) and count(*) = 2 from jsonb_each(v_cron) as e(k, v)), v_cron::text);

  -- Triggeren: oppdater en TEST-ordre (uten statusendring) og les forespørselen den køet
  select count(*) into v_for from supabase_functions.hooks where hook_table_id = 'public.ordrer'::regclass::oid;
  insert into public.ordrer (id) values (v_id);
  update public.ordrer set kunde = 'TEST - send-push (rulles tilbake)' where id = v_id;
  select count(*) into v_etter from supabase_functions.hooks where hook_table_id = 'public.ordrer'::regclass::oid;
  insert into _res(navn, ok, info) values ('ordre-push-triggeren kjørte hele veien (la til en hook-rad uten å feile)', v_etter = v_for + 1, v_for || ' -> ' || v_etter);

  select headers into v_h from net.http_request_queue where url like '%/functions/v1/send-push' order by id desc limit 1;
  insert into _res(navn, ok, info) values ('Den køede forespørselen har x-server-secret lik Vault-hemmeligheten', (v_h->>'x-server-secret') = v_sec, 'header finnes: ' || (v_h ? 'x-server-secret')::text);
  insert into _res(navn, ok, info) values ('Authorization er fortsatt Vault-nøkkelen (Bearer ...)', (v_h->>'Authorization') = 'Bearer ' || v_nokkel, '');
  insert into _res(navn, ok, info) values ('Content-type er uendret', v_h->>'Content-type' = 'application/json', coalesce(v_h->>'Content-type', ''));

  -- Mangler Vault-hemmeligheten: varselet skal likevel gå (tom header), og lagringen skal ikke feile
  delete from vault.secrets where name = 'send_push_server_secret';
  select count(*) into v_for from supabase_functions.hooks where hook_table_id = 'public.ordrer'::regclass::oid;
  update public.ordrer set kunde = 'TEST - send-push uten hemmelighet' where id = v_id;
  select count(*) into v_etter from supabase_functions.hooks where hook_table_id = 'public.ordrer'::regclass::oid;
  select headers into v_h from net.http_request_queue where url like '%/functions/v1/send-push' order by id desc limit 1;
  insert into _res(navn, ok, info) values ('Uten Vault-hemmelighet: ordren lagres, varselet sendes likevel med tom x-server-secret', v_etter = v_for + 1 and (v_h->>'x-server-secret') = '', 'header=' || coalesce(nullif(v_h->>'x-server-secret', ''), '(tom)'));
end $test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
