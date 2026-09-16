// Rent lese-verktøy: henter HELE produktlisten fra Fiken (produktnummer + navn), slik at
// Henrik/Claude kan slå opp riktig produktnummer for nye modeller/varianter uten å måtte
// lete manuelt i Fiken sitt eget grensesnitt. Ingen skriving, ingen faktura-opprettelse -
// se fiken-fakturer for selve fakturerings-logikken (samme mønster for auth/paginering).
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

async function fikenFetch(path: string) {
  return fetch(`${FIKEN_BASE}${path}`, { headers: { 'Authorization': `Bearer ${FIKEN_API_KEY}` } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)

    const produkter: any[] = []
    let page = 0
    while (true) {
      const res = await fikenFetch(`/companies/${FIKEN_SLUG}/products?page=${page}&pageSize=100`)
      if (!res.ok) return jsonSvar({ error: `Fiken /products svarte ${res.status}: ${await res.text()}` }, 502)
      produkter.push(...(await res.json()))
      const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
      page++
      if (page >= pageCount) break
    }

    // unitPrice fra Fiken er i øre (samme enhet som brukes ved overstyrt beløp i
    // fiken-fakturer) - regnes om til kroner her for lesbarhet i svaret.
    const liste = produkter
      .filter((p: any) => p.productNumber)
      .map((p: any) => ({
        produktnummer: p.productNumber,
        navn: p.name || '',
        prisKr: typeof p.unitPrice === 'number' ? p.unitPrice / 100 : null,
        aktiv: p.active !== false,
      }))
      .sort((a: any, b: any) => String(a.produktnummer).localeCompare(String(b.produktnummer), 'nb', { numeric: true }))

    return jsonSvar({ antall: liste.length, produkter: liste })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
