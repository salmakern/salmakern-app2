// Oppretter en faktura-KLADD i Fiken fra en ordre sine fikenLinjer - aldri en ferdig
// sendt faktura. Henrik godkjenner/sender selv inne i Fiken (se CLAUDE.md-diskusjonen
// om hvorfor: en faktura til en ekte kunde er en irreversibel handling som skal ha et
// menneske i loopen, i alle fall til koblingen har bevist seg over tid).
//
// Kundematching: Fiken sitt API har KUN eksakt navnesøk (bekreftet i api.fiken.no sin
// egen spec, ikke en antakelse) - det finnes ingen fuzzy-match som kunne koblet
// "BOS Drammen" (kortnavn brukt i Salmakern-appen) mot "Bertel O. Steen Drammen" (det
// virkelige navnet i Fiken) automatisk. Løsningen er tabellen fiken_kunde_alias: første
// gang et kundenavn dukker opp uten kjent kobling, sender vi tilbake hele kundelisten
// (customer=true) så en admin kan velge riktig kontakt selv - da huskes koblingen for
// godt, og senere fakturaer for samme kundenavn løses automatisk uten å spørre igjen.
//
// FIKEN_API_KEY er en personlig API-nøkkel (Bearer-token) - satt som Supabase-
// hemmelighet, ALDRI i klientkoden (samme begrunnelse som vegvesen-oppslag).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

async function fikenFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${FIKEN_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${FIKEN_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  return res
}

// Nøkkelen kan ha tilgang til FLERE foretak (bekreftet i praksis - Henrik sin
// personlige nøkkel dekker også to andre, ubeslektede selskaper) - plukk ALDRI bare
// første treff. Vi vil alltid og bare ha Telemark Salmakerverksted.
const FIKEN_SLUG = 'telemark-salmakerverksted'
async function hentCompanySlug(): Promise<string> {
  const res = await fikenFetch('/companies')
  if (!res.ok) throw new Error(`Fiken /companies svarte ${res.status}`)
  const selskaper = await res.json()
  const match = (selskaper || []).find((s: any) => s.slug === FIKEN_SLUG)
  if (!match) throw new Error(`Fant ikke foretaket "${FIKEN_SLUG}" blant selskapene nøkkelen har tilgang til`)
  return match.slug
}

// "produktnummer" i Salmakern-appen er Fiken sitt EGET, menneskelesbare produktnummer-
// felt (f.eks. "21" for Drivstoff) - IKKE det samme som Fiken sin interne numeriske
// productId (f.eks. 8497364290) som selve faktura-API-et faktisk krever i lines[].
// Bekreftet ved en ekte 404 ("Missing product with id 21") i testing - må alltid slå
// opp riktig productId via produktlisten før en kladd opprettes.
async function hentProduktnummerTilId(slug: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  let page = 0
  while (true) {
    const res = await fikenFetch(`/companies/${slug}/products?page=${page}&pageSize=100`)
    if (!res.ok) throw new Error(`Fiken /products svarte ${res.status}`)
    const produkter = await res.json()
    for (const p of produkter) {
      if (p.productNumber) map.set(String(p.productNumber), p.productId)
    }
    const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
    page++
    if (page >= pageCount) break
  }
  return map
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)

    const raw = await req.text()
    if (!raw) return jsonSvar({ error: 'Tom body' }, 400)
    const { kundeNavn, kontaktpersonNavn, linjer, bekreftetContactId, bekreftetFikenNavn, bekreftetAv } = JSON.parse(raw)
    if (!kundeNavn) return jsonSvar({ error: 'Mangler kundeNavn' }, 400)
    if (!Array.isArray(linjer) || !linjer.length) return jsonSvar({ error: 'Mangler fakturalinjer' }, 400)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    let contactId: number | null = null

    const { data: alias } = await supabase
      .from('fiken_kunde_alias')
      .select('fiken_contact_id')
      .eq('alias', kundeNavn)
      .maybeSingle()

    if (alias) {
      contactId = alias.fiken_contact_id
    } else if (bekreftetContactId) {
      contactId = bekreftetContactId
      const { error: upsertErr } = await supabase.from('fiken_kunde_alias').upsert({
        alias: kundeNavn,
        fiken_contact_id: bekreftetContactId,
        fiken_navn: bekreftetFikenNavn || '',
        bekreftet_av: bekreftetAv || '',
      }, { onConflict: 'alias' })
      if (upsertErr) return jsonSvar({ error: 'Kunne ikke lagre kunde-koblingen: ' + upsertErr.message }, 500)
    } else {
      // Ukjent kundenavn - Fiken sitt navnesøk er eksakt match, ikke fuzzy, så det
      // hjelper ikke å søke på "kundeNavn" direkte. Send heller hele kundelisten
      // tilbake, så admin kan velge riktig kontakt selv i UI-et. MÅ hente ALLE sider -
      // Henrik har 218 kundekontakter (over 2 sider), og en ny/nylig opprettet kontakt
      // havner ofte utenfor side 0 - bekreftet i praksis da TEST-kontakten manglet.
      const slug = await hentCompanySlug()
      const kontakter: any[] = []
      let page = 0
      while (true) {
        const res = await fikenFetch(`/companies/${slug}/contacts?customer=true&page=${page}&pageSize=100`)
        if (!res.ok) return jsonSvar({ error: `Fiken /contacts (slug=${slug}) svarte ${res.status}: ${await res.text()}` }, 502)
        kontakter.push(...(await res.json()))
        const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
        page++
        if (page >= pageCount) break
      }
      return jsonSvar({
        needsBekreftelse: true,
        kandidater: kontakter.map((k: any) => ({ contactId: k.contactId, navn: k.name })),
      })
    }

    const slug = await hentCompanySlug()
    const produktMap = await hentProduktnummerTilId(slug)
    const ukjente = linjer.map((l: any) => l.produktnummer).filter((n: string) => !produktMap.has(String(n)))
    if (ukjente.length) return jsonSvar({ error: `Fant ikke Fiken-produkt for produktnummer: ${ukjente.join(', ')}` }, 400)

    // Kontaktperson (o.eier i appen, kalt "Kontaktperson" i PDF-rapporten) - kobles KUN
    // hvis en person med samme navn allerede finnes registrert på denne Fiken-kontakten.
    // Fiken krever navn+e-post for å OPPRETTE en kontaktperson, og appen har ingen e-post
    // lagret på "eier" - så vi oppretter aldri en ny, bare bruker en som Henrik har lagt
    // inn i Fiken fra før (bekreftet at han allerede har gjort dette for flere kunder).
    let contactPersonId: number | undefined
    if (kontaktpersonNavn) {
      const kontaktRes = await fikenFetch(`/companies/${slug}/contacts/${contactId}`)
      if (kontaktRes.ok) {
        const kontakt = await kontaktRes.json()
        const treff = (kontakt.contactPerson || []).find((p: any) => (p.name || '').toLowerCase() === kontaktpersonNavn.toLowerCase())
        if (treff) contactPersonId = treff.contactPersonId
      }
    }

    const idag = new Date().toISOString().slice(0, 10)
    const draftBody = {
      type: 'invoice',
      customerId: contactId,
      ...(contactPersonId ? { contactPersonId } : {}),
      daysUntilDueDate: 14,
      issueDate: idag,
      lines: linjer.map((l: any) => {
        const line: Record<string, unknown> = { productId: produktMap.get(String(l.produktnummer)), quantity: l.antall || 1 }
        if (l.belop !== undefined && l.belop !== null) {
          line.unitPrice = Math.round(Number(l.belop) * 100)
          line.vatType = 'high' // 25% - alltid, uavhengig av drivstoff-satsen som ga beløpet (bekreftet av Henrik)
        }
        return line
      }),
    }

    const draftRes = await fikenFetch(`/companies/${slug}/invoices/drafts`, {
      method: 'POST',
      body: JSON.stringify(draftBody),
    })
    if (!draftRes.ok) {
      const feiltekst = await draftRes.text()
      return jsonSvar({ error: `Fiken avviste kladden (${draftRes.status}): ${feiltekst}` }, 502)
    }

    return jsonSvar({ ok: true, draftUrl: draftRes.headers.get('Location') || '' }, 201)
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
