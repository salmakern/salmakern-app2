// Oppretter en NY kontaktperson hos riktig Fiken-kunde (regnskapssystemet). Lukker gapet mellom
// Forhandlerportalens selgere (ca. 270 eksisterende + nye, synket inn i innstillinger.kontakter
// sine kontaktpersoner via hent-selgere-fra-portalen) og Fiken, som fiken-fakturer i dag bare
// STILLE hopper over hvis ingen kontaktperson med samme navn finnes fra før (se kommentaren ved
// contactPersonId der). Kalt fra Salmakern-appen (en innlogget admin) når faktureringsflyten
// oppdager at ordrens selger/kontaktperson (o.eier) mangler som kontaktperson i Fiken - se
// fiken-fakturer sin needsKontaktperson-gren og js/ordre-detalj.js/fikenKontaktpersonMangler.
//
// Søsken til fiken-opprett-produkt (samme "gjetter aldri, skriver aldri over noe"-filosofi), men
// MED en annen beskyttelse: fiken-opprett-produkt kalles av Forhandlerportalens server og bruker
// derfor en delt hemmelighet (FIKEN_SYNC_SECRET, x-sync-secret). Denne funksjonen kalles derimot
// direkte fra en innlogget admins nettleser i Salmakern-appen (edgeFetch) - en delt hemmelighet
// ville da måttet ligge i klientkoden, synlig for enhver som åpner den (lekket hemmelighet). Den
// bruker i stedet SAMME mønster som fiken-fakturer/hent-rabatter-fra-portalen: EDGE-AUTH-GATEN
// sjekker kallerens EGEN ansatt-sesjon (current_ansatt(), rolle admin) - ingen delt hemmelighet.
//
// Trygghetsregler (speiler fiken-opprett-produkt):
// - Stoler ALDRI på en contactId sendt fra klienten. Resolver riktig Fiken-kunde selv, server-
//   side, fra ordren sin egen kunde/forhandler_orgnr - se finnFikenKunde() under.
// - Matching mot riktig Fiken-kunde: (1) fiken_kunde_alias (samme tabell/konvensjon som
//   fiken-fakturer bruker for fakturering), ellers (2) organisasjonsnummer HVIS det gir NØYAKTIG
//   ett treff blant Fiken sine kunder. Gir org.nr-et null eller flere treff: opprett INGENTING -
//   returner en tydelig liste over kandidatene (eller at ingen ble funnet) slik at en admin kan
//   løse det selv, i stedet for å gjette.
// - Finnes en kontaktperson med samme navn (case-uavhengig) hos kunden fra før: opprett IKKE en
//   ny (unngå dubletter) - svar at den allerede finnes.
// - Henter ALLTID hele kunde-/kontaktpersonlisten (alle sider) før den konkluderer noe.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'

const MAX_NAVN_LENGDE = 200
const MAX_EPOST_LENGDE = 200
// eslint-disable-next-line no-control-regex
const KONTROLLTEGN = /[\u0000-\u001f\u007f]/
const EPOST_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

const FN = 'fiken-opprett-kontaktperson'
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

async function fikenFetch(path: string, init: RequestInit = {}) {
  return fetch(`${FIKEN_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${FIKEN_API_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
}

// Nøkkelen kan ha tilgang til flere foretak (samme forbehold som fiken-fakturer) - plukk aldri
// bare første treff, vi vil alltid og bare ha Telemark Salmakerverksted.
async function hentCompanySlug(): Promise<string> {
  const res = await fikenFetch('/companies')
  if (!res.ok) throw new Error(`Fiken /companies svarte ${res.status}`)
  const selskaper = await res.json()
  const match = (selskaper || []).find((s: any) => s.slug === FIKEN_SLUG)
  if (!match) throw new Error(`Fant ikke foretaket "${FIKEN_SLUG}" blant selskapene nøkkelen har tilgang til`)
  return match.slug
}

type FikenKontakt = { contactId: number; name: string; organizationNumber?: string | null; contactPerson?: Array<{ contactPersonId: number; name: string; email?: string | null }> }

// Alle Fiken-kunder (customer=true), ALLE sider - samme pagineringsmønster som fiken-fakturer sin
// needsBekreftelse-gren (218+ kontakter over flere sider; en ny kontakt havner ofte utenfor side 0).
async function hentAlleKunder(slug: string): Promise<FikenKontakt[]> {
  const kunder: FikenKontakt[] = []
  let page = 0
  while (true) {
    const res = await fikenFetch(`/companies/${slug}/contacts?customer=true&page=${page}&pageSize=100`)
    if (!res.ok) throw new Error(`Fiken /contacts svarte ${res.status}: ${await res.text()}`)
    kunder.push(...(await res.json()))
    const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
    page++
    if (page >= pageCount) break
  }
  return kunder
}

type KundeResultat =
  | { status: 'funnet'; contactId: number; navn: string; via: 'alias' | 'orgnr' }
  | { status: 'ingen_orgnr' }
  | { status: 'ingen_treff'; orgnr: string }
  | { status: 'flere_treff'; orgnr: string; kandidater: Array<{ contactId: number; navn: string }> }

// Resolver riktig Fiken-kunde SELV, server-side - stoler ALDRI på noe klienten måtte påstå.
// (1) fiken_kunde_alias (samme tabell fiken-fakturer bruker for fakturering - er kunden alt
//     koblet der, f.eks. fordi ordren er fakturert før, brukes akkurat den koblingen).
// (2) ellers organisasjonsnummer, HVIS det gir nøyaktig ett treff blant Fiken sine kunder.
async function finnFikenKunde(
  supabase: ReturnType<typeof createClient>,
  slug: string,
  kundeNavn: string,
  forhandlerOrgnr: string | null
): Promise<KundeResultat> {
  const { data: alias } = await supabase
    .from('fiken_kunde_alias')
    .select('fiken_contact_id, fiken_navn')
    .eq('alias', kundeNavn)
    .maybeSingle()
  if (alias) return { status: 'funnet', contactId: alias.fiken_contact_id, navn: alias.fiken_navn || kundeNavn, via: 'alias' }

  const orgnr = (forhandlerOrgnr || '').replace(/\s/g, '')
  if (!orgnr) return { status: 'ingen_orgnr' }

  const kunder = await hentAlleKunder(slug)
  const treff = kunder.filter((k) => String(k.organizationNumber || '').replace(/\s/g, '') === orgnr)
  if (treff.length === 0) return { status: 'ingen_treff', orgnr }
  if (treff.length > 1) return { status: 'flere_treff', orgnr, kandidater: treff.map((k) => ({ contactId: k.contactId, navn: k.name })) }

  const funnet = treff[0]
  // Et eksakt org.nr-treff er MINST like pålitelig som en admins manuelle valg i
  // fiken-fakturer sin needsBekreftelse-modal (som lagrer en alias med det samme) - lagres derfor
  // samme vei, slik senere fakturering av samme kundenavn slipper å spørre på nytt.
  await supabase.from('fiken_kunde_alias').upsert({
    alias: kundeNavn,
    fiken_contact_id: funnet.contactId,
    fiken_navn: funnet.name,
    bekreftet_av: 'Automatisk (eksakt org.nr-treff, fiken-opprett-kontaktperson)',
  }, { onConflict: 'alias' })

  return { status: 'funnet', contactId: funnet.contactId, navn: funnet.name, via: 'orgnr' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonSvar({ error: 'Bare POST er støttet' }, 405)
  try {
    const avvist = await innloggingsgate(req)
    if (avvist) return jsonSvar({ error: avvist.melding }, avvist.status)

    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)

    const body = await req.json().catch(() => null)
    const ordreId = typeof body?.ordreId === 'string' ? body.ordreId.trim() : ''
    const navn = typeof body?.navn === 'string' ? body.navn.trim() : ''
    const epost = typeof body?.epost === 'string' ? body.epost.trim() : ''

    if (!ordreId) return jsonSvar({ created: false, error: 'Mangler ordreId' }, 400)
    if (!navn || navn.length > MAX_NAVN_LENGDE || KONTROLLTEGN.test(navn)) {
      return jsonSvar({ created: false, error: `Navnet må være 1-${MAX_NAVN_LENGDE} tegn uten linjeskift` }, 400)
    }
    if (!epost || epost.length > MAX_EPOST_LENGDE || !EPOST_RE.test(epost)) {
      return jsonSvar({ created: false, error: 'Mangler eller ugyldig e-post - Fiken krever en gyldig e-post for å opprette en kontaktperson' }, 400)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: ordre, error: ordreFeil } = await supabase
      .from('ordrer')
      .select('kunde, forhandler_orgnr')
      .eq('id', ordreId)
      .maybeSingle()
    if (ordreFeil) return jsonSvar({ created: false, error: 'Kunne ikke lese ordren: ' + ordreFeil.message }, 500)
    if (!ordre) return jsonSvar({ created: false, error: 'Fant ikke ordren' }, 404)
    const kundeNavn = String(ordre.kunde || '').trim()
    if (!kundeNavn) return jsonSvar({ created: false, error: 'Ordren mangler kundenavn' }, 400)

    const slug = await hentCompanySlug()
    const kundeResultat = await finnFikenKunde(supabase, slug, kundeNavn, ordre.forhandler_orgnr ?? null)

    if (kundeResultat.status === 'ingen_orgnr') {
      return jsonSvar({
        created: false,
        reason: `Fant ingen tidligere Fiken-kobling for kunden «${kundeNavn}», og ordren har ikke noe organisasjonsnummer å slå opp mot. Fakturer ordren først (eller fyll inn forhandlerens org.nr), så kobles kunden - prøv igjen etterpå.`,
      }, 422)
    }
    if (kundeResultat.status === 'ingen_treff') {
      return jsonSvar({
        created: false,
        reason: `Fant ingen Fiken-kunde med organisasjonsnummer ${kundeResultat.orgnr} - sjekk om org.nr er riktig registrert, eller fakturer ordren først for å koble kunden manuelt.`,
        kandidater: [],
      }, 422)
    }
    if (kundeResultat.status === 'flere_treff') {
      return jsonSvar({
        created: false,
        reason: `${kundeResultat.kandidater.length} Fiken-kunder har organisasjonsnummer ${kundeResultat.orgnr} - for usikkert å velge automatisk. Fakturer ordren først og velg riktig kunde der (kobles samtidig for godt), prøv så igjen.`,
        kandidater: kundeResultat.kandidater,
      }, 409)
    }

    const { contactId, navn: fikenKundeNavn } = kundeResultat
    const kontaktRes = await fikenFetch(`/companies/${slug}/contacts/${contactId}`)
    if (!kontaktRes.ok) return jsonSvar({ created: false, error: `Fiken /contacts/${contactId} svarte ${kontaktRes.status}: ${await kontaktRes.text()}` }, 502)
    const kontakt = (await kontaktRes.json()) as FikenKontakt
    const eksisterende = (kontakt.contactPerson || []).find((p) => (p.name || '').trim().toLowerCase() === navn.toLowerCase())
    if (eksisterende) {
      return jsonSvar({
        created: false,
        reason: `Kontaktperson «${eksisterende.name}» finnes allerede hos ${fikenKundeNavn} i Fiken`,
        contactId,
        contactPersonId: eksisterende.contactPersonId,
        fikenKundeNavn,
      }, 200)
    }

    const postRes = await fikenFetch(`/companies/${slug}/contacts/${contactId}/contactPerson`, {
      method: 'POST',
      body: JSON.stringify({ name: navn, email: epost }),
    })
    if (!postRes.ok) {
      return jsonSvar({ created: false, error: `Fiken avviste kontaktpersonen (${postRes.status}): ${await postRes.text()}` }, 502)
    }
    const location = postRes.headers.get('Location') || ''
    const contactPersonId = Number(location.split('/').filter(Boolean).pop())

    return jsonSvar({
      created: true,
      contactId,
      contactPersonId: Number.isFinite(contactPersonId) ? contactPersonId : null,
      navn,
      epost,
      fikenKundeNavn,
    }, 201)
  } catch (e) {
    return jsonSvar({ created: false, error: String(e) }, 500)
  }
})
