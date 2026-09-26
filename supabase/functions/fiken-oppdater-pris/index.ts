// Skriveverktøy (i motsetning til fiken-produkter, som kun leser): tar imot
// et produktnummer + ny pris fra Forhandlerportalen og oppdaterer samme
// produkts unitPrice i Fiken, slik at prisene i de to systemene holdes i
// synk når en admin endrer pris i Forhandlerportalen.
//
// Beskyttet med en delt hemmelighet (FIKEN_SYNC_SECRET, sendt som
// x-sync-secret-header) i tillegg til Supabase sin egen anon-nøkkel-sjekk -
// dette er et SKRIVENDE endepunkt mot det ekte regnskapssystemet, så det
// holder ikke med kun den vidt embedde anon-nøkkelen slik som for
// fiken-produkter (rent lese-verktøy).
//
// Fiken sin PUT /products/{id} erstatter HELE produktet, ikke en delvis
// oppdatering - henter derfor alltid det fullstendige produktet først og
// sender alle feltene tilbake med bare unitPrice endret, slik at
// navn/konto/mva-type/aktiv-status ikke blir nullstilt ved et uhell.
const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const SYNC_SECRET = Deno.env.get('FIKEN_SYNC_SECRET')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'

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
  unitPrice: number
  incomeAccount: string
  vatType: string
  active: boolean
  productNumber: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)
    if (!SYNC_SECRET) return jsonSvar({ error: 'Ingen delt hemmelighet (FIKEN_SYNC_SECRET) er satt opp ennå' }, 500)
    if (req.headers.get('x-sync-secret') !== SYNC_SECRET) {
      return jsonSvar({ error: 'Ugyldig eller manglende x-sync-secret' }, 401)
    }

    const body = await req.json().catch(() => null)
    const productNumber = typeof body?.productNumber === 'string' ? body.productNumber.trim() : ''
    const unitPriceKr =
      typeof body?.unitPriceKr === 'number' && Number.isFinite(body.unitPriceKr) ? body.unitPriceKr : null

    if (!productNumber || unitPriceKr === null || unitPriceKr < 0) {
      return jsonSvar({ error: 'Mangler eller ugyldig productNumber/unitPriceKr' }, 400)
    }

    let found: FikenProduct | null = null
    let page = 0
    while (true) {
      const res = await fikenFetch(`/companies/${FIKEN_SLUG}/products?page=${page}&pageSize=100`)
      if (!res.ok) return jsonSvar({ error: `Fiken /products svarte ${res.status}: ${await res.text()}` }, 502)
      const produkter = (await res.json()) as FikenProduct[]
      found = produkter.find((p) => String(p.productNumber) === productNumber) ?? null
      const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
      page++
      if (found || page >= pageCount) break
    }

    if (!found) {
      return jsonSvar({ synced: false, reason: `Fant ikke produktnummer ${productNumber} i Fiken` }, 404)
    }

    const oppdatertProdukt = {
      name: found.name,
      unitPrice: Math.round(unitPriceKr * 100),
      incomeAccount: found.incomeAccount,
      vatType: found.vatType,
      active: found.active,
      productNumber: found.productNumber,
    }

    const putRes = await fikenFetch(`/companies/${FIKEN_SLUG}/products/${found.productId}`, {
      method: 'PUT',
      body: JSON.stringify(oppdatertProdukt),
    })
    if (!putRes.ok) {
      return jsonSvar({ error: `Fiken PUT svarte ${putRes.status}: ${await putRes.text()}` }, 502)
    }

    return jsonSvar({ synced: true, productNumber, unitPriceKr })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
