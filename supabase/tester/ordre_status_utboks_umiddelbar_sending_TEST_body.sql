-- Test av migrasjon 20261101160000 (umiddelbar sending til portalen + cron som sikkerhetsnett).
-- ALLTID i en transaksjon som rulles tilbake: ingen nettverkskall skjer i praksis, siden
-- net.http_post() bare setter raden inn i net.http_request_queue (en vanlig tabell) - usynlig
-- for pg_net sin bakgrunnsjobb (annen sesjon) før commit, og commit skjer aldri her.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261030210000_portal_koble_bestilling.sql; cat supabase/migrations/20261031160000_ordre_status_utboks_kun_portal.sql; cat supabase/migrations/20261101160000_ordre_status_utboks_umiddelbar_sending.sql; cat supabase/tester/ordre_status_utboks_umiddelbar_sending_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_portal text; r jsonb;
  v_antall_for int; v_antall_etter int;
  v_request jsonb;
begin
  -- Hele kjeden fra en ekte portal-ordre: UPDATE ordrer -> ordre_status_utboks_trigger_fn
  -- (eksisterende, 20261031160000) -> INSERT i ordre_status_utboks -> NY trigger her -> queuer sending.
  insert into public.portal_modell_kobling (portal_modell_slug, merke, modell, godkjent_av) values ('testumiddelbar', 'TESTMERKE', 'TESTMODELL', 'test')
    on conflict (portal_modell_slug) do nothing;
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testumiddelbar001', 'nr', 'B-TEST-UMIDDELBAR', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000091',
        'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test Umiddelbar', 'modell_slug', 'testumiddelbar'));
  v_portal := r->>'ordre_id';
  insert into _res(navn, ok, info) values ('Forutsetning: TEST portal-ordre opprettet', r->>'status' = 'ny_ordre' and v_portal is not null, r::text);

  if v_portal is not null then
    -- Direkte innsetting i ordre_status_utboks (samme vei som portal_bekreft_ordre() sin
    -- baseline-rad) skal alene trigge et umiddelbart sendeforsøk, på den ekte TEST-ordren.
    -- Telles kun mot send-ordre-status-til-portal-endepunktet - ordre-push-triggeren
    -- (eksisterende, fyrer på ALL ordre-oppdatering) queuer sine egne, urelaterte kall samtidig.
    select count(*) into v_antall_for from net.http_request_queue where url like '%send-ordre-status-til-portal%';
    insert into public.ordre_status_utboks (ordre_id, status, status_forrige) values (v_portal, 'paa_vei', null);
    select count(*) into v_antall_etter from net.http_request_queue where url like '%send-ordre-status-til-portal%';
    insert into _res(navn, ok, info) values (
      'Direkte innsetting i ordre_status_utboks queuer ett nytt net.http_post-forsøk',
      v_antall_etter = v_antall_for + 1, 'før=' || v_antall_for || ' etter=' || v_antall_etter);

    select jsonb_build_object('url', url, 'headers', headers) into v_request from net.http_request_queue order by id desc limit 1;
    insert into _res(navn, ok, info) values (
      'Forespørselen peker på send-ordre-status-til-portal med x-sync-secret satt (ikke tom)',
      v_request->>'url' = 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-ordre-status-til-portal'
        and coalesce(length(v_request->'headers'->>'x-sync-secret'), 0) > 0,
      v_request::text);
  else
    insert into _res(navn, ok, info) values ('Direkte innsetting: hoppet over (fant ikke portal-ordren)', true, '');
  end if;

  if v_portal is not null then
    select count(*) into v_antall_for from net.http_request_queue where url like '%send-ordre-status-til-portal%';
    update public.ordrer set ordre_status = 'ikke_paabegynt' where id = v_portal;
    select count(*) into v_antall_etter from net.http_request_queue where url like '%send-ordre-status-til-portal%';
    insert into _res(navn, ok, info) values (
      'Statusendring på en ekte portal-ordre queuer også et umiddelbart sendeforsøk (hele kjeden)',
      v_antall_etter = v_antall_for + 1, 'før=' || v_antall_for || ' etter=' || v_antall_etter);
  else
    insert into _res(navn, ok, info) values ('Full kjede: hoppet over (fant ikke portal-ordren)', true, '');
  end if;

  -- En vanlig (ikke-portal) statusendring skal fortsatt IKKE queue noe (uendret oppførsel fra 20261031160000).
  declare v_vanlig text;
  begin
    select id into v_vanlig from public.ordrer where status = 'aktiv' and portal_bestilling_id is null and ordre_status <> 'hentet' order by created_at desc limit 1;
    if v_vanlig is not null then
      select count(*) into v_antall_for from net.http_request_queue where url like '%send-ordre-status-til-portal%';
      update public.ordrer set ordre_status = 'hentet' where id = v_vanlig;
      update public.ordrer set ordre_status = 'ikke_paabegynt' where id = v_vanlig;
      select count(*) into v_antall_etter from net.http_request_queue where url like '%send-ordre-status-til-portal%';
      insert into _res(navn, ok, info) values (
        'Vanlig ordre (ingen portal_bestilling_id): INGEN umiddelbar sending',
        v_antall_etter = v_antall_for, 'før=' || v_antall_for || ' etter=' || v_antall_etter);
    else
      insert into _res(navn, ok, info) values ('Vanlig ordre: hoppet over (fant ingen aktiv ordre uten portal_bestilling_id)', true, '');
    end if;
  end;

  -- Cron-jobben skal finnes, med navngitt intervall.
  insert into _res(navn, ok, info) values (
    'Cron-jobben send-ordre-status-til-portal-cron finnes, hvert 5. minutt, aktiv',
    exists (select 1 from cron.job where jobname = 'send-ordre-status-til-portal-cron' and schedule = '*/5 * * * *' and active),
    (select schedule || ' aktiv=' || active from cron.job where jobname = 'send-ordre-status-til-portal-cron'));
end
$test$;

select n, case when ok then 'OK  ' else 'FEIL' end as resultat, navn, case when ok then '' else info end as info from _res order by n;
