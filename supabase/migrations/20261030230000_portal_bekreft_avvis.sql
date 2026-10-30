-- Kjørt: 2026-10-30 (v1: test 28/28 i en transaksjon som ble rullet tilbake; v2 samme dag etter uavhengig gjennomgang: strengere urørt-sjekk, NULL-sikker, lagerbruk; ordrer/admin_ark/innstillinger byte-identiske før og etter)
-- Fase 2, G6: de to handlingene en ansatt har på en ordre som kom fra Forhandlerportalen (opprettet av portal_koble_bestilling, merket «PORTAL · IKKE BEKREFTET»).
--
--  * portal_bekreft_ordre(p_ordre_id): en ansatt har sett over chassis.nr og bekrefter bestillingen. Idempotent (ny bekreftelse endrer ingenting). Setter
--    portal_bekreftet_at/-av, skriver én linje i endringsloggen og markerer portal_bestillinger som «bekreftet». ALLE innloggede ansatte kan bekrefte.
--  * portal_avvis_ordre(p_ordre_id): sletter en FEILOPPRETTET portal-ordre. Bare admin og godkjenner, og bare for en ordre som (a) kom fra portalen,
--    (b) ikke er bekreftet og (c) er URØRT (se v_urort under: fortsatt «På vei», uten flåte/kalender/bilder/timer/signatur/Fiken-linjer/lagerbruk/godkjenning,
--    uten utfylt utstyr/vekter/ombygging/drivstoff/tekstfelt, og med bare opprettelseslinjen i endringsloggen). Funksjonen sletter dermed aldri en ordre noen har jobbet på.
--    MERK: rolle- og urørt-sjekken er et sikkerhetsnett mot misforståelser i appen, IKKE en grense mot en ansatt som går forbi appen: RLS på ordrer
--    («krever_innlogget_ansatt», FOR ALL) lar alle innloggede ansatte slette og endre ordrer direkte, for ALLE ordrer (også uten portal). En avvist bestilling blir stående i portal_bestillinger
--    som «avvist» (gravstein): et nytt kall fra portalen med samme bestilling gjenskaper aldri ordren. Ordre som er endret av ansatte slettes som vanlig
--    («Slett ordre», admin).
-- Begge er SECURITY DEFINER og sjekker innlogget ansatt selv (current_ansatt()), siden tabellene ellers bare kan skrives av service_role/appens egne stier.
-- Skriver kun ordrer.portal_*-kolonnene, endringer og updated_at (UPDATE på ordrer gir ingen push: ordre-push varsler bare ved status-/vekt-/hengerfesteendring)
-- og portal_bestillinger.status/detalj. Rollback: supabase/rollback-referanser/portal_bekreft_avvis_ROLLBACK.sql.
-- Feil kastes som tekst «KODE» (IKKE_INNLOGGET, IKKE_TILLATT, ORDRE_FINNES_IKKE, IKKE_PORTAL_ORDRE, ALLEREDE_BEKREFTET, IKKE_URORT); appen oversetter dem.

create or replace function public.portal_bekreft_ordre(p_ordre_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ans_id bigint;
  v_navn text;
  v_o public.ordrer%rowtype;
  v_tid text;
  v_endringer jsonb;
  v_bekreftet_at timestamptz;
begin
  select a.id into v_ans_id from public.current_ansatt() a;
  if v_ans_id is null then
    raise exception 'IKKE_INNLOGGET';
  end if;
  select coalesce(nullif(btrim(an.navn), ''), 'Ansatt ' || an.id::text) into v_navn from public.ansatte an where an.id = v_ans_id;

  select * into v_o from public.ordrer where id = p_ordre_id for update;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;
  if v_o.portal_bestilling_id is null then
    raise exception 'IKKE_PORTAL_ORDRE';
  end if;
  if v_o.portal_bekreftet_at is not null then
    return jsonb_build_object('kode', 'allerede_bekreftet', 'portal_bekreftet_at', v_o.portal_bekreftet_at, 'portal_bekreftet_av', coalesce(v_o.portal_bekreftet_av, ''),
                              'endringer', coalesce(v_o.endringer, '[]'::jsonb));
  end if;

  v_tid := to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY, HH24:MI:SS');
  v_bekreftet_at := now();
  v_endringer := coalesce(v_o.endringer, '[]'::jsonb)
                 || jsonb_build_array(jsonb_build_object('av', v_navn, 'tid', v_tid, 'txt', 'Bekreftet som bestilling fra Forhandlerportalen'));
  update public.ordrer
     set portal_bekreftet_at = v_bekreftet_at, portal_bekreftet_av = v_navn, endringer = v_endringer, updated_at = v_bekreftet_at
   where id = p_ordre_id;
  update public.portal_bestillinger
     set status = 'bekreftet', detalj = 'Bekreftet av ' || v_navn || ' ' || v_tid, oppdatert_at = v_bekreftet_at
   where portal_bestilling_id = v_o.portal_bestilling_id;

  return jsonb_build_object('kode', 'ok', 'portal_bekreftet_at', v_bekreftet_at, 'portal_bekreftet_av', v_navn, 'endringer', v_endringer);
end;
$function$;

create or replace function public.portal_avvis_ordre(p_ordre_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ans_id bigint;
  v_rolle text;
  v_navn text;
  v_o public.ordrer%rowtype;
  v_tid text;
  v_urort boolean;
begin
  select a.id, a.rolle into v_ans_id, v_rolle from public.current_ansatt() a;
  if v_ans_id is null then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if v_rolle not in ('admin', 'godkjenner') then
    raise exception 'IKKE_TILLATT';
  end if;
  select coalesce(nullif(btrim(an.navn), ''), 'Ansatt ' || an.id::text) into v_navn from public.ansatte an where an.id = v_ans_id;

  select * into v_o from public.ordrer where id = p_ordre_id for update;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;
  if v_o.portal_bestilling_id is null then
    raise exception 'IKKE_PORTAL_ORDRE';
  end if;
  if v_o.portal_bekreftet_at is not null then
    raise exception 'ALLEREDE_BEKREFTET';
  end if;

  -- URØRT: ordren står som den ble opprettet av portal_koble_bestilling. Alt en ansatt kan ha fylt ut eller gjort på den (og som ville gått tapt ved sletting) stopper avvisningen:
  -- status, kalender, flåte, godkjenning, loggførte endringer, timer, bilder, signatur, dokumenter, Fiken-linjer, lagerbruk og de ulogget feltene (utstyr, vekter, ombygging, drivstoff, tekstfelt).
  -- Alle ledd er skrevet så en NULL gir «ikke urørt» (se `is not true` under).
  v_urort :=
        coalesce(v_o.status, '') = 'aktiv' and coalesce(v_o.ordre_status, '') = 'paa_vei'
    and v_o.flate_id is null and v_o.kalender_dato is null and v_o.ankomstdato is null
    and not coalesce(v_o.godkjent, false) and not coalesce(v_o.fakturert, false) and not coalesce(v_o.diagnose, false)
    and coalesce(v_o.regnr, '') = '' and coalesce(v_o.farge, '') = '' and coalesce(v_o.notater, '') = '' and coalesce(v_o.utstyr_mal_navn, '') = ''
    and coalesce(v_o.utstyr->>'skalHa', '') = '' and coalesce(v_o.utstyr->>'har', '') = ''
    and coalesce(v_o.utstyr->>'hengerfeste', 'ikke_hengerfeste') = 'ikke_hengerfeste'
    and coalesce(v_o.utstyr->>'hengerfesteMontert', 'ikke_montert') = 'ikke_montert'
    and coalesce(v_o.utstyr->>'hengerfesteBestilt', 'ikke_bestilt') = 'ikke_bestilt'
    and coalesce(v_o.drivstoff->>'totalpris', '') = '' and coalesce(v_o.drivstoff->>'satsId', '') = ''
    and not jsonb_path_exists(coalesce(v_o.vekter, '{}'::jsonb), '$.*.* ? (@.type() == "string" && @ != "")')
    and not exists (select 1 from jsonb_each(coalesce(v_o.ombygging, '{}'::jsonb)) e where e.value = 'true'::jsonb)
    and not exists (select 1 from public.lagerhistorikk lh where lh.ordre_id = p_ordre_id)
    and jsonb_array_length(coalesce(v_o.endringer, '[]'::jsonb)) <= 1
    and jsonb_array_length(coalesce(v_o.ordre_timer_sessions, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_o.klargjoring_timer_sessions, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_o.bilder_manglende_deler, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_o.ansatte_signert, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_o.fiken_linjer, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_o.dokumenter, '[]'::jsonb)) <= 1           -- bare den automatiske forhandlerfullmakten
    and v_o.signatur is null
    and not exists (select 1 from jsonb_array_elements(coalesce(v_o.bilder_ankomst, '[]'::jsonb)) e where jsonb_typeof(e) <> 'null')
    and not exists (select 1 from jsonb_array_elements(coalesce(v_o.bilder_levering, '[]'::jsonb)) e where jsonb_typeof(e) <> 'null')
    and not exists (select 1 from jsonb_array_elements(coalesce(v_o.bilder_avstand_skader, '[]'::jsonb)) e where jsonb_typeof(e) <> 'null');
  if v_urort is not true then
    raise exception 'IKKE_URORT';
  end if;

  v_tid := to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY, HH24:MI:SS');
  delete from public.ordrer where id = p_ordre_id;
  -- Alle bestillinger som peker på denne ordren (den som opprettet den, og eventuelle senere «koblet» på samme chassis) blir avvist: ordren finnes ikke lenger.
  update public.portal_bestillinger
     set status = 'avvist', detalj = 'Avvist av ' || v_navn || ' ' || v_tid || '. Ordren er slettet og blir ikke opprettet på nytt.', oppdatert_at = now()
   where ordre_id = p_ordre_id or portal_bestilling_id = v_o.portal_bestilling_id;

  return jsonb_build_object('kode', 'ok');
end;
$function$;

-- Bare innloggede ansatte (appens økt har rollen authenticated); ikke anon/public.
revoke all on function public.portal_bekreft_ordre(text) from public, anon;
revoke all on function public.portal_avvis_ordre(text) from public, anon;
grant execute on function public.portal_bekreft_ordre(text) to authenticated, service_role;
grant execute on function public.portal_avvis_ordre(text) to authenticated, service_role;
