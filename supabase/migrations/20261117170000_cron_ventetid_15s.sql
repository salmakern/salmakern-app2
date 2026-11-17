-- Cron-jobbenes kall til edge-funksjoner venter 15 s i stedet for pg_net-standarden 5 s (Henrik 17.11.2026: «Ja, gjør det»).
--
-- Bakgrunn (undersøkt 17.11, bare lesing): 28 av 325 pg_net-svar på 6 timer var «Timeout of 5000 ms reached», alle i
-- sekund 0-5 av et cron-tidspunkt (mest send-ordre-status-til-portal-cron og paaminnelser-sjekk, som starter i samme
-- sekund hvert 5. min). Årsak: kald oppstart av edge-funksjonene. Arbeidet gikk trolig ikke tapt (kallet er alt sendt),
-- men nattens QA (punkt 19) melder det som feil.
--
-- Endring:
--  1. timeout_milliseconds := 15000 settes inn i net.http_post-kallet i de fire jobbene (bare ventetiden; url, headere,
--     hemmeligheter og body røres ikke, og kommandoen skrives om på serveren så ingen hemmelighet står i denne fila).
--  2. send-ordre-status-til-portal-cron flyttes fra */5 til 2-59/5, så den ikke kaldstarter samtidig med påminnelsene.
-- Idempotent: en jobb som alt har timeout_milliseconds, røres ikke.
--
-- ROLLBACK: fjern teksten «timeout_milliseconds := 15000,» fra de fire kommandoene med samme mønster
--   (cron.alter_job(jobid, command := replace(command, E'timeout_milliseconds := 15000,\n    ', ''))) og sett
--   send-ordre-status-til-portal-cron tilbake til '*/5 * * * *'.

do $$
declare
  j record;
begin
  for j in
    select jobid, jobname, command from cron.job
    where jobname in ('paaminnelser-sjekk', 'fiken-priser-synk-cron', 'send-ordre-status-til-portal-cron', 'fiken-faktura-status-synk-cron')
  loop
    if j.command ilike '%timeout_milliseconds%' then
      continue;
    end if;
    if position('body :=' in j.command) = 0 then
      raise exception 'Fant ikke «body :=» i jobben %, avbryter uten endring', j.jobname;
    end if;
    perform cron.alter_job(j.jobid, command := replace(j.command, 'body :=', E'timeout_milliseconds := 15000,\n    body :='));
  end loop;

  perform cron.alter_job((select jobid from cron.job where jobname = 'send-ordre-status-til-portal-cron'), schedule := '2-59/5 * * * *');
end $$;
