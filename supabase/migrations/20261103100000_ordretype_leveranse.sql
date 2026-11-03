-- Kjørt: 2026-11-03 (etter Henriks samtykke). Testet først i en transaksjon som ble rullet tilbake (10 av 10 + de 62 eksisterende portal-testene mot den patchede funksjonen), deretter kjørt; verifisert read-only: 5 nye kolonner, alle 164 ordrer er bil, constraint finnes, portal_koble_bestilling filtrerer på bil.
-- Bakgrunn: «Ny leveranse» (Henrik 2026-11-02): en ordre UTEN bil, for å sende av gårde løsninger. Lagres i ordrer med en ordretype i stedet for en egen tabell,
-- så fiken_linjer, timer, lagerbruk, dokumenter, logg, Realtime og offline-køen kan gjenbrukes uendret.
--  ordretype          'bil' (default, alle eksisterende rader) eller 'leveranse'.
--  leveranse          jsonb med leveransens egne felt (merking, adresse, fraktselskap, kolli, ønsket hentedato, sporing, sendt-dato, auto-frakt). Klienten normaliserer
--                     (normaliserLeveranse), så {} er trygt. Skrives av klienten sammen med resten av ordren (ordreToDb), men bare for leveranser.
--  frakt_bestilt_*    settes KUN av edge-funksjonen send-frakt-epost (service_role) når fraktbestillingen er sendt, med én UPDATE ... WHERE frakt_bestilt_at IS NULL
--                     som «claim»: samme bestilling sendes aldri to ganger, selv med to samtidige klienter. Skrives ALDRI av klienten (som portal_*-kolonnene).
-- portal_koble_bestilling matchet aktive ordrer på chassis: en leveranse med samme chassis som en bil-bestilling fra portalen kunne blitt koblet til (eller telt som
-- «flere ordrer på chassis»). De to chassis-oppslagene filtrerer nå på ordretype = 'bil'. Alt annet i funksjonen er uendret (hentet fra databasen 2026-11-03).
-- Rollback: alter table public.ordrer drop column ordretype, drop column leveranse, drop column frakt_bestilt_at, drop column frakt_bestilt_av, drop column frakt_bestilt_til;
--           og kjør 20261101000000_portal_koble_chassis_fra_losrad.sql / forrige versjon av portal_koble_bestilling på nytt.

alter table public.ordrer
  add column if not exists ordretype text not null default 'bil',
  add column if not exists leveranse jsonb not null default '{}'::jsonb,
  add column if not exists frakt_bestilt_at timestamptz,
  add column if not exists frakt_bestilt_av text,
  add column if not exists frakt_bestilt_til text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ordrer_ordretype_sjekk' and conrelid = 'public.ordrer'::regclass) then
    alter table public.ordrer add constraint ordrer_ordretype_sjekk check (ordretype in ('bil', 'leveranse'));
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.portal_koble_bestilling(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_tak constant int := 10;
  v_id text;
  v_nr text;
  v_type text;
  v_ident text;
  v_slug text;
  v_selger text;
  v_epost text;
  v_orgnr text;
  v_kontakt_id text;
  v_kontakt jsonb;
  v_kunde text;
  v_rerun boolean;
  v_rad public.portal_bestillinger%rowtype;
  v_status text;
  v_detalj text;
  v_ordre_id text;
  v_ark_id text;
  v_merke text;
  v_modell text;
  v_n int;
  v_o public.ordrer%rowtype;
  v_kp_navn text;
  v_aar int;
  v_rek int;
  v_epoch bigint;
  v_ukonf int;
  v_forhandler_nr text;
  v_utstyr jsonb;
  v_dok jsonb;
  v_logg jsonb;
  v_linjer jsonb;
  v_linje_elem jsonb;
begin
  -- ---------- 1. Input: valider og sanér ----------
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'UGYLDIG_INPUT: ikke et objekt';
  end if;
  v_id := btrim(coalesce(p->>'bestilling_id', ''));
  if v_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'UGYLDIG_INPUT: bestilling_id';
  end if;
  v_nr := left(regexp_replace(coalesce(p->>'nr', ''), '[^A-Za-z0-9-]', '', 'g'), 30);
  if v_nr = '' then
    raise exception 'UGYLDIG_INPUT: nr';
  end if;
  v_type := p->>'ident_type';
  if v_type is null or v_type not in ('CHASSIS', 'SERIENUMMER', 'BESTILLINGSNR') then
    raise exception 'UGYLDIG_INPUT: ident_type';
  end if;
  if v_type = 'CHASSIS' then
    v_ident := upper(regexp_replace(coalesce(p->>'ident', ''), '[\s-]', '', 'g'));
    if v_ident !~ '^[A-HJ-NPR-Z0-9]{17}$' then
      raise exception 'UGYLDIG_INPUT: chassis';
    end if;
  else
    v_ident := upper(btrim(regexp_replace(coalesce(p->>'ident', ''), '\s+', ' ', 'g')));
    if char_length(v_ident) not between 3 and 40 or v_ident !~ '^[A-Z0-9._/ -]+$' then
      raise exception 'UGYLDIG_INPUT: %', case when v_type = 'BESTILLINGSNR' then 'bestillingsnr' else 'serienummer' end;
    end if;
  end if;
  v_slug := left(btrim(coalesce(p->>'modell_slug', '')), 80);
  -- s08-048: valgfri produktliste fra bestillingen (portalens egen rabatt per linje).
  -- Mangler feltet: v_linjer forblir null, helt uendret oppførsel. Finnes det, valideres
  -- HVERT element strengt og hele kallet avvises ved første feil (fail-closed, samme
  -- prinsipp som resten av valideringen over) - aldri en delvis lagret/tolket liste.
  v_linjer := null;
  if p ? 'linjer' and jsonb_typeof(p->'linjer') = 'array' then
    if jsonb_array_length(p->'linjer') > 30 then
      raise exception 'UGYLDIG_INPUT: linjer';
    end if;
    v_linjer := '[]'::jsonb;
    for v_linje_elem in select * from jsonb_array_elements(p->'linjer') loop
      if coalesce(btrim(v_linje_elem->>'produktnummer'), '') = '' or char_length(v_linje_elem->>'produktnummer') > 40
         or coalesce(btrim(v_linje_elem->>'navn'), '') = '' or char_length(v_linje_elem->>'navn') > 200
         or (v_linje_elem->>'rabatt_prosent') !~ '^[0-9]+(\.[0-9]+)?$'
         or (v_linje_elem->>'rabatt_prosent')::numeric < 0 or (v_linje_elem->>'rabatt_prosent')::numeric > 100 then
        raise exception 'UGYLDIG_INPUT: linjer';
      end if;
      v_linjer := v_linjer || jsonb_build_array(jsonb_build_object(
        'produktnummer', btrim(v_linje_elem->>'produktnummer'),
        'navn', left(btrim(regexp_replace(v_linje_elem->>'navn', '[\u0001-\u001f\u007f<>]', '', 'g')), 200),
        'rabatt_prosent', (v_linje_elem->>'rabatt_prosent')::numeric
      ));
    end loop;
  elsif p ? 'linjer' then
    raise exception 'UGYLDIG_INPUT: linjer';
  end if;
  v_kontakt_id := left(btrim(coalesce(p->>'kontakt_id', '')), 80);
  v_orgnr := regexp_replace(coalesce(p->>'orgnr', ''), '\D', '', 'g');
  -- Navn og e-post fra en ekstern bruker: ingen kontrolltegn, retningstegn eller < >, kappet lengde.
  v_selger := btrim(regexp_replace(regexp_replace(coalesce(p->>'selger_navn', ''), '[\u0001-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]', '', 'g'), '[<>]', '', 'g'));
  v_selger := left(regexp_replace(v_selger, '\s+', ' ', 'g'), 80);
  if v_selger = '' then
    v_selger := 'Selger fra portalen';
  end if;
  v_epost := lower(left(btrim(regexp_replace(coalesce(p->>'selger_epost', ''), '[[:cntrl:][:space:]<>]', '', 'g')), 200));
  v_rerun := coalesce((p->>'kjor_pa_nytt')::boolean, false);

  -- ---------- 2. Idempotens og kappløp ----------
  perform pg_advisory_xact_lock(hashtextextended('portal_bestilling:' || v_id, 0));
  select * into v_rad from public.portal_bestillinger where portal_bestilling_id = v_id;
  if found then
    -- Ferdige utfall endres aldri. Slettet ordre = gravstein (avvist), aldri gjenoppliving.
    -- «bekreftet» (satt av portal_bekreft_ordre) er et ferdig utfall som «ny_ordre»: et nytt forsøk fra portalen etter at en ansatt har bekreftet skal fortsatt svare ok.
    if v_rad.status in ('ny_ordre', 'koblet', 'bekreftet') then
      if v_rad.ordre_id is not null and not exists (select 1 from public.ordrer where id = v_rad.ordre_id) then
        update public.portal_bestillinger
           set status = 'avvist', detalj = 'Ordren ble slettet i Salmaker''n etter at bestillingen var koblet. Ingen ny ordre opprettes.', oppdatert_at = now()
         where portal_bestilling_id = v_id;
        return jsonb_build_object('kode', 'trenger_avklaring', 'status', 'avvist');
      end if;
      return jsonb_build_object('kode', 'ok', 'status', v_rad.status, 'ordre_id', v_rad.ordre_id);
    elsif v_rad.status = 'admin_ark' and not v_rerun then
      -- v6 (s90-20261101-1): tidligere et hardkodet endelig svar uten unntak. Nå faller den
      -- gjennom til vanlig behandling når kjor_pa_nytt=true (portal_koble_chassis_fra_losrad),
      -- akkurat som venter_*/avklaring_*-grenen rett under alt gjorde.
      return jsonb_build_object('kode', 'ok', 'status', 'admin_ark');
    elsif v_rad.status = 'avvist' then
      return jsonb_build_object('kode', 'trenger_avklaring', 'status', 'avvist');
    elsif not v_rerun then
      -- venter_* / avklaring_*: kjøres bare på nytt etter en eksplisitt handling (aldri av portalens automatiske nytt forsøk).
      return jsonb_build_object('kode', 'trenger_avklaring', 'status', v_rad.status);
    end if;
    -- Eksplisitt ny kjøring: ta imot oppdaterte, endringsbare felt (org.nr, kontakt, selger) men behold identiteten.
    update public.portal_bestillinger
       set forhandler_kontakt_id = nullif(v_kontakt_id, ''), forhandler_orgnr = nullif(v_orgnr, ''), selger_navn = v_selger, selger_epost = nullif(v_epost, ''),
           portal_modell_slug = nullif(v_slug, ''), linjer = coalesce(v_linjer, linjer), oppdatert_at = now()
     where portal_bestilling_id = v_id;
  else
    insert into public.portal_bestillinger
      (portal_bestilling_id, portal_nr, ident_type, ident, forhandler_kontakt_id, forhandler_orgnr, forhandler_navn, selger_navn, selger_epost, portal_modell_slug, linjer, payload)
    values
      (v_id, v_nr, v_type, v_ident, nullif(v_kontakt_id, ''), nullif(v_orgnr, ''), left(coalesce(p->>'forhandler_navn', ''), 120), v_selger, nullif(v_epost, ''), nullif(v_slug, ''), v_linjer,
       jsonb_build_object('nr', v_nr, 'ident_type', v_type, 'modell_slug', v_slug, 'kontakt_id', v_kontakt_id));
  end if;

  -- ---------- 3. Forhandler: Kontakter er fasit, org.nr er kontroll ----------
  select k into v_kontakt
  from public.innstillinger i, jsonb_array_elements(i.kontakter) k
  where i.id = 1 and k->>'id' = v_kontakt_id and k->>'type' = 'Forhandler'
  limit 1;
  if v_kontakt is null then
    v_status := 'venter_forhandler';
    v_detalj := 'Forhandler-kontakten ' || coalesce(nullif(v_kontakt_id, ''), '(mangler)') || ' finnes ikke i Kontakter (eller er ikke en forhandler).';
  elsif v_orgnr = '' or regexp_replace(coalesce(v_kontakt->>'orgnr', ''), '\D', '', 'g') <> v_orgnr then
    v_status := 'venter_forhandler';
    v_detalj := 'Org.nr fra portalen stemmer ikke med org.nr på Kontakter-forhandleren ' || coalesce(v_kontakt->>'navn', '') || '.';
  end if;
  if v_status is not null then
    update public.portal_bestillinger set status = v_status, detalj = v_detalj, oppdatert_at = now() where portal_bestilling_id = v_id;
    return jsonb_build_object('kode', 'trenger_avklaring', 'status', v_status);
  end if;
  v_kunde := btrim(coalesce(v_kontakt->>'navn', ''));

  -- Kontaktperson under DENNE forhandleren: først samme e-post, så samme navn (ikke på tvers av forhandlere), ellers selgerens eget navn.
  select kp->>'navn' into v_kp_navn
  from jsonb_array_elements(coalesce(v_kontakt->'kontaktpersoner', '[]'::jsonb)) kp
  where (v_epost <> '' and lower(btrim(coalesce(kp->>'epost', ''))) = v_epost)
     or lower(btrim(coalesce(kp->>'navn', ''))) = lower(v_selger)
  order by (v_epost <> '' and lower(btrim(coalesce(kp->>'epost', ''))) = v_epost) desc
  limit 1;
  if nullif(btrim(v_kp_navn), '') is null then
    -- Ingen kontaktperson under denne forhandleren treffer. Selgerens eget navn brukes bare hvis det IKKE tilhører noen annen kontakt eller kontaktperson i Kontakter:
    -- Admin-ark slår opp e-postadresse på NAVN på tvers av alle kontakter og forhandlere (adminArkFinnKontaktEpost), så et sammenfallende navn hos en annen
    -- forhandler ville sendt frakt-/hentet-e-post (med chassis.nr, forhandler og dato) til feil person. Ved sammenfall står kontaktpersonen tom (appen viser
    -- «mangler kontakt») og selgerens navn står i merknaden/endringsloggen i stedet.
    if exists (
      select 1 from public.innstillinger i, jsonb_array_elements(i.kontakter) k
      where i.id = 1
        and (lower(btrim(coalesce(k->>'navn', ''))) = lower(v_selger)
             or exists (select 1 from jsonb_array_elements(coalesce(k->'kontaktpersoner', '[]'::jsonb)) kp where lower(btrim(coalesce(kp->>'navn', ''))) = lower(v_selger)))
    ) then
      v_kp_navn := '';
    else
      v_kp_navn := v_selger;
    end if;
  end if;

  -- ---------- 4a. SERIENUMMER og BESTILLINGSNR: løs rad i Admin-ark (nummeret i serienummer-kolonnen), ingen ordre ----------
  if v_type in ('SERIENUMMER', 'BESTILLINGSNR') then
    v_aar := extract(year from (now() at time zone 'Europe/Oslo'))::int;
    -- Samme regel som adminArkNesteRekkefolge(): høyeste radnummer dette året, men aldri bunn-grensen (2147483647).
    select coalesce(max(rekkefolge), 0) + 1 into v_rek from public.admin_ark where aar = v_aar and rekkefolge <> 2147483647;
    v_epoch := (extract(epoch from clock_timestamp()) * 1000)::bigint;
    v_ark_id := 'ark_' || v_epoch::text || '_' || substr(md5(v_id), 1, 5);
    insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, forhandler, kontaktperson, serienummer, merknader)
    values (v_ark_id, '', v_aar, v_rek, left(v_kunde, 200), left(v_kp_navn, 120), v_ident,
            'Fra portalen ' || v_nr || case when v_type = 'BESTILLINGSNR' then ' (bestillingsnr fra forhandler)' else '' end || case when v_kp_navn = '' then ' (selger: ' || v_selger || ', finnes ikke som kontaktperson hos forhandleren)' else '' end);
    update public.portal_bestillinger
       set status = 'admin_ark', admin_ark_id = v_ark_id, forhandler_navn = v_kunde, detalj = 'Løs rad i Admin-ark opprettet.', oppdatert_at = now()
     where portal_bestilling_id = v_id;
    return jsonb_build_object('kode', 'ok', 'status', 'admin_ark');
  end if;

  -- ---------- 4b. CHASSIS: finn aktiv ordre ----------
  perform pg_advisory_xact_lock(hashtextextended('portal_chassis:' || v_ident, 0));
  select count(*) into v_n from public.ordrer where status = 'aktiv' and ordretype = 'bil' and upper(btrim(coalesce(chassis, ''))) = v_ident;

  if v_n > 1 then
    v_status := 'avklaring_chassis';
    v_detalj := 'Flere aktive ordrer har dette chassis.nr. Må avklares manuelt.';
  elsif v_n = 1 then
    select * into v_o from public.ordrer where status = 'aktiv' and ordretype = 'bil' and upper(btrim(coalesce(chassis, ''))) = v_ident limit 1;
    if v_o.portal_bestilling_id = v_id then
      v_status := 'koblet'; v_ordre_id := v_o.id; v_detalj := 'Allerede koblet.';
    elsif lower(btrim(coalesce(v_o.kunde, ''))) <> lower(v_kunde) then
      v_status := 'avklaring_annen_forhandler';
      v_detalj := 'Chassis.nr står på en aktiv ordre for en annen forhandler (' || coalesce(nullif(btrim(v_o.kunde), ''), 'ingen forhandler satt') || '). Må avklares manuelt.';
    elsif v_o.ordre_status = 'hentet' then
      v_status := 'avklaring_chassis';
      v_detalj := 'Chassis.nr står på en ordre som er hentet, men ikke arkivert. Må avklares manuelt.';
    else
      v_status := 'koblet'; v_ordre_id := v_o.id;
      v_detalj := 'Koblet til eksisterende aktiv ordre (status ' || coalesce(v_o.ordre_status, '') || '). Ordren er ikke endret.';
    end if;
  else
    -- Ingen aktiv ordre: opprett. Først modell og tak.
    select merke, modell into v_merke, v_modell from public.portal_modell_kobling where portal_modell_slug = v_slug;
    if not found or coalesce(btrim(v_merke), '') = '' then
      v_status := 'venter_modell';
      v_detalj := 'Portalmodellen «' || v_slug || '» har ingen oversettelse i portal_modell_kobling.';
    else
      -- Lås per forhandler: uten den kunne to samtidige bestillinger (ulike chassis, ulike chassis-låser) begge se 9 ubekreftede og begge opprette, og taket ble 11.
      -- Rekkefølge på låsene er alltid bestilling, så chassis, så forhandler: ingen syklus, ingen vranglås.
      perform pg_advisory_xact_lock(hashtextextended('portal_forhandler:' || lower(v_kunde), 0));
      select count(*) into v_ukonf from public.ordrer
       where status = 'aktiv' and portal_bestilling_id is not null and portal_bekreftet_at is null and lower(btrim(coalesce(kunde, ''))) = lower(v_kunde);
      if v_ukonf >= c_tak then
        v_status := 'avklaring_tak';
        v_detalj := 'Forhandleren har allerede ' || v_ukonf || ' ubekreftede portal-ordrer (tak ' || c_tak || '). Bekreft eller slett noen først.';
      end if;
    end if;
    if v_status is null then
      v_forhandler_nr := btrim(coalesce(v_kontakt->>'forhandlerNr', ''));
      v_utstyr := jsonb_build_object('har', '', 'skalHa', '', 'hengerfeste', 'ikke_hengerfeste', 'hengerfesteMontert', 'ikke_montert',
                                     'hengerfesteBestilt', 'ikke_bestilt', 'skalHaBekreftet', false);
      if v_forhandler_nr <> '' then
        v_utstyr := v_utstyr || jsonb_build_object('forhandlerNr', v_forhandler_nr);
      end if;
      -- Samme auto-vedlegg av forhandlerens fullmakt som appens opprettOrdre().
      v_dok := '[]'::jsonb;
      if btrim(coalesce(v_kontakt->>'fullmaktUrl', '')) <> '' then
        v_dok := jsonb_build_array(jsonb_build_object(
          'navn', coalesce(nullif(v_kontakt->>'fullmaktNavn', ''), 'Fullmakt.pdf'), 'url', v_kontakt->>'fullmaktUrl',
          'lastetOppAv', 'Automatisk (forhandlerfullmakt)', 'dato', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      end if;
      v_logg := jsonb_build_array(jsonb_build_object(
        'av', 'Forhandlerportalen', 'tid', to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY, HH24:MI:SS'),
        'txt', 'Opprettet fra Forhandlerportalen (bestilling ' || v_nr || ' fra ' || v_selger || '). Ikke bekreftet ennå.'));
      v_epoch := (extract(epoch from clock_timestamp()) * 1000)::bigint;
      -- Stabil, unik id per bestilling (ingen kode parser id-en): unngår kollisjon med appens ord_<ms> og med to samtidige kall.
      v_ordre_id := 'ord_' || v_epoch::text || '_' || substr(md5(v_id), 1, 6);
      insert into public.ordrer (
        id, regnr, kunde, eier, ombygging, merke, type, modell, variant, versjon, chassis, farge, ankomstdato, status, ordre_status,
        kalender_dato, kalender_tid, vekter, drivstoff, utstyr, bilder_ankomst, bilder_levering, bilder_avstand_skader, bilder_manglende_deler,
        ansatte_signert, signatur, godkjent, godkjenner_navn, diagnose, diagnose_av, fakturert, fakturert_av, ordre_start, ordre_stopp,
        ordre_timer_sessions, klargjoring_timer_sessions, fiken_linjer, notater, endringer, utstyr_sjekkliste, utstyr_mal_navn,
        visnings_sjekkliste, visnings_mal_navn, flate_id, coc, fullmakt, typegodkjenning, egenvekt_coc, forhandler_orgnr, kjoreseddel_skilt,
        dokumenter, updated_at, portal_bestilling_id, portal_bekreftet_at, portal_bekreftet_av, portal_modell_slug, portal_linjer
      ) values (
        v_ordre_id, '', v_kunde, v_kp_navn,
        '{"nyttKjoretoy":false,"bruktKjoretoy":false,"lafinto":false,"personbil":false}'::jsonb,
        v_merke, '', v_modell, '', '', v_ident, '', null, 'aktiv', 'paa_vei',
        null, '',
        '{"totalvekt":{"a":"","e":"","v":""},"vogntog":{"a":"","e":"","v":""},"foraksel":{"a":"","e":"","v":""},"bakaksel":{"a":"","e":"","v":""}}'::jsonb,
        '{"totalpris":"","satsId":""}'::jsonb, v_utstyr,
        '[null,null,null,null,null,null]'::jsonb, '[null,null,null,null,null,null]'::jsonb, '[null,null,null]'::jsonb, '[]'::jsonb,
        '[]'::jsonb, null, false, '', false, '', false, '', null, null,
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '', v_logg, '[]'::jsonb, '',
        '[]'::jsonb, '', null, 'har_ikke', case when v_dok <> '[]'::jsonb then 'har' else 'har_ikke' end, '', '', coalesce(v_kontakt->>'orgnr', ''), null,
        v_dok, now(), v_id, null, null, v_slug, v_linjer
      );
      v_status := 'ny_ordre';
      v_detalj := 'Ny ordre «På vei» opprettet (ikke bekreftet fra portal).';
    end if;
  end if;

  update public.portal_bestillinger
     set status = v_status, detalj = v_detalj, ordre_id = v_ordre_id, forhandler_navn = v_kunde, merke = v_merke, modell = v_modell, oppdatert_at = now()
   where portal_bestilling_id = v_id;

  if v_status in ('ny_ordre', 'koblet') then
    return jsonb_build_object('kode', 'ok', 'status', v_status, 'ordre_id', v_ordre_id);
  end if;
  return jsonb_build_object('kode', 'trenger_avklaring', 'status', v_status);
end;
$function$;
