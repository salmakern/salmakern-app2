-- s08-004 (Henrik, "lag noe som skiller de fra hverandre" 2026-11-13): org.nr alene kan ikke
-- skille forhandler-AVDELINGER som deler org.nr (f.eks. Bertel O. Steen Innlandet AS dekker
-- Gjøvik/Hamar/Lillehammer under samme org.nr). ordrer.forhandler_kontakt_id lagrer derfor
-- hvilken SPESIFIKKE Kontakter-rad (innstillinger.kontakter[].id) ordren faktisk hører til.
--
-- Backfill-regelen under er 100% entydig, aldri en gjetning:
--   1) Ordren kom fra Forhandlerportalen (portal_bestilling_id satt) -> bestillingens EGEN
--      forhandler_kontakt_id er fasit (matchet der via ekte kontakt-id, ikke org.nr).
--   2) org.nr matcher nøyaktig ÉN forhandler-kontakt -> den, uansett.
--   3) org.nr matcher FLERE forhandler-kontakter (de ca. 10 delte org.nr-tilfellene) -> brukes
--      bare hvis selve kunde-teksten på ordren er et EKSAKT (trimmet, case-uavhengig) treff mot
--      navnet på én av kandidatene. Finnes ikke et slikt eksakt treff, skrives ingenting -
--      feltet blir stående NULL og ordren må avklares manuelt (ingen slike tilfeller fantes i
--      de 68 ordrene med org.nr da dette ble skrevet: alle 11 med tvetydig org.nr hadde et
--      eksakt navnetreff).
--
-- Fremover holdes feltet ved like av synkroniserForhandlerKontaktId() (js/ordre-detalj.js),
-- kalt fra sf() hver gang 'forhandlerOrgnr' settes/endres - samme regel 2/3 som her, aldri
-- regel 1 (det er portal_koble_bestilling sin jobb). Leses av dbToOrdre, skrives ALDRI av
-- ordreToDb()/save() (samme mønster som portal_bestilling_id m.fl. - en ansatt som lagrer et
-- annet felt skal aldri kunne overskrive denne med en gammel lokal kopi).
--
-- Rollback: alter table ordrer drop column if exists forhandler_kontakt_id;

alter table ordrer add column if not exists forhandler_kontakt_id text;

with k as (
  select (elem->>'id') as kontakt_id, elem->>'navn' as navn, elem->>'orgnr' as orgnr
  from innstillinger, jsonb_array_elements(coalesce(kontakter, '[]'::jsonb)) elem
  where id = 1 and elem->>'type' = 'Forhandler' and coalesce(elem->>'orgnr', '') <> ''
),
orgnr_antall as (
  select orgnr, count(*) as n from k group by orgnr
)
update ordrer o
set forhandler_kontakt_id = coalesce(
  (select pb.forhandler_kontakt_id from portal_bestillinger pb where pb.portal_bestilling_id = o.portal_bestilling_id and coalesce(pb.forhandler_kontakt_id, '') <> ''),
  (select k.kontakt_id from k join orgnr_antall oa on oa.orgnr = k.orgnr where k.orgnr = o.forhandler_orgnr and oa.n = 1),
  (select k.kontakt_id from k where k.orgnr = o.forhandler_orgnr and lower(btrim(k.navn)) = lower(btrim(o.kunde)))
)
where o.forhandler_kontakt_id is null and coalesce(o.forhandler_orgnr, '') <> '';
