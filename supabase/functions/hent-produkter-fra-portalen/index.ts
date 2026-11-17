// Henter produktlista fra Forhandlerportalen (GET /api/salmakern/produktnumre) inn i portal_produkter (trinn 2 av «Én produktliste»,
// Henrik 17.11.2026). Portalen er fasit for produktnummer; appen bruker rollene (ombygging/personbil/lafinto per modell) til
// ombyggingslinjen på fakturaen, med den hardkodede lista i js/ordre-detalj.js bare som reserve. Bygget etter hent-rabatter-fra-portalen:
// samme innloggingssjekk (bare admin, håndheves når FN står i EDGE_AUTH_ENFORCE) og samme hemmelighet mot portalen (SALMAKERN_HENT_SECRET).
// Svaret valideres strengt i logikk.ts og avvises i sin helhet ved første brudd; lagringen er én atomisk rpc (portal_produkter_synk) som
// bytter ut hele lista og nekter en tom liste eller to varianter med samme rolle på samme modell.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { lesProduktliste } from './logikk.ts'

const PORTAL_URL = 'https://forhandler.salmaker.as/api/salmakern/produktnumre'
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

const FN = 'hent-produkter-fra-portalen'
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonSvar({ error: 'Bare POST' }, 405)
  try {
    const avvist = await innloggingsgate(req)
    if (avvist) return jsonSvar({ error: avvist.melding }, avvist.status)

    if (!PORTAL_SECRET) return jsonSvar({ error: 'Ingen delt hemmelighet mot portalen (SALMAKERN_HENT_SECRET) er satt opp' }, 500)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)

    const portalRes = await fetch(PORTAL_URL, { headers: { 'x-salmakern-hent-secret': PORTAL_SECRET }, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!portalRes.ok) return jsonSvar({ error: `Portalen svarte ${portalRes.status}` }, 502)
    const liste = lesProduktliste(await portalRes.json().catch(() => null))
    if (!liste) return jsonSvar({ error: 'Uventet eller ufullstendig produktliste fra portalen - avviser hele svaret, ingenting er endret' }, 502)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await supabase.rpc('portal_produkter_synk', { p: liste.rader })
    if (error) {
      const melding = error.message === 'DOBBEL_ROLLE'
        ? "To varianter på samme modell har samme «Brukes i Salmaker'n som» i portalen - rett det i portalen"
        : 'Kunne ikke lagre produktlista (ingenting er endret)'
      // Bare SQLSTATE og våre egne koder (aldri meldingsteksten fra databasen ellers), så en feil kan spores uten å røpe noe.
      const kode = (typeof error.code === 'string' ? error.code.slice(0, 12) : '') + (/^[A-Z_]{3,30}$/.test(String(error.message)) ? ':' + error.message : '')
      console.log(JSON.stringify({ fn: 'hent-produkter-fra-portalen', utfall: 'synk_feil', kode }))
      return jsonSvar({ error: melding, kode }, error.message === 'DOBBEL_ROLLE' ? 409 : 500)
    }
    return jsonSvar({ ok: true, ...data })
  } catch (e) {
    return jsonSvar({ error: 'Uventet feil: ' + (e instanceof Error ? e.name : 'ukjent') }, 500)
  }
})
