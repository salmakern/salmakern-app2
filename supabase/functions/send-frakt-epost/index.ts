// Sender ekte e-post (via Resend) for tre formål, alle utløst manuelt fra en knapp på
// Admin-arket (js/admin-ark.js: adminArkFraktBestill/adminArkVarsleHentet) - ALDRI
// automatisk, siden dette går til ekte eksterne mottakere og feil data er vanskeligere å
// rette opp enn en intern PDF:
//   type: "bestilling"       - bestiller frakt hos fraktselskapet (forhandler/kontaktperson/
//         chassis.nr i innholdet), kontaktpersonen på kopi.
//   type: "hentet"           - varsler kontaktpersonen om at bilen er hentet (kun chassis.nr).
//   type: "klar_for_henting" - varsler kontaktpersonen om at bilen er klar for å hentes,
//         brukt når Fraktselskap er satt til "Hente selv" (kun chassis.nr).
// Krever RESEND_API_KEY satt som secret (npx supabase secrets set RESEND_API_KEY=...).
// FRAKT_EPOST_AVSENDER er valgfri (secret) - faller tilbake til post@salmaker.as, som må
// være en verifisert avsenderadresse/domene i Resend-kontoen for at sending skal fungere.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FRA_EPOST = Deno.env.get('FRAKT_EPOST_AVSENDER') || 'post@salmaker.as'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

async function sendEpost(til: string, cc: string | undefined, emne: string, html: string, tekst: string) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY er ikke satt - kontakt Henrik for å fullføre oppsettet')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FRA_EPOST, to: [til], cc: cc ? [cc] : undefined, subject: emne, html, text: tekst }),
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
      const { kontaktpersonEpost, chassisNr, avsenderNavn } = payload
      if (!kontaktpersonEpost) return new Response('Mangler e-post for kontaktperson', { status: 400, headers: CORS_HEADERS })
      const emne = `Bilen er hentet${chassisNr ? ' - ' + chassisNr : ''}`
      const html = `
        <p style="margin:0 0 12px">Hei,</p>
        <p style="margin:0 0 16px">Bilen med chassis.nr ${escHtml(chassisNr || '-')} er nå hentet.</p>
        ${await signaturHtml(avsenderNavn)}`
      const tekst = `Hei,\n\nBilen med chassis.nr ${chassisNr || '-'} er nå hentet.\n\n`
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
        <p style="margin:0 0 16px">Bilen med chassis.nr ${escHtml(chassisNr || '-')} er klar for å bli hentet${escHtml(fraSetning)}.</p>
        ${await signaturHtml(avsenderNavn)}`
      const tekst = `Hei,\n\nBilen med chassis.nr ${chassisNr || '-'} er klar for å bli hentet${fraSetning}.\n\n`
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
