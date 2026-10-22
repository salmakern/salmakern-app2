// Oppretter et NYTT produkt i Fiken (regnskapssystemet). Brukes av Forhandlerportalen når en admin legger inn en ny
// variant/et nytt tillegg med et produktnummer som ikke finnes i Fiken og bekrefter at det skal opprettes
// (og fra «Priser og Fiken»). Søsken til fiken-oppdater-pris (som bare endrer prisen på et produkt som finnes fra før).
//
// Beskyttet med en delt hemmelighet (FIKEN_SYNC_SECRET, sendt som x-sync-secret-header) i tillegg til Supabase sin egen
// anon-nøkkel-sjekk - dette er et SKRIVENDE endepunkt mot det ekte regnskapet.
//
// Trygghetsregler:
// - Skriver ALDRI over noe: finnes produktnummeret fra før (også som inaktivt produkt), avvises kallet med 409.
// - Gjetter aldri på kontoplan eller mva: det nye produktet får samme inntektskonto og mva-type som et REFERANSEPRODUKT
//   (standard «500», Varebilombygging av KIA EV9). Finnes ikke referanseproduktet, opprettes ingenting (422).
// - Hele produktlisten leses først (alle sider) - både for å sjekke at nummeret er ledig og for å finne referanseproduktet.
const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const SYNC_SECRET = Deno.env.get('FIKEN_SYNC_SECRET')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'

const DEFAULT_REFERENCE = '500'
const MAX_NAME_LENGTH = 100
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
  unitPrice: number
  incomeAccount: string
  vatType: string
  active: boolean
  productNumber: string
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
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const unitPriceKr = typeof body?.unitPriceKr === 'number' && Number.isFinite(body.unitPriceKr) ? body.unitPriceKr : null
    const referenceNumber =
      typeof body?.referenceProductNumber === 'string' && body.referenceProductNumber.trim()
        ? body.referenceProductNumber.trim()
        : DEFAULT_REFERENCE

    if (!NUMBER_RE.test(productNumber)) {
      return jsonSvar({ created: false, error: 'Ugyldig produktnummer (bare bokstaver, tall, punktum, understrek og bindestrek, maks 40 tegn)' }, 400)
    }
    // eslint-disable-next-line no-control-regex
    if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
      return jsonSvar({ created: false, error: `Navnet må være 1-${MAX_NAME_LENGTH} tegn uten linjeskift` }, 400)
    }
    if (unitPriceKr === null || unitPriceKr < 0 || unitPriceKr > 100_000_000) {
      return jsonSvar({ created: false, error: 'Mangler eller ugyldig unitPriceKr' }, 400)
    }
    if (!NUMBER_RE.test(referenceNumber)) {
      return jsonSvar({ created: false, error: 'Ugyldig referanseprodukt' }, 400)
    }

    // Les HELE listen (alle sider): nummeret må være ledig, og referanseproduktet må finnes.
    let existing: FikenProduct | null = null
    let reference: FikenProduct | null = null
    let page = 0
    while (true) {
      const res = await fikenFetch(`/companies/${FIKEN_SLUG}/products?page=${page}&pageSize=100`)
      if (!res.ok) return jsonSvar({ error: `Fiken /products svarte ${res.status}: ${await res.text()}` }, 502)
      const produkter = (await res.json()) as FikenProduct[]
      for (const p of produkter) {
        const nr = String(p.productNumber ?? '')
        if (nr === productNumber) existing = p
        if (nr === referenceNumber) reference = p
      }
      const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
      page++
      if (page >= pageCount) break
    }

    if (existing) {
      return jsonSvar({ created: false, reason: `Produktnummer ${productNumber} finnes allerede i Fiken` }, 409)
    }
    if (!reference || !reference.incomeAccount || !reference.vatType) {
      return jsonSvar({ created: false, reason: `Fant ikke referanseproduktet ${referenceNumber} (konto og mva hentes derfra)` }, 422)
    }

    const nyttProdukt = {
      name,
      unitPrice: Math.round(unitPriceKr * 100),
      incomeAccount: reference.incomeAccount,
      vatType: reference.vatType,
      active: true,
      productNumber,
    }
    const postRes = await fikenFetch(`/companies/${FIKEN_SLUG}/products`, { method: 'POST', body: JSON.stringify(nyttProdukt) })
    if (!postRes.ok) {
      return jsonSvar({ error: `Fiken POST svarte ${postRes.status}: ${await postRes.text()}` }, 502)
    }

    return jsonSvar({
      created: true,
      productNumber,
      unitPriceKr,
      incomeAccount: reference.incomeAccount,
      vatType: reference.vatType,
    })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
