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
// oppdatering - henter derfor alltid det fullstendige produktet først
// (GET /products/{id}) og sender ALLE skrivbare felt tilbake med bare
// unitPrice endret (se FULL-PUT under), slik at navn/konto/mva-type/aktiv,
// notat, lagerantall (stock) og kostpris (costPrice) aldri nullstilles.
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

// ── PRIS-AVVIK-SJEKK BEGIN (test/fiken-pris-avvik.test.js henter ut denne funksjonen og tester den isolert) ──
// Sammenligner i kroner (ikke øre) - begge sider kan ha blitt avrundet på vei gjennom en UI-visning, så
// en terskel på 1 øre unngår falske avvik fra ren flyttallsunøyaktighet uten å skjule ekte avvik (disse er
// i praksis alltid hele kroner i Fiken-produktlista).
function erPrisAvvik(forventetKr: number, faktiskKr: number): boolean {
  return Math.abs(forventetKr - faktiskKr) > 0.01
}
// ── PRIS-AVVIK-SJEKK END ──

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
    // forventetGammelPrisKr er valgfri (s04-005): sender kalleren den (prisen den selv TROR står i Fiken
    // fra før, f.eks. portalens egen lagrede verdi for produktet), sjekkes den mot Fikens FAKTISKE pris
    // før vi skriver. Avviker de, skrives INGENTING - svaret sier fra i stedet, slik at kalleren kan
    // spørre brukeren "Fiken-prisen er X, du skriver Y, fortsett?" og sende på nytt med bekreftAvvik:true.
    // Uten feltet (gamle/andre kallere) er oppførselen UENDRET - skriver alltid, akkurat som før.
    const forventetGammelPrisKr =
      typeof body?.forventetGammelPrisKr === 'number' && Number.isFinite(body.forventetGammelPrisKr)
        ? body.forventetGammelPrisKr
        : null
    const bekreftAvvik = body?.bekreftAvvik === true

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

    // Det fulle produktet rett før skriving (listen kan mangle felt, og produktet kan være endret siden).
    const hentet = await hentProdukt(found.productId)
    if (!hentet.ok) return jsonSvar({ error: hentet.feil }, 502)
    const fullt = hentet.produkt
    const gammelOre = fullt.unitPrice
    if (String(fullt.productNumber ?? '') !== productNumber || typeof gammelOre !== 'number') {
      return jsonSvar({ synced: false, reason: `Produktet med nummer ${productNumber} ble endret i Fiken mens vi leste det - prøv igjen` }, 409)
    }

    const faktiskGammelPrisKr = gammelOre / 100
    if (forventetGammelPrisKr !== null && !bekreftAvvik && erPrisAvvik(forventetGammelPrisKr, faktiskGammelPrisKr)) {
      // Skriver INGENTING - produktnummeret kan peke på feil produkt (skrivefeil), eller noen har endret
      // prisen direkte i Fiken siden sist. Kalleren spør brukeren og sender samme kall på nytt med
      // bekreftAvvik:true for å overstyre, eller lar være.
      return jsonSvar(
        { synced: false, avvik: true, productNumber, faktiskGammelPrisKr, forventetGammelPrisKr, nyPrisKr: unitPriceKr },
        409
      )
    }

    // Alt annet (navn, konto, mva, aktiv, notat, stock, costPrice ...) sendes tilbake uendret.
    const oppdatertProdukt = byggPutBody(fullt, { unitPrice: Math.round(unitPriceKr * 100) })

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
