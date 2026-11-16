// Ren logikk for edge-funksjonen portal-timer-fakta: validering av det portalen sender, og avgrensning av det funksjonen svarer.
// Ingen eksterne importer og ingen Deno-API-er, så Vitest kan laste filen direkte (test/portal-timer-fakta.test.js).
//
// Bakgrunn (kalkylesiden i Forhandlerportalen, /admin/kalkyle): portalen HENTER et skrivebeskyttet øyeblikksbilde av FAKTISKE timer per bil (ordreklokka i appen)
// og sammenligner dem med kalkulerte timer per modell. Portalen eier all matching mot kalkylemodellene; appen leverer bare tall per bil og skriver aldri til portalen.
// Denne funksjonen skriver aldri noe heller.
//
// Prinsipper (samme som portal-import-fakta/logikk.ts):
//  * Edge-funksjonen normaliserer ikke: all utregning og rensing av tekst skjer i Postgres-funksjonen portal_timer_fakta (migrasjon 20261116120000). Her avvises
//    bare det som er åpenbart ugyldig, og svaret avgrenses til nøyaktig de navngitte feltene i kontrakten (versjon 1, supabase/README.md «Faktiske timer til portalen»).
//  * Svaret til portalen er enten kontraktens fakta eller bare {kode, felt?}. Aldri databasetekst, aldri verdier fra ordrene i en feilmelding.
//  * I motsetning til portal-import-fakta har svaret INGEN `ok`-nøkkel: kontraktens gullfil (test/fixtures/portal-timer-fakta-svar.json) har bare versjon, generert, antall, biler.
//  * Grensene (2000 biler, 1024 byte) må endres sammen i begge ender (portalens kopi av kontrakten).

export const VERSJON = 1
// Forespørselen er {"versjon":1}: alt over 1 KB er feil hos oss (og avvises før det parses).
export const MAKS_BODY_BYTES = 1024
export const BILER_MAKS = 2000
// Merke og modell er kappet til 100 tegn (kodepunkter) av Postgres-funksjonen.
export const TEKST_MAKS = 100

const ER_OBJEKT = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Forespørselen: { versjon: 1 }
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type ParseForesporsel = { ok: true } | { ok: false; felt: 'body' | 'versjon' }

// `versjon` er PÅKREVD og må være tallet 1 (ikke teksten «1», ikke null). Ukjente felt kastes og sendes aldri videre (funksjonen tar ingen inndata til databasen).
export function parseForesporsel(raw: unknown): ParseForesporsel {
  if (!ER_OBJEKT(raw)) return { ok: false, felt: 'body' }
  if (raw.versjon !== VERSJON) return { ok: false, felt: 'versjon' }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Svaret: det Postgres-funksjonen returnerer, avgrenset til kjente nøkler med kjent form.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type TimerBil = {
  merke: string; modell: string; ordre_status: string; arkivert: boolean; hentet: boolean
  minutter_ombygging: number; okter_ombygging: number; okter_ombygging_glemt: number; minutter_klargjoring: number
  pagaar: boolean; frossen_effektiv_minutter: number | null
}
export type TimerSvar = { versjon: 1; generert: string; antall: number; biler: TimerBil[] }

// Tidspunkt slik Postgres-funksjonen formaterer dem (to_char med 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), og en ekte dato.
const TIDSPUNKT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/
function erTidspunkt(v: unknown): v is string {
  if (typeof v !== 'string' || !TIDSPUNKT.test(v)) return false
  const ms = Date.parse(v)
  // Date.parse(«2026-02-30T…Z») gir enten NaN eller en annen dag; sammenligningen fanger begge deler.
  return Number.isFinite(ms) && new Date(ms).toISOString() === v
}
const ER_BOOLSK = (v: unknown): v is boolean => typeof v === 'boolean'
// Hele, ikke-negative tall (minutter og antall). Tall utenfor trygt heltallsområde avvises.
const ER_HELT = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const ER_TEKST_HOYST = (v: unknown): v is string => typeof v === 'string' && [...v].length <= TEKST_MAKS

// Én bil. Alle 11 felt må være til stede med riktig type (frossen_effektiv_minutter er null eller et helt tall); ekstra felt kastes ved at et nytt objekt bygges av de
// navngitte feltene (i kontraktens rekkefølge). `hentet` må stemme med ordre_status (kontraktens definisjon: hentet = ordre_status er «hentet»). Gir null ved første brudd.
function mapBil(raa: unknown): TimerBil | null {
  if (!ER_OBJEKT(raa)) return null
  const r = raa
  if (!ER_TEKST_HOYST(r.merke) || !ER_TEKST_HOYST(r.modell)) return null
  if (typeof r.ordre_status !== 'string' || r.ordre_status === '') return null
  if (!ER_BOOLSK(r.arkivert) || !ER_BOOLSK(r.hentet) || !ER_BOOLSK(r.pagaar)) return null
  if (r.hentet !== (r.ordre_status === 'hentet')) return null
  if (!ER_HELT(r.minutter_ombygging) || !ER_HELT(r.okter_ombygging) || !ER_HELT(r.okter_ombygging_glemt) || !ER_HELT(r.minutter_klargjoring)) return null
  if (r.frossen_effektiv_minutter !== null && !ER_HELT(r.frossen_effektiv_minutter)) return null
  return {
    merke: r.merke, modell: r.modell, ordre_status: r.ordre_status, arkivert: r.arkivert, hentet: r.hentet,
    minutter_ombygging: r.minutter_ombygging, okter_ombygging: r.okter_ombygging, okter_ombygging_glemt: r.okter_ombygging_glemt,
    minutter_klargjoring: r.minutter_klargjoring, pagaar: r.pagaar, frossen_effektiv_minutter: r.frossen_effektiv_minutter,
  }
}

// `data` er funksjonens jsonb (versjon, generert, antall, biler). Ukjent form gir null (og dermed 502), ekstra felt kastes. `antall` må være lik lengden på `biler`
// (en uenighet er en feil i funksjonen, ikke i dataene), og listen kan aldri være lengre enn taket (Postgres-funksjonen kaster FOR_MANGE_BILER før dette).
export function mapTimer(data: unknown): TimerSvar | null {
  if (!ER_OBJEKT(data)) return null
  if (data.versjon !== VERSJON) return null
  if (!erTidspunkt(data.generert)) return null
  if (!Array.isArray(data.biler) || data.biler.length > BILER_MAKS) return null
  if (data.antall !== data.biler.length) return null
  const biler: TimerBil[] = []
  for (const raa of data.biler) {
    const bil = mapBil(raa)
    if (!bil) return null
    biler.push(bil)
  }
  return { versjon: VERSJON, generert: data.generert, antall: biler.length, biler }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Feil fra rpc(): bare koden, aldri meldingen (den kan inneholde verdier).
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type Feil = { status: 422 | 502; kode: 'for_mange_biler' | 'intern_feil' }

// Bare feilen funksjonen kaster selv («FOR_MANGE_BILER») har egen kode, og bare når meldingen BEGYNNER med den; alt annet, også tekst som bare ligner, er en intern feil
// (502) uten detaljer.
export function mapFeil(feil: unknown): Feil {
  const melding = ER_OBJEKT(feil) && typeof feil.message === 'string' ? feil.message : ''
  if (/^FOR_MANGE_BILER\b/.test(melding)) return { status: 422, kode: 'for_mange_biler' }
  return { status: 502, kode: 'intern_feil' }
}
