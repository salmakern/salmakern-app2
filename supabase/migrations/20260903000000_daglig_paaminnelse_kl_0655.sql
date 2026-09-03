-- Kjørt: 2026-09-03
-- Bakgrunn: "Husk å starte timer!"-varselet (daglig-paaminnelse-cronjobben) skulle
-- flyttes fra kl. 05:55 til kl. 06:55 (Oslo-tid).
--
-- Jobben ble opprinnelig satt opp direkte i Supabase (ikke via en migreringsfil her -
-- se supabase/README.md), derfor ingen tidligere fil å diffe mot. cron.schedule() med
-- samme jobbnavn overskriver den eksisterende jobben i stedet for å lage en ny.
--
-- Selve cron-utløsningen står i UTC og kjøres på TO timer (4 og 5) for å dekke begge
-- sider av sommertid-skiftet - Oslo er UTC+2 om sommeren (CEST) og UTC+1 om vinteren
-- (CET), så kl. 06:55 Oslo-tid tilsvarer enten 04:55 UTC (sommer) eller 05:55 UTC
-- (vinter). Selve utsendelsen skjer kun når den indre sjekken (Europe/Oslo-klokkeslettet
-- er faktisk 06:55) stemmer, så jobben "bommer" bevisst hver dag på den ene av de to
-- timene den trigges på.
select cron.schedule(
  'daglig-paaminnelse',
  '55 4,5 * * 1-5',
  $$
  DO $do$
  BEGIN
    IF extract(hour from now() at time zone 'Europe/Oslo') = 6
       AND extract(minute from now() at time zone 'Europe/Oslo') = 55 THEN
      PERFORM net.http_post(
        url := 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-push',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_46JAdcBUbQYS8NbDwP-MXg_zKWA8Ojz"}'::jsonb,
        body := '{"type": "daglig"}'::jsonb
      );
    END IF;
  END $do$;
  $$
);
