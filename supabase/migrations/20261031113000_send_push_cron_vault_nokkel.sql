-- Kjørt: 2026-10-31 (etter Henriks ja). s00-006 i Henger igjen-lista. Se supabase/README.md, «send-push: innloggingssjekk».
--
-- Cron-jobbene «paaminnelser-sjekk» (hvert 5. minutt) og «daglig-paaminnelse» (kl. 06:55 Oslo-tid, hverdager) kalte send-push med den OFFENTLIGE
-- nøkkelen (sb_publishable_..., står i åpen kildekode og er aldri et server-kall). Da send-push fikk en innloggingssjekk (som en dag kan slås på
-- med EDGE_AUTH_ENFORCE) ville håndheving gitt 401 og stoppet alle biltilsyn-, møte- og «Husk å starte timer»-påminnelser uten feilmelding.
-- Nå sender begge service_role-nøkkelen, som send-push gjenkjenner som server-kall (via=server). Samme mønster som triggeren «ordre-push»
-- (20261030180000): nøkkelen slås opp fra Vault (hemmelighetens navn: ordre_push_service_role_key, brukes av alle tre) ved HVER kjøring og
-- står aldri i selve cron-jobben, i en fil eller i Git. Denne filen inneholder ingen hemmelighet, kun navnet på den.
--
-- cron.alter_job bytter BARE kommandoen: jobbnavn, timeplan, aktiv-flagg og bruker er urørt. Selve logikken (URL, body, tidssjekken i daglig-paaminnelse)
-- er uendret; kun Authorization-headeren er byttet.
--
-- Hvis hemmeligheten mangler gir oppslaget NULL og kallet kommer uten gyldig Authorization (porten avviser med 401): påminnelsene stopper STILLE
-- (cron-kjøringen står som «succeeded», feilen vises bare i net._http_response). Se spørringen i README for å se det.
--
-- Rollback: kjør kommandoene i 20260808095154_paaminnelser_cron.sql (paaminnelser-sjekk) og 20260903000000_daglig_paaminnelse_kl_0655.sql
-- (daglig-paaminnelse) på nytt: cron.schedule med samme jobbnavn overskriver jobben. Da er den offentlige nøkkelen tilbake (og håndheving for send-push må ikke være på).

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'paaminnelser-sjekk'),
  command := $cmd$
  select net.http_post(
    url := 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ordre_push_service_role_key')
    ),
    body := jsonb_build_object('type', 'paaminnelser_sjekk')
  );
  $cmd$
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'daglig-paaminnelse'),
  command := $cmd$
  DO $do$
  BEGIN
    IF extract(hour from now() at time zone 'Europe/Oslo') = 6
       AND extract(minute from now() at time zone 'Europe/Oslo') = 55 THEN
      PERFORM net.http_post(
        url := 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ordre_push_service_role_key')
        ),
        body := '{"type": "daglig"}'::jsonb
      );
    END IF;
  END $do$;
  $cmd$
);
