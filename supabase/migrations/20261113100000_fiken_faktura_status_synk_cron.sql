-- Kjørt: 2026-11-13
-- Planlagt jobb som kaller fiken-faktura-status-synk hver 6. time (samme kadens og mønster
-- som fiken-priser-synk-cron, migrasjon 20261030231000): "Fiken gir fakturastatus tilbake til
-- appen" (Henger igjen s90-20261104-5, Henriks valgte steg 1 i automatiseringsplanen 4.11).
-- Hemmeligheten ligger i Vault (vault.create_secret, ALDRI committet - se supabase/README.md,
-- "Slik lages eller byttes hemmeligheten"), samme to-lags mønster (Vault for cron-kallet,
-- Supabase-funksjonshemmelighet FIKEN_FAKTURA_STATUS_SYNK_SECRET for selve edge-funksjonen).
select cron.schedule(
  'fiken-faktura-status-synk-cron',
  '20 */6 * * *',
  $$
  select net.http_post(
    url := 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/fiken-faktura-status-synk',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_46JAdcBUbQYS8NbDwP-MXg_zKWA8Ojz',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fiken_faktura_status_synk_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
