-- Ikke kjørt ennå (skrives 5.11, kjøres etter Henriks eget, eksplisitte ja).
--
-- BAKGRUNN (Henger igjen s90-20261104-7, bekreftet mot ekte data 5.11): dagens
-- oppskrift-trekk (trekkOppskriftForOrdre/angreLagerBatch i js/lager.js) er verken
-- atomisk (beholdning skrives via endre_lagervare_antall_batch, historikken skrives i et
-- HELT SEPARAT etterfølgende kall) eller idempotent (ingen sperre mot å trekke samme
-- oppskrift på samme ordre to ganger). Målt mot ekte lagerhistorikk 5.11: TO ordre/
-- oppskrift-par er alt trukket to ganger - det ene med 2,4 SEKUNDERS mellomrom
-- (batch_1791188876388/batch_1791188878832, klassisk dobbeltklikk/kappløp), det andre
-- med ca. 33 dagers mellomrom (batch_1790770994453/batch_1793610042027).
--
-- FIKSEN: to nye atomiske RPC-er (samme mønster som lager_motta_bestilling - radlås,
-- én transaksjon for BÅDE beholdning og historikk, en sperre som gir et tydelig svar i
-- stedet for å trekke på nytt):
--   lager_trekk_oppskrift(p_ordre_id, p_oppskrift_id, p_ansatt)       - trekker alle
--     ingrediensene i oppskriften (slått opp FERSK fra lager_oppskrifter, ikke klientens
--     lokale kopi) fra lageret og skriver historikken, i ÉN transaksjon. Reiser
--     ALLEREDE_TRUKKET hvis det allerede finnes en lagerhistorikk-rad for nøyaktig
--     denne ordren+oppskriften (angre først for å trekke på nytt - matcher UI-ets eget
--     av/på-avkrysningsmønster, der "trukket to ganger" aldri er meningen).
--   lager_angre_oppskrift_trekk(p_ordre_id, p_oppskrift_id)            - reverserer
--     ALLE radene i batchen for denne ordren+oppskriften, i ÉN transaksjon, og sletter
--     historikkradene. Reiser IKKE_TRUKKET hvis det ikke finnes noe å angre.
-- Begge låser ORDRE-RADEN (select ... for update på ordrer) som serialiseringspunkt -
-- to samtidige kall for SAMME ordre (f.eks. et dobbeltklikk) køes dermed naturlig bak
-- hverandre i stedet for å kappløpe, og idempotens-sjekken kan aldri rekke å bli forbigått.
-- Ingrediensene låses (select ... for update) i SORTERT rekkefølge på vare-id for å unngå
-- dødlås mot andre samtidige lagerendringer (manuelt uttak, mottak, en annen oppskrift som
-- deler en vare).
--
-- "bestilt"-feltet håndteres med nøyaktig samme regel som endre_lagervare_antall_batch
-- (kolonnen crosser opp over min_antall OG ingen åpen bestilling finnes) - relevant kun
-- for ANGRE (trekk kan aldri løfte beholdningen).
--
-- IKKE rørt: "manuelt uttak/påfyll/telling" (lagerBatchFlush -> endre_lagervare_antall_batch
-- direkte) bruker fortsatt samme RPC som før - kun oppskrift-trekk/angre flyttes til de to
-- nye funksjonene her.
--
-- OPPRYDDING AV DE TO KJENTE DOBBELTTRUKNE RADENE: IKKE gjort i denne migrasjonen (venter
-- på Henriks avgjørelse om varene faktisk ble brukt dobbelt eller bare registrert dobbelt -
-- se egen SQL i rollback-referanser/ hvis han vil rydde dem manuelt senere).
--
-- Rollback: drop function if exists public.lager_trekk_oppskrift(text, text, text);
--           drop function if exists public.lager_angre_oppskrift_trekk(text, text);
-- (klientkoden MÅ oppdateres FØR denne kjøres, siden den gamle lagerBatch-veien da ikke
-- lenger kalles for oppskrift-trekk - se commit for js/lager.js-endringen).

create or replace function public.lager_trekk_oppskrift(p_ordre_id text, p_oppskrift_id text, p_ansatt text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r lager_oppskrifter%rowtype;
  v_batch_id text;
  v_ikke_funnet integer := 0;
  v_antall_trukket integer := 0;
  rad record;
  v lagervarer%rowtype;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  -- Låser ordre-raden: serialiserer alle trekk/angre-kall for DENNE ordren bak hverandre
  -- (lukker dobbeltklikk-/kappløpsvinduet som ga batch_1791188876388/...878832).
  if not exists (select 1 from ordrer where id = p_ordre_id for update) then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  select * into r from lager_oppskrifter where id = p_oppskrift_id;
  if not found then
    raise exception 'OPPSKRIFT_FINNES_IKKE';
  end if;

  if exists (select 1 from lagerhistorikk where ordre_id = p_ordre_id and oppskrift_id = p_oppskrift_id) then
    raise exception 'ALLEREDE_TRUKKET';
  end if;

  if coalesce(jsonb_array_length(r.ingredienser), 0) = 0 then
    return jsonb_build_object('batchId', null, 'ikkeFunnet', 0, 'antallTrukket', 0);
  end if;

  v_batch_id := 'batch_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || floor(random() * 1000)::int;

  -- Sortert på vare-id FØR radlåsing, for å unngå dødlås mot andre samtidige
  -- lagerendringer (manuelt uttak, mottak, en annen oppskrift som deler en vare).
  for rad in
    select (i->>'vareId')::text as vare_id, (i->>'antall')::numeric as antall
    from jsonb_array_elements(r.ingredienser) as i
    order by (i->>'vareId')::text
  loop
    select * into v from lagervarer where id = rad.vare_id for update;
    if not found then
      v_ikke_funnet := v_ikke_funnet + 1;
      continue;
    end if;
    update lagervarer set antall = antall - abs(rad.antall) where id = rad.vare_id;
    insert into lagerhistorikk (id, vare_id, vare_navn, endring, type, ordre_id, batch_id, ansatt_navn, kommentar, oppskrift_id)
    values (
      'lh_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || floor(random() * 1000)::int,
      v.id, v.navn, -abs(rad.antall), 'ut', p_ordre_id, v_batch_id, coalesce(p_ansatt, ''), r.navn, p_oppskrift_id
    );
    v_antall_trukket := v_antall_trukket + 1;
  end loop;

  return jsonb_build_object('batchId', v_batch_id, 'ikkeFunnet', v_ikke_funnet, 'antallTrukket', v_antall_trukket);
end;
$$;
grant execute on function public.lager_trekk_oppskrift(text, text, text) to anon, authenticated;

create or replace function public.lager_angre_oppskrift_trekk(p_ordre_id text, p_oppskrift_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id text;
  rad record;
  v_antall_rader integer := 0;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  if not exists (select 1 from ordrer where id = p_ordre_id for update) then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  select batch_id into v_batch_id from lagerhistorikk
  where ordre_id = p_ordre_id and oppskrift_id = p_oppskrift_id
  limit 1;
  if v_batch_id is null then
    raise exception 'IKKE_TRUKKET';
  end if;

  -- Sortert på vare-id FØR radlåsing, av samme grunn som trekket over.
  for rad in
    select * from lagerhistorikk where batch_id = v_batch_id order by vare_id for update
  loop
    update lagervarer
    set antall = antall - rad.endring,  -- rad.endring er negativ (trekk), så dette LEGGER til
        bestilt = case
          when (min_antall <= 0 or (antall - rad.endring) > min_antall)
               and not exists (select 1 from lager_bestillinger lb where lb.vare_id = lagervarer.id and lb.status = 'apen')
            then false
          else bestilt
        end
    where id = rad.vare_id;
    v_antall_rader := v_antall_rader + 1;
  end loop;

  delete from lagerhistorikk where batch_id = v_batch_id;

  return jsonb_build_object('batchId', v_batch_id, 'antallRader', v_antall_rader);
end;
$$;
grant execute on function public.lager_angre_oppskrift_trekk(text, text) to anon, authenticated;
