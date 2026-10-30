-- Kjørt: 2026-10-30
-- Del 2 av prislås (s09-023/s05-003): planlagt jobb som kaller fiken-priser-synk hver 6.
-- time, slik at fiken_priser holdes jevnlig oppdatert uten et live Fiken-kall per
-- avkrysning i Lager/Utstyr. Ingen eksakt klokkeslett-følsomhet her (ulikt den daglige
-- påminnelsen kl. 06:55) - rene UTC-timer er greit, ombygginger tar dager/uker, ikke
-- sekunder. Hemmeligheten ligger i Vault (vault.create_secret, ALDRI committet - se
-- seed-kommandoen i samtalen 30.10), samme mønster som ordre-push-triggeren (s00-021).
select cron.schedule(
  'fiken-priser-synk-cron',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/fiken-priser-synk',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_46JAdcBUbQYS8NbDwP-MXg_zKWA8Ojz',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fiken_priser_synk_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
