// Ren logikk for edge-funksjonen portal-oppskrift: validering av det portalen sender, og avgrensning av svaret.
// Ingen eksterne importer og ingen Deno-API-er, så Vitest kan laste filen direkte (test/portal-oppskrift.test.js).
//
// Bakgrunn (trinn 1 av «Én produktliste», Henrik 17.11.2026): «Ny variant» i Forhandlerportalen tar også delene fra appens lager.
// Portalen er fasit for navn og pris; DELENE (oppskriften i lager_oppskrifter) bor i appen. Portalen leser lagervarene og oppskriften
// (handling «hent») og sender delene tilbake (handling «lagre»). All databaselogikk (kobling, nummertreff, låsing) ligger i Postgres-
// funksjonene portal_oppskrift_hent / portal_oppskrift_lagre (migrasjon 20261117200000); her avvises bare åpenbart ugyldig input, og
// svaret avgrenses til kjente felt. Feilsvar er bare {kode, felt?}, aldri databasetekst.

export const VERSJON = 1
// 100 deler à ca. 100 byte + navn: godt under 32 KB. Alt over er feil hos portalen.
export const MAKS_BODY_BYTES = 32 * 1024
export const DELER_MAKS = 100
export const VARER_MAKS = 5000
export const ID_MAKS = 64
export const NR_MAKS = 20
export const NAVN_MAKS = 200
export const ANTALL_MAKS = 10000
// PERSONBIL lagt til 2026-11-23 (Forhandlerportalens nye priskategori "Personbil", gren henger/personbil-priskategori
// i forhandlerportal-app - IKKE merget der ennå). Databasefunksjonen portal_oppskrift_lagre er utvidet samtidig
// (migrasjon 20261123110000) - hold de to i takt, de to er egentlig den samme allow-listen i to repoer.
export const PRISGRUPPER = ['STANDARD', 'EKSTRAUTSTYR', 'MODUL_SYSTEM', 'PERSONBIL'] as const

const ER_OBJEKT = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const tekst = (v: unknown, maks: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t !== '' && [...t].length <= maks ? t : null
}
const valgfriTekst = (v: unknown, maks: number): string | null | false => {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null
  return tekst(v, maks) ?? false
}

export type Del = { vareId: string; antall: number }
export type HentInput = { handling: 'hent'; variantId: string | null; tilleggId: string | null; produktnummer: string | null }
export type LagreInput = {
  handling: 'lagre'; variantId: string | null; tilleggId: string | null; produktnummer: string; navn: string
  prisgruppe: (typeof PRISGRUPPER)[number]; modellSlug: string | null; modellNavn: string; deler: Del[]
}
export type ParseForesporsel = { ok: true; input: HentInput | LagreInput } | { ok: false; felt: string }

// Gyldig antall: et tall > 0 og <= 10 000 med høyst tre desimaler (samme regel som Postgres-funksjonen).
export function gyldigAntall(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= ANTALL_MAKS && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6
}

export function parseForesporsel(raw: unknown): ParseForesporsel {
  if (!ER_OBJEKT(raw)) return { ok: false, felt: 'body' }
  if (raw.versjon !== VERSJON) return { ok: false, felt: 'versjon' }
  const variantId = valgfriTekst(raw.variantId, ID_MAKS)
  const tilleggId = valgfriTekst(raw.tilleggId, ID_MAKS)
  if (variantId === false || tilleggId === false || (variantId && tilleggId)) return { ok: false, felt: 'id' }

  if (raw.handling === 'hent') {
    const produktnummer = valgfriTekst(raw.produktnummer, NR_MAKS)
    if (produktnummer === false) return { ok: false, felt: 'produktnummer' }
    return { ok: true, input: { handling: 'hent', variantId, tilleggId, produktnummer } }
  }
  if (raw.handling !== 'lagre') return { ok: false, felt: 'handling' }

  if (!variantId && !tilleggId) return { ok: false, felt: 'id' }
  const produktnummer = tekst(raw.produktnummer, NR_MAKS)
  if (!produktnummer || /[\s,;]/.test(produktnummer)) return { ok: false, felt: 'produktnummer' }
  const navn = tekst(raw.navn, NAVN_MAKS)
  if (!navn) return { ok: false, felt: 'navn' }
  if (!PRISGRUPPER.includes(raw.prisgruppe as (typeof PRISGRUPPER)[number])) return { ok: false, felt: 'prisgruppe' }
  const modellSlug = valgfriTekst(raw.modellSlug, NAVN_MAKS)
  if (modellSlug === false) return { ok: false, felt: 'modellSlug' }
  const modellNavn = tekst(raw.modellNavn, NAVN_MAKS)
  if (!modellNavn) return { ok: false, felt: 'modellNavn' }
  if (!Array.isArray(raw.deler) || raw.deler.length > DELER_MAKS) return { ok: false, felt: 'deler' }
  const sett = new Set<string>()
  const deler: Del[] = []
  for (const d of raw.deler) {
    if (!ER_OBJEKT(d)) return { ok: false, felt: 'deler' }
    const vareId = tekst(d.vareId, ID_MAKS)
    if (!vareId || sett.has(vareId) || !gyldigAntall(d.antall)) return { ok: false, felt: 'deler' }
    sett.add(vareId)
    deler.push({ vareId, antall: d.antall })
  }
  return {
    ok: true,
    input: { handling: 'lagre', variantId, tilleggId, produktnummer, navn, prisgruppe: raw.prisgruppe as LagreInput['prisgruppe'], modellSlug, modellNavn, deler },
  }
}

// Argumentene til Postgres-funksjonene (nøyaktig navnene i migrasjonen).
export function rpcFor(input: HentInput | LagreInput): { navn: string; args: Record<string, unknown> } {
  if (input.handling === 'hent') {
    return { navn: 'portal_oppskrift_hent', args: { p_variant_id: input.variantId, p_tillegg_id: input.tilleggId, p_produktnummer: input.produktnummer } }
  }
  const { handling: _h, ...p } = input
  return { navn: 'portal_oppskrift_lagre', args: { p } }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Svaret: avgrenset til kjente nøkler. Null = svaret fra databasen har feil form (gir 502).
// ---------------------------------------------------------------------------------------------------------------------------------------------------
export type Vare = { id: string; navn: string; enhet: string; antall: number; modell: string; kategori: string }
export type Oppskrift = { id: string; navn: string; type: string; ingredienser: Del[]; koblet: boolean; utelatteDeler: number }
export type HentSvar = { versjon: 1; varer: Vare[]; oppskrift: Oppskrift | null; flere: number }
export type LagreSvar = { versjon: 1; status: 'opprettet' | 'oppdatert' | 'koblet' | 'ingen_deler'; oppskriftId: string | null; antallDeler: number; biltypeFraKobling: boolean }

const kutt = (v: unknown, maks: number): string => (typeof v === 'string' ? [...v].slice(0, maks).join('') : '')

export function mapHent(data: unknown): HentSvar | null {
  if (!ER_OBJEKT(data) || !Array.isArray(data.varer) || data.varer.length > VARER_MAKS) return null
  const varer: Vare[] = []
  for (const v of data.varer) {
    if (!ER_OBJEKT(v) || typeof v.id !== 'string' || v.id === '' || typeof v.antall !== 'number' || !Number.isFinite(v.antall)) return null
    varer.push({ id: kutt(v.id, ID_MAKS), navn: kutt(v.navn, NAVN_MAKS), enhet: kutt(v.enhet, 20) || 'stk', antall: v.antall, modell: kutt(v.modell, NAVN_MAKS), kategori: kutt(v.kategori, NAVN_MAKS) })
  }
  let oppskrift: Oppskrift | null = null
  if (data.oppskrift !== null && data.oppskrift !== undefined) {
    const o = data.oppskrift
    if (!ER_OBJEKT(o) || typeof o.id !== 'string' || typeof o.koblet !== 'boolean') return null
    // En oppskrift lagt inn for hånd i appen kan ha en del med rar form (antall som tekst, manglende vareId). Den tas ikke med, men telles, så portalen
    // kan si fra i stedet for stille å vise færre deler enn appen har (og overskrive dem ved lagring).
    const ingredienser: Del[] = []
    let utelatt = 0
    for (const i of Array.isArray(o.ingredienser) ? o.ingredienser : []) {
      const antall = ER_OBJEKT(i) ? (typeof i.antall === 'string' ? Number(i.antall.replace(',', '.')) : i.antall) : NaN
      const vareId = ER_OBJEKT(i) ? tekst(i.vareId, ID_MAKS) : null
      if (vareId && gyldigAntall(antall) && !ingredienser.some((x) => x.vareId === vareId)) ingredienser.push({ vareId, antall })
      else utelatt++
    }
    oppskrift = { id: kutt(o.id, ID_MAKS), navn: kutt(o.navn, NAVN_MAKS), type: o.type === 'ombygging' ? 'ombygging' : 'ekstra_utstyr', ingredienser, koblet: o.koblet, utelatteDeler: utelatt }
  }
  const flere = typeof data.flere === 'number' && Number.isInteger(data.flere) && data.flere >= 0 ? data.flere : 0
  return { versjon: 1, varer, oppskrift, flere }
}

const STATUSER = ['opprettet', 'oppdatert', 'koblet', 'ingen_deler'] as const
export function mapLagre(data: unknown): LagreSvar | null {
  if (!ER_OBJEKT(data) || !STATUSER.includes(data.status as (typeof STATUSER)[number])) return null
  const oppskriftId = typeof data.oppskriftId === 'string' ? kutt(data.oppskriftId, ID_MAKS) : null
  if (data.status !== 'ingen_deler' && !oppskriftId) return null
  if (typeof data.antallDeler !== 'number' || !Number.isInteger(data.antallDeler) || data.antallDeler < 0) return null
  return { versjon: 1, status: data.status as LagreSvar['status'], oppskriftId, antallDeler: data.antallDeler, biltypeFraKobling: data.biltypeFraKobling === true }
}

// Databasefeil til et svar uten databasetekst. Bare våre egne, kjente koder slipper gjennom.
export function mapFeil(error: { message?: unknown } | null | undefined): { status: number; kode: string; felt?: string } {
  const m = typeof error?.message === 'string' ? error.message : ''
  const ugyldig = /^UGYLDIG_INPUT:([a-zA-Z]{1,20})$/.exec(m)
  if (ugyldig) return { status: 400, kode: 'ugyldig_input', felt: ugyldig[1] }
  if (m === 'UKJENT_VARE') return { status: 422, kode: 'ukjent_vare' }
  if (m === 'FLERE_OPPSKRIFTER') return { status: 409, kode: 'flere_oppskrifter' }
  if (m === 'SAMTIDIG_LAGRING') return { status: 409, kode: 'samtidig_lagring' }
  return { status: 502, kode: 'intern_feil' }
}
