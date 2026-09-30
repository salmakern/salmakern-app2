// Oppretter et BOKFØRT kjøpsbilag i Fiken fra et dokument som ligger i Fiken sin
// regnskapsinnboks (typisk en EHF-faktura eller en fotografert kvittering).
//
// VIKTIG FORSKJELL fra fiken-fakturer (salgssiden): et kjøp opprettet via Fiken sitt
// API kan IKKE slettes eller endres i ettertid via API-et (bekreftet mot Fiken sin
// egen OpenAPI-spec - /purchases/{purchaseId} har kun GET, ingen PUT/DELETE). Dette
// er derfor en reell, permanent bokføring i det øyeblikket den opprettes - ikke en
// kladd. Skal ALDRI kalles uten at Henrik har sett og godkjent nøyaktig hva som skal
// opprettes for det aktuelle bilaget først (se samtalen 2026-09-18).
//
// Leverandørmatching: samme mønster som fiken_kunde_alias for kunder - Fiken sitt
// kontaktsøk er eksakt match, ikke fuzzy. Ukjent leverandørnavn returnerer
// needsBekreftelse med full leverandørliste, admin velger riktig kontakt én gang,
// koblingen huskes i fiken_leverandor_alias for godt.
//
// Vedlegg: dokumentet ligger allerede lagret hos Fiken (det kom derfra i utgangspunktet
// - en ubehandlet innboks-fil). Vi laster det derfor ned fra Fiken sin egen documentUrl
// og legger det ved det nyopprettede kjøpet, i stedet for å sende bildebytes gjennom
// klienten på nytt.
//
// FIKEN_API_KEY er en personlig API-nøkkel (Bearer-token) - satt som Supabase-
// hemmelighet, ALDRI i klientkoden (samme begrunnelse som de andre Fiken-funksjonene).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'
// Fiken sin interne bankkontokode for firmaets driftskonto, brukt til å markere et
// kjøp som betalt (paymentAccount-feltet på purchaseRequest). Bekreftet ved å lese
// payments[].account tilbake på ekte, allerede bokførte kjøp under bankavstemmingen.
const FIKEN_BETALINGSKONTO = '1920:10001'

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

// Samme begrunnelse som i fiken-fakturer: nøkkelen har tilgang til flere foretak,
// plukk aldri bare første treff.
async function hentCompanySlug(): Promise<string> {
  const res = await fikenFetch('/companies')
  if (!res.ok) throw new Error(`Fiken /companies svarte ${res.status}`)
  const selskaper = await res.json()
  const match = (selskaper || []).find((s: any) => s.slug === FIKEN_SLUG)
  if (!match) throw new Error(`Fant ikke foretaket "${FIKEN_SLUG}" blant selskapene nøkkelen har tilgang til`)
  return match.slug
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)

    // Rent lese-verktøy for å bekrefte en allerede opprettet bokføring - f.eks.
    // ?verify=14172216742 - ingen skriving, bare GET videreformidlet fra Fiken.
    const url = new URL(req.url)
    const verifyId = url.searchParams.get('verify')
    if (verifyId) {
      const slugV = await hentCompanySlug()
      const verifyRes = await fikenFetch(`/companies/${slugV}/purchases/${verifyId}`)
      if (!verifyRes.ok) return jsonSvar({ error: `Fiken svarte ${verifyRes.status}: ${await verifyRes.text()}` }, 502)
      return jsonSvar(await verifyRes.json())
    }

    // Rent lese-verktøy: proxy for å laste ned et enkeltdokument fra Fiken sin fillagring
    // (?downloadDoc=<full documentUrl>) - relayer rå bytes med riktig Content-Type, siden
    // disse URL-ene krever Bearer-autentisering med selve FIKEN_API_KEY (som klienten ikke
    // har), ikke Supabase-nøkkelen.
    const downloadDoc = url.searchParams.get('downloadDoc')
    if (downloadDoc) {
      const fileRes = await fetch(downloadDoc, { headers: { 'Authorization': `Bearer ${FIKEN_API_KEY}` } })
      if (!fileRes.ok) return jsonSvar({ error: `Klarte ikke hente dokument (${fileRes.status})` }, 502)
      const contentType = fileRes.headers.get('Content-Type') || 'application/octet-stream'
      return new Response(fileRes.body, { headers: { ...CORS_HEADERS, 'Content-Type': contentType } })
    }

    // Rent lese-verktøy: full, paginert liste over ALT i regnskapsinnboksen akkurat nå
    // (?listInbox=1) - erstatning for det gamle, statiske inbox_unused.json-uttrekket,
    // siden innboksen fylles på fortløpende med nye EHF-fakturaer/kvitteringer.
    if (url.searchParams.get('listInbox')) {
      const slugI = await hentCompanySlug()
      const dokumenter: any[] = []
      let page = 0
      while (true) {
        const res = await fikenFetch(`/companies/${slugI}/inbox?page=${page}&pageSize=100`)
        if (!res.ok) return jsonSvar({ error: `Fiken /inbox svarte ${res.status}: ${await res.text()}` }, 502)
        dokumenter.push(...(await res.json()))
        const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
        page++
        if (page >= pageCount) break
      }
      return jsonSvar({ antall: dokumenter.length, dokumenter })
    }

    const raw = await req.text()
    if (!raw) return jsonSvar({ error: 'Tom body' }, 400)
    const {
      documentId, documentUrl, filename,
      kind, date, dueDate, betalt, betalingsdato, kid,
      leverandorNavn, bekreftetSupplierId, bekreftetLeverandorNavn, bekreftetAv,
      lines, dryRun,
      // registrerBetaling: kobler en betaling til et ALLEREDE eksisterende kjøp (f.eks.
      // en faktura som er riktig bokført, men der selve betalingen aldri ble registrert -
      // se samtalen 2026-09-18 om de to Modul-System-fakturaene fra desember 2025).
      // Egen, enklere gren enn resten av funksjonen: ingen leverandørmatching eller
      // linjebygging nødvendig, bare en direkte POST mot payments-underressursen.
      registrerBetaling,
    } = JSON.parse(raw)

    if (registrerBetaling) {
      const { purchaseId, betalingsdato: pDato, belop } = registrerBetaling
      if (!purchaseId || !pDato || belop === undefined) {
        return jsonSvar({ error: 'registrerBetaling krever purchaseId, betalingsdato og belop' }, 400)
      }
      const slugP = await hentCompanySlug()
      const paymentBody = { date: pDato, account: FIKEN_BETALINGSKONTO, amount: Math.round(Number(belop)) }
      if (dryRun) return jsonSvar({ ok: true, dryRun: true, paymentBody })
      const payRes = await fikenFetch(`/companies/${slugP}/purchases/${purchaseId}/payments`, {
        method: 'POST',
        body: JSON.stringify(paymentBody),
      })
      if (!payRes.ok) {
        const feiltekst = await payRes.text()
        return jsonSvar({ error: `Fiken avviste betalingen (${payRes.status}): ${feiltekst}`, sendtBody: paymentBody }, 502)
      }
      return jsonSvar({ ok: true, paymentUrl: payRes.headers.get('Location') || '' }, 201)
    }

    if (!date) return jsonSvar({ error: 'Mangler date' }, 400)
    if (!['cash_purchase', 'supplier'].includes(kind)) return jsonSvar({ error: 'kind må være cash_purchase eller supplier' }, 400)
    if (!Array.isArray(lines) || !lines.length) return jsonSvar({ error: 'Mangler lines' }, 400)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const slug = await hentCompanySlug()

    let supplierId: number | undefined
    if (kind === 'supplier') {
      if (!leverandorNavn) return jsonSvar({ error: 'Mangler leverandorNavn for kind=supplier' }, 400)

      const { data: alias } = await supabase
        .from('fiken_leverandor_alias')
        .select('fiken_contact_id')
        .eq('alias', leverandorNavn)
        .maybeSingle()

      if (alias) {
        supplierId = alias.fiken_contact_id
      } else if (bekreftetSupplierId) {
        supplierId = bekreftetSupplierId
        const { error: upsertErr } = await supabase.from('fiken_leverandor_alias').upsert({
          alias: leverandorNavn,
          fiken_contact_id: bekreftetSupplierId,
          fiken_navn: bekreftetLeverandorNavn || '',
          bekreftet_av: bekreftetAv || '',
        }, { onConflict: 'alias' })
        if (upsertErr) return jsonSvar({ error: 'Kunne ikke lagre leverandør-koblingen: ' + upsertErr.message }, 500)
      } else {
        // Ukjent leverandørnavn - prøv eksakt navnesøk først (Fiken støtter ?name=),
        // fall tilbake til å hente ALLE leverandørkontakter (paginert) hvis det ikke
        // gir nøyaktig ett treff, og be admin bekrefte i UI-et.
        const eksaktRes = await fikenFetch(`/companies/${slug}/contacts?supplier=true&name=${encodeURIComponent(leverandorNavn)}`)
        const eksakteTreff = eksaktRes.ok ? await eksaktRes.json() : []
        if (Array.isArray(eksakteTreff) && eksakteTreff.length === 1) {
          supplierId = eksakteTreff[0].contactId
        } else {
          const kontakter: any[] = []
          let page = 0
          while (true) {
            const res = await fikenFetch(`/companies/${slug}/contacts?supplier=true&page=${page}&pageSize=100`)
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
      }
    }

    const fikenLines = lines.map((l: any) => {
      const line: Record<string, unknown> = { vatType: l.vatType }
      if (l.description) line.description = String(l.description).slice(0, 200)
      if (l.netPrice !== undefined && l.netPrice !== null) line.netPrice = Math.round(Number(l.netPrice))
      if (l.vat !== undefined && l.vat !== null) line.vat = Math.round(Number(l.vat))
      if (l.account) line.account = String(l.account)
      return line
    })

    const purchaseBody: Record<string, unknown> = {
      date,
      kind,
      paid: !!betalt,
      lines: fikenLines,
      currency: 'NOK',
    }
    // Fiken sitt "nummer"-felt (identifier) er begrenset til 50 tegn (bekreftet ved en
    // ekte 500-feil i testing - ikke dokumentert i swagger-specen).
    if (filename) purchaseBody.identifier = String(filename).slice(0, 50)
    if (kind === 'supplier') {
      purchaseBody.supplierId = supplierId
      if (dueDate) purchaseBody.dueDate = dueDate
      if (kid) purchaseBody.kid = kid
    }
    if (betalt) {
      purchaseBody.paymentAccount = FIKEN_BETALINGSKONTO
      purchaseBody.paymentDate = betalingsdato || date
    }

    if (dryRun) {
      // Ingen POST mot Fiken - kun til for å la Henrik se nøyaktig hva som VILLE blitt
      // opprettet, siden et ekte kjøp ikke kan slettes/endres via API-et i ettertid.
      return jsonSvar({ ok: true, dryRun: true, purchaseBody, resolvedSupplierId: supplierId })
    }

    const createRes = await fikenFetch(`/companies/${slug}/purchases`, {
      method: 'POST',
      body: JSON.stringify(purchaseBody),
    })
    if (!createRes.ok) {
      const feiltekst = await createRes.text()
      return jsonSvar({ error: `Fiken avviste kjøpet (${createRes.status}): ${feiltekst}`, sendtBody: purchaseBody }, 502)
    }

    const location = createRes.headers.get('Location') || ''
    const purchaseId = location.split('/').filter(Boolean).pop() || null

    // Legg ved originaldokumentet - hent det fra Fiken sin egen fillagring (samme sted
    // det allerede ligger som ubehandlet innboks-fil) og post det videre som vedlegg.
    let vedleggOk = false
    let vedleggFeil = ''
    if (documentUrl && purchaseId) {
      try {
        const filRes = await fetch(documentUrl, { headers: { 'Authorization': `Bearer ${FIKEN_API_KEY}` } })
        if (filRes.ok) {
          const blob = await filRes.blob()
          const form = new FormData()
          const navn = filename || `bilag-${documentId}`
          form.append('filename', navn)
          form.append('attachToSale', 'true')
          if (kind === 'cash_purchase') form.append('attachToPayment', 'true')
          form.append('file', blob, navn)
          const vedleggRes = await fetch(`${FIKEN_BASE}/companies/${slug}/purchases/${purchaseId}/attachments`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${FIKEN_API_KEY}` },
            body: form,
          })
          vedleggOk = vedleggRes.ok
          if (!vedleggRes.ok) vedleggFeil = await vedleggRes.text()
        } else {
          vedleggFeil = `Klarte ikke hente originaldokument fra Fiken (${filRes.status})`
        }
      } catch (e) {
        vedleggFeil = String(e)
      }
    }

    return jsonSvar({ ok: true, purchaseId, purchaseUrl: location, vedleggOk, vedleggFeil: vedleggFeil || undefined }, 201)
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
