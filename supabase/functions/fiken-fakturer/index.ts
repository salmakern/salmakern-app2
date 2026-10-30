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

const FN = 'fiken-fakturer'
// Oppretter Fiken-kladder i selskapets navn: bare admin (godkjenner og andre ansatte skal ikke kunne fakturere, bestemt av Henrik 2026-10-29).
const TILLATTE_ROLLER = ['admin']
// ── EDGE-AUTH-GATE BEGIN (blokken er byte-lik i fiken-fakturer og send-frakt-epost; test/edge-auth-gate.test.js vokter mot avvik) ──
// Innloggingssjekk innført 2026-10-29: kallet skal komme fra en innlogget ansatt med riktig rolle (TILLATTE_ROLLER). Samme regel som RLS bruker:
// vi spør databasen via current_ansatt() med KALLERENS eget token (aktiv, riktig session_token, rolle slått opp live) - aldri dekoding av JWT her,
// og aldri rolle-claimen i tokenet (den er frosset fra innloggingen). MYK MODUS til håndheving er slått på: kallet slippes alltid gjennom, men
// utfallet logges som én JSON-linje (edge_auth: 1, aldri tokens eller andre verdier fra headerne). Håndheving slås på uten ny utrulling ved å
// legge funksjonsnavnet (eller *) i Supabase-hemmeligheten EDGE_AUTH_ENFORCE (kommaliste) og rulles tilbake ved å fjerne det igjen.
const HAANDHEV = (Deno.env.get('EDGE_AUTH_ENFORCE') ?? '').split(',').map((s) => s.trim()).some((s) => s === '*' || s === FN)
const JWT_FORM = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/

type Sjekk = { via: 'ansatt' | 'ikke_tillatt_rolle' | 'ingen' | 'ukjent'; grunn?: string; rolle?: string; ansattId?: number }

async function sjekkAnsatt(req: Request): Promise<Sjekk> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { via: 'ingen', grunn: 'ingen_header' }
  // Den offentlige nøkkelen (sb_publishable_...) og alt annet som ikke er en JWT er aldri en ansatt-sesjon: ingen oppslag nødvendig.
  if (token.length > 4096 || !JWT_FORM.test(token)) return { via: 'ingen', grunn: 'ikke_jwt' }
  const url = Deno.env.get('SUPABASE_URL')
  const apikey = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || ''
  if (!url || !apikey) return { via: 'ukjent', grunn: 'mangler_miljo' }
  const res = await fetch(`${url}/rest/v1/rpc/current_ansatt`, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) {
    // Ugyldig/utløpt token er kallerens sak (ingen); alt annet (feil nøkkel hos oss, databasen nede, rate limit) er «ukjent» så vi aldri
    // påstår at en ekte admin ikke er innlogget bare fordi selve sjekken svikter.
    const kode = await res.json().then((b) => String(b?.code ?? '')).catch(() => '')
    return /^PGRST30[13]$/.test(kode) ? { via: 'ingen', grunn: 'ugyldig_eller_utlopt_token' } : { via: 'ukjent', grunn: `postgrest_${res.status}` }
  }
  const rader = await res.json()
  if (!Array.isArray(rader) || rader.length > 1) return { via: 'ukjent', grunn: 'uventet_svar' }
  if (rader.length === 0) return { via: 'ingen', grunn: 'ingen_ansatt_sesjon' }
  const { id, rolle } = rader[0] ?? {}
  if (typeof rolle !== 'string' || !Number.isInteger(id)) return { via: 'ukjent', grunn: 'uventet_svar' }
  return TILLATTE_ROLLER.includes(rolle) ? { via: 'ansatt', rolle, ansattId: id } : { via: 'ikke_tillatt_rolle', rolle, ansattId: id }
}

// Gir null når kallet skal slippes gjennom, ellers statuskoden og meldingen funksjonen skal svare med (i funksjonens eget svarformat).
async function innloggingsgate(req: Request): Promise<{ status: number; melding: string } | null> {
  let sjekk: Sjekk
  try {
    sjekk = await sjekkAnsatt(req)
  } catch (e) {
    sjekk = { via: 'ukjent', grunn: e instanceof Error ? e.name : 'feil' }
  }
  console.log(JSON.stringify({ edge_auth: 1, fn: FN, via: sjekk.via, grunn: sjekk.grunn ?? '', rolle: sjekk.rolle ?? '', ansatt_id: sjekk.ansattId ?? null, haandhevet: HAANDHEV, origin: req.headers.get('origin') ?? '' }))
  if (sjekk.via === 'ansatt' || !HAANDHEV) return null
  if (sjekk.via === 'ukjent') return { status: 503, melding: 'Kunne ikke bekrefte innloggingen akkurat nå - prøv igjen om litt' }
  if (sjekk.via === 'ikke_tillatt_rolle') return { status: 403, melding: 'Bare administrator kan gjøre dette' }
  return { status: 401, melding: 'Du må være innlogget som administrator - logg inn på nytt og prøv igjen' }
}
// ── EDGE-AUTH-GATE END ──

// Dagens dato i Oslo lokaltid, uavhengig av at serveren selv kjører i UTC - new
// Date().toISOString().slice(0,10) ga feil (gårsdagens) dato på fakturaer opprettet mellom
// ca. 00:00-02:00 norsk tid, siden UTC da fortsatt viser forrige dag. Samme mønster som
// osloNaa() i send-push/index.ts.
function norskDato(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' })
  const deler = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]))
  return `${deler.year}-${deler.month}-${deler.day}`
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
    const avvist = await innloggingsgate(req)
    if (avvist) return jsonSvar({ error: avvist.melding }, avvist.status)

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

    const { ordreId, kundeNavn, kontaktpersonNavn, chassisNr, regnr, linjer, brukRabatt, bekreftetContactId, bekreftetFikenNavn, bekreftetAv } = body
    if (!kundeNavn) return jsonSvar({ error: 'Mangler kundeNavn' }, 400)
    if (!Array.isArray(linjer) || !linjer.length) return jsonSvar({ error: 'Mangler fakturalinjer' }, 400)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Idempotens (s09-006): hvis denne ordren allerede har en lagret kladd-adresse, har en
    // tidligere (kanskje en annen administrators) kall allerede opprettet kladden i Fiken -
    // opprett ALDRI en ny, bare returner den eksisterende. Lukker race-vinduet der to
    // administratorer trykker fakturer nesten samtidig fra hver sin enhet, før Realtime har
    // rukket å vise den andres "fakturert"-endring.
    if (ordreId) {
      const { data: eksisterendeOrdre, error: ordreFeil } = await supabase
        .from('ordrer')
        .select('fiken_kladd_url')
        .eq('id', ordreId)
        .maybeSingle()
      if (ordreFeil) return jsonSvar({ error: 'Kunne ikke sjekke ordren: ' + ordreFeil.message }, 500)
      if (eksisterendeOrdre?.fiken_kladd_url) {
        return jsonSvar({ ok: true, draftUrl: eksisterendeOrdre.fiken_kladd_url, alleredeOpprettet: true }, 200)
      }
    }

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

    const idag = norskDato()
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
      // Prislås (s09-023): en linje som har fått pris+mva frosset da den ble lagt til/endret
      // på ordren (se oppdater_ordre_fiken_linje(_ved_id) i migrasjon 20261030220000) bruker
      // DEN prisen her, ikke Fikens pris slik den er akkurat denne dagen - ellers kunne en
      // prisendring i Fiken (prissynk) mellom bestilling og fakturering endre det kunden
      // faktureres uten at noen merket det. Linjer uten frosset pris (lagt til før denne
      // migrasjonen, eller produktnummer uten rad i fiken_priser) er uendret: ingen unitPrice
      // satt her, Fiken fyller inn produktets pris slik den er i dag - akkurat som før.
      const erLaastPris = !erOverstyrtBelop && l.pris !== undefined && l.pris !== null && l.mva
      if (erOverstyrtBelop) {
        line.unitPrice = Math.round(Number(l.belop) * 100)
        line.vatType = 'high' // 25% - alltid, uavhengig av drivstoff-satsen som ga beløpet (bekreftet av Henrik)
      } else {
        if (erLaastPris) {
          line.unitPrice = Math.round(Number(l.pris) * 100)
          line.vatType = l.mva
        }
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

    const draftUrl = draftRes.headers.get('Location') || ''
    // Lagres her, server-side, i SAMME kall som kladden faktisk ble opprettet i Fiken - ikke
    // avhengig av at klientens nettleser fortsatt er tilkoblet og rekker sitt eget save()-kall
    // etterpå (se s09-006: "kladd-adressen kastes" var nettopp symptomet på at den eneste
    // lagringen var klient-initiert). fakturert settes også her av samme grunn; klientens egen
    // save() rett etter gjør det samme, men er nå en ufarlig duplikat, ikke den eneste lagringen.
    if (ordreId && draftUrl) {
      const { error: lagreFeil } = await supabase
        .from('ordrer')
        .update({ fiken_kladd_url: draftUrl, fakturert: true })
        .eq('id', ordreId)
      if (lagreFeil) console.error('Kunne ikke lagre fiken_kladd_url på ordren:', lagreFeil.message)
    }

    return jsonSvar({ ok: true, draftUrl }, 201)
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
