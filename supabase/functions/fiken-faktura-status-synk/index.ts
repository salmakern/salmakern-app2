// FØRSTE steg mot "Fiken gir fakturastatus tilbake" (Henriks valg 4.11, se Henger igjen
// s90-20261104-5): «Fakturert» i appen betyr i dag bare at en KLADD er laget i Fiken
// (fiken-fakturer lagrer fiken_kladd_url+fakturert=true samtidig) - appen får ALDRI
// tilbakemelding om kladden faktisk blir sendt, betalt eller slettet i Fiken.
//
// Denne funksjonen gjør KUN selve lesingen og lagrer resultatet - ingen varsler, ingen UI
// ennå (kommer i senere, egne steg). Kalles bare av en planlagt cron-jobb (pg_cron), samme
// mønster som fiken-priser-synk/send-ordre-status-til-portal: egen delt hemmelighet
// (x-sync-secret mot Vault-hemmeligheten fiken_faktura_status_synk_secret).
//
// VAKTER (bedt om av Henrik via portal-øktas kartlegging, s90-20261104-5):
//  - Fiken røres KUN med GET - aldri POST/PUT/DELETE. fikenGet() under tar bevisst ingen
//    init-parameter som kunne bli misbrukt til å sende en annen metode.
//  - Fiken tillater KUN én samtidig forespørsel (bekreftet i deres egen API-spesifikasjon,
//    api.fiken.no/api/v2/docs/swagger.yaml: "You are only allowed to make a single
//    concurrent API-request... may be slowed if you execute more than 4 requests per
//    second"). Løkken under er derfor en vanlig sekvensiell for-løkke med await - ALDRI
//    Promise.all/Promise.allSettled mot Fiken.
//  - Ingen automatisk fakturasending - denne funksjonen skriver ALDRI til Fiken.
//  - Hver ordre behandles i egen try/catch (samme prinsipp som stopp_forlatte_ordreklokker
//    og send-ordre-status-til-portal sin admin_ark-sjekk, begge 4.11): én ordre med uventet
//    data skal aldri velte resten av batchen.
//
// SLIK FINNES STATUS (bekreftet mot Fikens egen swagger-spesifikasjon, ikke antatt):
// en faktura-KLADD har INGEN statusfelt i seg selv, men har en egen `uuid`. Så lenge
// GET <fiken_kladd_url> fortsatt gir 200, er den uendret en kladd ("kladd") - uuid-en
// lagres da (fiken_kladd_uuid) for et presist oppslag SENERE, den dagen kladden forsvinner
// (sendt ELLER slettet - GET på den gir da 404, uten å si hvorfor).
// For å avgjøre hvorfor: GET /companies/{slug}/invoices?invoiceDraftUuid=<uuid> - "Filter
// basert på UUID-en til kladden som ble brukt til å opprette en gitt faktura". Finnes
// NØYAKTIG ÉN faktura der, ble kladden sendt ("sendt"/"betalt"); finnes ingen, er kladden
// bare slettet ("kladd_borte"); finnes det (mot formodning) FLERE, er det for usikkert å
// gjette - "ukjent". Eldre kladder (opprettet FØR denne funksjonen fikk sjekket dem én gang,
// og som alt var borte ved aller første sjekk) har ingen lagret uuid å slå opp på - da
// brukes i stedet fiken_faktura_referanse (et ØYEBLIKKSBILDE av orderReference-teksten slik
// den faktisk ble satt på kladden av fiken-fakturer DEN GANGEN, se migrasjonen) som et
// mindre presist, men eneste tilgjengelige, fall-back-oppslag - ALDRI chassis/regnr regnet
// ut på nytt fra ordrens nåværende felter, som kan ha endret seg siden fakturering (funnet i
// uavhengig gjennomgang 4.11: et regnr lagt inn etter fakturering ville gjort et slikt
// gjenutregnet søk umulig å treffe igjen).
// Betalt-status ligger IKKE på selve fakturaen, men på dens underliggende `sale`-objekt:
// GET /companies/{slug}/invoices/{invoiceId} -> sale.settled (boolean).
//
// 'kladd_borte' og 'ukjent' er BEVISST IKKE endelige tilstander (se kandidat-spørringen
// under) - et oppslag som i dag ikke finner noe (eller er tvetydig) kan stemme bedre neste
// gang (f.eks. etter at noen retter data), og skal da få lov til å rette seg selv i stedet
// for å stå fast for alltid. Kun 'betalt' er reelt endelig.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const FIKEN_API_KEY = Deno.env.get('FIKEN_API_KEY')
const SYNC_SECRET = Deno.env.get('FIKEN_FAKTURA_STATUS_SYNK_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const FIKEN_BASE = 'https://api.fiken.no/api/v2'
const FIKEN_SLUG = 'telemark-salmakerverksted'
// Batch-tak per kjøring - rent forsiktighetsprinsipp (i dag ca. 30 ordre med en kladd totalt,
// langt under dette), se vaktene øverst i filen om Fikens fart-grense.
const MAKS_PER_KJORING = 50

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

// Sammenligning i konstant tid (samme mønster som fiken-fakturaer-oversikt).
async function likt(a: string, b: string): Promise<boolean> {
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

// Bevisst UTEN init-parameter - denne funksjonen skal fysisk ikke kunne brukes til noe annet enn GET.
async function fikenGet(url: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${FIKEN_API_KEY}` } })
}

// null = ingen treff, 'ukjent' = tvetydig (flere treff) - for usikkert til å gjette.
type FakturaFunn = { status: 'sendt' | 'betalt'; invoiceId: number } | null | 'ukjent'

// Henter settled-status direkte fra selve fakturaressursen (ikke fra listesvaret, som ikke med
// sikkerhet er dokumentert å inneholde hele sale-objektet) - éé ekstra GET, ubetydelig på denne skalaen.
async function hentSendtEllerBetalt(invoiceId: number): Promise<FakturaFunn> {
  const res = await fikenGet(`${FIKEN_BASE}/companies/${FIKEN_SLUG}/invoices/${invoiceId}`)
  if (!res.ok) return { status: 'sendt', invoiceId } // usikker på betalt-status, men fakturaen finnes utvilsomt
  const faktura = await res.json()
  return { status: faktura?.sale?.settled === true ? 'betalt' : 'sendt', invoiceId }
}

// Samme sidepagineringsmønster som fiken-fakturer/fiken-fakturaer-oversikt (Fiken-Api-Page-Count) -
// uten dette ville et ekte treff utenfor side 0 blitt lest som "ingen treff".
async function hentAlleSider(url: string): Promise<any[]> {
  const alle: any[] = []
  let side = 0
  while (true) {
    const res = await fikenGet(`${url}${url.includes('?') ? '&' : '?'}page=${side}&pageSize=100`)
    if (!res.ok) throw new Error(`Fiken ${url} svarte ${res.status}`)
    alle.push(...(await res.json()))
    const sideantall = Number(res.headers.get('Fiken-Api-Page-Count') || '1')
    side++
    if (side >= sideantall) break
  }
  return alle
}

async function finnFakturaViaUuid(uuid: string): Promise<FakturaFunn> {
  const treff = await hentAlleSider(`${FIKEN_BASE}/companies/${FIKEN_SLUG}/invoices?invoiceDraftUuid=${encodeURIComponent(uuid)}`)
  if (!treff.length) return null
  // uuid-en er unik per kladd, så presist mer enn ett treff skal ikke kunne skje - men
  // gjett aldri hvis det likevel gjør det (funn fra uavhengig gjennomgang 4.11).
  if (treff.length > 1) return 'ukjent'
  return hentSendtEllerBetalt(treff[0].invoiceId)
}

// Mindre presist fall-back-oppslag for kladder som allerede var borte FØR de ble sjekket én
// gang av denne funksjonen (ingen lagret uuid) - se fiken_faktura_referanse i migrasjonen.
async function finnFakturaViaOrderReference(referanse: string): Promise<FakturaFunn> {
  const treff = await hentAlleSider(`${FIKEN_BASE}/companies/${FIKEN_SLUG}/invoices?orderReference=${encodeURIComponent(referanse)}`)
  // Serverfilteret er ikke dokumentert som eksakt match - filtrer selv for å være sikre.
  const eksakte = treff.filter((f: any) => f.orderReference === referanse)
  if (!eksakte.length) return null
  // orderReference er FRITEKST (chassis/regnr) og kan i prinsippet dele seg mellom to
  // ordre (f.eks. samme bil inn til et nytt oppdrag senere) - gjett aldri mellom flere
  // eksakte treff, det er nøyaktig scenarioet fall-backen ikke kan skille på egen hånd.
  if (eksakte.length > 1) return 'ukjent'
  return hentSendtEllerBetalt(eksakte[0].invoiceId)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    if (!SYNC_SECRET) return jsonSvar({ error: 'Ingen delt hemmelighet (FIKEN_FAKTURA_STATUS_SYNK_SECRET) er satt opp ennå' }, 500)
    if (!(await likt(req.headers.get('x-sync-secret') ?? '', SYNC_SECRET))) return jsonSvar({ error: 'Ugyldig eller manglende x-sync-secret' }, 401)
    if (!FIKEN_API_KEY) return jsonSvar({ error: 'Ingen Fiken API-nøkkel er satt opp ennå' }, 500)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Ekskluderer KUN 'betalt' (den eneste reelt endelige tilstanden) - se notatet øverst i
    // filen om hvorfor 'kladd_borte'/'ukjent' bevisst sjekkes på nytt hver gang. `.is.null`
    // MÅ stå som egen klausul: `<> 'betalt'` i SQL er verken sann eller usann for NULL, så en
    // rad som aldri er sjekket ville ellers falt utenfor begge klausulene og aldri blitt plukket opp.
    const { data: ordre, error: hentFeil } = await supabase
      .from('ordrer')
      .select('id, fiken_kladd_url, fiken_kladd_uuid, fiken_faktura_referanse, fiken_faktura_status, fiken_faktura_id')
      .eq('fakturert', true)
      .not('fiken_kladd_url', 'is', null)
      .eq('ordretype', 'bil')
      .or('fiken_faktura_status.is.null,fiken_faktura_status.neq.betalt')
      .order('id')
      .limit(MAKS_PER_KJORING)
    if (hentFeil) return jsonSvar({ error: 'Kunne ikke hente ordre: ' + hentFeil.message }, 500)
    if (!ordre || !ordre.length) return jsonSvar({ ok: true, sjekket: 0 })

    const tellere = { kladd: 0, sendt: 0, betalt: 0, kladd_borte: 0, ukjent: 0, uendret: 0, feilet: 0 }

    // Sekvensiell (ALDRI Promise.all) - se vakten om Fikens fart-grense øverst i filen.
    for (const o of ordre as any[]) {
      try {
        let ny: { status: string; uuid?: string | null; faktura_id?: number | null } | null = null

        if (o.fiken_faktura_status === 'sendt' && o.fiken_faktura_id) {
          // Allerede en kjent faktura - sjekk bare om den har blitt betalt siden sist.
          const funn = await hentSendtEllerBetalt(o.fiken_faktura_id)
          ny = funn && funn !== 'ukjent' ? { status: funn.status, faktura_id: funn.invoiceId } : { status: 'sendt', faktura_id: o.fiken_faktura_id }
        } else {
          const draftRes = await fikenGet(o.fiken_kladd_url)
          if (draftRes.ok) {
            const kladd = await draftRes.json()
            ny = { status: 'kladd', uuid: kladd?.uuid ?? o.fiken_kladd_uuid ?? null }
          } else if (draftRes.status === 404) {
            // Presist oppslag (uuid) foretrekkes alltid når vi har det. Fall-backen bruker
            // KUN det lagrede øyeblikksbildet (fiken_faktura_referanse) - ALDRI chassis/regnr
            // regnet ut på nytt fra ordrens nåværende felter, se notatet øverst i filen. Har vi
            // VERKEN uuid eller referanse, er det INGENTING å slå opp på - "ukjent" (vi har
            // faktisk ikke sjekket noe), ikke "kladd_borte" (som skal bety "sjekket, fant
            // ingenting") - rettet etter uavhengig gjennomgang 4.11, se migrasjonsnotatet.
            const funn = o.fiken_kladd_uuid
              ? await finnFakturaViaUuid(o.fiken_kladd_uuid)
              : (o.fiken_faktura_referanse ? await finnFakturaViaOrderReference(o.fiken_faktura_referanse) : 'ukjent')
            ny = funn === 'ukjent' ? { status: 'ukjent' } : (funn ? { status: funn.status, faktura_id: funn.invoiceId } : { status: 'kladd_borte' })
          } else {
            throw new Error(`Fiken /invoices/drafts svarte ${draftRes.status}`)
          }
        }

        if (!ny) { tellere.uendret++; continue }
        const oppdatering: Record<string, unknown> = { fiken_faktura_status: ny.status, fiken_faktura_status_sjekket_at: new Date().toISOString() }
        if (ny.uuid) oppdatering.fiken_kladd_uuid = ny.uuid
        if (ny.faktura_id) oppdatering.fiken_faktura_id = ny.faktura_id
        const { error: skriveFeil } = await supabase.from('ordrer').update(oppdatering).eq('id', o.id)
        if (skriveFeil) throw new Error(`Kunne ikke lagre status på ordren: ${skriveFeil.message}`)
        tellere[ny.status as keyof typeof tellere] = (tellere[ny.status as keyof typeof tellere] ?? 0) + 1
      } catch (e) {
        // Best-effort per rad (samme prinsipp som send-ordre-status-til-portal sin admin_ark-sjekk
        // og stopp_forlatte_ordreklokker): én ordre med uventet data/en Fiken-feil skal aldri
        // velte resten av batchen. Raden prøves på nytt neste kjøring (sjekket_at røres ikke).
        console.error(`fiken-faktura-status-synk: ordre ${o.id} feilet: ${String(e)}`)
        tellere.feilet++
      }
    }

    return jsonSvar({ ok: true, sjekket: ordre.length, resultat: tellere })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
