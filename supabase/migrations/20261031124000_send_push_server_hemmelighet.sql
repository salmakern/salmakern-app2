-- Kjørt: 2026-10-31 (etter Henriks ja). s00-027 (og s00-006) i Henger igjen-lista. Se supabase/README.md, «send-push: innloggingssjekk».
--
-- Bakgrunn: send-push har en innloggingssjekk (myk modus) som skal gjenkjenne SERVER-til-server-kall (cron-jobbene «paaminnelser-sjekk» og
-- «daglig-paaminnelse» og triggeren «ordre-push») som en egen gyldig kategori, slik at en dag med håndheving ikke stopper påminnelser og statusvarsler.
-- Første forsøk (20261031113000) lot cron sende service_role-nøkkelen fra Vault og sammenlignet mot funksjonens SUPABASE_SERVICE_ROLE_KEY. Det traff aldri:
-- loggene viste via=ingen, og SHA-256-sammendrag viste at de to nøklene er ulike verdier (funksjonen har også det nye nøkkelsystemet).
--
-- Løsning: en EGEN delt hemmelighet. Funksjonshemmeligheten SEND_PUSH_SERVER_SECRET (satt med «supabase secrets set») og Vault-hemmeligheten
-- send_push_server_secret (samme verdi) lages i en SEPARAT, ikke-committet kommando FØR denne migrasjonen kjøres (verdien skal aldri stå i en fil i Git eller
-- i OneDrive). Denne filen inneholder ingen hemmelighet, kun navnet på den. Cron-jobbene og triggeren slår den opp fra Vault ved HVER kjøring og sender den i
-- headeren x-server-secret. Authorization er uendret (service_role-nøkkelen fra Vault) og brukes bare av Supabase-porten (verify_jwt).
--
-- Mangler Vault-hemmeligheten sendes headeren tom: i myk modus går alt gjennom som før (loggen viser via=ingen), og ordre-lagringen berøres aldri
-- (triggeren er pakket i exception-blokken som før). Rollback: kjør 20261031113000_send_push_cron_vault_nokkel.sql og 20261030180000_ordre_push_vault_nokkel.sql
-- på nytt (de setter cron og triggeren tilbake til forrige form); fjern gjerne SEND_PUSH_SERVER_SECRET.

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'paaminnelser-sjekk'),
  command := $cmd$
  select net.http_post(
    url := 'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ordre_push_service_role_key'),
      'x-server-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'send_push_server_secret'), '')
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
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ordre_push_service_role_key'),
          'x-server-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'send_push_server_secret'), '')
        ),
        body := '{"type": "daglig"}'::jsonb
      );
    END IF;
  END $do$;
  $cmd$
);

create or replace function public.ordre_push_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nokkel text;
  v_server text;
  v_headers jsonb;
  v_payload jsonb;
  v_request_id bigint;
begin
  -- Push-varselet er et best-effort sidevirkning, ALDRI noe som skal kunne blokkere selve
  -- ordre-lagringen - denne triggeren kjører AFTER UPDATE i samme transaksjon som selve
  -- UPDATE-en, så en ufanget exception her ville rullet tilbake ordre-endringen også.
  begin
    select decrypted_secret into v_nokkel
    from vault.decrypted_secrets
    where name = 'ordre_push_service_role_key';

    if v_nokkel is null then
      raise warning 'ordre-push: fant ikke nøkkelen i Vault (ordre_push_service_role_key) - hopper over push-varsel';
      return new;
    end if;

    -- Den delte server-hemmeligheten (s00-027): send-push gjenkjenner den som server-kall. Mangler den, sendes varselet likevel (myk modus).
    select decrypted_secret into v_server
    from vault.decrypted_secrets
    where name = 'send_push_server_secret';
    if v_server is null then
      raise warning 'ordre-push: fant ikke send_push_server_secret i Vault - sender uten server-hemmelighet';
    end if;

    v_headers := jsonb_build_object('Content-type', 'application/json', 'Authorization', 'Bearer ' || v_nokkel, 'x-server-secret', coalesce(v_server, ''));
    -- Samme nyttelast-form som supabase_functions.http_request() bygget tidligere - send-push
    -- (supabase/functions/send-push/index.ts) leser payload.record/old_record/type direkte.
    v_payload := jsonb_build_object(
      'old_record', to_jsonb(old),
      'record', to_jsonb(new),
      'type', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema
    );

    select http_post into v_request_id
    from net.http_post(
      'https://qoqpenbfdxeduylxirwk.supabase.co/functions/v1/send-push',
      v_payload,
      '{}'::jsonb,
      v_headers,
      5000
    );

    insert into supabase_functions.hooks (hook_table_id, hook_name, request_id)
    values (tg_relid, tg_name, v_request_id);
  exception when others then
    raise warning 'ordre-push: push-varsel feilet (%), ordre-lagringen fortsetter uendret', sqlerrm;
  end;

  return new;
end;
$function$;
revoke all on function public.ordre_push_trigger_fn() from public, anon, authenticated;
