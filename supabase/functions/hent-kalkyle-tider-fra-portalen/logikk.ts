// Ren logikk for hent-kalkyle-tider-fra-portalen (Henger igjen s09-027, 2026-11-25). Ingen importer, ingen Deno-API-er (testet i
// test/hent-kalkyle-tider-fra-portalen.test.js). Svaret fra portalens kalkyle (GET /api/salmakern/kalkyle-timer, versjon 1) valideres
// STRENGT og avvises i sin helhet ved første brudd. Det er bare FORSLAG: ingenting lagres av funksjonen, og en standardtid endres først
// når en admin trykker «Bruk» i appen (Mer → Standardtider), via sett_standardtid.
//
// Kontrakten (versjon 1, appens forslag - portalen eier innholdet og hvilke kalkulerte timer som teller):
// { ok: true, versjon: 1, generert: <ISO-tid>, modeller: [
//     { kalkyle_id: string (1-100 tegn, unik), kalkyle_navn: string (1-200 tegn),
//       portal_modell_slug: string | null (portalens modellnøkkel, a-z 0-9 og bindestrek, høyst 100 tegn; null = ingen kobling),
//       minutter: heltall 0-100000 | null (kalkulerte PERSON-minutter for selve ombyggingen, totalt for bilen; null = ikke regnbar) } ] }
// Høyst 500 modeller. Aldri timer per ansatt (kalkylen har ingen).

const ER_OBJEKT = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAKS_MODELLER = 500

export type KalkyleTid = { kalkyle_id: string; kalkyle_navn: string; portal_modell_slug: string | null; minutter: number | null }

const tekst = (v: unknown, maks: number): string | null =>
  typeof v === 'string' && v.trim() !== '' && [...v].length <= maks ? v : null

export function lesKalkyleTider(x: unknown): { generert: string; modeller: KalkyleTid[] } | null {
  if (!ER_OBJEKT(x) || x.ok !== true || x.versjon !== 1) return null
  const generert = tekst(x.generert, 40)
  if (generert === null || Number.isNaN(Date.parse(generert))) return null
  if (!Array.isArray(x.modeller) || x.modeller.length > MAKS_MODELLER) return null
  const sett = new Set<string>()
  const ut: KalkyleTid[] = []
  for (const m of x.modeller) {
    if (!ER_OBJEKT(m)) return null
    const id = tekst(m.kalkyle_id, 100)
    const navn = tekst(m.kalkyle_navn, 200)
    if (id === null || navn === null || sett.has(id)) return null
    sett.add(id)
    const slug = m.portal_modell_slug
    if (!(slug === null || (typeof slug === 'string' && slug.length <= 100 && SLUG.test(slug)))) return null
    const min = m.minutter
    if (!(min === null || (typeof min === 'number' && Number.isInteger(min) && min >= 0 && min <= 100000))) return null
    ut.push({ kalkyle_id: id, kalkyle_navn: navn, portal_modell_slug: slug as string | null, minutter: min as number | null })
  }
  return { generert, modeller: ut }
}
