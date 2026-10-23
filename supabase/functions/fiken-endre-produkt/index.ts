// Endrer PRODUKTNUMMER og/eller AKTIV-status på et EKSISTERENDE produkt i Fiken (regnskapssystemet). Brukes av Forhandlerportalen
// («Priser og Fiken»: bytte produktnr og «gjør inaktivt»/«aktiver igjen»). Søsken til fiken-oppdater-pris (pris) og fiken-opprett-produkt (nytt produkt).
//
// Beskyttet med en delt hemmelighet (FIKEN_SYNC_SECRET, sendt som x-sync-secret-header) i tillegg til Supabase sin egen anon-nøkkel-sjekk -
// dette er et SKRIVENDE endepunkt mot det ekte regnskapet.
//
// Trygghetsregler:
// - Endrer BARE det som er bedt om (nytt nummer og/eller aktiv). Navn, pris, konto og mva sendes tilbake uendret (Fikens PUT erstatter hele
//   produktet, så hele produktet hentes først, som i fiken-oppdater-pris).
// - Nytt nummer som allerede finnes i Fiken (også på et inaktivt produkt) avvises med 409. Ukjent produkt gir 404.
// - Hele produktlisten leses (alle sider) før noe skrives.
// - Produktet beholder sin interne produkt-id, så historikk (fakturalinjer m.m.) følger med. MERK: andre systemer som slår opp på nummer
//   (bestillingsappen) må oppdateres av den som endrer nummeret - portalen advarer før den kaller denne funksjonen.
const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const SYNC_SECRET = Deno.env.get('FIKEN_SYNC_SECRET')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'

const NUMBER_RE = /^[A-Za-z0-9._-]{1,40}$/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

async function fikenFetch(path: string, init?: RequestInit) {
  return fetch(`${FIKEN_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${FIKEN_API_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
}

type FikenProduct = {
  productId: number
  name: string
  unitPrice?: number
  incomeAccount: string
  vatType: string
  active: boolean
  productNumber: string
  note?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonSvar({ error: 'Bare POST er støttet' }, 405)
  try {
    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)
    if (!SYNC_SECRET) return jsonSvar({ error: 'Ingen delt hemmelighet (FIKEN_SYNC_SECRET) er satt opp ennå' }, 500)
    if (req.headers.get('x-sync-secret') !== SYNC_SECRET) {
      return jsonSvar({ error: 'Ugyldig eller manglende x-sync-secret' }, 401)
    }

    const body = await req.json().catch(() => null)
    const productNumber = typeof body?.productNumber === 'string' ? body.productNumber.trim() : ''
    const newProductNumber = typeof body?.newProductNumber === 'string' ? body.newProductNumber.trim() : null
    const active = typeof body?.active === 'boolean' ? body.active : null

    if (!NUMBER_RE.test(productNumber)) {
      return jsonSvar({ updated: false, error: 'Ugyldig produktnummer' }, 400)
    }
    if (newProductNumber === null && active === null) {
      return jsonSvar({ updated: false, error: 'Ingenting å endre (newProductNumber eller active må være satt)' }, 400)
    }
    if (newProductNumber !== null && !NUMBER_RE.test(newProductNumber)) {
      return jsonSvar({ updated: false, error: 'Ugyldig nytt produktnummer (bare bokstaver, tall, punktum, understrek og bindestrek, maks 40 tegn)' }, 400)
    }
    if (newProductNumber !== null && newProductNumber === productNumber) {
      return jsonSvar({ updated: false, error: 'Det nye produktnummeret er det samme som det gamle' }, 400)
    }

    // Les HELE listen (alle sider): produktet må finnes, og et nytt nummer må være ledig.
    let found: FikenProduct | null = null
    let conflict: FikenProduct | null = null
    let page = 0
    while (true) {
      const res = await fikenFetch(`/companies/${FIKEN_SLUG}/products?page=${page}&pageSize=100`)
      if (!res.ok) return jsonSvar({ error: `Fiken /products svarte ${res.status}: ${await res.text()}` }, 502)
      const produkter = (await res.json()) as FikenProduct[]
      for (const p of produkter) {
        const nr = String(p.productNumber ?? '')
        if (nr === productNumber) found = p
        if (newProductNumber !== null && nr === newProductNumber) conflict = p
      }
      const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
      page++
      if (page >= pageCount) break
    }

    if (!found) {
      return jsonSvar({ updated: false, reason: `Fant ikke produktnummer ${productNumber} i Fiken` }, 404)
    }
    if (conflict) {
      return jsonSvar({ updated: false, reason: `Produktnummer ${newProductNumber} finnes allerede i Fiken` }, 409)
    }

    // Alt annet sendes tilbake uendret (PUT erstatter hele produktet).
    const oppdatertProdukt: Record<string, unknown> = {
      name: found.name,
      incomeAccount: found.incomeAccount,
      vatType: found.vatType,
      active: active !== null ? active : found.active,
      productNumber: newProductNumber !== null ? newProductNumber : found.productNumber,
    }
    if (typeof found.unitPrice === 'number') oppdatertProdukt.unitPrice = found.unitPrice
    // Har produktet et notat i Fiken, tas det med (PUT erstatter hele produktet - ellers ville notatet blitt tomt). Feiler Fiken på feltet, skjer ingenting (502).
    if (typeof found.note === 'string' && found.note !== '') oppdatertProdukt.note = found.note

    const putRes = await fikenFetch(`/companies/${FIKEN_SLUG}/products/${found.productId}`, {
      method: 'PUT',
      body: JSON.stringify(oppdatertProdukt),
    })
    if (!putRes.ok) {
      return jsonSvar({ error: `Fiken PUT svarte ${putRes.status}: ${await putRes.text()}` }, 502)
    }

    return jsonSvar({
      updated: true,
      productNumber: oppdatertProdukt.productNumber,
      previousProductNumber: productNumber,
      active: oppdatertProdukt.active,
    })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
