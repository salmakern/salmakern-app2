// Sender ekte e-post (via Resend) for tre formål, alle utløst manuelt fra en knapp på
// Admin-arket (js/admin-ark.js: adminArkFraktBestill/adminArkVarsleHentet) - ALDRI
// automatisk, siden dette går til ekte eksterne mottakere og feil data er vanskeligere å
// rette opp enn en intern PDF:
//   type: "bestilling"       - bestiller frakt hos fraktselskapet (forhandler/kontaktperson/
//         chassis.nr i innholdet), kontaktpersonen på kopi.
//   type: "hentet"           - varsler kontaktpersonen om at bilen er hentet (kun chassis.nr).
//   type: "klar_for_henting" - varsler kontaktpersonen om at bilen er klar for å hentes,
//         brukt når Fraktselskap er satt til "Hente selv" (kun chassis.nr).
//   type: "paa_vei"          - varsler kontaktpersonen om at bilen er på vei til dem, brukt
//         når Fraktselskap er satt til "Levering av oss" (kun chassis.nr).
// ALLE fire typene sendes med Salmakern selv på blindkopi (BCC_EPOST under).
// Krever RESEND_API_KEY satt som secret (npx supabase secrets set RESEND_API_KEY=...).
// FRAKT_EPOST_AVSENDER er valgfri (secret) - faller tilbake til post@salmaker.as, som må
// være en verifisert avsenderadresse/domene i Resend-kontoen for at sending skal fungere.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FRA_EPOST = Deno.env.get('FRAKT_EPOST_AVSENDER') || 'post@salmaker.as'
// Blindkopi til Salmakern selv på ALLE e-poster herfra (bedt om av Henrik 2026-09-30:
// "sett oss på blindkopi som blir sendt ut ifra admin arket") - egen valgfri secret hvis
// en annen adresse enn avsenderadressen ønskes senere, faller ellers tilbake til samme.
const BCC_EPOST = Deno.env.get('FRAKT_EPOST_BCC') || FRA_EPOST

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const FN = 'send-frakt-epost'
// Sender ekte e-post fra post@salmaker.as: bare admin (samme rolle som ser Admin-arket i appen).
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

function escHtml(s: string) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
}

// Samme adresse/telefon/logo som brukes i brevhodet på Vegvesen-dokumentene (se
// vegvesenTegnBrevhode i js/vegvesen-dokumenter.js), format bekreftet av Henrik
// 2026-09-22 mot et ekte skjermbilde av en Outlook-signatur. Holdt likt to steder med
// vilje fremfor å dele kode på tvers av frontend/edge function for noen faste linjer.
// avsenderNavn er den innloggede ansatte som trykket knappen (me.navn i frontend) - ikke
// fast til én person, siden hvem som helst med admin-rolle kan bestille frakt/varsle
// (bekreftet av Henrik - ulikt Vegvesen-dokumentene, som alltid signeres av Jan Børre).
const LOGO_URL = 'https://salmaker.as/logoer/logo-transparent.png'
const RØD = '#dc2626'

// De fleste e-postklienter blokkerer eksterne bilder som standard (Henrik bekreftet
// 2026-09-22 at logoen ikke vises i en ekte test) - baker derfor logoen inn i selve
// e-posten som en data-URI i stedet for en ekstern lenke, så den alltid vises med en
// gang uten at mottakeren må klikke "vis bilder". Hentes og base64-kodes ved sending
// (ikke hardkodet i kildekoden) og caches i minnet for resten av denne kjørende
// funksjons-instansen, siden Deno kan gjenbruke samme instans for flere kall på rad.
let logoBase64Cache: string | null = null
async function hentLogoDataUri(): Promise<string | null> {
  if (logoBase64Cache) return logoBase64Cache
  try {
    const res = await fetch(LOGO_URL)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binaer = ''
    const CHUNK = 8192
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binaer += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    logoBase64Cache = `data:image/png;base64,${btoa(binaer)}`
    return logoBase64Cache
  } catch (e) {
    console.error('Kunne ikke hente/kode logo:', e)
    return null
  }
}

async function signaturHtml(avsenderNavn: string | undefined) {
  const navnLinje = avsenderNavn ? `<p style="margin:0 0 10px;font-weight:bold;font-size:14px">${escHtml(avsenderNavn)}</p>` : ''
  const logoUri = await hentLogoDataUri()
  const logoTag = logoUri
    ? `<p style="margin:0 0 10px"><img src="${logoUri}" alt="Telemark Salmakerverksted" width="220" style="display:block"></p>`
    : ''
  return `
    <p style="margin:0 0 4px">Med vennlig hilsen</p>
    ${navnLinje}
    ${logoTag}
    <p style="margin:0;font-size:13px;line-height:1.6;color:#333">
      Bataljonvegen&nbsp;25&nbsp;&nbsp;|&nbsp;&nbsp;3734&nbsp;Skien<br>
      Tel:&nbsp;35&nbsp;59&nbsp;33&nbsp;95&nbsp;&nbsp;&nbsp;&nbsp;Mobil:&nbsp;915&nbsp;67&nbsp;363<br>
      Email:&nbsp;<a href="mailto:post@salmaker.as" style="color:${RØD};text-decoration:underline">post@salmaker.as</a>&nbsp;&nbsp;|&nbsp;&nbsp;Internet:&nbsp;<a href="https://www.salmaker.as" style="color:${RØD};text-decoration:underline">www.salmaker.as</a>
    </p>`
}

function signaturTekst(avsenderNavn: string | undefined) {
  const navnLinje = avsenderNavn ? `${avsenderNavn}\n` : ''
  return `Med vennlig hilsen\n\n${navnLinje}Telemark Salmakerverksted\n`
    + `Bataljonvegen 25, 3734 Skien\n`
    + `Tel: 35 59 33 95   Mobil: 915 67 363\n`
    + `Email: post@salmaker.as | Internet: www.salmaker.as`
}

// En Kontakt kan nå ha flere e-postadresser kommaseparert i ett felt (bedt om av Henrik
// 2026-09-26, kom opp for fraktselskaper med flere mottakere) - splittes til en ekte liste
// her, siden Resend sitt API krever adskilte strenger i to/cc-arrayen, ikke én streng med
// komma i midten (som ville blitt tolket som én, ugyldig mottaker-adresse).
function splittEposter(felt: string | undefined): string[] {
  return (felt || '').split(',').map(e => e.trim()).filter(Boolean)
}

async function sendEpost(til: string, cc: string | undefined, emne: string, html: string, tekst: string) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY er ikke satt - kontakt Henrik for å fullføre oppsettet')
  const tilListe = splittEposter(til)
  const ccListe = splittEposter(cc)
  const bccListe = splittEposter(BCC_EPOST)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FRA_EPOST, to: tilListe, cc: ccListe.length ? ccListe : undefined, bcc: bccListe.length ? bccListe : undefined, subject: emne, html, text: tekst }),
  })
  if (!res.ok) {
    const feiltekst = await res.text()
    throw new Error(`Resend feilet (${res.status}): ${feiltekst}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  try {
    const avvist = await innloggingsgate(req)
    if (avvist) return new Response(avvist.melding, { status: avvist.status, headers: CORS_HEADERS })

    const raw = await req.text()
    if (!raw) return new Response('tom body', { status: 400, headers: CORS_HEADERS })
    const payload = JSON.parse(raw)

    if (payload.type === 'bestilling') {
      const { fraktselskapEpost, kontaktpersonEpost, forhandler, kontaktperson, chassisNr, avsenderNavn } = payload
      if (!fraktselskapEpost) return new Response('Mangler e-post for fraktselskap', { status: 400, headers: CORS_HEADERS })
      const emne = `Bestilling av frakt${chassisNr ? ' - ' + chassisNr : ''}`
      const html = `
        <p style="margin:0 0 12px">Hei,</p>
        <p style="margin:0 0 12px">Vi ønsker å bestille frakt for følgende bil:</p>
        <p style="margin:0 0 16px">
          Forhandler: ${escHtml(forhandler || '-')}<br>
          Kontaktperson: ${escHtml(kontaktperson || '-')}<br>
          Chassis.nr: ${escHtml(chassisNr || '-')}
        </p>
        ${await signaturHtml(avsenderNavn)}`
      const tekst = `Hei,\n\nVi ønsker å bestille frakt for følgende bil:\n\n`
        + `Forhandler: ${forhandler || '-'}\n`
        + `Kontaktperson: ${kontaktperson || '-'}\n`
        + `Chassis.nr: ${chassisNr || '-'}\n\n`
        + signaturTekst(avsenderNavn)
      await sendEpost(fraktselskapEpost, kontaktpersonEpost, emne, html, tekst)
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }

    if (payload.type === 'hentet') {
      const { kontaktpersonEpost, chassisNr, fraktselskap, avsenderNavn } = payload
      if (!kontaktpersonEpost) return new Response('Mangler e-post for kontaktperson', { status: 400, headers: CORS_HEADERS })
      // Nevner hvilket fraktselskap som faktisk hentet bilen når det er registrert på raden
      // (bedt om av Henrik 2026-10-08) - utelatt hvis feltet er tomt, i stedet for å skrive
      // "av " etterfulgt av ingenting.
      const avSetning = fraktselskap ? ` av ${escHtml(fraktselskap)}` : ''
      const emne = `Bilen er hentet${chassisNr ? ' - ' + chassisNr : ''}`
      const html = `
        <p style="margin:0 0 12px">Hei,</p>
        <p style="margin:0 0 16px">Bilen med chassis.nr ${escHtml(chassisNr || '-')} er nå hentet${avSetning}.</p>
        ${await signaturHtml(avsenderNavn)}`
      const tekst = `Hei,\n\nBilen med chassis.nr ${chassisNr || '-'} er nå hentet${fraktselskap ? ' av ' + fraktselskap : ''}.\n\n`
        + signaturTekst(avsenderNavn)
      await sendEpost(kontaktpersonEpost, undefined, emne, html, tekst)
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }

    if (payload.type === 'paa_vei') {
      const { kontaktpersonEpost, chassisNr, avsenderNavn } = payload
      if (!kontaktpersonEpost) return new Response('Mangler e-post for kontaktperson', { status: 400, headers: CORS_HEADERS })
      const emne = `Bilen er på vei til dere${chassisNr ? ' - ' + chassisNr : ''}`
      const html = `
        <p style="margin:0 0 12px">Hei,</p>
        <p style="margin:0 0 16px">Bilen med chassis.nr ${escHtml(chassisNr || '-')} er nå på vei til dere.</p>
        ${await signaturHtml(avsenderNavn)}`
      const tekst = `Hei,\n\nBilen med chassis.nr ${chassisNr || '-'} er nå på vei til dere.\n\n`
        + signaturTekst(avsenderNavn)
      await sendEpost(kontaktpersonEpost, undefined, emne, html, tekst)
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }

    if (payload.type === 'klar_for_henting') {
      const { kontaktpersonEpost, chassisNr, dato, avsenderNavn } = payload
      if (!kontaktpersonEpost) return new Response('Mangler e-post for kontaktperson', { status: 400, headers: CORS_HEADERS })
      // "dato" kommer som 'YYYY-MM-DD' fra <input type="date"> i admin-ark.js - formatert
      // om til 'DD.MM.YYYY' for visning, samme konvensjon som fmtDatoKort() i frontend.
      const datoVisning = /^\d{4}-\d{2}-\d{2}$/.test(dato || '') ? dato.split('-').reverse().join('.') : ''
      const fraSetning = datoVisning ? ` fra ${datoVisning}` : ''
      const emne = `Bilen er klar for henting${chassisNr ? ' - ' + chassisNr : ''}`
      const html = `
        <p style="margin:0 0 12px">Hei,</p>
        <p style="margin:0 0 16px">Bilen med chassis.nr ${escHtml(chassisNr || '-')} er klar for å bli hentet${escHtml(fraSetning)}. Som avtalt henter dere selv.</p>
        ${await signaturHtml(avsenderNavn)}`
      const tekst = `Hei,\n\nBilen med chassis.nr ${chassisNr || '-'} er klar for å bli hentet${fraSetning}. Som avtalt henter dere selv.\n\n`
        + signaturTekst(avsenderNavn)
      await sendEpost(kontaktpersonEpost, undefined, emne, html, tekst)
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }

    return new Response('Ukjent type: ' + payload.type, { status: 400, headers: CORS_HEADERS })
  } catch (e) {
    console.error('Kritisk feil:', e)
    return new Response(String(e), { status: 500, headers: CORS_HEADERS })
  }
})
