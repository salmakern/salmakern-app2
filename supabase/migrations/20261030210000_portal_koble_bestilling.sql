-- v5 (2026-10-31, s08-048): tar nå imot en valgfri "linjer"-liste (produktnummer, navn,
-- rabatt_prosent - forhandlerens rabatt fra BESTILLINGEN, ikke Salmaker'ns kundesats) og
-- lagrer den rått i portal_bestillinger.linjer (admin-innsyn) og normalisert på den nye
-- kolonnen ordrer.portal_linjer (kun ny_ordre-grenen - en løs Admin-ark-rad har ingen
-- fakturering å fylle). Henrik 30.10/31.10: rabatten på fakturalinjen skal være portalens,
-- ikke fiken_kunde_rabatt, for en portal-ordre - selve bruken (Bekreft fyller «Skal ha
-- etter visning» + fiken_linjer, fiken-fakturer bruker den FROSNE rabatten) bygges i
-- js/lager.js (leggTilPortalUtstyrLinjer) og fiken-fakturer, ikke her. Feltet er HELT
-- valgfritt: mangler "linjer" i input (portalen sender det ikke ennå), er alt uendret.
-- Se 20261031170000_portal_bestilling_linjer.sql for kolonnene.
-- v4 (2026-10-31, s09-012 steg 2): ordre-grenen (4b, "Ingen aktiv ordre: opprett") lagrer nå
-- v_slug på den nye kolonnen ordrer.portal_modell_slug (se 20261031150000_portal_modell_slug_matching.sql)
-- - den var allerede slått opp og validert her (linje ~236, venter_modell ellers), bare kastet bort før.
-- v3 (2026-10-31, Henrik: «bestillingsnummer fra forhandler ved siden av chassis.nr og serienummer»): ident_type BESTILLINGSNR (forhandlerens eget bestillingsnummer) behandles som SERIENUMMER:
-- løs rad i Admin-ark med nummeret i Serienummer-kolonnen, merknaden sier at det er et bestillingsnr fra forhandleren. Se også 20261031100000_portal_bestillingsnr.sql (sjekk-regelen på portal_bestillinger.ident_type).
-- Kjørt: 2026-10-30 (v1, etter test 43/43 i en transaksjon som ble rullet tilbake og gjennomgang av en annen økt), omkjørt samme dag som v2 etter uavhengig gjennomgang av edge-funksjonen v3 samme dag: «bekreftet» er et ferdig utfall i idempotensgrenen (nytt kall etter Bekreft svarer ok); test 47/47.
-- (navnekollisjon på kontaktperson/eier, lås per forhandler rundt taket, kommentarer; test 47/47). Begge ganger var ordrer/admin_ark/innstillinger byte-identiske før og etter.
-- Fase 2 av «Bestill»-koblingen, STEG 3 (G3 i C:/Users/GroAnitaMartinsen/.claude/bestill-fase2/plan-salmakern.md): funksjonen som tar imot EN bestilling fra
-- Forhandlerportalen og enten kobler den til en eksisterende ordre, oppretter en ny ordre «På vei» (ikke bekreftet fra portal), lager en løs rad i
-- Admin-ark (serienummer) eller legger den til manuell avklaring. Den kalles bare av edge-funksjonen portal-bestilling (G4, utrullet 2026-10-30; portalen
-- sender først når koblingen slås på, G11), og den kan KUN kalles av service_role. Alt den skriver omgår dermed ikke appens regler: ordren lages i EXAKT samme form som appen lager den selv (js/core.js mkOrdre +
-- ordreToDb, js/ordre-diverse.js opprettOrdre, js/admin-ark.js adminArkLagreFelter).
--
-- Regler (Henriks avgjørelser 2026-10-30, kritikernes funn lagt inn):
--  * Idempotent på portalens bestilling-id (primærnøkkel i portal_bestillinger + advisory lock): samme bestilling to ganger = én ordre. Et nytt kall på en
--    bestilling som allerede er koblet/avvist endrer ingenting. Rader i venter_*/avklaring_* kjøres bare på nytt ved eksplisitt `kjor_pa_nytt` (admin).
--  * GRAVSTEIN: slettes en portal-opprettet ordre, svarer et nytt kall «avvist» og lager ALDRI en ny ordre (derfor ingen fremmednøkkel).
--  * Forhandleren identifiseres av Kontakter-id (innstillinger.kontakter[].id) + org.nr som KONTROLL (portalen eier koblingen, Salmaker'n er fasit).
--    Finnes ikke kontakten, er den ikke type Forhandler eller stemmer ikke org.nr (kun sifre): venter_forhandler, ingen ordre.
--  * CHASSIS (17 tegn, A-Z0-9 uten I, O, Q): normalisert chassis sammenlignes mot AKTIVE ordrer (status = 'aktiv', samme definisjon som appens
--    opprettOrdre/samsvarerChassis: store/små bokstaver og mellomrom likegyldig). Ingen: ny ordre. Én, samme forhandler (kundenavn, eksakt, uten hensyn til
--    store/små) og ikke «hentet»: koblet, ordren RØRES IKKE (ingen UPDATE: gir ingen push og ingen historikkrad). Én, annen forhandler: avklaring_annen_forhandler.
--    Hentet-men-ikke-arkivert, eller flere aktive: avklaring_chassis (manuelt). Chassis på bare arkivert ordre gir ny ordre.
--  * Modell: portal_modell_kobling (portalens slug til appens merke/modell) MÅ ha en rad, ellers venter_modell (ingen ordre med feil/tomt modellnavn).
--  * Tak: maks 10 ubekreftede portal-ORDRER per forhandler (c_tak; lås per forhandler så taket holder ved samtidige kall). Over det: avklaring_tak (ingen ordre)
--    så en feil, en test eller et angrep ikke kan fylle ordrelisten hos alle ansatte. Taket gjelder bare chassis-banen: serienummer-rader (Admin-ark, bare
--    administratorer ser dem) og rader i portal_bestillinger har ingen egen grense her; portalens grenser (20/time per selger, 100/time og 300/døgn totalt)
--    og at bare portalen har hemmeligheten er det som begrenser dem. Kjent og bevisst ikke dedupet: samme serienummer sendt to ganger med ulik bestilling-id gir to rader.
--  * SERIENUMMER: løs rad i admin_ark (chassis_nr = ''), forhandler = Kontakter-navnet, kontaktperson = kontaktperson under DENNE forhandleren med samme
--    e-post (ellers samme navn), ellers selgerens navn, MEN bare hvis navnet ikke tilhører noen annen kontakt/kontaktperson i Kontakter (ellers tom, og selgeren
--    står i merknaden: Admin-ark slår opp e-post på navn på tvers av alle forhandlere). Samme regel gir ordrens eier. Ingen ordre.
--  * BESTILLINGSNR (v3): samme vei som SERIENUMMER (samme format 3-40 tegn A-Z0-9._/ -, samme løse Admin-ark-rad med nummeret i Serienummer-kolonnen). Merknaden er
--    «Fra portalen <nr> (bestillingsnr fra forhandler)», så ansatte ser at nummeret i Serienummer-kolonnen er forhandlerens bestillingsnummer og ikke et serienummer.
--  * Fritekst fra portalen: selger_navn og selger_epost saniteres (kontrolltegn, retningstegn og < > fjernes, lengde kappes). Øvrige felt (forhandler_navn,
--    kontakt_id, modell_slug) lagres i portal_bestillinger (bare admin leser) bare med kappet lengde: en visning av dem MÅ bruke esc() på alle felt.
--    Selgerens KOMMENTAR tas ikke imot og havner aldri i ordrenotater (notater kan skrives ut på dokumenter).
--  * Utfall som venter_* og avklaring_* er endelige sett fra portalen: et nytt kall på samme bestilling-id endrer ingenting. Etter at årsaken er rettet (rad i
--    portal_modell_kobling, rettet org.nr/kontakt-id i Kontakter, manuell avklaring) kjøres funksjonen på nytt av admin med `kjor_pa_nytt` (via SQL som
--    postgres/service_role, eller G8-RPC-ene). Edge-funksjonen slipper aldri `kjor_pa_nytt` gjennom fra portalen.
--  * Returnerer BARE en grov kode til portalen: {kode: ok | trenger_avklaring, status, ordre_id?}. Detaljert utfall (inkl. andre forhandleres navn) står kun i
--    portal_bestillinger.detalj som bare admin leser. Portalen skal aldri vise utfallet til selgeren.
--
-- Rollback: supabase/rollback-referanser/portal_koble_bestilling_ROLLBACK.sql (drop function). Test: supabase/tester/portal_koble_bestilling_TEST_body.sql (kjøres i en transaksjon som ALLTID rulles tilbake; kjøring står øverst i filen).

create or replace function public.portal_koble_bestilling(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    elsif v_rad.status = 'admin_ark' then
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
  select count(*) into v_n from public.ordrer where status = 'aktiv' and upper(btrim(coalesce(chassis, ''))) = v_ident;

  if v_n > 1 then
    v_status := 'avklaring_chassis';
    v_detalj := 'Flere aktive ordrer har dette chassis.nr. Må avklares manuelt.';
  elsif v_n = 1 then
    select * into v_o from public.ordrer where status = 'aktiv' and upper(btrim(coalesce(chassis, ''))) = v_ident limit 1;
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

-- Kun service_role (edge-funksjonen) får kalle den. Ingen anon/authenticated/public.
revoke all on function public.portal_koble_bestilling(jsonb) from public, anon, authenticated;
grant execute on function public.portal_koble_bestilling(jsonb) to service_role;
