-- Kjørt: 2026-11-01
-- s08-034/s08-056: Henrik spurte om statusen til portalen kan sendes med én gang i stedet for å
-- vente på cron-jobben. Svar: ja, samme mønster som ordre-push-triggeren (s00-021) - en AFTER
-- INSERT-trigger på selve køtabellen ordre_status_utboks forsøker å kalle send-ordre-status-til-
-- portal UMIDDELBART, best-effort (kan aldri la forsøket rulle tilbake selve kø-innsettingen).
-- Lagt på ordre_status_utboks (ikke ordrer-triggeren direkte) slik at BÅDE vanlige
-- statusendringer (ordre_status_utboks_trigger_fn) OG portal_bekreft_ordre() sin egen
-- baseline-innsetting (20261031180000) fanges av samme, ene mekanisme.
--
-- Cron-jobben (del 2 av denne migrasjonen) beholdes som sikkerhetsnett: fanger opp rader der det
-- umiddelbare forsøket feilet (portalen nede, timeout, Vault-oppslag feilet etc.) - selve
-- send-ordre-status-til-portal er idempotent og trygg å kalle ofte (den finner bare uleverte
-- rader), så dobbel kjøring (umiddelbar + neste cron-tikk) er helt ufarlig.
--
-- Henrik 1.11: "ja" til umiddelbar sending + cron som sikkerhetsnett (hvert 5. minutt), etter
-- portal-øktas bekreftede røyktest (b) av portalens mottaker.

create or replace function public.ordre_status_utboks_umiddelbar_sending_fn()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sync_secret text;
  v_request_id bigint;
begin
  begin
    select decrypted_secret into v_sync_secret
    from vault.decrypted_secrets
    where name = 'ordre_status_synk_secret';

    if v_sync_secret is null then
      raise warning 'ordre-status-utboks-umiddelbar: fant ikke ordre_status_synk_secret i Vault - hopper over umiddelbar sending, cron-jobben tar den neste runde';
      return new;
    end if;

    select http_post into v_request_id
    from net.http_post(
      'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-ordre-status-til-portal',
      '{}'::jsonb,
      '{}'::jsonb,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_46JAdcBUbQYS8NbDwP-MXg_zKWA8Ojz',
        'x-sync-secret', v_sync_secret
      ),
      5000
    );
  exception when others then
    -- Best-effort, akkurat som ordre-push-triggeren: en feilende umiddelbar sending skal
    -- ALDRI rulle tilbake selve kø-innsettingen. Cron-jobben plukker raden opp senere uansett.
    raise warning 'ordre-status-utboks-umiddelbar: sending feilet (%), cron-jobben tar den neste runde', sqlerrm;
  end;

  return new;
end;
$function$;

drop trigger if exists "ordre-status-utboks-umiddelbar-sending" on public.ordre_status_utboks;
create trigger "ordre-status-utboks-umiddelbar-sending"
after insert on public.ordre_status_utboks
for each row
execute function public.ordre_status_utboks_umiddelbar_sending_fn();

-- Sikkerhetsnett: samme intervall som paaminnelser-sjekk (hvert 5. minutt). I normaltilfellet er
-- det ingenting igjen å gjøre her (umiddelbar sending traff), så dette fanger bare opp unntak.
select cron.schedule(
  'send-ordre-status-til-portal-cron',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-ordre-status-til-portal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_46JAdcBUbQYS8NbDwP-MXg_zKWA8Ojz',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ordre_status_synk_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
