// Ren logikk for edge-funksjonen portal-forhandler-salg: validering av det portalen sender, og avgrensning av det funksjonen svarer.
// Ingen eksterne importer og ingen Deno-API-er, så Vitest kan laste filen direkte (test/portal-forhandler-salg.test.js).
//
// Bakgrunn (Kalkyle «lønnsomhet per forhandler», lagt til 2026-11-16, Henriks ja i chat): Forhandlerportalen HENTER et skrivebeskyttet, AGGREGERT
// øyeblikksbilde av faktisk fakturerte bil-ordre (summert per forhandler + modell, aldri per enkeltordre) og sammenligner mot Kalkyle sin beregnede
// kostnad. Appen skriver aldri til portalen, og denne funksjonen skriver aldri noe.
//
// Prinsipper (samme som portal-import-fakta/logikk.ts):
//  * Edge-funksjonen normaliserer ikke: all rensing og gruppering skjer i Postgres-funksjonen portal_forhandler_salg (migrasjon 20261116110000). Her
//    avvises bare det som er åpenbart ugyldig, og svaret avgrenses til nøyaktig de navngitte feltene i kontrakten (versjon 1).
//  * Svaret til portalen er enten kontraktens fakta eller bare {kode, felt?}. Aldri databasetekst.
//  * Grensene (500 forhandler-id-er, 65 536 byte, 2000 grupper) må endres sammen i begge ender om portalen noen gang trenger mer.

export const VERSJON = 1
export const MAKS_BODY_BYTES = 65536
export const IDER_MAKS = 500
export const GRUPPER_MAKS = 2000
// Samme mønster som Postgres-funksjonen krever av forhandler_kontakt_ider.
export const ID_FORM = /^[A-Za-z0-9_.-]{1,64}$/

const ER_OBJEKT = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Forespørselen: { versjon: 1, forhandler_kontakt_ider?: string[] }
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type Foresporsel = { forhandlerKontaktIder: string[] | null }
export type ParseForesporsel = { ok: true; foresporsel: Foresporsel } | { ok: false; felt: 'body' | 'versjon' | 'forhandler_kontakt_ider' }

// `versjon` er PÅKREVD og må være tallet 1. `forhandler_kontakt_ider` er valgfri: mangler/null = alle forhandlere (samme som Postgres-funksjonens NULL).
export function parseForesporsel(raw: unknown): ParseForesporsel {
  if (!ER_OBJEKT(raw)) return { ok: false, felt: 'body' }
  if (raw.versjon !== VERSJON) return { ok: false, felt: 'versjon' }
  const ider = raw.forhandler_kontakt_ider
  if (ider === undefined || ider === null) return { ok: true, foresporsel: { forhandlerKontaktIder: null } }
  if (!Array.isArray(ider) || ider.length > IDER_MAKS) return { ok: false, felt: 'forhandler_kontakt_ider' }
  const sett = new Set<string>()
  for (const id of ider) {
    if (typeof id !== 'string' || !ID_FORM.test(id)) return { ok: false, felt: 'forhandler_kontakt_ider' }
    sett.add(id)
  }
  return { ok: true, foresporsel: { forhandlerKontaktIder: [...sett] } }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Svaret: det Postgres-funksjonen returnerer, avgrenset til kjente nøkler med kjent form.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type GruppeRad = {
  forhandler_kontakt_id: string; merke: string; modell: string; portal_modell_slug: string | null
  antall_ordre: number; fakturert_belop_eks_mva: number
}
export type SalgSvar = { ok: true; versjon: 1; generert: string; grupper: GruppeRad[] }

const TIDSPUNKT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/
function erTidspunkt(v: unknown): v is string {
  if (typeof v !== 'string' || !TIDSPUNKT.test(v)) return false
  const ms = Date.parse(v)
  return Number.isFinite(ms) && new Date(ms).toISOString() === v
}
const ER_TEKST = (v: unknown): v is string => typeof v === 'string'
const ER_TEKST_ELLER_NULL = (v: unknown): v is string | null => v === null || typeof v === 'string'
const ER_ENDELIG_TALL = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Én gruppe. Alle seks felt må være til stede med riktig type; ekstra felt kastes ved at et nytt objekt bygges. Gir null ved første brudd.
function mapGruppe(raa: unknown): GruppeRad | null {
  if (!ER_OBJEKT(raa)) return null
  const r = raa
  if (!ER_TEKST(r.forhandler_kontakt_id) || r.forhandler_kontakt_id === '') return null
  if (!ER_TEKST(r.merke) || !ER_TEKST(r.modell)) return null
  if (!ER_TEKST_ELLER_NULL(r.portal_modell_slug)) return null
  if (typeof r.antall_ordre !== 'number' || !Number.isInteger(r.antall_ordre) || r.antall_ordre < 1) return null
  if (!ER_ENDELIG_TALL(r.fakturert_belop_eks_mva)) return null
  return {
    forhandler_kontakt_id: r.forhandler_kontakt_id, merke: r.merke as string, modell: r.modell as string,
    portal_modell_slug: r.portal_modell_slug, antall_ordre: r.antall_ordre, fakturert_belop_eks_mva: r.fakturert_belop_eks_mva,
  }
}

// `data` er funksjonens jsonb UTEN `ok` (versjon, generert, grupper); `ok: true` settes her. Ukjent form gir null (og dermed 502), ekstra felt kastes.
export function mapSalg(data: unknown): SalgSvar | null {
  if (!ER_OBJEKT(data)) return null
  if (data.versjon !== VERSJON) return null
  if (!erTidspunkt(data.generert)) return null
  if (!Array.isArray(data.grupper) || data.grupper.length > GRUPPER_MAKS) return null
  const grupper: GruppeRad[] = []
  for (const raa of data.grupper) {
    const rad = mapGruppe(raa)
    if (!rad) return null
    grupper.push(rad)
  }
  return { ok: true, versjon: VERSJON, generert: data.generert, grupper }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Feil fra rpc(): bare koden, aldri meldingen.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type Feil = { status: 400 | 502; kode: 'ugyldig_input' | 'intern_feil'; felt?: string }

export function mapFeil(feil: unknown): Feil {
  const melding = ER_OBJEKT(feil) && typeof feil.message === 'string' ? feil.message : ''
  if (/^UGYLDIG_INPUT\b/.test(melding)) return { status: 400, kode: 'ugyldig_input', felt: 'forhandler_kontakt_ider' }
  return { status: 502, kode: 'intern_feil' }
}
