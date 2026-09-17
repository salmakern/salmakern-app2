// Rent lese-verktøy: henter fakturahistorikk fra Fiken og grupperer linjene per
// produktnummer, slik at Henrik/Claude kan se hvilke modeller som faktisk har blitt
// fakturert med hvilket produktnummer - nyttig grunnlag for produktnummer-opprydding.
// Ingen skriving. Samme auth/paginerings-mønster som fiken-produkter/fiken-fakturer.
//
// Fiken sitt LISTE-endepunkt (/invoices) returnerer linjene (inkl.
// productId/productName/description) direkte i hvert fakturaobjekt - ingen treg
// per-faktura-henting nødvendig, bare paginering over /invoices og /products.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

async function fikenFetch(path: string, init: RequestInit = {}) {
  return fetch(`${FIKEN_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${FIKEN_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)

    // productId -> produktnummer (linjene i fakturalisten har kun productId+productName,
    // ikke Fiken sitt menneskelesbare produktnummer).
    const idTilNummer = new Map<number, string>()
    {
      let page = 0
      while (true) {
        const res = await fikenFetch(`/companies/${FIKEN_SLUG}/products?page=${page}&pageSize=100`)
        if (!res.ok) return jsonSvar({ error: `Fiken /products svarte ${res.status}` }, 502)
        for (const p of await res.json()) {
          if (p.productId && p.productNumber) idTilNummer.set(p.productId, String(p.productNumber))
        }
        const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
        page++
        if (page >= pageCount) break
      }
    }

    type Treff = { navn: string; kunde: string; dato: string; orderReference: string }
    const grupper = new Map<string, Map<string, Treff[]>>() // produktnummer -> produktnavn -> treff[]

    let page = 0
    let antallFakturaer = 0
    while (true) {
      const res = await fikenFetch(`/companies/${FIKEN_SLUG}/invoices?page=${page}&pageSize=100`)
      if (!res.ok) return jsonSvar({ error: `Fiken /invoices svarte ${res.status}: ${await res.text()}` }, 502)
      const fakturaer = await res.json()
      antallFakturaer += fakturaer.length
      for (const f of fakturaer) {
        for (const l of f.lines || []) {
          const produktnummer = idTilNummer.get(l.productId)
          if (!produktnummer) continue
          const navn = l.productName || ''
          if (!grupper.has(produktnummer)) grupper.set(produktnummer, new Map())
          const navnMap = grupper.get(produktnummer)!
          if (!navnMap.has(navn)) navnMap.set(navn, [])
          navnMap.get(navn)!.push({
            navn,
            kunde: f.customer?.name || '',
            dato: f.issueDate || '',
            orderReference: f.orderReference || '',
          })
        }
      }
      const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
      page++
      if (page >= pageCount) break
    }

    const resultat = Array.from(grupper.entries())
      .map(([produktnummer, navnMap]) => ({
        produktnummer,
        varianter: Array.from(navnMap.entries()).map(([navn, treff]) => ({
          navn,
          antallFakturaer: treff.length,
          eksempler: treff.slice(0, 5),
        })),
      }))
      .sort((a, b) => String(a.produktnummer).localeCompare(String(b.produktnummer), 'nb', { numeric: true }))

    return jsonSvar({ antallFakturaer, antallProdukter: resultat.length, produkter: resultat })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
