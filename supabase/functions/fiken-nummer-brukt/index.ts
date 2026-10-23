// RENT LESEVERKTØY: forteller hvor et Fiken-produktnummer brukes i bestillingsappen (Salmaker'n), slik at Forhandlerportalen kan advare
// før en admin bytter nummer på eller deaktiverer et produkt. Bestillingsappen og faktureringen (fiken-fakturer) slår opp Fiken-produkter
// PÅ NUMMER: endres et nummer i Fiken, stopper faktureringen for det produktet («Fant ikke Fiken-produkt for produktnummer ...») til appen er oppdatert.
//
// Tre kilder:
// 1. Faste numre i bestillingsappens kode (FASTE_NUMRE under) - må holdes i takt med js/ordre-detalj.js (FIKEN_OMBYGGING_MODELLER, drivstoff)
//    og js/ansatte-utstyr.js (panorama, 4-seter 180, hengerfeste, utstyr-punkt per modell).
// 2. lager_oppskrifter.fiken_produktnummer (oppskrifter som skriver fakturalinjer).
// 3. ordrer.fiken_linjer for ordrer som IKKE er fakturert ennå (fakturagrunnlaget som sendes til Fiken).
// Beskyttet med den delte hemmeligheten (x-sync-secret) fordi svaret inneholder ordredata (regnr/kunde). Skriver aldri noe.
const SYNC_SECRET = Deno.env.get('FIKEN_SYNC_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

// Faste produktnumre i bestillingsappens kode (kontrollert 2026-10-22 mot js/ordre-detalj.js og js/ansatte-utstyr.js).
const FASTE_NUMRE: Record<string, string> = {
  '21': 'Drivstoff (fast fakturalinje)',
  '501': 'Panorama glasstak (KIA EV9)',
  '502': '4-seter bak 180 (KIA EV9)',
  '521': 'Hengerfeste',
  '500': 'Ombygging KIA EV9', '524': 'Ombygging til personbil KIA EV9',
  '200': 'Ombygging Land Rover Discovery 5', '229': 'Ombygging til personbil Discovery 5',
  '1400': 'Ombygging Land Rover Defender', '1415': 'Ombygging til personbil Defender',
  '300': 'Ombygging Mercedes Geländewagen', '318': 'Ombygging til personbil Geländewagen',
  '400': 'Ombygging Mercedes GLS', '417': 'Ombygging til personbil GLS',
  '1500': 'Ombygging Mercedes Vito', '1600': 'Ombygging Mercedes EQV', '1700': 'Ombygging Mercedes V-Klasse',
  '1800': 'Ombygging VW ID. Buzz', '1812': 'Ombygging til personbil VW ID. Buzz',
  '2400': 'Ombygging KGM Rexton', '2401': 'Ombygging KGM Rexton (Lafinto)',
  '2500': 'Ombygging Toyota Land Cruiser 250', '2508': 'Ombygging til personbil Land Cruiser 250',
  '308': 'Utstyr Geländewagen: DVD-skjermer', '302': 'Utstyr Geländewagen: Airbag 2. seterad',
  '306': 'Utstyr Geländewagen: Takluke', '309': 'Utstyr Geländewagen: Taktrekk i skinn',
  '401': 'Utstyr GLS: Klima i taket', '402': 'Utstyr GLS: Airbag', '403': 'Utstyr GLS: Koppholder i midtkonsoll',
  '404': 'Utstyr GLS: Subwoofer', '405': 'Utstyr GLS: DVD-skjermer',
  '1801': 'Utstyr VW ID. Buzz: Lang modell',
  '201': 'Utstyr Discovery 5: 5-seter bak', '202': 'Utstyr Discovery 5: Klima i taket',
  '204': 'Utstyr Discovery 5: AD', '205': 'Utstyr Discovery 5: Reservehjul',
}

const MAX_NUMBERS = 50
const MAX_REASONS = 8
const PAGE_SIZE = 1000

// Sortert på id og lest til en TOM side: uten sortering gir offset-paginering ingen garanti (rader kan hoppes over eller dobles når ordrer oppdateres underveis), og
// et lavere max-rows i prosjektet enn PAGE_SIZE ville stoppet løkken for tidlig hvis vi sluttet på «færre enn PAGE_SIZE».
async function rest(path: string): Promise<unknown[]> {
  const out: unknown[] = []
  for (let page = 0; page < 200; page++) {
    const offset = out.length
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${sep}order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!res.ok) throw new Error(`${path.split('?')[0]} svarte ${res.status}: ${await res.text()}`)
    const rows = (await res.json()) as unknown[]
    if (rows.length === 0) break
    out.push(...rows)
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonSvar({ error: 'Bare POST er støttet' }, 405)
  try {
    if (!SYNC_SECRET) return jsonSvar({ error: 'Ingen delt hemmelighet (FIKEN_SYNC_SECRET) er satt opp ennå' }, 500)
    if (req.headers.get('x-sync-secret') !== SYNC_SECRET) return jsonSvar({ error: 'Ugyldig eller manglende x-sync-secret' }, 401)
    if (!SUPABASE_URL || !SERVICE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)

    const body = await req.json().catch(() => null)
    const raw = Array.isArray(body?.productNumbers) ? body.productNumbers : null
    if (!raw || raw.length === 0 || raw.length > MAX_NUMBERS || raw.some((n: unknown) => typeof n !== 'string' || !n.trim() || n.length > 40)) {
      return jsonSvar({ ok: false, error: `productNumbers må være en liste med 1-${MAX_NUMBERS} produktnumre` }, 400)
    }
    const numbers = [...new Set<string>(raw.map((n: string) => n.trim()))]
    const brukt: Record<string, string[]> = Object.fromEntries(numbers.map((n) => [n, []]))
    const add = (nr: string, why: string) => {
      if (brukt[nr] && brukt[nr].length <= MAX_REASONS) brukt[nr].push(why)
    }

    for (const nr of numbers) {
      if (FASTE_NUMRE[nr]) add(nr, `Fast i bestillingsappens kode: ${FASTE_NUMRE[nr]}`)
    }

    const oppskrifter = (await rest('lager_oppskrifter?select=navn,fiken_produktnummer&fiken_produktnummer=not.is.null')) as { navn: string; fiken_produktnummer: string }[]
    for (const o of oppskrifter) {
      const nr = String(o.fiken_produktnummer ?? '').trim()
      if (brukt[nr]) add(nr, `Lager-oppskrift «${o.navn || 'uten navn'}»`)
    }

    const ordrer = (await rest('ordrer?select=id,regnr,kunde,fiken_linjer&fakturert=eq.false')) as {
      id: string
      regnr: string | null
      kunde: string | null
      fiken_linjer: { produktnummer?: string }[] | null
    }[]
    for (const o of ordrer) {
      const linjer = Array.isArray(o.fiken_linjer) ? o.fiken_linjer : []
      const sett = new Set(linjer.map((l) => String(l?.produktnummer ?? '').trim()))
      for (const nr of numbers) {
        if (sett.has(nr)) add(nr, `Ordre ${o.regnr || o.id}${o.kunde ? ` (${o.kunde})` : ''}, ikke fakturert ennå`)
      }
    }

    return jsonSvar({ ok: true, brukt, kilder: { oppskrifter: oppskrifter.length, ikkeFakturerteOrdrer: ordrer.length } })
  } catch (e) {
    return jsonSvar({ ok: false, error: String(e) }, 502)
  }
})
