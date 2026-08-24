-- ============================================================
-- Salmaker'n – Cron-jobb: sjekker biltilsyn-tider og møter hvert 5. minutt
-- og sender push-varsel via send-push-funksjonen når noe er nær forestående.
--
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- FORUTSETTER at supabase_paaminnelser.sql er kjørt, og at send-push-funksjonen
-- er redeployet med den nye "paaminnelser_sjekk"-logikken (index.ts er oppdatert).
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'paaminnelser-sjekk',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_46JAdcBUbQYS8NbDwP-MXg_zKWA8Ojz'
    ),
    body := jsonb_build_object('type', 'paaminnelser_sjekk')
  );
  $$
);

-- For å se at jobben faktisk kjører og lykkes:
-- select * from cron.job;
-- select * from cron.job_run_details order by start_time desc limit 20;

-- For å fjerne jobben igjen ved behov:
-- select cron.unschedule('paaminnelser-sjekk');
