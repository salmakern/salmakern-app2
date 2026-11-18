-- KIA EV9: «Dørbeskyttere» i «Skal på bilen» (Henrik 18.11.2026). Dørbeskyttere er en ombygging-oppskrift UTEN Fiken-produktnummer (bare deler, ingen
-- fakturalinje), så raden på lista har oppskriftens id som nøkkel i stedet for et produktnummer. Rettelsene («Fjern fra bilen», «Legg tilbake», «+ Legg
-- til utstyr») lagres i samme logg (ordrer.produkt_rettelser) via legg_til_ordre_produkt_rettelse, som til nå bare godtok et produktnummer
-- (^[1-9][0-9]{0,9}$) i feltet «produktnummer». Tre endringer, ellers røres ingen data:
--   1) legg_til_ordre_produkt_rettelse: regelen for «produktnummer» godtar også en oppskrifts-id (oppskrift_<10-16 siffer>, slik appen lager dem:
--      oppskrift_<ms>). Alt annet i funksjonen er byte-likt 20261118100000_skal_paa_bilen.sql (samme navn, samme signatur, samme rettigheter).
--   2) oppdater_ordre_fiken_linje og 3) oppdater_ordre_fiken_linje_ved_id: å LEGGE TIL en fakturalinje med en oppskrifts-id som produktnummer avvises
--      (UGYLDIG_PRODUKTNUMMER). Resten av begge er byte-likt 20261030220000_prislas_fiken_priser.sql (samme signatur; rettighetene beholdes av
--      «create or replace»). Fjerning (p_linje null) er uendret og står åpent. Hvorfor: en GAMMEL klient (en PWA-fane som ikke er lastet på nytt
--      siden utrullingen, eller en tilbakerulling av klienten) kjenner ikke oppskrifts-id-er i rettelsesloggen. Den LESER en dørbeskyttere-rettelse
--      («legg_til» på oppskrift_<ms>) som et vanlig produkt, lager en «manuell» rad og skriver en fakturalinje med oppskrifts-id-en som produktnummer,
--      som stopper Fakturering («Fant ikke Fiken-produkt for produktnummer ...») til noen fjerner den. Med dette vernet får den gamle klienten en feil i
--      stedet (bare console.error i den fanen), og den nye klienten rydder en slik rest bort selv ved neste synk av «Skal på bilen».
--
-- UTRULLINGSREKKEFØLGE: denne migrasjonen FØR klientkoden (js/skal-paa-bilen.js, sw.js v93). Kommer klienten først, avviser databasen en rettelse på
-- dørbeskyttere med UGYLDIG_INPUT (toast «Kunne ikke lagre rettelsen»); rettelser på vanlige produkter og 180-spørsmålet (produktnummer 502) virker
-- uansett. Ny database + gammel klient er ufarlig for FAKTURAEN (vernet over), men IKKE helt ufarlig for lageret: en gammel fane som gjør en bevisst
-- handling (sjekklistepunkt, Nytt/Brukt, «Rett») kjenner ikke dørbeskyttere-raden og ber om å legge delene tilbake på lager selv om bilen fortsatt skal
-- ha dem (lager_angre_oppskrift_trekk); den nye klienten trekker dem på nytt neste gang ordren åpnes. Derfor: be ALLE laste siden på nytt («Oppdater nå»,
-- eller lukk og åpne appen) etter utrullingen, og vent med å legge dørbeskyttere til/angre for hånd til det er gjort.
--
-- Rollback (gjenoppretter de tre funksjonene slik de var):
--   * legg_til_ordre_produkt_rettelse: kjør blokken «create or replace function public.legg_til_ordre_produkt_rettelse» fra
--     supabase/migrations/20261118100000_skal_paa_bilen.sql på nytt (regelen der er: coalesce(p_rettelse->>'produktnummer', '') !~ '^[1-9][0-9]{0,9}$').
--   * oppdater_ordre_fiken_linje og oppdater_ordre_fiken_linje_ved_id: kjør de to «create or replace function»-blokkene fra
--     supabase/migrations/20261030220000_prislas_fiken_priser.sql på nytt.
--   * IKKE rull tilbake klienten (til før sw.js v93) mens en rettelse på en oppskrifts-id ligger i en ordres logg: gammel klient leser den som et vanlig
--     produkt (se over). Rydd først: finn ordrene med
--       select id from ordrer where jsonb_path_exists(produkt_rettelser, '$[*] ? (@.produktnummer like_regex "^oppskrift_")');
--     og la en ansatt trykke «Angre» på dørbeskyttere-raden (eller fjern oppføringene på oppskrifts-id fra loggen) FØR klienten rulles tilbake.

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
  v_eksisterende jsonb;
  v_ny jsonb;
  v_pris record;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  -- Nytt 18.11: en oppskrifts-id (oppskrift_<ms>) er aldri et Fiken-produktnummer. En gammel klient (åpen fane, tilbakerulling) kan lese en
  -- dørbeskyttere-rettelse som et vanlig produkt og forsøke å legge den på fakturaen; fiken-fakturer ville da svart «Fant ikke Fiken-produkt».
  -- Å LEGGE TIL avvises; å FJERNE (p_linje null) står åpent, så en slik rest kan ryddes bort.
  if p_linje is not null and left(coalesce(p_produktnummer, ''), 10) = 'oppskrift_' then
    raise exception 'UGYLDIG_PRODUKTNUMMER';
  end if;

  select coalesce(fiken_linjer, '[]'::jsonb) into v_linjer
  from ordrer where id = p_ordre_id for update;

  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_elem in select * from jsonb_array_elements(v_linjer) loop
    if v_elem->>'produktnummer' = p_produktnummer then
      v_idx := v_i;
      v_eksisterende := v_elem;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_linje is null then
    if v_idx is not null then
      select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_linjer
      from jsonb_array_elements(v_linjer) with ordinality as t(elem, i)
      where i - 1 != v_idx;
    end if;
    update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;
    return jsonb_build_object('fikenLinjer', v_linjer);
  end if;

  v_ny := p_linje;

  if v_idx is null then
    select pris_kr, mva_type into v_pris from fiken_priser where produktnummer = p_produktnummer;
    if found then
      v_ny := v_ny || jsonb_build_object('pris', v_pris.pris_kr, 'mva', v_pris.mva_type, 'kilde', 'fiken_priser', 'tidspunkt', to_jsonb(now()));
    end if;
  end if;

  if v_idx is not null then
    v_linjer := jsonb_set(v_linjer, array[v_idx::text], coalesce(v_eksisterende, '{}'::jsonb) || v_ny);
  else
    v_linjer := v_linjer || jsonb_build_array(v_ny);
  end if;

  update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;

  return jsonb_build_object('fikenLinjer', v_linjer);
end;
$$;

create or replace function public.oppdater_ordre_fiken_linje_ved_id(p_ordre_id text, p_linje_id text, p_linje jsonb)
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
  v_eksisterende jsonb;
  v_ny jsonb;
  v_pris record;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  -- Nytt 18.11: samme vern som i oppdater_ordre_fiken_linje (se der): en oppskrifts-id er aldri et Fiken-produktnummer. Fjerning (p_linje null) står åpent.
  if p_linje is not null and left(coalesce(p_linje->>'produktnummer', ''), 10) = 'oppskrift_' then
    raise exception 'UGYLDIG_PRODUKTNUMMER';
  end if;

  select coalesce(fiken_linjer, '[]'::jsonb) into v_linjer
  from ordrer where id = p_ordre_id for update;

  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_elem in select * from jsonb_array_elements(v_linjer) loop
    if v_elem->>'id' = p_linje_id then
      v_idx := v_i;
      v_eksisterende := v_elem;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_linje is null then
    if v_idx is not null then
      select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_linjer
      from jsonb_array_elements(v_linjer) with ordinality as t(elem, i)
      where i - 1 != v_idx;
    end if;
    update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;
    return jsonb_build_object('fikenLinjer', v_linjer);
  end if;

  v_ny := p_linje;

  if (v_ny ? 'produktnummer') and (v_eksisterende is null or (v_eksisterende->>'produktnummer') is distinct from (v_ny->>'produktnummer')) then
    select pris_kr, mva_type into v_pris from fiken_priser where produktnummer = v_ny->>'produktnummer';
    if found then
      v_ny := v_ny || jsonb_build_object('pris', v_pris.pris_kr, 'mva', v_pris.mva_type, 'kilde', 'fiken_priser', 'tidspunkt', to_jsonb(now()));
    end if;
  end if;

  if v_idx is not null then
    v_linjer := jsonb_set(v_linjer, array[v_idx::text], coalesce(v_eksisterende, '{}'::jsonb) || v_ny);
  else
    v_linjer := v_linjer || jsonb_build_array(v_ny);
  end if;

  update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;

  return jsonb_build_object('fikenLinjer', v_linjer);
end;
$$;

create or replace function public.legg_til_ordre_produkt_rettelse(p_ordre_id text, p_rettelse jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn text; v_liste jsonb; v_ny jsonb;
begin
  if not exists (select 1 from current_ansatt()) then raise exception 'IKKE_INNLOGGET'; end if;
  select coalesce(a.navn, '') into v_navn from ansatte a join current_ansatt() c on c.id = a.id limit 1;
  if p_rettelse is null or jsonb_typeof(p_rettelse) <> 'object'
     or coalesce(p_rettelse->>'handling', '') not in ('fjern', 'legg_til', 'angre')
     -- produktnummer = Fiken-nummeret, eller id-en til en oppskrift uten produktnummer (rad med bare deler, f.eks. dørbeskyttere)
     or coalesce(p_rettelse->>'produktnummer', '') !~ '^([1-9][0-9]{0,9}|oppskrift_[0-9]{10,16})$'
     or length(coalesce(p_rettelse->>'portalId', '')) > 64
     or length(coalesce(p_rettelse->>'navn', '')) > 200 then
    raise exception 'UGYLDIG_INPUT';
  end if;
  select coalesce(produkt_rettelser, '[]'::jsonb) into v_liste from ordrer where id = p_ordre_id for update;
  if not found then raise exception 'ORDRE_FINNES_IKKE'; end if;
  if jsonb_array_length(v_liste) >= 300 then raise exception 'FOR_MANGE_RETTELSER'; end if;
  v_ny := jsonb_strip_nulls(jsonb_build_object(
    'handling', p_rettelse->>'handling', 'produktnummer', p_rettelse->>'produktnummer',
    'portalId', nullif(p_rettelse->>'portalId', ''), 'navn', nullif(p_rettelse->>'navn', ''),
    'av', coalesce(v_navn, ''), 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  update ordrer set produkt_rettelser = v_liste || jsonb_build_array(v_ny) where id = p_ordre_id;
  return v_liste || jsonb_build_array(v_ny);
end;
$$;
revoke all on function public.legg_til_ordre_produkt_rettelse(text, jsonb) from public, anon;
grant execute on function public.legg_til_ordre_produkt_rettelse(text, jsonb) to authenticated, service_role;
