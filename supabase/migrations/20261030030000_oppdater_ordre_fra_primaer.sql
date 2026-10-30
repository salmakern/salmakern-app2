-- Del av s09-005 (kappløpsfeil i save()): synkroniserFraPrimaer() (ordre-detalj.js) kopierer
-- en flåtes primærkjøretøy sine type/variant/versjon/vekter/typegodkjenning/ombygging til
-- hvert sekundærkjøretøy, og lagret dette via den GENERELLE save() (full-rad-upsert fra
-- nettleserens lokale kopi) - nøyaktig samme mønster som allerede er fikset for ansatte_
-- signert/timer-økter/fiken-linjer (2026-10-29), bare ikke lagt merke til for vekter/type/
-- variant/versjon/typegodkjenning/ombygging før nå (2026-10-30). Uten en egen atomisk rute
-- kunne en ansatt som lagret et urelatert felt på SEKUNDÆRBILEN (fra en litt gammel lokal
-- kopi) stille overskrive en nettopp synkronisert vekt/type/variant med en eldre verdi.
create or replace function public.oppdater_ordre_fra_primaer(
  p_sekundaer_id text,
  p_type text,
  p_variant text,
  p_versjon text,
  p_vekter jsonb,
  p_typegodkjenning text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_eksisterende_ombygging jsonb;
  v_ny_ombygging jsonb;
  v_resultat jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  select coalesce(ombygging, '{}'::jsonb) into v_eksisterende_ombygging
  from ordrer where id = p_sekundaer_id for update;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  -- En flåte er alltid Nytt Kjøretøy (bekreftet av Henrik 2026-10-15) - de tre andre
  -- ombygging-flaggene (bruktKjoretoy/lafinto/personbil) røres ikke.
  v_ny_ombygging := jsonb_set(v_eksisterende_ombygging, '{nyttKjoretoy}', 'true'::jsonb, true);

  update ordrer
  set type = p_type, variant = p_variant, versjon = p_versjon,
      vekter = p_vekter, typegodkjenning = p_typegodkjenning, ombygging = v_ny_ombygging
  where id = p_sekundaer_id
  returning jsonb_build_object(
    'type', type, 'variant', variant, 'versjon', versjon,
    'vekter', vekter, 'typegodkjenning', typegodkjenning, 'ombygging', ombygging
  ) into v_resultat;

  return v_resultat;
end;
$function$;
