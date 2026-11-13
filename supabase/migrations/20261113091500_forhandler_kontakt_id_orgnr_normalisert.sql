-- Rettelse til 20261113090000 (s08-004): backfillen der sammenlignet org.nr med EKSAKT
-- strengmatch, uten å fjerne mellomrom. 11 av 68 ordre lagrer forhandler_orgnr MED mellomrom
-- (f.eks. "984 993 188"), mens innstillinger.kontakter lagrer det UTEN ("984993188") - disse
-- 11 ble derfor stående med forhandler_kontakt_id = NULL etter første kjøring, selv om de i
-- virkeligheten har en helt entydig løsning. js/ordre-detalj.js sin synkroniserForhandlerKontaktId()
-- fjernet mellomrom riktig fra første stund (samme feil fantes ALDRI der) - bare denne
-- engangs-backfillen manglet det. Samme tre regler som forrige migrasjon, nå med
-- regexp_replace(..., '\s', '', 'g') på begge sider av org.nr-sammenligningen.
--
-- Idempotent: rører kun rader som fortsatt har forhandler_kontakt_id is null.
-- Rollback: ingen (denne retter bare data satt av 20261113090000, som selv ikke droppes).

with k as (
  select (elem->>'id') as kontakt_id, elem->>'navn' as navn, regexp_replace(coalesce(elem->>'orgnr',''), '\s', '', 'g') as orgnr
  from innstillinger, jsonb_array_elements(coalesce(kontakter, '[]'::jsonb)) elem
  where id = 1 and elem->>'type' = 'Forhandler' and coalesce(elem->>'orgnr', '') <> ''
),
orgnr_antall as (
  select orgnr, count(*) as n from k group by orgnr
)
update ordrer o
set forhandler_kontakt_id = coalesce(
  (select pb.forhandler_kontakt_id from portal_bestillinger pb where pb.portal_bestilling_id = o.portal_bestilling_id and coalesce(pb.forhandler_kontakt_id, '') <> ''),
  (select k.kontakt_id from k join orgnr_antall oa on oa.orgnr = k.orgnr where k.orgnr = regexp_replace(coalesce(o.forhandler_orgnr,''), '\s', '', 'g') and oa.n = 1),
  (select k.kontakt_id from k where k.orgnr = regexp_replace(coalesce(o.forhandler_orgnr,''), '\s', '', 'g') and lower(btrim(k.navn)) = lower(btrim(o.kunde)))
)
where o.forhandler_kontakt_id is null and coalesce(o.forhandler_orgnr, '') <> '';
