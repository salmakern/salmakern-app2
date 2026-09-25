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
// Driftskonto fakturaer skal betales til - oppgitt av Henrik 2026-09-17 ("2801 56 52790"),
// lagret uten mellomrom/punktum siden Fiken sitt eget bankAccountNumber-felt (bekreftet
// mot en ekte utstedt faktura) er en ren 11-sifret streng uten formattering.
const FIKEN_DRIFTSKONTO = '28015652790'

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
async function hentProduktnummerTilId(slug: string): Promise<Map<string, { productId: number; navn: string; konto: string | null }>> {
  const map = new Map<string, { productId: number; navn: string; konto: string | null }>()
  let page = 0
  while (true) {
    const res = await fikenFetch(`/companies/${slug}/products?page=${page}&pageSize=100`)
    if (!res.ok) throw new Error(`Fiken /products svarte ${res.status}`)
    const produkter = await res.json()
    for (const p of produkter) {
      if (p.productNumber) map.set(String(p.productNumber), { productId: p.productId, navn: p.name || '', konto: p.incomeAccount || null })
    }
    const pageCount = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
    page++
    if (page >= pageCount) break
  }
  return map
}

// Avtalt rabatt er kundespesifikk, ikke en fast regel (bekreftet av Henrik - historikken
// viste at samme produkttype fikk ulik rabatt hos ulike kunder). "ombygging"-linjer
// identifiseres på at PRODUKTNAVNET i Fiken inneholder "ombygging" (dekker "Varebilombygging
// av X" og "Ombygging av X til personbil" og "Ombyggingskit ..." likt) - alt annet regnes
// som ekstra utstyr. Drivstoff (egen unitPrice-override) skal ALDRI ha rabatt, uansett.
function erOmbyggingslinje(produktnavn: string): boolean {
  return /ombygg/i.test(produktnavn || '')
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
    const body = JSON.parse(raw)

    // Oppretter en NY kunde i Fiken (organisasjonsnummer bekreftet mot Brønnøysundregisteret
    // av admin på forhånd, aldri gjettet her) - helt separat fra fakturaflyten under. Kun
    // navn er påkrevd av Fiken sitt eget schema (bekreftet mot components.schemas.contact i
    // https://github.com/bjerkio/fiken-js/blob/main/swagger.json), men vi sender alltid med
    // organisasjonsnummer når vi har det siden det er nøkkelen til at kontakten faktisk
    // representerer riktig juridisk enhet.
    if (body.opprettKunde) {
      const { navn, orgnr } = body.opprettKunde
      if (!navn) return jsonSvar({ error: 'Mangler navn for ny kunde' }, 400)
      const slug = await hentCompanySlug()
      const opprettRes = await fikenFetch(`/companies/${slug}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ name: navn, ...(orgnr ? { organizationNumber: String(orgnr) } : {}), customer: true }),
      })
      if (!opprettRes.ok) {
        return jsonSvar({ error: `Fiken avviste ny kunde (${opprettRes.status}): ${await opprettRes.text()}` }, 502)
      }
      const location = opprettRes.headers.get('Location') || ''
      const contactId = Number(location.split('/').filter(Boolean).pop())
      return jsonSvar({ ok: true, contactId, navn }, 201)
    }

    const { kundeNavn, kontaktpersonNavn, chassisNr, regnr, linjer, brukRabatt, bekreftetContactId, bekreftetFikenNavn, bekreftetAv } = body
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
    // Hver fakturalinje MÅ ha en konto (bekreftet av Henrik) - stopp heller kladden helt
    // enn å la Fiken sin egen default (som kan være feil/tom) stille avgjøre kontoen.
    const utenKonto = linjer
      .map((l: any) => ({ produktnummer: String(l.produktnummer), produkt: produktMap.get(String(l.produktnummer)) }))
      .filter((x: any) => !x.produkt?.konto)
    if (utenKonto.length) {
      return jsonSvar({ error: `Produkt uten konto satt opp i Fiken: ${utenKonto.map((x: any) => x.produktnummer).join(', ')} - sett en inntektskonto på produktet i Fiken før fakturering.` }, 400)
    }

    // Avtalt rabatt per kunde - kun forhåndsutfylt der historikken var konsekvent (se
    // fiken_kunde_rabatt-migrasjonen), NULL/mangler rad betyr 0% til Henrik setter en verdi.
    const { data: rabattRad } = await supabase
      .from('fiken_kunde_rabatt')
      .select('rabatt_ombygging, rabatt_ekstra_utstyr')
      .eq('fiken_contact_id', contactId)
      .maybeSingle()
    // Fiken sitt discount-felt på en fakturalinje forventes 0-100 (prosent), samme skala
    // som verdiene er lagret i her - ingen omregning nødvendig. brukRabatt===false betyr
    // admin har bevisst huket av "Bruk kundens avtalte rabatt" på DENNE fakturaen - null
    // ut satsene uansett hva som er avtalt, i stedet for å måtte fjerne dem per linje etterpå.
    const rabattSkalBrukes = brukRabatt !== false
    const rabattOmbygging = rabattSkalBrukes ? (rabattRad?.rabatt_ombygging ?? 0) : 0
    const rabattEkstraUtstyr = rabattSkalBrukes ? (rabattRad?.rabatt_ekstra_utstyr ?? 0) : 0

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
    // Ordrereferanse: "<chassis> - <regnr>" hvis regnr finnes, ellers bare chassisnr.
    // Kommentar på siste linje: "Ch. nr. <chassis>" - begge deler bekreftet av Henrik.
    const ordreReferanse = chassisNr ? (regnr ? `${chassisNr} - ${regnr}` : chassisNr) : undefined
    const linjerMedIndeks = linjer.map((l: any, i: number) => {
      const produkt = produktMap.get(String(l.produktnummer))!
      const line: Record<string, unknown> = { productId: produkt.productId, quantity: l.antall || 1 }
      // Fiken arver IKKE nødvendigvis produktets egen inntektskonto automatisk på en
      // fakturalinje opprettet via API-et (bekreftet av Henrik: kontoen kom ikke inn av
      // seg selv) - send den derfor eksplisitt (validert obligatorisk over). Feltnavnet
      // er bekreftet identisk på både produktet og en faktisk utstedt fakturalinje
      // ("incomeAccount") ved å lese en ekte faktura tilbake fra Fiken.
      line.incomeAccount = produkt.konto
      const erOverstyrtBelop = l.belop !== undefined && l.belop !== null
      if (erOverstyrtBelop) {
        line.unitPrice = Math.round(Number(l.belop) * 100)
        line.vatType = 'high' // 25% - alltid, uavhengig av drivstoff-satsen som ga beløpet (bekreftet av Henrik)
      } else {
        // Drivstoff (overstyrt beløp) skal ALDRI ha rabatt - alt annet får kundens avtalte
        // sats, valgt ut fra om Fiken-produktnavnet er en ombygging-linje eller ekstra utstyr.
        const rabatt = erOmbyggingslinje(produkt.navn) ? rabattOmbygging : rabattEkstraUtstyr
        if (rabatt > 0) line.discount = rabatt
      }
      if (chassisNr && i === linjer.length - 1) line.comment = `Ch. nr. ${chassisNr}`
      return line
    })
    const draftBody = {
      type: 'invoice',
      customerId: contactId,
      ...(contactPersonId ? { contactPersonId } : {}),
      daysUntilDueDate: 10, // 93,6% av 595 ekte fakturaer bruker 10 dager - verifisert, ikke antatt
      issueDate: idag,
      ourReference: 'Jan Børre Sigurdsen',
      // Driftskontoen fakturaen skal betales til - satt eksplisitt fordi Fiken sin egen
      // default ikke traff riktig konto (bekreftet av Henrik 2026-09-17).
      bankAccountNumber: FIKEN_DRIFTSKONTO,
      ...(ordreReferanse ? { orderReference: ordreReferanse } : {}),
      lines: linjerMedIndeks,
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
