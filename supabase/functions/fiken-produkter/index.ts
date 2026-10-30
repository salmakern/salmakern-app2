// Rent lese-verktøy: henter HELE produktlisten fra Fiken (produktnummer + navn), slik at
// Henrik/Claude kan slå opp riktig produktnummer for nye modeller/varianter uten å måtte
// lete manuelt i Fiken sitt eget grensesnitt. Ingen skriving, ingen faktura-opprettelse -
// se fiken-fakturer for selve fakturerings-logikken (samme mønster for auth/paginering).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'

// Beskyttelse (innført 2026-10-29): bare server-til-server-kallere (Forhandlerportalen, nattlig QA, manuelle verktøy) bruker
// denne funksjonen, og de kan holde en hemmelighet: x-sync-secret = FIKEN_SYNC_SECRET, som de andre Fiken-funksjonene.
// MYK MODUS til portalen og QA-en sender hemmeligheten: kall uten den slippes gjennom, men logges (JSON-linje med
// edge_auth: 1). Håndheving slås på uten ny utrulling ved å legge funksjonsnavnet (eller *) i Supabase-hemmeligheten
// EDGE_AUTH_ENFORCE (kommaliste); fjern det igjen for å rulle tilbake.
const FN = 'fiken-produkter'
const SYNC_SECRET = Deno.env.get('FIKEN_SYNC_SECRET')
const HAANDHEV = (Deno.env.get('EDGE_AUTH_ENFORCE') ?? '').split(',').map((s) => s.trim()).some((s) => s === '*' || s === FN)

async function likt(a: string, b: string): Promise<boolean> {
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
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
    const sendt = req.headers.get('x-sync-secret') ?? ''
    const godkjent = !!SYNC_SECRET && sendt !== '' && (await likt(sendt, SYNC_SECRET))
    // Én logglinje per kall (aldri verdier): hvem som kaller uten hemmelighet vises her før håndheving slås på.
    console.log(JSON.stringify({ edge_auth: 1, fn: FN, via: godkjent ? 'server' : 'legacy', haandhevet: HAANDHEV, har_header: sendt !== '', origin: req.headers.get('origin') ?? '' }))
    if (!godkjent && HAANDHEV) {
      if (!SYNC_SECRET) return jsonSvar({ error: 'Ingen delt hemmelighet (FIKEN_SYNC_SECRET) er satt opp ennå' }, 500)
      return jsonSvar({ error: 'Ugyldig eller manglende x-sync-secret' }, 401)
    }

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
        mva: p.vatType || null,
        aktiv: p.active !== false,
        konto: p.incomeAccount || null,
        productId: p.productId,
      }))
      .sort((a: any, b: any) => String(a.produktnummer).localeCompare(String(b.produktnummer), 'nb', { numeric: true }))

    return jsonSvar({ antall: liste.length, produkter: liste })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
