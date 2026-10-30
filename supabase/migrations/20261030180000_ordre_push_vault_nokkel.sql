-- Kjørt: 2026-10-30
-- s00-021 i Henger igjen-lista. Se supabase/README.md, "Kjent hull i migrasjonshistorikken".
--
-- Triggeren "ordre-push" (AFTER UPDATE på ordrer) kalte tidligere den generiske
-- supabase_functions.http_request() DIREKTE som trigger-funksjon, med service_role-nøkkelen
-- hardkodet i klartekst i selve CREATE TRIGGER-definisjonen (synlig for alle med
-- SQL Editor/direkte spørretilgang - ikke nåbar via appens offentlige PostgREST-API, men
-- dårlig praksis). supabase_functions.http_request() tar bare STATISKE tekst-argumenter
-- (lagret i trigger-definisjonen ved CREATE TRIGGER, ikke slått opp på nytt per rad), så et
-- rent "bytt ut nøkkelen i samme triggerfunksjon"-grep er ikke mulig - løsningen er en egen,
-- liten trigger-funksjon som slår opp nøkkelen fra Supabase sin Vault DYNAMISK ved hver
-- kjøring, og selv bygger samme nyttelast-form (old_record/record/type/table/schema) som
-- http_request() gjorde, slik at send-push-funksjonen (som leser payload.record/old_record)
-- ikke merker noen forskjell.
--
-- Selve nøkkelen er lagret i Vault i en SEPARAT, ikke-committet kommando (navn
-- 'ordre_push_service_role_key') - FØR denne migrasjonen kjøres. Denne filen inneholder
-- ingen hemmelighet, kun et oppslag etter navnet.
--
-- Rollback: se supabase/rollback-referanser/ordre_push_vault_nokkel_ROLLBACK.sql (gjenoppretter
-- det gamle, hardkodede oppsettet fra en lokal kopi av nøkkelen - ALDRI fra en committet fil).

create or replace function public.ordre_push_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nokkel text;
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

    v_headers := jsonb_build_object('Content-type', 'application/json', 'Authorization', 'Bearer ' || v_nokkel);
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

drop trigger if exists "ordre-push" on public.ordrer;
create trigger "ordre-push" after update on public.ordrer
  for each row execute function public.ordre_push_trigger_fn();
