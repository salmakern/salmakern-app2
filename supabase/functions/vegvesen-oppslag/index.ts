// Slår opp kjøretøydata hos Statens vegvesen sitt "enkeltoppslag"-API på vegne av
// klienten. Nøkkelen MÅ holdes server-side her - kaller klienten Statens vegvesen
// direkte, kan enhver som åpner utviklerverktøy i nettleseren lese ut og misbruke
// nøkkelen (delt kvote på 50 000 kall/døgn, knyttet til Henriks Altinn-identitet).
// Se https://autosys-kjoretoy-api.atlas.vegvesen.no/api-ui/index-enkeltoppslag.html
//
// Merk: denne tjenesten gir IKKE eierinformasjon (bekreftet i Statens vegvesen sin
// egen dokumentasjon) - ikke prøv å hente eier-navn herfra, det vil alltid mangle.

const VEGVESEN_API_KEY = Deno.env.get('VEGVESEN_API_KEY')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

const FN = 'vegvesen-oppslag'
// Oppslaget brukes av enhver innlogget ansatt (knappen i ordre-detalj), ikke bare admin - derfor alle kjente roller, ulikt fiken-fakturer/send-frakt-epost.
const TILLATTE_ROLLER = ['admin', 'godkjenner', 'ansatt', 'verneombud']
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const avvist = await innloggingsgate(req)
    if (avvist) return jsonSvar({ error: avvist.melding }, avvist.status)

    if (!VEGVESEN_API_KEY) {
      return jsonSvar({ error: 'Ingen API-nøkkel for Statens vegvesen er satt opp ennå' }, 500)
    }

    // req.json() har vist seg upålitelig på denne kjøretiden (kaster "Unexpected
    // end of JSON input" selv med en gyldig body) - les som tekst og parse selv,
    // samme mønster som send-push allerede bruker.
    const raw = await req.text()
    if (!raw) return jsonSvar({ error: 'Tom body' }, 400)
    const { regnr } = JSON.parse(raw)
    if (!regnr) return jsonSvar({ error: 'Mangler regnr' }, 400)

    const res = await fetch(
      `https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=${encodeURIComponent(regnr)}`,
      { headers: { 'SVV-Authorization': `Apikey ${VEGVESEN_API_KEY}` } }
    )
    if (!res.ok) return jsonSvar({ error: `Statens vegvesen svarte ${res.status}` }, 502)

    // Et gyldig, men ukjent/ikke-registrert reg.nr gir 200 OK med enten en tom body
    // eller ren tekst ("OPPLYSNINGER_IKKE_TILGJENGELIGE") - IKKE gyldig JSON. Les som
    // tekst og prøv å parse selv, i stedet for å anta res.json() alltid lykkes.
    const rawSvar = await res.text()
    let data: any
    try {
      data = rawSvar ? JSON.parse(rawSvar) : null
    } catch {
      return jsonSvar({ error: 'Ingen data funnet for dette reg.nr-et' }, 404)
    }
    const kjt = data?.kjoretoydataListe?.[0]
    if (!kjt) return jsonSvar({ error: 'Ingen data funnet for dette reg.nr-et' }, 404)

    const td = kjt.godkjenning?.tekniskGodkjenning?.tekniskeData
    const merke = td?.generelt?.merke?.[0]?.merke || ''
    const modell = td?.generelt?.handelsbetegnelse?.[0] || ''
    const aar = kjt.forstegangsregistrering?.registrertForstegangNorgeDato?.substring(0, 4) || ''
    const chassis = kjt.kjennemerke?.understellsnummer || ''

    return jsonSvar({ merke, modell, aar, chassis })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
