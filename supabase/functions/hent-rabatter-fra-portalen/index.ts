// Henter forhandler-rabattsatser fra Forhandlerportalen inn i en egen, rå tabell
// (portal_kunde_rabatt) - STEG 1 av 4 i rabatt-prosjektet (5.11, Henriks ja: "Ja det er bare å
// starte"). Appen HENTER (pull), portalen EIER satsene. Denne funksjonen henter og lagrer KUN -
// den endrer IKKE fiken-fakturering, rører ALDRI fiken_kunde_rabatt/fiken_kunde_alias, og ingen
// ordre slår ennå opp mot denne tabellen. Det er en bevisst avgrensning: hvordan en ordre finner
// riktig rad her (kontakt_id kan stå på FLERE portalforhandlere, f.eks. BOS-gruppen) er steg 2
// ("faktura-sammenligning/forhåndsvisning") og avgjøres med Henrik når ekte data er hentet inn -
// ikke gjettet frem her.
//
// Samme to kallertyper som hent-selgere-fra-portalen (server-kategorien er IKKE bygget her ennå
// - kun admin-knapp i v1, avklar med Henrik om/når en cron-variant trengs):
//  - En innlogget admin som trykker "Hent rabatter fra portalen" (vanlig ansatt-token, den
//    delte EDGE-AUTH-GATEN under).
//
// Portalens endepunkt: GET https://forhandler.salmaker.as/api/salmakern/rabatter med header
// x-salmakern-hent-secret - SAMME delte hemmelighet (SALMAKERN_HENT_SECRET) som
// hent-selgere-fra-portalen bruker, allerede satt opp i produksjon. Avtalt med portal-økta 5.11:
// jeg foreslo en egen hemmelighet per datadomene (rabatter er kommersielt sensitiv
// forhandleravtale-informasjon), men portal-økta påpekte at det gir liten reell isolasjon (alle
// edge-funksjoner i samme Supabase-prosjekt kan uansett lese alle secrets - RLS er det som faktisk
// beskytter dataene) mot kostnaden av enda en hemmelighet å administrere/rotere/importere i
// Vercel. Begge sider hadde allerede bygget og testet mot denne antagelsen da avtalen ble
// bekreftet, så en egen hemmelighet tas som et eget, lite steg senere om/når cron-varianter med
// forskjellige rotasjonsbehov gjør det ønskelig.
//
// Avtalt kontrakt (ENDELIG, portal-øktas side skrevet og enhetstestet, IKKE utlagt ennå):
// { ok: true, versjon: 1, generert, antall: { forhandlere, med_ugyldig_sats },
//   forhandlere: [{ kontakt_id, kontakt_navn, orgnr: string|null, portal_forhandler_id,
//                   rabatt: { standard: number|null, ekstrautstyr: number|null, modulsystem: number|null } }] }
// Satser er PROSENT 0-100 (kan ha desimaler). En UGYLDIG sats (NaN/uendelig/negativ/over 100/
// ikke tall) sendes av portalen som null, ALDRI som 0 - denne funksjonen avviser HELE svaret
// (502) hvis et rabattfelt verken er null eller et gyldig tall 0-100, slik at en feil aldri kan
// tolkes som "ingen rabatt".

import { createClient } from 'jsr:@supabase/supabase-js@2'

const PORTAL_URL = 'https://forhandler.salmaker.as/api/salmakern/rabatter'
const PORTAL_SECRET = Deno.env.get('SALMAKERN_HENT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

const FN = 'hent-rabatter-fra-portalen'
const TILLATTE_ROLLER = ['admin']
// ── EDGE-AUTH-GATE BEGIN (blokken er byte-lik i fiken-fakturer, send-frakt-epost, vegvesen-oppslag og send-push; test/edge-auth-gate.test.js vokter mot avvik) ──
// Innloggingssjekk innført 2026-10-29: kallet skal komme fra en innlogget ansatt med riktig rolle (TILLATTE_ROLLER). Samme regel som RLS bruker:
// vi spør databasen via current_ansatt() med KALLERENS eget token (aktiv, riktig session_token, rolle slått opp live) - aldri dekoding av JWT her,
// og aldri rolle-claimen i tokenet (den er frosset fra innloggingen). MYK MODUS til håndheving er slått på: kallet slippes alltid gjennom, men
// utfallet logges som én JSON-linje (edge_auth: 1, aldri tokens eller andre verdier fra headerne). Håndheving slås på uten ny utrulling ved å
// legge funksjonsnavnet (eller *) i Supabase-hemmeligheten EDGE_AUTH_ENFORCE (kommaliste) og rulles tilbake ved å fjerne det igjen.
const HAANDHEV = (Deno.env.get('EDGE_AUTH_ENFORCE') ?? '').split(',').map((s) => s.trim()).some((s) => s === '*' || s === FN)
const JWT_FORM = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/

type Sjekk = { via: 'ansatt' | 'ikke_tillatt_rolle' | 'ingen' | 'ukjent'; grunn?: string; rolle?: string; ansattId?: number }

async function sjekkAnsatt(req: Request): Promise<Sjekk> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { via: 'ingen', grunn: 'ingen_header' }
  // Den offentlige nøkkelen (sb_publishable_...) og alt annet som ikke er en JWT er aldri en ansatt-sesjon: ingen oppslag nødvendig.
  if (token.length > 4096 || !JWT_FORM.test(token)) return { via: 'ingen', grunn: 'ikke_jwt' }
  const url = Deno.env.get('SUPABASE_URL')
  const apikey = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || ''
  if (!url || !apikey) return { via: 'ukjent', grunn: 'mangler_miljo' }
  const res = await fetch(`${url}/rest/v1/rpc/current_ansatt`, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) {
    // Ugyldig/utløpt token er kallerens sak (ingen); alt annet (feil nøkkel hos oss, databasen nede, rate limit) er «ukjent» så vi aldri
    // påstår at en ekte admin ikke er innlogget bare fordi selve sjekken svikter.
    const kode = await res.json().then((b) => String(b?.code ?? '')).catch(() => '')
    return /^PGRST30[13]$/.test(kode) ? { via: 'ingen', grunn: 'ugyldig_eller_utlopt_token' } : { via: 'ukjent', grunn: `postgrest_${res.status}` }
  }
  const rader = await res.json()
  if (!Array.isArray(rader) || rader.length > 1) return { via: 'ukjent', grunn: 'uventet_svar' }
  if (rader.length === 0) return { via: 'ingen', grunn: 'ingen_ansatt_sesjon' }
  const { id, rolle } = rader[0] ?? {}
  if (typeof rolle !== 'string' || !Number.isInteger(id)) return { via: 'ukjent', grunn: 'uventet_svar' }
  return TILLATTE_ROLLER.includes(rolle) ? { via: 'ansatt', rolle, ansattId: id } : { via: 'ikke_tillatt_rolle', rolle, ansattId: id }
}

// Gir null når kallet skal slippes gjennom, ellers statuskoden og meldingen funksjonen skal svare med (i funksjonens eget svarformat).
async function innloggingsgate(req: Request): Promise<{ status: number; melding: string } | null> {
  let sjekk: Sjekk
  try {
    sjekk = await sjekkAnsatt(req)
  } catch (e) {
    sjekk = { via: 'ukjent', grunn: e instanceof Error ? e.name : 'feil' }
  }
  console.log(JSON.stringify({ edge_auth: 1, fn: FN, via: sjekk.via, grunn: sjekk.grunn ?? '', rolle: sjekk.rolle ?? '', ansatt_id: sjekk.ansattId ?? null, haandhevet: HAANDHEV, origin: req.headers.get('origin') ?? '' }))
  if (sjekk.via === 'ansatt' || !HAANDHEV) return null
  if (sjekk.via === 'ukjent') return { status: 503, melding: 'Kunne ikke bekrefte innloggingen akkurat nå - prøv igjen om litt' }
  if (sjekk.via === 'ikke_tillatt_rolle') return { status: 403, melding: 'Rollen din har ikke tilgang til dette' }
  return { status: 401, melding: 'Du må være innlogget - logg inn på nytt og prøv igjen' }
}
// ── EDGE-AUTH-GATE END ──

type PortalRabattSvar = {
  ok: boolean
  versjon: number
  generert: string
  antall: { forhandlere: number; med_ugyldig_sats: number }
  forhandlere: Array<{
    kontakt_id: string
    kontakt_navn: string
    orgnr: string | null
    portal_forhandler_id: string
    rabatt: { standard: number | null; ekstrautstyr: number | null; modulsystem: number | null }
  }>
}

function erGyldigSats(x: unknown): x is number | null {
  return x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100)
}

// kontakt_id/portal_forhandler_id er NØKLER (brukes til oppslag/kobling) og må derfor være en
// ikke-tom streng - ulikt kontakt_navn, som er fritekst og derfor kan være tom (samme skille som
// selgere-funksjonen gjør for navn vs. portal_id/epost).
function gyldigPortalSvar(x: any): x is PortalRabattSvar {
  return !!x && x.ok === true
    && typeof x?.versjon === 'number'
    && typeof x?.antall?.forhandlere === 'number' && typeof x?.antall?.med_ugyldig_sats === 'number'
    && Array.isArray(x.forhandlere) && x.forhandlere.every((f: any) =>
      typeof f?.kontakt_id === 'string' && f.kontakt_id !== ''
      && typeof f?.kontakt_navn === 'string'
      && (f?.orgnr === null || typeof f?.orgnr === 'string')
      && typeof f?.portal_forhandler_id === 'string' && f.portal_forhandler_id !== ''
      && !!f?.rabatt && erGyldigSats(f.rabatt.standard) && erGyldigSats(f.rabatt.ekstrautstyr) && erGyldigSats(f.rabatt.modulsystem)
    )
}

// Samme konsistenssjekk som hent-selgere-fra-portalen sin antallStemmer() - fanger et
// avkuttet/brutt svar FØR det skrives til databasen, i stedet for å stille lagre en delvis liste.
function antallStemmer(x: PortalRabattSvar): boolean {
  const faktiskUgyldige = x.forhandlere.filter((f) => f.rabatt.standard === null || f.rabatt.ekstrautstyr === null || f.rabatt.modulsystem === null).length
  return x.antall.forhandlere === x.forhandlere.length && x.antall.med_ugyldig_sats === faktiskUgyldige
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const avvist = await innloggingsgate(req)
    if (avvist) return jsonSvar({ error: avvist.melding }, avvist.status)

    if (!PORTAL_SECRET) return jsonSvar({ error: 'Ingen delt hemmelighet mot portalen (SALMAKERN_HENT_SECRET) er satt opp ennå' }, 500)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)

    const portalRes = await fetch(PORTAL_URL, {
      headers: { 'x-salmakern-hent-secret': PORTAL_SECRET },
      signal: AbortSignal.timeout(15000),
    })
    if (!portalRes.ok) return jsonSvar({ error: `Portalen svarte ${portalRes.status}` }, 502)
    const portalData = await portalRes.json().catch(() => null)
    if (!gyldigPortalSvar(portalData)) return jsonSvar({ error: 'Uventet svarform fra portalen' }, 502)
    if (!antallStemmer(portalData)) return jsonSvar({ error: 'Portalens oppgitte antall stemmer ikke med listen den faktisk sendte - avviser svaret' }, 502)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await supabase.rpc('portal_rabatter_synk', {
      p_forhandlere: portalData.forhandlere.map((f) => ({
        portal_forhandler_id: f.portal_forhandler_id,
        kontakt_id: f.kontakt_id,
        kontakt_navn: f.kontakt_navn,
        orgnr: f.orgnr,
        rabatt_standard: f.rabatt.standard,
        rabatt_ekstrautstyr: f.rabatt.ekstrautstyr,
        rabatt_modulsystem: f.rabatt.modulsystem,
      })),
    })
    if (error) return jsonSvar({ error: 'Kunne ikke lagre: ' + error.message }, 500)

    return jsonSvar({ ok: true, antallForhandlere: portalData.forhandlere.length, ...data })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
