-- ============================================================
-- "Dagens PIN" (GPS-overstyringskoden i timer-funksjonen, se timer.js
-- bekreftTimerPIN()) skal bytte automatisk hver natt ved midnatt, i stedet for at en
-- admin må trykke "Ny PIN" manuelt i Mer-fanen (bedt om av Henrik 2026-09-16).
--
-- Samme mønster som daglig-paaminnelse-cronjobben (se
-- 20260903000000_daglig_paaminnelse_kl_0655.sql): cron.schedule() kjører på begge UTC-
-- timer midnatt Oslo-tid kan falle på (22:00 UTC om sommeren/CEST, 23:00 UTC om
-- vinteren/CET), og den indre sjekken avgjør hvilken av de to som faktisk er midnatt i
-- Oslo akkurat nå - jobben "bommer" bevisst på den andre.
--
-- Selve utloggingen av alle innloggede skjer klient-side (se core.js sin
-- subscribeRealtime() - realtime-oppdateringen på innstillinger-tabellen sammenligner ny
-- mot forrige kjente PIN og kaller doLogout() på alle økter unntatt den som selv gjorde
-- endringen, hvis noen). Denne SQL-jobben trenger derfor bare å bytte selve PIN-en - det
-- utløser automatisk riktig oppførsel på klientene via det eksisterende realtime-
-- abonnementet, uten noen egen kobling herfra.
select cron.schedule(
  'daglig-pin-rotasjon',
  '0 22,23 * * *',
  $$
  DO $do$
  BEGIN
    IF extract(hour from now() at time zone 'Europe/Oslo') = 0
       AND extract(minute from now() at time zone 'Europe/Oslo') = 0 THEN
      UPDATE innstillinger
      SET dagens_pin = lpad(floor(random() * 10000)::int::text, 4, '0')
      WHERE id = 1;
    END IF;
  END $do$;
  $$
);
