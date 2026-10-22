-- Kjørt: 2026-10-22
-- Bakgrunn: To ansatte (Jan Henrik og Jan Børre) genererte Vegvesen-dokumenter på samme
-- ordre (ord_1792056356666, chassis W1NFF3DE6TB720873) med ca. 40 sekunders mellomrom.
-- vegvesenLagreGenerertDokument()/-Flere() (js/vegvesen-dokumenter.js) leser HELE
-- o.dokumenter inn i nettleserens minne, legger til/erstatter ÉN linje, og skriver HELE
-- lista tilbake - et klassisk "les-endre-skriv"-kappløp. Når to nettlesere gjør dette på
-- samme ordre nesten samtidig, overskriver den som lagrer SIST hele lista med SIN egen
-- (eldre) kopi, og sletter dermed den andres nylig tilførte dokumentlinjer uten varsel.
-- Bekreftet ved å sammenligne endringer-loggen (begge ansattes "Generert dokument"-
-- oppføringer tett i tid) mot sluttresultatet (kun ÉN dokumentlinje sto igjen, og selve
-- PDF-filen den pekte til var borte fra storage - den ble ryddet bort som "gammel versjon"
-- av den andre, tapte skrivingen).
--
-- Fiksen: flytter selve les-endre-skriv-steget for dokumenter-kolonnen inn i databasen,
-- som ÉN atomisk funksjon med "select ... for update" - det radlåser ordre-raden til
-- funksjonen er ferdig, slik at et overlappende kall fra en ANNEN ansatt/nettleser må
-- vente til det første er helt ferdig, og da ser den OPPDATERTE (ikke den opprinnelige,
-- utdaterte) dokument-lista før den selv legger til sin egen linje. Dette eliminerer
-- kappløpet helt, uavhengig av hvor lenge nettsiden bruker på å generere/laste opp PDF-en
-- før den kaller funksjonen.
--
-- Samme mønster (security definer, search_path-herding, current_ansatt()-sjekk) som
-- kontakter_upsert (20261001100000) og logg_inn_med_pin (20260803162946) - "alle
-- innloggede ansatte", ikke admin-only, siden Vegvesen-dokumenter genereres av vanlige
-- ansatte under ordreregistrering, ikke en admin-only handling.
--
-- Returnerer BÅDE den nye dokument-lista OG dokumentet som ble erstattet (hvis navnet
-- fantes fra før) - klienten trenger den gamle url-en for å slette den utdaterte filen
-- fra Storage etterpå (se vegvesenLagreGenerertDokument() i js/vegvesen-dokumenter.js).

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

  -- "for update" låser raden for resten av denne transaksjonen - et overlappende kall
  -- fra en annen sesjon på SAMME ordre venter her til denne funksjonen er ferdig (commit),
  -- og leser da garantert den ferskeste dokument-lista, ikke en utdatert kopi.
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

  if v_idx is not null then
    v_dokumenter := jsonb_set(v_dokumenter, array[v_idx::text], p_dokument);
  else
    v_dokumenter := v_dokumenter || jsonb_build_array(p_dokument);
  end if;

  update ordrer set dokumenter = v_dokumenter where id = p_ordre_id;

  return jsonb_build_object('dokumenter', v_dokumenter, 'forrige', v_forrige);
end;
$$;
grant execute on function public.oppdater_ordre_dokument(text, text, jsonb) to anon, authenticated;
