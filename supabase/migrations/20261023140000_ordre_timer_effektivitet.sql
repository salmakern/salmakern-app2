-- Kjørt: 2026-10-23
-- Bakgrunn: Henrik ba om å kunne måle hvor lang tid ansatte faktisk bruker på en bil, sette
-- en standardtid per modell, og få en bedømmelse/effektivitetsoversikt per ansatt ut av det
-- (samtalen 2026-10-23). Appen hadde allerede to stoppeklokker per ordre (Ombygging og
-- Klargjøring, se ordre_timer_sessions/klargjoring_timer_sessions i ordrer-tabellen og
-- ORDRE_TIMER_LABEL i ordre-diverse.js), men øktene manglet HVEM som kjørte klokka, og
-- start/stopp var helt manuelt.
--
-- Avklart design (se samtalen for full begrunnelse):
-- - Klokkene skal starte/stoppe AUTOMATISK ut fra ordrens status + hvem som er "meldt på"
--   ordren (ansatte_signert) - ingen ny knapp. Ombygging = status 'paabegynt' til den forlates
--   (til 'ikke_veid' eller 'klar_visning'). Klargjøring = status 'vist_biltilsyn' til den
--   forlates (til 'klar_henting'). Periodene 'ikke_veid'/'klar_visning' er bevisst "dødsone" -
--   ingen klokke går der.
-- - 2 ansatte kan jobbe på samme bil samtidig - hver påmelding er sin egen uavhengige økt.
-- - "Står og går over natta/helg selv om ingen jobber"-problemet løses IKKE ved sanntids-
--   sjekk av om noen er stemplet inn (ville krevd ny databasetilstand for "er X innlogget på
--   lønnsklokka akkurat nå" på tvers av enheter) - i stedet beregnes EFFEKTIV tid i etterkant
--   som overlappet mellom en økts [start,stopp] og den aktuelle ansattes faktiske stemplede
--   arbeidstid fra timer_entries (se effektivOrdreTid() i js/ordre-diverse.js). Rådataene i
--   disse to funksjonene lagrer derfor fortsatt RÅ kalendertid, ikke justert tid.
-- - Standardtid er TOTAL forventet tid for bilen (ikke delt per ansatt når flere jobber
--   samtidig) - satt per modell i innstillinger.standardtider.
-- - De to eksisterende manuelle Start/Stopp-knappene på ordre-siden beholdes som fallback
--   (nye/uvanlige jobbtyper som ikke følger det vanlige statusløpet) - disse skrives nå også
--   om til å bruke oppdater_ordre_timer_sesjon() under, i stedet for den generelle save(), og
--   får dermed også ansatt-attribusjon.

alter table public.innstillinger add column if not exists standardtider jsonb not null default '{}'::jsonb;

-- Starter/stopper ÉN ansatt sin økt på ett av de to tidsfeltene - brukt av meldPaa()/meldAv()
-- (automatisk) og de manuelle Start/Stopp-knappene (fallback). Idempotent: et "start" når
-- vedkommende allerede har en åpen økt gjør ingenting (unngår duplikate økter ved dobbeltklikk/
-- samtidige kall), et "stopp" uten åpen økt likeså.
create or replace function public.oppdater_ordre_timer_sesjon(p_ordre_id text, p_felt text, p_handling text, p_ansatt_id int, p_ansatt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions jsonb;
  v_idx int := null;
  v_i int := 0;
  v_elem jsonb;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if p_felt not in ('ordre_timer_sessions','klargjoring_timer_sessions') then
    raise exception 'UGYLDIG_FELT';
  end if;
  if p_handling not in ('start','stopp') then
    raise exception 'UGYLDIG_HANDLING';
  end if;

  if p_felt = 'ordre_timer_sessions' then
    select coalesce(ordre_timer_sessions, '[]'::jsonb) into v_sessions from ordrer where id = p_ordre_id for update;
  else
    select coalesce(klargjoring_timer_sessions, '[]'::jsonb) into v_sessions from ordrer where id = p_ordre_id for update;
  end if;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_elem in select * from jsonb_array_elements(v_sessions) loop
    if (v_elem->>'ansattId')::int = p_ansatt_id and (v_elem->>'stopp') is null then
      v_idx := v_i;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_handling = 'start' then
    if v_idx is null then
      v_sessions := v_sessions || jsonb_build_array(jsonb_build_object('start', v_now, 'stopp', null, 'ansattId', p_ansatt_id, 'ansatt', p_ansatt));
    end if;
  else
    if v_idx is not null then
      v_sessions := jsonb_set(v_sessions, array[v_idx::text,'stopp'], to_jsonb(v_now));
    end if;
  end if;

  if p_felt = 'ordre_timer_sessions' then
    update ordrer set ordre_timer_sessions = v_sessions where id = p_ordre_id;
  else
    update ordrer set klargjoring_timer_sessions = v_sessions where id = p_ordre_id;
  end if;

  return jsonb_build_object('sessions', v_sessions);
end;
$$;
grant execute on function public.oppdater_ordre_timer_sesjon(text, text, text, int, text) to anon, authenticated;

-- Starter økt for ALLE som står meldt på ordren (ansatte_signert) samtidig, eller avslutter
-- fasen (stopper alle åpne økter OG melder av alle - bedt om av Henrik 2026-10-23: når en
-- fase er over skal ikke noen stå igjen som "meldt på" uten grunn, neste fase krever fersk
-- påmelding) - brukt av endreStatus() ved faseoverganger (paabegynt/vist_biltilsyn), slik at
-- flere samtidig påmeldte ansatte alle håndteres korrekt i ÉN atomisk operasjon, uansett hvem
-- (admin eller ansatt) som faktisk trykket på statusendringen.
create or replace function public.oppdater_ordre_timer_fase(p_ordre_id text, p_felt text, p_handling text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions jsonb;
  v_signert jsonb;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_person jsonb;
  v_har_apen boolean;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if p_felt not in ('ordre_timer_sessions','klargjoring_timer_sessions') then
    raise exception 'UGYLDIG_FELT';
  end if;
  if p_handling not in ('start_alle_paameldte','avslutt_fase') then
    raise exception 'UGYLDIG_HANDLING';
  end if;

  if p_felt = 'ordre_timer_sessions' then
    select coalesce(ordre_timer_sessions,'[]'::jsonb), coalesce(ansatte_signert,'[]'::jsonb)
      into v_sessions, v_signert from ordrer where id = p_ordre_id for update;
  else
    select coalesce(klargjoring_timer_sessions,'[]'::jsonb), coalesce(ansatte_signert,'[]'::jsonb)
      into v_sessions, v_signert from ordrer where id = p_ordre_id for update;
  end if;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  if p_handling = 'start_alle_paameldte' then
    for v_person in select * from jsonb_array_elements(v_signert) loop
      v_har_apen := false;
      for v_elem in select * from jsonb_array_elements(v_sessions) loop
        if (v_elem->>'ansattId')::int = (v_person->>'id')::int and (v_elem->>'stopp') is null then
          v_har_apen := true;
        end if;
      end loop;
      if not v_har_apen then
        v_sessions := v_sessions || jsonb_build_array(jsonb_build_object('start', v_now, 'stopp', null, 'ansattId', (v_person->>'id')::int, 'ansatt', v_person->>'navn'));
      end if;
    end loop;
  else
    select coalesce(jsonb_agg(
      case when elem->>'stopp' is null then elem || jsonb_build_object('stopp', v_now) else elem end
    ), '[]'::jsonb) into v_sessions
    from jsonb_array_elements(v_sessions) elem;
    v_signert := '[]'::jsonb;
  end if;

  if p_felt = 'ordre_timer_sessions' then
    update ordrer set ordre_timer_sessions = v_sessions, ansatte_signert = v_signert where id = p_ordre_id;
  else
    update ordrer set klargjoring_timer_sessions = v_sessions, ansatte_signert = v_signert where id = p_ordre_id;
  end if;

  return jsonb_build_object('sessions', v_sessions, 'ansatteSignert', v_signert);
end;
$$;
grant execute on function public.oppdater_ordre_timer_fase(text, text, text) to anon, authenticated;
