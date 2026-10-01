-- Kjørt: 2026-10-01
-- Bakgrunn: Full gjennomgang av rolletilganger i appen (bedt om av Henrik) avdekket at
-- kontakter_slett/kontakter_upsert/kontakter_orgnr_batch_oppdater (20260926120000,
-- 20260927100000) - i motsetning til ALLE andre SECURITY DEFINER-funksjoner i appen
-- (opprett_ansatt, logg_inn_med_pin) - mangler en current_ansatt()-sjekk inni selve
-- funksjonskroppen. Siden Postgres som standard gir EXECUTE til PUBLIC (bekreftet i
-- databasen: PUBLIC + anon har EXECUTE på alle tre), kunne i prinsippet hvem som helst med
-- appens offentlige nøkkel kalle disse direkte og slette/endre hele kontaktlisten UTEN å
-- logge inn. Kontakter-redigering i selve UI-et (js/ansatte-utstyr.js) er allerede admin-
-- only - denne fiksen gjør det samme håndhevet i selve databasen, nøyaktig samme mønster
-- som opprett_ansatt sin 'KUN_ADMIN'-sjekk.

create or replace function public.kontakter_slett(p_kontakt_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ny jsonb;
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  select coalesce(jsonb_agg(k), '[]'::jsonb)
  into v_ny
  from innstillinger, jsonb_array_elements(kontakter) k
  where innstillinger.id = 1 and k->>'id' != p_kontakt_id;

  update innstillinger set kontakter = coalesce(v_ny, '[]'::jsonb) where id = 1;
  return v_ny;
end;
$$;

create or replace function public.kontakter_upsert(p_kontakt jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ny jsonb;
  v_id text := p_kontakt->>'id';
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  if v_id is null or v_id = '' then
    raise exception 'Kontakt mangler id';
  end if;

  select coalesce(jsonb_agg(
    case when k->>'id' = v_id then p_kontakt else k end
  ), '[]'::jsonb)
  into v_ny
  from innstillinger, jsonb_array_elements(kontakter) k
  where innstillinger.id = 1;

  if not exists (select 1 from jsonb_array_elements(v_ny) k where k->>'id' = v_id) then
    v_ny := v_ny || jsonb_build_array(p_kontakt);
  end if;

  update innstillinger set kontakter = v_ny where id = 1;
  return v_ny;
end;
$$;

create or replace function public.kontakter_orgnr_batch_oppdater(p_oppdateringer jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ny jsonb;
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  select coalesce(jsonb_agg(
    case
      when (select (o->>'orgnr') from jsonb_array_elements(p_oppdateringer) o where o->>'id' = k->>'id' limit 1) is not null
        then jsonb_set(k, '{orgnr}', to_jsonb((select (o->>'orgnr') from jsonb_array_elements(p_oppdateringer) o where o->>'id' = k->>'id' limit 1)))
      else k
    end
  ), '[]'::jsonb)
  into v_ny
  from innstillinger, jsonb_array_elements(kontakter) k
  where innstillinger.id = 1;

  update innstillinger set kontakter = coalesce(v_ny, '[]'::jsonb) where id = 1;
  return v_ny;
end;
$$;
