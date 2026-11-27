// Endrer PRODUKTNUMMER og/eller AKTIV-status på et EKSISTERENDE produkt i Fiken (regnskapssystemet). Brukes av Forhandlerportalen
// («Priser og Fiken»: bytte produktnr og «gjør inaktivt»/«aktiver igjen»). Søsken til fiken-oppdater-pris (pris) og fiken-opprett-produkt (nytt produkt).
//
// Beskyttet med en delt hemmelighet (FIKEN_SYNC_SECRET, sendt som x-sync-secret-header) i tillegg til Supabase sin egen anon-nøkkel-sjekk -
// dette er et SKRIVENDE endepunkt mot det ekte regnskapet.
//
// Trygghetsregler:
// - Endrer BARE det som er bedt om (nytt nummer og/eller aktiv). Alt annet (navn, pris, konto, mva, notat, stock, costPrice ...) sendes
//   tilbake uendret: Fikens PUT erstatter hele produktet, så det fulle produktet hentes med GET /products/{id} rett før PUT (FULL-PUT under).
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

// ── FULL-PUT BEGIN (byte-lik i fiken-oppdater-pris og fiken-endre-produkt; test/fiken-full-put.test.js vokter mot avvik) ──
// Fikens PUT /products/{id} erstatter HELE produktet: et felt som ikke sendes, blir tomt (OpenAPI: «stock: If not provided, stock value
// is set to null»). Før 26.11 sendte denne funksjonen bare et utvalg felt, og nullet dermed stock (lagerantall) og costPrice (kostpris) på
// hvert produkt den endret (Henger igjen s00-20261126-2). Nå hentes det fulle produktet med GET /products/{id} rett før PUT, og ALT som
// kan skrives sendes tilbake uendret; bare feltene i `endringer` byttes. Samme regel som byggPutBody i fiken-rett-produktnavn.
const SKRIVEBESKYTTET = ['productId', 'createdDate', 'lastModifiedDate', 'unitPricesInForeignCurrency']

function byggPutBody(produkt: Record<string, unknown>, endringer: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(produkt)) {
    if (SKRIVEBESKYTTET.includes(k)) continue
    body[k] = v
  }
  return { ...body, ...endringer }
}

async function hentProdukt(productId: number): Promise<{ ok: true; produkt: Record<string, unknown> } | { ok: false; feil: string }> {
  const res = await fikenFetch(`/companies/${FIKEN_SLUG}/products/${productId}`)
  if (!res.ok) return { ok: false, feil: `Fiken GET /products/${productId} svarte ${res.status}: ${await res.text()}` }
  const produkt = await res.json().catch(() => null)
  if (!produkt || typeof produkt !== 'object' || Array.isArray(produkt)) return { ok: false, feil: `Fiken GET /products/${productId} ga ikke et produkt` }
  return { ok: true, produkt }
}
// ── FULL-PUT END ──

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
    // Fiken tillater flere produkter med SAMME produktnummer (ekte kollisjoner funnet 31.10,
    // f.eks. 553 "Oppbevaringskasse standard" til både 6600 og 6900 kr) - uten en entydig id
    // å style etter (denne funksjonen tar bare nummer, ikke Fikens interne productId) må en
    // kaller som treffer flere rader oppgi PRISEN på raden den faktisk mener, ellers nekter vi
    // å gjette. Samme "spør i stedet for å anta"-prinsipp som forventetGammelPrisKr i
    // fiken-oppdater-pris (s04-005).
    const expectedUnitPriceKr =
      typeof body?.expectedUnitPriceKr === 'number' && Number.isFinite(body.expectedUnitPriceKr)
        ? body.expectedUnitPriceKr
        : null

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
    const treff: FikenProduct[] = []
    let conflict: FikenProduct | null = null
    let page = 0
    while (true) {
      const res = await fikenFetch(`/companies/${FIKEN_SLUG}/products?page=${page}&pageSize=100`)
      if (!res.ok) return jsonSvar({ error: `Fiken /products svarte ${res.status}: ${await res.text()}` }, 502)
      const produkter = (await res.json()) as FikenProduct[]
      for (const p of produkter) {
        const nr = String(p.productNumber ?? '')
        if (nr === productNumber) treff.push(p)
        if (newProductNumber !== null && nr === newProductNumber) conflict = p
      }
      const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
      page++
      if (page >= pageCount) break
    }

    if (treff.length === 0) {
      return jsonSvar({ updated: false, reason: `Fant ikke produktnummer ${productNumber} i Fiken` }, 404)
    }
    let found: FikenProduct = treff[0]
    if (treff.length > 1) {
      if (expectedUnitPriceKr === null) {
        return jsonSvar(
          {
            updated: false,
            avvik: true,
            reason: `${treff.length} produkter deler produktnummer ${productNumber} - oppgi expectedUnitPriceKr for å si hvilket du mener`,
            treff: treff.map((p) => ({ navn: p.name, unitPriceKr: typeof p.unitPrice === 'number' ? p.unitPrice / 100 : null, active: p.active })),
          },
          409
        )
      }
      const entydige = treff.filter((p) => typeof p.unitPrice === 'number' && p.unitPrice === Math.round(expectedUnitPriceKr * 100))
      if (entydige.length !== 1) {
        return jsonSvar(
          {
            updated: false,
            reason: `expectedUnitPriceKr=${expectedUnitPriceKr} matcher ${entydige.length} av de ${treff.length} produktene på nummer ${productNumber} - må matche nøyaktig én`,
            treff: treff.map((p) => ({ navn: p.name, unitPriceKr: typeof p.unitPrice === 'number' ? p.unitPrice / 100 : null, active: p.active })),
          },
          409
        )
      }
      found = entydige[0]
    }
    if (conflict) {
      return jsonSvar({ updated: false, reason: `Produktnummer ${newProductNumber} finnes allerede i Fiken` }, 409)
    }

    // Det fulle produktet rett før skriving (listen kan mangle felt, og produktet kan være endret siden).
    const hentet = await hentProdukt(found.productId)
    if (!hentet.ok) return jsonSvar({ error: hentet.feil }, 502)
    const fullt = hentet.produkt
    if (String(fullt.productNumber ?? '') !== productNumber || fullt.unitPrice !== found.unitPrice) {
      return jsonSvar({ updated: false, reason: `Produktet med nummer ${productNumber} ble endret i Fiken mens vi leste det - prøv igjen` }, 409)
    }

    // Alt annet sendes tilbake uendret (PUT erstatter hele produktet). Bare nummer og/eller aktiv byttes.
    const endringer: Record<string, unknown> = {}
    if (active !== null) endringer.active = active
    if (newProductNumber !== null) endringer.productNumber = newProductNumber
    const oppdatertProdukt = byggPutBody(fullt, endringer)

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
