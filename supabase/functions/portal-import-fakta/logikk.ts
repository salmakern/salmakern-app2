// Ren logikk for edge-funksjonen portal-import-fakta: validering av det portalen sender, og avgrensning av det funksjonen svarer.
// Ingen eksterne importer og ingen Deno-API-er, så Vitest kan laste filen direkte (test/portal-import-fakta.test.js).
//
// Bakgrunn (aktive biler i selgernes «Mine bestillinger», etappe 1): Forhandlerportalen HENTER et skrivebeskyttet øyeblikksbilde av aktive bil-ordrer og
// eier all matching, oppretting og skjuling selv. Appen skriver aldri til portalen, og denne funksjonen skriver aldri noe.
//
// Prinsipper (samme som portal-bestilling/logikk.ts):
//  * Edge-funksjonen normaliserer ikke: all rensing av tekst skjer i Postgres-funksjonen portal_import_fakta (migrasjon 20261110200000). Her avvises bare
//    det som er åpenbart ugyldig, og svaret avgrenses til nøyaktig de navngitte feltene i kontrakten (versjon 1, supabase/README.md «Importerte biler til portalen»).
//  * Svaret til portalen er enten kontraktens fakta eller bare {kode, felt?}. Aldri databasetekst, aldri verdier fra ordrene i en feilmelding.
//  * Grensene (500 id-er, 500 aktive, 65 536 byte) må endres sammen i begge ender (portalens lib/import/fakta.ts og typer.ts).

export const VERSJON = 1
export const MAKS_BODY_BYTES = 65536
export const IDER_MAKS = 500
export const AKTIVE_MAKS = 500
// Samme mønster som Postgres-funksjonen krever av ider (en id utenfor mønsteret avviser HELE kallet der, og portalen sender aldri slike).
export const ID_FORM = /^[A-Za-z0-9_.-]{1,64}$/

const ER_OBJEKT = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Forespørselen: { versjon: 1, ider?: string[] }
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type Foresporsel = { ider: string[] }
export type ParseForesporsel = { ok: true; foresporsel: Foresporsel } | { ok: false; felt: 'body' | 'versjon' | 'ider' }

// `versjon` er PÅKREVD og må være tallet 1 (ikke teksten «1», ikke null). `ider` er valgfri (mangler/null = tom liste). Ukjente felt kastes og sendes aldri videre.
// Lengden telles FØR dubletter fjernes: en liste på 501 elementer avvises selv om den består av få ulike id-er (taket er på det portalen sender, ikke på det som blir igjen).
export function parseForesporsel(raw: unknown): ParseForesporsel {
  if (!ER_OBJEKT(raw)) return { ok: false, felt: 'body' }
  if (raw.versjon !== VERSJON) return { ok: false, felt: 'versjon' }
  const ider = raw.ider
  if (ider === undefined || ider === null) return { ok: true, foresporsel: { ider: [] } }
  if (!Array.isArray(ider) || ider.length > IDER_MAKS) return { ok: false, felt: 'ider' }
  const sett = new Set<string>()
  for (const id of ider) {
    if (typeof id !== 'string' || !ID_FORM.test(id)) return { ok: false, felt: 'ider' }
    sett.add(id)
  }
  // Set bevarer innsettingsrekkefølgen, så rekkefølgen til første forekomst av hver id består.
  return { ok: true, foresporsel: { ider: [...sett] } }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Svaret: det Postgres-funksjonen returnerer, avgrenset til kjente nøkler med kjent form.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type FaktaRad = {
  ordre_id: string; ordretype: string; kunde: string; chassis: string; eier: string; merke: string; modell: string
  ordre_status: string; status: 'aktiv' | 'arkivert'; opprettet: string | null; kontakt_treff: number; kontakt_id: string | null
  kontakt_navn: string | null; kontakt_orgnr: string | null; portal_bestilling_ider: string[]
}
export type UtvalgtRad = (FaktaRad & { finnes: true }) | { ordre_id: string; finnes: false }
export type FaktaSvar = { ok: true; versjon: 1; generert: string; aktive: FaktaRad[]; utvalgte: UtvalgtRad[] }

// Tidspunkt slik Postgres-funksjonen formaterer dem (to_char med 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), og en ekte dato.
const TIDSPUNKT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/
function erTidspunkt(v: unknown): v is string {
  if (typeof v !== 'string' || !TIDSPUNKT.test(v)) return false
  const ms = Date.parse(v)
  // Date.parse(«2026-02-30T…Z») gir enten NaN eller en annen dag; sammenligningen fanger begge deler.
  return Number.isFinite(ms) && new Date(ms).toISOString() === v
}
const ER_TEKST = (v: unknown): v is string => typeof v === 'string'
const ER_TEKST_ELLER_NULL = (v: unknown): v is string | null => v === null || typeof v === 'string'

// Én rad. Alle 15 felt må være til stede med riktig type (null er eksplisitt der kontrakten sier det); ekstra felt kastes ved at et nytt objekt bygges
// av de navngitte feltene. Gir null ved første brudd.
function mapRad(raa: unknown): FaktaRad | null {
  if (!ER_OBJEKT(raa)) return null
  const r = raa
  if (!ER_TEKST(r.ordre_id) || r.ordre_id === '') return null
  for (const felt of ['ordretype', 'kunde', 'chassis', 'eier', 'merke', 'modell', 'ordre_status'] as const) {
    if (!ER_TEKST(r[felt])) return null
  }
  if (r.status !== 'aktiv' && r.status !== 'arkivert') return null
  if (r.opprettet !== null && !erTidspunkt(r.opprettet)) return null
  if (typeof r.kontakt_treff !== 'number' || !Number.isInteger(r.kontakt_treff) || r.kontakt_treff < 0) return null
  if (!ER_TEKST_ELLER_NULL(r.kontakt_id) || !ER_TEKST_ELLER_NULL(r.kontakt_navn) || !ER_TEKST_ELLER_NULL(r.kontakt_orgnr)) return null
  if (!Array.isArray(r.portal_bestilling_ider) || !r.portal_bestilling_ider.every(ER_TEKST)) return null
  return {
    ordre_id: r.ordre_id, ordretype: r.ordretype as string, kunde: r.kunde as string, chassis: r.chassis as string, eier: r.eier as string,
    merke: r.merke as string, modell: r.modell as string, ordre_status: r.ordre_status as string, status: r.status,
    opprettet: r.opprettet as string | null, kontakt_treff: r.kontakt_treff, kontakt_id: r.kontakt_id, kontakt_navn: r.kontakt_navn,
    kontakt_orgnr: r.kontakt_orgnr, portal_bestilling_ider: [...(r.portal_bestilling_ider as string[])],
  }
}

function mapUtvalgt(raa: unknown): UtvalgtRad | null {
  if (!ER_OBJEKT(raa)) return null
  if (raa.finnes === false) {
    // «Finnes ikke» har BARE nøklene ordre_id og finnes: en rad med ekstra felt er en uventet svarform og avvises (ikke bare kastes).
    if (!ER_TEKST(raa.ordre_id) || raa.ordre_id === '') return null
    if (Object.keys(raa).some((k) => k !== 'ordre_id' && k !== 'finnes')) return null
    return { ordre_id: raa.ordre_id, finnes: false }
  }
  if (raa.finnes !== true) return null
  const rad = mapRad(raa)
  return rad ? { ...rad, finnes: true } : null
}

// `data` er funksjonens jsonb UTEN `ok` (versjon, generert, aktive, utvalgte); `ok: true` settes her. Ukjent form gir null (og dermed 502), ekstra felt kastes.
// En `aktive`-rad må være en aktiv bil: Postgres-funksjonen garanterer det, og portalen sjekker det på nytt, så brudd her er en feil i funksjonen, ikke i dataene.
export function mapFakta(data: unknown): FaktaSvar | null {
  if (!ER_OBJEKT(data)) return null
  if (data.versjon !== VERSJON) return null
  if (!erTidspunkt(data.generert)) return null
  if (!Array.isArray(data.aktive) || data.aktive.length > AKTIVE_MAKS) return null
  if (!Array.isArray(data.utvalgte) || data.utvalgte.length > IDER_MAKS) return null
  const aktive: FaktaRad[] = []
  for (const raa of data.aktive) {
    const rad = mapRad(raa)
    if (!rad || rad.ordretype !== 'bil' || rad.status !== 'aktiv') return null
    aktive.push(rad)
  }
  const utvalgte: UtvalgtRad[] = []
  for (const raa of data.utvalgte) {
    const rad = mapUtvalgt(raa)
    if (!rad) return null
    utvalgte.push(rad)
  }
  return { ok: true, versjon: VERSJON, generert: data.generert, aktive, utvalgte }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Feil fra rpc(): bare koden, aldri meldingen (den kan inneholde verdier).
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type Feil = { status: 400 | 422 | 502; kode: 'ugyldig_input' | 'for_mange_aktive' | 'intern_feil'; felt?: string }

// Bare feilene funksjonen kaster selv («UGYLDIG_INPUT: ider», «FOR_MANGE_AKTIVE») har egne koder, og bare når meldingen BEGYNNER med dem; alt annet,
// også tekst som bare ligner, er en intern feil (502) uten detaljer.
export function mapFeil(feil: unknown): Feil {
  const melding = ER_OBJEKT(feil) && typeof feil.message === 'string' ? feil.message : ''
  if (/^UGYLDIG_INPUT\b/.test(melding)) return { status: 400, kode: 'ugyldig_input', felt: 'ider' }
  if (/^FOR_MANGE_AKTIVE\b/.test(melding)) return { status: 422, kode: 'for_mange_aktive' }
  return { status: 502, kode: 'intern_feil' }
}
