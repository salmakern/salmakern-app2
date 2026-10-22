-- Kjørt: 2026-10-22
-- Bakgrunn: Full gjennomgang (samme dag som dokumenter-/endringer-/fikenLinjer-kappløpet)
-- avdekket at lagervarer.antall ble oppdatert ved å lese DENNE nettleserøktens lokale kopi
-- av antallet, legge til/trekke fra en endring, og skrive den resulterende ABSOLUTTVERDIEN
-- tilbake (registrerLagerEndring/angreLagerBatch i lager.js) - IKKE en atomisk
-- server-side tilvekst. To uavhengige endringer på SAMME vare tett i tid (f.eks. manuelt
-- "Ta ut" på én ordre og et automatisk oppskrift-trekk på en annen ordre, begge brukt samme
-- delte lagervare) kan dermed overskrive hverandre - den som lagrer sist "vinner", og det
-- korrekte sluttantallet (start minus BEGGE endringene) blir aldri lagret.
--
-- Fiksen: en atomisk batch-funksjon som gjør selve tilveksten ("antall = antall + endring")
-- direkte i databasen - Postgres sin egen UPDATE-evaluering av currentrad-verdien gjør dette
-- race-fritt helt uten egen radlås, i motsetning til array-feltene (dokumenter/fiken_linjer/
-- endringer) som trengte "select ... for update" for å kunne slå opp OG erstatte riktig
-- element atomisk. Tar et helt array av {vareId, endring}-par i ÉTT kall (samme "mange
-- enkeltkall har vist seg upålitelig"-begrunnelse som selve batch-mønsteret i
-- lagerBatchFlush() allerede bygger på) - brukes av både enkelt-vare-endringer (array med
-- Ett element) og ekte batcher (oppskrift-trekk, angre-uttrekking).
--
-- Nullstiller også "bestilt"-merket atomisk når antallet krysser opp over min_antall igjen,
-- samme logikk som lå klient-side i registrerLagerEndring() før.

create or replace function public.endre_lagervare_antall_batch(p_endringer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultater jsonb := '[]'::jsonb;
  v_endring jsonb;
  v_antall numeric;
  v_min_antall numeric;
  v_bestilt boolean;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  for v_endring in select * from jsonb_array_elements(p_endringer) loop
    update lagervarer
    set antall = antall + (v_endring->>'endring')::numeric,
        bestilt = case
          when min_antall <= 0 or (antall + (v_endring->>'endring')::numeric) > min_antall then false
          else bestilt
        end
    where id = v_endring->>'vareId'
    returning antall, min_antall, bestilt into v_antall, v_min_antall, v_bestilt;

    if found then
      v_resultater := v_resultater || jsonb_build_array(jsonb_build_object(
        'id', v_endring->>'vareId', 'antall', v_antall, 'minAntall', v_min_antall, 'bestilt', v_bestilt
      ));
    end if;
  end loop;

  return v_resultater;
end;
$$;
grant execute on function public.endre_lagervare_antall_batch(jsonb) to anon, authenticated;
