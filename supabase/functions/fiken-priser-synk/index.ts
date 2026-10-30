// Fyller den lokale tabellen fiken_priser med Fiken sine produktpriser, slik at prislåsen
// (oppdater_ordre_fiken_linje/_ved_id, migrasjon 20261030220000) kan fryse pris+mva på en
// fakturalinje uten å gjøre et live Fiken-kall for hver avkrysning i Lager/Utstyr.
//
// Kalles KUN av den planlagte cron-jobben (pg_cron, "fiken-priser-synk-cron") - se
// supabase/README.md. Ikke tenkt kalt fra appen eller portalen. Egen hemmelighet
// (FIKEN_PRISER_SYNK_SECRET), ikke FIKEN_SYNC_SECRET - ingen grunn til å dele den videre
// enn nødvendig siden denne funksjonen skriver til databasen, ikke bare leser.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SYNC_SECRET = Deno.env.get('FIKEN_PRISER_SYNK_SECRET')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function fikenFetch(path: string) {
  return fetch(`${FIKEN_BASE}${path}`, { headers: { Authorization: `Bearer ${FIKEN_API_KEY}` } })
}

Deno.serve(async (req) => {
  try {
    if (!SYNC_SECRET || req.headers.get('x-sync-secret') !== SYNC_SECRET) {
      return jsonSvar({ error: 'Ugyldig eller manglende x-sync-secret' }, 401)
    }
    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)

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

    // unitPrice fra Fiken er i øre - regnes om til kroner, samme som fiken-produkter.
    const rader = produkter
      .filter((p: any) => p.productNumber && typeof p.unitPrice === 'number')
      .map((p: any) => ({
        produktnummer: String(p.productNumber),
        navn: p.name || '',
        pris_kr: p.unitPrice / 100,
        mva_type: p.vatType || null,
        konto: p.incomeAccount || null,
        oppdatert_at: new Date().toISOString(),
      }))

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    // Batch-skriving (ett upsert), ikke én rad om gangen - samme mønster som ellers i appen.
    const { error } = await supabase.from('fiken_priser').upsert(rader, { onConflict: 'produktnummer' })
    if (error) return jsonSvar({ error: 'Kunne ikke lagre prisene: ' + error.message }, 500)

    return jsonSvar({ ok: true, antall: rader.length })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
