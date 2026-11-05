// Henter selgere fra Forhandlerportalen inn i Kontakter sine kontaktpersoner (5.11, Henriks
// ja i Salmaker'n-økta: "Ja, bygg det nå (lokalt)" - IKKE utrullet ennå). Appen HENTER
// (pull), portalen EIER selgerne. Selve matchingen/sammenslåingen skjer atomisk i
// portal_selgere_synk (se migrasjon 20261105120000) - denne funksjonen er bare døra inn:
// henter fra portalen, sender videre til databasefunksjonen, returnerer rapporten.
//
// To slags legitime kallere (samme mønster som send-push sin server-kategori):
//  - En innlogget admin som trykker "Hent selgere fra portalen" i Kontakter (vanlig
//    ansatt-token, den delte EDGE-AUTH-GATEN under).
//  - pg_cron hver halvtime, med en EGEN delt hemmelighet (x-server-secret mot
//    HENT_SELGERE_SERVER_SECRET) - ingen ansatt-sesjon finnes da.
//
// Portalens endepunkt: GET https://forhandler.salmaker.as/api/salmakern/selgere med header
// x-salmakern-hent-secret (EGEN hemmelighet - gir persondata, derfor ALDRI gjenbruk av
// SALMAKERN_STATUS_SECRET, etter avtale med portal-økta). Svarformen er avtalt kontrakt:
// { ok: true, generert, forhandlere: [{ kontakt_id, kontakt_navn, orgnr, selgere: [{portal_id, navn, epost}] }] }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const PORTAL_URL = 'https://forhandler.salmaker.as/api/salmakern/selgere'
const PORTAL_SECRET = Deno.env.get('SALMAKERN_HENT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-server-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

const FN = 'hent-selgere-fra-portalen'
const TILLATTE_ROLLER = ['admin']
// ── EDGE-AUTH-GATE BEGIN (samme blokk som fiken-fakturer/send-frakt-epost/vegvesen-oppslag/
// send-push, se de for den fulle begrunnelsen - IKKE i deres delte byte-lik-test ennå, siden
// dette er en helt ny funksjon, men samme oppførsel) ──
const HAANDHEV = (Deno.env.get('EDGE_AUTH_ENFORCE') ?? '').split(',').map((s) => s.trim()).some((s) => s === '*' || s === FN)
const JWT_FORM = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/

type Sjekk = { via: 'ansatt' | 'ikke_tillatt_rolle' | 'ingen' | 'ukjent'; grunn?: string; rolle?: string; ansattId?: number }

async function sjekkAnsatt(req: Request): Promise<Sjekk> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { via: 'ingen', grunn: 'ingen_header' }
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

// ── SERVER-KALLER (cron) - samme mønster som send-push sin server-kategori ──
async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
}
async function erServerKall(req: Request): Promise<boolean> {
  const hemmelighet = Deno.env.get('HENT_SELGERE_SERVER_SECRET') ?? ''
  const sendt = (req.headers.get('x-server-secret') ?? '').trim()
  if (hemmelighet.length < 32 || !sendt) return false
  const [a, b] = await Promise.all([sha256(sendt), sha256(hemmelighet)])
  let avvik = 0
  for (let i = 0; i < a.length; i++) avvik |= a[i] ^ b[i]
  return avvik === 0
}
async function selgereGate(req: Request): Promise<{ status: number; melding: string } | null> {
  let server = false
  try { server = await erServerKall(req) } catch { /* la den delte gaten avgjøre */ }
  if (!server) return innloggingsgate(req)
  console.log(JSON.stringify({ edge_auth: 1, fn: FN, via: 'server', grunn: 'delt_hemmelighet', rolle: '', ansatt_id: null, haandhevet: HAANDHEV, origin: req.headers.get('origin') ?? '' }))
  return null
}
// ── SERVER-KALLER END ──

type PortalSvar = {
  ok: boolean
  // utelatte_dubletter telles av portalen selv (samme e-post på flere brukere - laveste
  // portal_id vinner der, resten telles her) - vi sjekker den ikke mot noe her, bare tar imot.
  antall: { forhandlere: number; selgere: number; utelatte_dubletter?: number }
  forhandlere: Array<{ kontakt_id: string; kontakt_navn: string; orgnr: string | null; selgere: Array<{ portal_id: string; navn: string; epost: string }> }>
}

// navn/kontakt_navn er ALLTID strenger fra portalen (tom streng hvis ukjent, aldri null -
// avtalt 5.11 etter at en tidligere null-verdi for en navnløs selger/forhandler avviste HELE
// svaret her). En tom streng er fortsatt gyldig på dette nivået - selve matchingen
// (portal_selgere_synk) håndterer det videre uten å opprette en kontaktperson uten navn.
function gyldigPortalSvar(x: any): x is PortalSvar {
  return !!x && x.ok === true
    && typeof x?.antall?.forhandlere === 'number' && typeof x?.antall?.selgere === 'number'
    && Array.isArray(x.forhandlere) && x.forhandlere.every((f: any) =>
      typeof f?.kontakt_id === 'string' && typeof f?.kontakt_navn === 'string' && Array.isArray(f?.selgere) &&
      f.selgere.every((s: any) => typeof s?.portal_id === 'string' && typeof s?.navn === 'string' && typeof s?.epost === 'string')
    )
}

// Portalens eget antall-felt må stemme med den faktiske listen den sendte - en ekte, men
// avkuttet/mistenkelig liten respons (f.eks. en feil på portalens side som gir et tomt
// forhandlere-array) skal IKKE kunne tømme kontaktpersoner stille. Dette er en intern
// konsistenssjekk (fanger opp et brutt/avkuttet svar), ikke en sammenligning mot historikk.
function antallStemmer(x: PortalSvar): boolean {
  const faktiskeSelgere = x.forhandlere.reduce((sum, f) => sum + f.selgere.length, 0)
  return x.antall.forhandlere === x.forhandlere.length && x.antall.selgere === faktiskeSelgere
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const avvist = await selgereGate(req)
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
    const { data, error } = await supabase.rpc('portal_selgere_synk', {
      p_forhandlere: portalData.forhandlere.map((f) => ({
        kontakt_id: f.kontakt_id, kontakt_navn: f.kontakt_navn,
        selgere: f.selgere.map((s) => ({ portal_id: s.portal_id, navn: s.navn, epost: s.epost })),
      })),
    })
    if (error) return jsonSvar({ error: 'Kunne ikke lagre: ' + error.message }, 500)

    return jsonSvar({ ok: true, antallForhandlere: portalData.forhandlere.length, ...data })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
