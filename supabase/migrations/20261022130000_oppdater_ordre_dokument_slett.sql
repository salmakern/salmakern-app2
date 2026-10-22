-- Kjørt: 2026-10-22
-- Bakgrunn: Full gjennomgang etter gårsdagens kappløps-fiks (oppdater_ordre_dokument,
-- 20261022120000) avdekket at FLERE andre steder i koden fortsatt skriver hele
-- ordrer.dokumenter-kolonnen basert på nettleserens lokale kopi, med samme kappløpsrisiko
-- som den allerede bekreftede hendelsen - bare via andre funksjoner på SAMME kolonne:
-- - vegvesenFjernGenererteDokumenterHvisIkkeLengerAktuelt() (vegvesen-dokumenter.js)
-- - lastOppEtDokument()/lastOppFlereDokumenter() (ordre-diverse.js, manuell opplasting)
-- - slettDokument() (ordre-diverse.js)
--
-- Utvider oppdater_ordre_dokument() til også å støtte SLETTING: p_dokument=NULL fjerner
-- oppføringen med det gitte navnet i stedet for å legge til/erstatte en. Samme radlås
-- ("select ... for update") som før gjør også slettingen atomisk mot overlappende kall fra
-- en annen økt. Returnerer fortsatt { dokumenter, forrige } - "forrige" er nå det som ble
-- fjernet (eller null hvis navnet ikke fantes), slik at kallstedet kan rydde opp i Storage.

create or replace function public.oppdater_ordre_dokument(p_ordre_id text, p_navn text, p_dokument jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dokumenter jsonb;
  v_forrige jsonb := null;
  v_idx int := null;
  v_i int := 0;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  select coalesce(dokumenter, '[]'::jsonb) into v_dokumenter
  from ordrer where id = p_ordre_id for update;

  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_elem in select * from jsonb_array_elements(v_dokumenter) loop
    if v_elem->>'navn' = p_navn then
      v_idx := v_i;
      v_forrige := v_elem;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_dokument is null then
    -- Slett: fjern oppføringen med dette navnet, hvis den finnes.
    if v_idx is not null then
      select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_dokumenter
      from jsonb_array_elements(v_dokumenter) with ordinality as t(elem, i)
      where i - 1 != v_idx;
    end if;
  elsif v_idx is not null then
    v_dokumenter := jsonb_set(v_dokumenter, array[v_idx::text], p_dokument);
  else
    v_dokumenter := v_dokumenter || jsonb_build_array(p_dokument);
  end if;

  update ordrer set dokumenter = v_dokumenter where id = p_ordre_id;

  return jsonb_build_object('dokumenter', v_dokumenter, 'forrige', v_forrige);
end;
$$;
grant execute on function public.oppdater_ordre_dokument(text, text, jsonb) to anon, authenticated;
