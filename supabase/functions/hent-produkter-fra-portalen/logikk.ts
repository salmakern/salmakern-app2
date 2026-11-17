// Ren logikk for hent-produkter-fra-portalen (trinn 2 av «Én produktliste», Henrik 17.11.2026). Ingen importer, ingen Deno-API-er
// (testet i test/hent-produkter-fra-portalen.test.js). Svaret fra portalen (GET /api/salmakern/produktnumre, versjon 1, se portalens
// src/lib/salmakernProduktnumre.ts) valideres STRENGT og avvises i sin helhet ved første brudd: en halvgyldig liste kunne gitt feil
// ombyggingsnummer på en faktura. Ut kommer radene til portal_produkter_synk.

const ER_OBJEKT = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const STATUSER = ['ok', 'intervall', 'mangler', 'ugyldig']
const ROLLER = ['ombygging', 'personbil', 'lafinto']
const NUMMER = /^[1-9][0-9]{0,9}$/

export type Rad = {
  portal_id: string; type: 'variant' | 'tillegg' | 'losning'; modell_slug: string; modell_navn: string; variant_portal_id: string | null
  produktnummer: string; fiken_nummer: string | null; nummer_status: string; navn: string; prisgruppe: string | null; app_rolle: string | null
  velges_nar: string[]
}

const tekst = (v: unknown, maks = 200): string | null => (typeof v === 'string' && [...v].length <= maks ? v : null)

// «Velges når» (trinn 3, valgfritt felt): liste med høyst 20 tekster à 1-100 tegn. Mangler feltet (eldre portal) = tom liste. null = ugyldig.
function velgesNar(v: unknown): string[] | null {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > 20) return null
  const ut: string[] = []
  for (const x of v) {
    if (typeof x !== 'string' || x.trim() === '' || [...x].length > 100) return null
    ut.push(x)
  }
  return ut
}

function nummerFelt(o: Record<string, unknown>): { produktnummer: string; fiken_nummer: string | null; nummer_status: string } | null {
  const produktnummer = tekst(o.produktnummer, 40)
  const status = o.nummer_status
  if (produktnummer === null || typeof status !== 'string' || !STATUSER.includes(status)) return null
  if (status === 'ok') {
    if (typeof o.fiken_nummer !== 'string' || !NUMMER.test(o.fiken_nummer)) return null
    return { produktnummer, fiken_nummer: o.fiken_nummer, nummer_status: status }
  }
  if (o.fiken_nummer !== null) return null
  return { produktnummer, fiken_nummer: null, nummer_status: status }
}

// null = svaret avvises. Ellers radene (varianter + tillegg/løsninger) og antall roller.
export function lesProduktliste(data: unknown): { rader: Rad[]; roller: number } | null {
  if (!ER_OBJEKT(data) || data.ok !== true || data.versjon !== 1 || !Array.isArray(data.modeller) || !ER_OBJEKT(data.antall)) return null
  const rader: Rad[] = []
  let antVar = 0, antTil = 0, roller = 0
  const sett = new Set<string>()
  const rollePerModell = new Set<string>()
  for (const m of data.modeller) {
    if (!ER_OBJEKT(m) || !Array.isArray(m.varianter)) return null
    const slug = tekst(m.slug, 100), navn = tekst(m.navn) ?? ''
    if (!slug) return null
    for (const v of m.varianter) {
      if (!ER_OBJEKT(v) || !Array.isArray(v.tillegg)) return null
      const id = tekst(v.portal_id, 64), nr = nummerFelt(v)
      if (!id || !nr || sett.has(id)) return null
      const rolle = v.app_rolle ?? null
      if (rolle !== null && (typeof rolle !== 'string' || !ROLLER.includes(rolle))) return null
      if (rolle) {
        if (rollePerModell.has(slug + ':' + rolle)) return null
        rollePerModell.add(slug + ':' + rolle)
        roller++
      }
      const vn = velgesNar(v.velges_nar)
      if (!vn) return null
      sett.add(id)
      antVar++
      rader.push({ portal_id: id, type: 'variant', modell_slug: slug, modell_navn: navn, variant_portal_id: null, ...nr, navn: tekst(v.navn) ?? '', prisgruppe: tekst(v.prisgruppe, 20), app_rolle: rolle, velges_nar: vn })
      for (const t of v.tillegg) {
        if (!ER_OBJEKT(t)) return null
        const tid = tekst(t.portal_id, 64), tnr = nummerFelt(t)
        if (!tid || !tnr || sett.has(tid) || (t.type !== 'tillegg' && t.type !== 'losning')) return null
        const tvn = velgesNar(t.velges_nar)
        if (!tvn) return null
        sett.add(tid)
        antTil++
        rader.push({ portal_id: tid, type: t.type, modell_slug: slug, modell_navn: navn, variant_portal_id: id, ...tnr, navn: tekst(t.navn) ?? '', prisgruppe: null, app_rolle: null, velges_nar: tvn })
      }
    }
  }
  // Portalens egne tall må stemme med lista (ellers er noe kuttet underveis).
  if (data.antall.modeller !== data.modeller.length || data.antall.varianter !== antVar || data.antall.tillegg !== antTil) return null
  if (rader.length === 0) return null
  return { rader, roller }
}
