// Ren logikk for edge-funksjonen portal-bestilling: validering av det portalen sender, og avgrensning av det funksjonen svarer.
// Ingen eksterne importer og ingen Deno-API-er, så Vitest kan laste filen direkte (test/portal-bestilling.test.js).
//
// Prinsipper:
//  * ALLOWLIST: bare de ti feltene under sendes videre til Postgres-funksjonen. Alt annet kastes (også `kjor_pa_nytt`, som bare en
//    admin i Salmaker'n skal kunne sette: det gjør at venter_*/avklaring_*-rader kjøres på nytt, og det skal portalen aldri kunne utløse).
//  * Edge-funksjonen normaliserer ikke: den sender originalverdiene videre, og Postgres-funksjonen er eneste sted som renser og normaliserer.
//    Her avvises bare det som er åpenbart ugyldig, tidlig og med en tydelig 400, slik at en feilkonfigurert eller manipulert avsender ikke
//    når databasen. Sjekkene er bevisst like strenge som i Postgres-funksjonen (supabase/migrations/20261030210000_portal_koble_bestilling.sql).
//  * Svaret til portalen er bare en grov kode: {kode, status, ordre_id?}. Aldri detaljer, aldri feilmeldinger fra databasen.

export const MAKS_BODY_BYTES = 8192

export const TILLATTE_FELT = [
  'bestilling_id', 'nr', 'ident_type', 'ident', 'kontakt_id', 'orgnr',
  'forhandler_navn', 'selger_navn', 'selger_epost', 'modell_slug',
] as const
type Felt = (typeof TILLATTE_FELT)[number]

// Øvre grense per felt (tegn). Postgres-funksjonen kapper selv (kontakt_id 80, selger 80, e-post 200, slug 80, forhandler_navn 120);
// her avvises det som er langt over, så en flom av tekst aldri nås så langt.
const MAKS_LENGDE: Record<Felt, number> = {
  bestilling_id: 64, nr: 40, ident_type: 20, ident: 60, kontakt_id: 120, orgnr: 30,
  forhandler_navn: 200, selger_navn: 200, selger_epost: 320, modell_slug: 120,
}

const PAAKREVD: Felt[] = ['bestilling_id', 'nr', 'ident_type', 'ident']

export type Innkommende =
  | { ok: true; p: Record<string, string>; ignorerte: number }
  | { ok: false; felt: string }

const ER_OBJEKT = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseInnkommende(raw: unknown): Innkommende {
  if (!ER_OBJEKT(raw)) return { ok: false, felt: 'body' }

  const p: Record<string, string> = {}
  for (const felt of TILLATTE_FELT) {
    const v = raw[felt]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') return { ok: false, felt }
    if (v.length > MAKS_LENGDE[felt]) return { ok: false, felt }
    // NUL kan ikke lagres i Postgres-tekst/jsonb og ville gitt en databasefeil midt i kallet: avvis her.
    if (v.includes('\u0000')) return { ok: false, felt }
    p[felt] = v
  }
  for (const felt of PAAKREVD) if (p[felt] === undefined) return { ok: false, felt }

  // Samme regler som Postgres-funksjonen (steg 1 i portal_koble_bestilling), men bevisst ASCII-strenge: det som slipper gjennom her skal ALLTID også
  // godtas av Postgres (en differensialtest på 356 grensetilfeller viste at JavaScript og Postgres ellers tolker «mellomrom» ulikt: `\s` og trim() tar med
  // BOM og Unicode-mellomrom, Postgres sin btrim() bare vanlig mellomrom, og toUpperCase() utvider f.eks. «ﬁ» til «FI»). Portalen sender allerede
  // normaliserte verdier, så strengheten koster ingenting; den som sender Unicode-mellomrom får en 400 her i stedet for fra databasen.
  const MELLOMROM = /[ \t\n\r\f\v]/g
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.bestilling_id.replace(/^ +| +$/g, ''))) return { ok: false, felt: 'bestilling_id' }
  if (p.nr.replace(/[^A-Za-z0-9-]/g, '') === '') return { ok: false, felt: 'nr' }
  if (p.ident_type !== 'CHASSIS' && p.ident_type !== 'SERIENUMMER') return { ok: false, felt: 'ident_type' }
  if (p.ident_type === 'CHASSIS') {
    // Bare ASCII før store bokstaver: toUpperCase() på ikke-ASCII kan endre lengden eller gi A-Z (ß, ﬁ, ŉ).
    const chassis = p.ident.replace(MELLOMROM, '').replace(/-/g, '')
    if (!/^[A-Za-z0-9]{17}$/.test(chassis) || /[IOQioq]/.test(chassis)) return { ok: false, felt: 'ident' }
  } else {
    const serie = p.ident.replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ +| +$/g, '')
    if (!/^[A-Za-z0-9._/ -]{3,40}$/.test(serie)) return { ok: false, felt: 'ident' }
  }

  const ignorerte = Object.keys(raw).filter((k) => !(TILLATTE_FELT as readonly string[]).includes(k)).length
  return { ok: true, p, ignorerte }
}

export type Svar = { kode: 'ok' | 'trenger_avklaring'; status: string; ordre_id?: string }

// Det Postgres-funksjonen returnerer, avgrenset til kjente nøkler med kjent form. Alt annet (uventet form, ekstra felt) gir null
// og dermed 502 til portalen: en ukjent verdi sendes aldri videre.
export function mapSvar(data: unknown): Svar | null {
  if (!ER_OBJEKT(data)) return null
  const { kode, status, ordre_id } = data
  if (kode !== 'ok' && kode !== 'trenger_avklaring') return null
  if (typeof status !== 'string' || !/^[a-z_]{1,40}$/.test(status)) return null
  const svar: Svar = { kode, status }
  if (ordre_id !== undefined && ordre_id !== null) {
    if (typeof ordre_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(ordre_id)) return null
    svar.ordre_id = ordre_id
  }
  return svar
}

export type Feil = { status: number; kode: 'ugyldig_input' | 'intern_feil'; felt?: string }

// PostgREST-feil fra rpc(). Bare «UGYLDIG_INPUT: <felt>» (kastet av funksjonen selv) kan bli en 400; alt annet er en intern feil (502) uten detaljer.
export function mapFeil(feil: unknown): Feil {
  const melding = ER_OBJEKT(feil) && typeof feil.message === 'string' ? feil.message : ''
  const treff = /^UGYLDIG_INPUT:\s*([a-z_]{1,30})\s*$/.exec(melding)
  if (treff) return { status: 400, kode: 'ugyldig_input', felt: treff[1] }
  if (/^UGYLDIG_INPUT\b/.test(melding)) return { status: 400, kode: 'ugyldig_input' }
  return { status: 502, kode: 'intern_feil' }
}
