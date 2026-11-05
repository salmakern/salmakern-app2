-- Ikke kjørt ennå (skrives 5.11, kjøres etter Henriks eget, eksplisitte ja - bygges lokalt
-- per hans ja i Salmaker'n-økta 5.11: "Ja, bygg det nå (lokalt)", på oppdrag relayet fra
-- portal-økta: "gjør sånn appen henter selgere fra portalen").
--
-- Appen HENTER (pull) selgere fra Forhandlerportalen inn i Kontakter sine kontaktpersoner -
-- portalen EIER selgerne, appen sletter/overskriver ALDRI noe som ikke kommer fra portalen.
-- Målet: en selger lagt inn i portalen (admin oppretter, eller en tilgangsforespørsel
-- godkjennes) dukker opp som kontaktperson under riktig forhandler i Kontakter uten at noen
-- gjør noe for hånd - Admin-arkets e-postoppslag og eier-matchen på portal-ordre bruker
-- allerede kontaktpersonene.
--
-- Hvorfor en HELT NY funksjon og ikke de eksisterende kontaktperson_upsert/kontaktperson_slett
-- (migrasjon 20261022170000): begge krever current_ansatt() med rolle admin - de kan ikke
-- kalles fra en ubetjent cron-trigget edge-funksjon (ingen ekte ansatt-sesjon). Denne
-- funksjonen er i stedet KUN tilgjengelig for service_role (samme sikringsmodell som
-- portal_koble_bestilling, migrasjon 20261030210000) - edge-funksjonen hent-selgere-fra-
-- portalen er den eneste døra inn, og DEN har sin egen innloggingssjekk (ansatt-admin ELLER
-- en delt hemmelighet for cron).
--
-- Navn-normalisering (rettet 5.11 etter portal-øktas presisering): portalen normaliserer sine
-- navn (ett mellomrom, usynlige tegn og retningstegn fjernet, maks lengde) - appens EGNE lagrede
-- navn er derimot fritekst tastet inn av ansatte over tid og kan ha doble mellomrom eller en
-- gjenværende usynlig tegn fra copy-paste. portal_normaliser_navn() gjør DET SAMME med appens
-- navn før sammenligning, slik at et navn som ser likt ut for et menneske faktisk MATCHER.
--
-- Matching, i denne rekkefølgen per selger (portal_id, navn, epost) innenfor forhandleren
-- med riktig kontakt_id (ukjent kontakt_id, eller kontakt_navn som ikke stemmer med navnet i
-- appen: hele forhandleren hoppes over og rapporteres - aldri gjett videre på feil forhandler):
--  1) kontaktperson med portalId == portal_id fra før: oppdater e-post hvis endret, navnet
--     røres ALDRI (en ansatt kan ha rettet en skrivefeil portalen ikke vet om). Virker uansett
--     om navn er tomt - portalId er den sikreste nøkkelen og trenger ikke navnet i det hele tatt.
--  2) ellers kontaktperson med SAMME e-post (uavhengig av store/små bokstaver): sett portalId,
--     ingenting annet endres. Virker også uansett om navn er tomt.
--  3) ellers (krever et IKKE-tomt navn fra portalen - se under) ÉN kontaktperson UTEN e-post der
--     navnet er identisk eller er et ledd/fornavn av portalnavnet (f.eks. "Bjarne" -> "Bjarne
--     Hellestø"): den overtas (får e-post, portalId og navnet utvidet til portalens). Flere
--     kandidater: IKKE overta noen (for usikkert), fall gjennom til (5) og rapporter som konflikt.
--  4) ellers kontaktperson med SAMME navn men ANNEN e-post (kjente eksempler: Frank Olaf
--     Bakke, Tage Sirnes - ulik adresse i app og portal): IKKE legg til en dublett, la appens
--     e-post stå urørt og rapporter avviket - en administrator avgjør manuelt.
--  5) ellers: legg til en ny kontaktperson {id:'kp_portal_<portal_id>', navn, epost, tlf:'',
--     notat:'Fra portalen', portalId}.
-- En selger UTEN navn (portalen sender nå alltid en streng, tom hvis ukjent - aldri NULL, etter
-- avtale 5.11) kan fortsatt kobles via regel 1/2 (portalId/e-post trenger ikke navn), men hopper
-- over regel 3-5 (navnematching og "lag ny kontaktperson" ville laget/sammenlignet mot en TOM
-- streng, som verken er trygt å matche på eller ønskelig å lagre som en ekte kontaktpersons navn).
-- Idempotent av konstruksjon: når portalId først er satt på en kontaktperson, treffer alle
-- senere kjøringer for samme selger regel (1) og gjør ingenting (eller bare oppdaterer
-- e-post) - å kjøre funksjonen to ganger på rad med samme input endrer ingenting mer.
--
-- Radlås på innstillinger-raden (samme select ... for update-mønster som kontaktperson_upsert)
-- gjør HELE synken for ALLE forhandlere/selgere i ÉN transaksjon - en samtidig admin-redigering
-- av en annen kontaktperson (vanlig kontaktperson_upsert) venter naturlig på denne, eller omvendt,
-- i stedet for at den ene kan overskrive den andre sin endring (samme rotårsak-fiks som resten
-- av innstillinger-feltene, se migrasjon 20261022170000).
--
-- Svaret inneholder BEVISST bare tall og forhandlernavn, ALDRI e-postadresser (portalens eget
-- krav for kontrakten, og i tråd med hvordan appen ellers logger - se fiken-fakturer/
-- portal-bestilling for samme prinsipp).
--
-- Rollback: drop function if exists public.portal_selgere_synk(jsonb);
--           drop function if exists public.portal_normaliser_navn(text);

-- Fjerner usynlige/retningsstyrende Unicode-tegn (zero-width space/joiner/non-joiner, venstre-/
-- høyre-til-høyre-merker, bidi-innbygging/overstyring, ordforbinder, BOM) som kan henge igjen fra
-- copy-paste, kollapser indre mellomrom til ett, trimmer kantene og gjør små bokstaver - samme
-- normalisering portalen selv gjør på sin side før den sender navnet.
create or replace function public.portal_normaliser_navn(p_navn text)
returns text
language sql
immutable
as $$
  select lower(trim(both ' ' from regexp_replace(
    regexp_replace(coalesce(p_navn, ''), '[​‌‍‎‏‪‫‬‭‮⁠﻿]', '', 'g'),
    '\s+', ' ', 'g'
  )));
$$;

create or replace function public.portal_selgere_synk(p_forhandlere jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kontakter jsonb;
  v_forhandler_payload jsonb;
  v_i int;
  v_forhandler_idx int;
  v_forhandler jsonb;
  v_kontaktpersoner jsonb;
  v_selger jsonb;
  v_portal_id text;
  v_navn text;
  v_epost text;
  v_kp jsonb;
  v_match_idx int;
  v_kandidater int[];
  v_rapport jsonb := '[]'::jsonb;
  v_opprettet int; v_oppdatert int; v_koblet int; v_konflikt int; v_hoppet_over int;
  v_ukjent_kontakt_id int := 0;
  v_navn_mismatch int := 0;
begin
  if p_forhandlere is null or jsonb_typeof(p_forhandlere) <> 'array' then
    raise exception 'UGYLDIG_INPUT';
  end if;

  select coalesce(kontakter, '[]'::jsonb) into v_kontakter from innstillinger where id = 1 for update;
  if not found then raise exception 'INNSTILLINGER_FINNES_IKKE'; end if;

  for v_forhandler_payload in select * from jsonb_array_elements(p_forhandlere)
  loop
    v_opprettet := 0; v_oppdatert := 0; v_koblet := 0; v_konflikt := 0; v_hoppet_over := 0;

    v_forhandler_idx := null; v_forhandler := null; v_i := 0;
    for v_kp in select * from jsonb_array_elements(v_kontakter) loop
      if v_kp->>'id' = v_forhandler_payload->>'kontakt_id' then
        v_forhandler_idx := v_i; v_forhandler := v_kp;
      end if;
      v_i := v_i + 1;
    end loop;

    if v_forhandler_idx is null then
      v_ukjent_kontakt_id := v_ukjent_kontakt_id + 1;
      v_rapport := v_rapport || jsonb_build_array(jsonb_build_object('forhandler', v_forhandler_payload->>'kontakt_navn', 'status', 'ukjent_kontakt_id'));
      continue;
    end if;
    -- En tom (eller manglende) kontakt_navn fra portalen stemmer naturlig ALDRI med en ekte
    -- forhandlers navn i appen - havner her, akkurat som ønsket (hele forhandleren hoppes over).
    if portal_normaliser_navn(v_forhandler->>'navn') <> portal_normaliser_navn(v_forhandler_payload->>'kontakt_navn') then
      v_navn_mismatch := v_navn_mismatch + 1;
      v_rapport := v_rapport || jsonb_build_array(jsonb_build_object('forhandler', v_forhandler->>'navn', 'status', 'navn_stemmer_ikke'));
      continue;
    end if;

    v_kontaktpersoner := coalesce(v_forhandler->'kontaktpersoner', '[]'::jsonb);

    for v_selger in select * from jsonb_array_elements(coalesce(v_forhandler_payload->'selgere', '[]'::jsonb))
    loop
      v_portal_id := v_selger->>'portal_id';
      v_navn := trim(coalesce(v_selger->>'navn', ''));
      v_epost := trim(coalesce(v_selger->>'epost', ''));
      -- Uten portal_id eller e-post er det ingenting trygt å matche på i det hele tatt - hopp
      -- over. Et TOMT navn hopper IKKE over her lenger (rettet 5.11) - portalId/e-post-match
      -- (regel 1/2 under) trenger ikke navnet, se migrasjonsnotatet.
      if v_portal_id is null or v_portal_id = '' or v_epost = '' then
        v_hoppet_over := v_hoppet_over + 1;
        continue;
      end if;

      -- Regel 1: match på portalId fra før (uavhengig av om navn er tomt)
      v_match_idx := null; v_i := 0;
      for v_kp in select * from jsonb_array_elements(v_kontaktpersoner) loop
        if v_kp->>'portalId' = v_portal_id then v_match_idx := v_i; end if;
        v_i := v_i + 1;
      end loop;
      if v_match_idx is not null then
        v_kp := v_kontaktpersoner->v_match_idx;
        if lower(trim(coalesce(v_kp->>'epost', ''))) <> lower(v_epost) then
          v_kontaktpersoner := jsonb_set(v_kontaktpersoner, array[v_match_idx::text, 'epost'], to_jsonb(v_epost));
          v_oppdatert := v_oppdatert + 1;
        end if;
        continue;
      end if;

      -- Regel 2: match på e-post (uavhengig av store/små bokstaver, og uavhengig av om navn er tomt)
      v_match_idx := null; v_i := 0;
      for v_kp in select * from jsonb_array_elements(v_kontaktpersoner) loop
        if coalesce(v_kp->>'epost', '') <> '' and lower(trim(v_kp->>'epost')) = lower(v_epost) then v_match_idx := v_i; end if;
        v_i := v_i + 1;
      end loop;
      if v_match_idx is not null then
        v_kontaktpersoner := jsonb_set(v_kontaktpersoner, array[v_match_idx::text, 'portalId'], to_jsonb(v_portal_id));
        v_koblet := v_koblet + 1;
        continue;
      end if;

      -- Uten navn er regel 3-5 verken trygge å matche på (ville sammenlignet mot en tom streng)
      -- eller ønskelig å opprette en ny kontaktperson med (en kontaktperson uten navn) - hopp
      -- over resten for DENNE selgeren (rettet 5.11, portal-øktas presisering: portalen kan
      -- fortsatt sende en tom streng for en selger uten navn registrert).
      if v_navn = '' then
        v_hoppet_over := v_hoppet_over + 1;
        continue;
      end if;

      -- Regel 3: ÉN kontaktperson uten e-post der navnet er identisk eller er et ledd/fornavn av portalnavnet
      v_kandidater := array[]::int[]; v_i := 0;
      for v_kp in select * from jsonb_array_elements(v_kontaktpersoner) loop
        if coalesce(v_kp->>'epost', '') = '' and coalesce(v_kp->>'navn', '') <> '' and (
             portal_normaliser_navn(v_kp->>'navn') = portal_normaliser_navn(v_navn)
             or portal_normaliser_navn(v_kp->>'navn') = any (string_to_array(portal_normaliser_navn(v_navn), ' '))
           ) then
          v_kandidater := array_append(v_kandidater, v_i);
        end if;
        v_i := v_i + 1;
      end loop;
      if array_length(v_kandidater, 1) = 1 then
        v_match_idx := v_kandidater[1];
        v_kontaktpersoner := jsonb_set(v_kontaktpersoner, array[v_match_idx::text],
          (v_kontaktpersoner->v_match_idx) || jsonb_build_object('navn', v_navn, 'epost', v_epost, 'portalId', v_portal_id));
        v_koblet := v_koblet + 1;
        continue;
      end if;
      if array_length(v_kandidater, 1) > 1 then
        v_konflikt := v_konflikt + 1;
        v_rapport := v_rapport || jsonb_build_array(jsonb_build_object('forhandler', v_forhandler->>'navn', 'status', 'flere_navnekandidater'));
        -- Faller videre til regel 5 (legg til ny) under - for usikkert å velge mellom flere.
      end if;

      -- Regel 4: samme navn, ANNEN e-post - ikke dupliser, rapporter, la appens e-post stå
      v_match_idx := null; v_i := 0;
      for v_kp in select * from jsonb_array_elements(v_kontaktpersoner) loop
        if coalesce(v_kp->>'navn', '') <> '' and portal_normaliser_navn(v_kp->>'navn') = portal_normaliser_navn(v_navn)
           and coalesce(v_kp->>'epost', '') <> '' and lower(trim(v_kp->>'epost')) <> lower(v_epost) then
          v_match_idx := v_i;
        end if;
        v_i := v_i + 1;
      end loop;
      if v_match_idx is not null then
        v_konflikt := v_konflikt + 1;
        v_rapport := v_rapport || jsonb_build_array(jsonb_build_object('forhandler', v_forhandler->>'navn', 'status', 'samme_navn_annen_epost'));
        continue;
      end if;

      -- Regel 5: legg til ny kontaktperson
      v_kontaktpersoner := v_kontaktpersoner || jsonb_build_array(jsonb_build_object(
        'id', 'kp_portal_' || v_portal_id, 'navn', v_navn, 'epost', v_epost, 'tlf', '', 'notat', 'Fra portalen', 'portalId', v_portal_id
      ));
      v_opprettet := v_opprettet + 1;
    end loop;

    v_forhandler := jsonb_set(v_forhandler, '{kontaktpersoner}', v_kontaktpersoner);
    v_kontakter := jsonb_set(v_kontakter, array[v_forhandler_idx::text], v_forhandler);
    v_rapport := v_rapport || jsonb_build_array(jsonb_build_object(
      'forhandler', v_forhandler->>'navn', 'opprettet', v_opprettet, 'oppdatert', v_oppdatert,
      'koblet', v_koblet, 'konflikt', v_konflikt, 'hoppetOver', v_hoppet_over
    ));
  end loop;

  update innstillinger set kontakter = v_kontakter where id = 1;
  return jsonb_build_object('rapport', v_rapport, 'ukjentKontaktId', v_ukjent_kontakt_id, 'navnMismatch', v_navn_mismatch);
end;
$$;
revoke all on function public.portal_selgere_synk(jsonb) from public, anon, authenticated;
grant execute on function public.portal_selgere_synk(jsonb) to service_role;
