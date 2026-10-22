-- Kjørt: 2026-10-22
-- Bakgrunn: Full gjennomgang avdekket at saveInnstillinger() gjør ÉN blind full-rad-upsert
-- av HELE "innstillinger"-raden (dagens_pin, utstyr_maler, drivstoff_satser, beskjeder,
-- kontakter, hms) basert på nettleserens lokale kopi av alle fem feltene samtidig - kalt fra
-- mange innbyrdes uavhengige steder (lagreBeskjed/slettBeskjed, lagreHMS/toggleHMSLukket,
-- lagreKontaktperson/slettKontaktperson). I TILLEGG er "kontakter" fortsatt med i DENNE
-- payloaden selv om kontakter_upsert()/kontakter_slett() (20260926120000) allerede har sin
-- egen atomiske vei - bekreftet reell bug: en admin som bare poster en beskjed kan (med en
-- litt utdatert lokal S.kontakter) stille overskrive en kontakt en ANNEN admin nettopp
-- lagret/slettet via den atomiske RPC-en, siden saveInnstillinger() uansett sender hele
-- kontakter-arrayet på nytt. Samme delte, upresise "ignorerRealtimeInnstillinger"-flagg
-- (10 sek, satt av ALLE disse funksjonene uansett hvilket felt de faktisk endret) gjør i
-- tillegg at en samtidig sanntidsoppdatering fra en ANNEN økt kan bli ignorert og dermed
-- aldri hentet inn før neste (da garantert utdaterte) full-rad-skriving overskriver den.
--
-- Fiksen: egne atomiske, RADLÅSTE ("select ... for update") funksjoner for beskjeder, hms og
-- kontaktpersoner (nøstet i kontakter) - samme prinsipp som oppdater_ordre_dokument
-- (20261022120000), men for innstillinger-raden. saveInnstillinger() slutter samtidig å
-- sende beskjeder/kontakter/hms i sin egen payload (se egen endring i ansatte-utstyr.js) -
-- den brukes nå kun til dagens_pin/utstyr_maler/drivstoff_satser.

-- Beskjeder (oppslagstavle) - alle innloggede ansatte, samme nivå som i dag (ingen
-- admin-sjekk funnet i lagreBeskjed()/slettBeskjed() fra før - UI skjuler bare knappene).
create or replace function public.beskjed_upsert(p_beskjed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liste jsonb;
  v_id text := p_beskjed->>'id';
  v_idx int := null;
  v_i int := 0;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if v_id is null or v_id = '' then
    raise exception 'Beskjed mangler id';
  end if;

  select coalesce(beskjeder, '[]'::jsonb) into v_liste from innstillinger where id = 1 for update;
  if not found then raise exception 'INNSTILLINGER_FINNES_IKKE'; end if;

  for v_elem in select * from jsonb_array_elements(v_liste) loop
    if v_elem->>'id' = v_id then v_idx := v_i; end if;
    v_i := v_i + 1;
  end loop;

  if v_idx is not null then
    v_liste := jsonb_set(v_liste, array[v_idx::text], p_beskjed);
  else
    v_liste := jsonb_build_array(p_beskjed) || v_liste; -- nyest øverst, som S.beskjeder.unshift()
  end if;

  update innstillinger set beskjeder = v_liste where id = 1;
  return v_liste;
end;
$$;
grant execute on function public.beskjed_upsert(jsonb) to anon, authenticated;

create or replace function public.beskjed_slett(p_beskjed_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liste jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  select coalesce(beskjeder, '[]'::jsonb) into v_liste from innstillinger where id = 1 for update;
  if not found then raise exception 'INNSTILLINGER_FINNES_IKKE'; end if;

  select coalesce(jsonb_agg(b), '[]'::jsonb) into v_liste
  from jsonb_array_elements(v_liste) b where b->>'id' != p_beskjed_id;

  update innstillinger set beskjeder = v_liste where id = 1;
  return v_liste;
end;
$$;
grant execute on function public.beskjed_slett(text) to anon, authenticated;

-- HMS-logg - alle innloggede ansatte (samme nivå som i dag - ingen admin-sjekk funnet i
-- lagreHMS()/toggleHMSLukket()). Dekker både ny registrering OG lukk/gjenåpne (begge er
-- "skriv inn hele saken med denne id-en") - ingen sletting finnes for HMS-saker.
create or replace function public.hms_upsert(p_sak jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liste jsonb;
  v_id text := p_sak->>'id';
  v_idx int := null;
  v_i int := 0;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if v_id is null or v_id = '' then
    raise exception 'HMS-sak mangler id';
  end if;

  select coalesce(hms, '[]'::jsonb) into v_liste from innstillinger where id = 1 for update;
  if not found then raise exception 'INNSTILLINGER_FINNES_IKKE'; end if;

  for v_elem in select * from jsonb_array_elements(v_liste) loop
    if v_elem->>'id' = v_id then v_idx := v_i; end if;
    v_i := v_i + 1;
  end loop;

  if v_idx is not null then
    v_liste := jsonb_set(v_liste, array[v_idx::text], p_sak);
  else
    v_liste := jsonb_build_array(p_sak) || v_liste; -- nyest øverst, som S.hms.unshift()
  end if;

  update innstillinger set hms = v_liste where id = 1;
  return v_liste;
end;
$$;
grant execute on function public.hms_upsert(jsonb) to anon, authenticated;

-- Kontaktpersoner (nøstet i én kontakt sin kontaktpersoner-array) - admin-only, samme nivå
-- som kontakter_upsert/kontakter_slett (redigering/sletting er begge erAdmin-gatet i UI-et).
create or replace function public.kontaktperson_upsert(p_forhandler_id text, p_kontaktperson jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kontakter jsonb;
  v_forhandler_idx int := null;
  v_forhandler jsonb;
  v_kontaktpersoner jsonb;
  v_kp_idx int := null;
  v_i int := 0;
  v_elem jsonb;
  v_kp_id text := p_kontaktperson->>'id';
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;
  if v_kp_id is null or v_kp_id = '' then
    raise exception 'Kontaktperson mangler id';
  end if;

  select coalesce(kontakter, '[]'::jsonb) into v_kontakter from innstillinger where id = 1 for update;
  if not found then raise exception 'INNSTILLINGER_FINNES_IKKE'; end if;

  v_i := 0;
  for v_elem in select * from jsonb_array_elements(v_kontakter) loop
    if v_elem->>'id' = p_forhandler_id then
      v_forhandler_idx := v_i;
      v_forhandler := v_elem;
    end if;
    v_i := v_i + 1;
  end loop;
  if v_forhandler_idx is null then
    raise exception 'FORHANDLER_FINNES_IKKE';
  end if;

  v_kontaktpersoner := coalesce(v_forhandler->'kontaktpersoner', '[]'::jsonb);
  v_kp_idx := null;
  v_i := 0;
  for v_elem in select * from jsonb_array_elements(v_kontaktpersoner) loop
    if v_elem->>'id' = v_kp_id then v_kp_idx := v_i; end if;
    v_i := v_i + 1;
  end loop;

  if v_kp_idx is not null then
    v_kontaktpersoner := jsonb_set(v_kontaktpersoner, array[v_kp_idx::text], p_kontaktperson);
  else
    v_kontaktpersoner := v_kontaktpersoner || jsonb_build_array(p_kontaktperson);
  end if;

  v_forhandler := jsonb_set(v_forhandler, '{kontaktpersoner}', v_kontaktpersoner);
  v_kontakter := jsonb_set(v_kontakter, array[v_forhandler_idx::text], v_forhandler);

  update innstillinger set kontakter = v_kontakter where id = 1;
  return v_kontakter;
end;
$$;
grant execute on function public.kontaktperson_upsert(text, jsonb) to anon, authenticated;

create or replace function public.kontaktperson_slett(p_forhandler_id text, p_kontaktperson_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kontakter jsonb;
  v_forhandler_idx int := null;
  v_forhandler jsonb;
  v_kontaktpersoner jsonb;
  v_i int := 0;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  select coalesce(kontakter, '[]'::jsonb) into v_kontakter from innstillinger where id = 1 for update;
  if not found then raise exception 'INNSTILLINGER_FINNES_IKKE'; end if;

  v_i := 0;
  for v_elem in select * from jsonb_array_elements(v_kontakter) loop
    if v_elem->>'id' = p_forhandler_id then
      v_forhandler_idx := v_i;
      v_forhandler := v_elem;
    end if;
    v_i := v_i + 1;
  end loop;
  if v_forhandler_idx is null then
    raise exception 'FORHANDLER_FINNES_IKKE';
  end if;

  select coalesce(jsonb_agg(p), '[]'::jsonb) into v_kontaktpersoner
  from jsonb_array_elements(coalesce(v_forhandler->'kontaktpersoner','[]'::jsonb)) p
  where p->>'id' != p_kontaktperson_id;

  v_forhandler := jsonb_set(v_forhandler, '{kontaktpersoner}', v_kontaktpersoner);
  v_kontakter := jsonb_set(v_kontakter, array[v_forhandler_idx::text], v_forhandler);

  update innstillinger set kontakter = v_kontakter where id = 1;
  return v_kontakter;
end;
$$;
grant execute on function public.kontaktperson_slett(text, text) to anon, authenticated;
