-- Kjørt: 2026-10-22
-- Bakgrunn: Full gjennomgang (samme dag som dokumenter-/endringer-kappløpet) avdekket at
-- ordrer.fiken_linjer (fakturagrunnlaget) har samme "les hele arrayet lokalt, endre, skriv
-- hele arrayet tilbake"-kappløp som de to andre - oppdaterFikenLinjeForOppskrift() (lager.js,
-- brukt av EV9-panorama/4-seter-huking, utstyr-maler og "Ekstra utstyr"-oppskrifter) og
-- drivstoff-synkroniseringen (ordre-detalj.js) kaller alle den generelle save(), som upserter
-- HELE ordre-raden fra nettleserens lokale kopi. Et automatisk synk-kall (kjøres på HVERT
-- render) som overlapper med en annen ansatts manuelle redigering av en annen fakturalinje
-- kan dermed overskrive hverandre.
--
-- Denne funksjonen dekker PRODUKTNUMMER-keyede skrivinger (legg til/oppdater/fjern ÉN linje
-- identifisert ved produktnummer) - samme mønster som oppdater_ordre_dokument, bare for
-- fiken_linjer i stedet for dokumenter. Den rent manuelle, friteksts-baserte linjeredigeringen
-- (legg til tom linje / fjern linje ved indeks / rediger felt ved indeks i selve
-- Fakturering-kortet) er IKKE dekket av denne - den er en enkelt-admin, kortvarig
-- redigeringsøkt uten noen naturlig "nøkkel" per linje, og står foreløpig igjen med samme
-- (lavere praktiske risiko) begrensning som før. Se samtalen 2026-10-22 for vurderingen.

create or replace function public.oppdater_ordre_fiken_linje(p_ordre_id text, p_produktnummer text, p_linje jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linjer jsonb;
  v_idx int := null;
  v_i int := 0;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  select coalesce(fiken_linjer, '[]'::jsonb) into v_linjer
  from ordrer where id = p_ordre_id for update;

  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_elem in select * from jsonb_array_elements(v_linjer) loop
    if v_elem->>'produktnummer' = p_produktnummer then
      v_idx := v_i;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_linje is null then
    if v_idx is not null then
      select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_linjer
      from jsonb_array_elements(v_linjer) with ordinality as t(elem, i)
      where i - 1 != v_idx;
    end if;
  elsif v_idx is not null then
    v_linjer := jsonb_set(v_linjer, array[v_idx::text], p_linje);
  else
    v_linjer := v_linjer || jsonb_build_array(p_linje);
  end if;

  update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;

  return jsonb_build_object('fikenLinjer', v_linjer);
end;
$$;
grant execute on function public.oppdater_ordre_fiken_linje(text, text, jsonb) to anon, authenticated;
