// Sender ekte e-post (via Resend) for tre formål, alle utløst manuelt fra en knapp på
// Admin-arket (js/admin-ark.js: adminArkFraktBestill/adminArkVarsleHentet) - ALDRI
// automatisk, siden dette går til ekte eksterne mottakere og feil data er vanskeligere å
// rette opp enn en intern PDF:
//   type: "bestilling"       - bestiller frakt hos fraktselskapet (forhandler/kontaktperson/
//         chassis.nr i innholdet, og "Bilen er klar for å bli hentet fra <dato>" når en
//         henteklar-dato er valgt), kontaktpersonen på kopi.
//   type: "hentet"           - varsler kontaktpersonen om at bilen er hentet (kun chassis.nr).
//   type: "klar_for_henting" - varsler kontaktpersonen om at bilen er klar for å hentes,
//         brukt når Fraktselskap er satt til "Hente selv" (kun chassis.nr).
//   type: "paa_vei"          - varsler kontaktpersonen om at bilen er på vei til dem, brukt
//         når Fraktselskap er satt til "Levering av oss" (kun chassis.nr).
//   type: "leveranse_bestilling" - (2026-11-03) bestiller frakt for en LEVERANSE (ordre uten bil, «Ny leveranse» i appen). I motsetning til de andre
//         typene sender klienten bare ordre-id: serveren leser leveransen selv, finner fraktselskapets e-post i Kontakter (innstillinger.kontakter),
//         «claimer» bestillingen atomisk (UPDATE ... WHERE frakt_bestilt_at IS NULL) FØR den sender, og frigir den igjen hvis sendingen feiler.
//         Samme bestilling går dermed aldri ut to ganger, selv med to samtidige klienter. Alt skjer med kallerens eget token (RLS), aldri service-nøkkel.
// ALLE typene sendes med Salmakern selv på blindkopi (BCC_EPOST under).
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
// ── EDGE-AUTH-GATE BEGIN (blokken er byte-lik i fiken-fakturer, send-frakt-epost, vegvesen-oppslag og send-push; test/edge-auth-gate.test.js vokter mot avvik) ──
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
  if (sjekk.via === 'ikke_tillatt_rolle') return { status: 403, melding: 'Rollen din har ikke tilgang til dette' }
  return { status: 401, melding: 'Du må være innlogget - logg inn på nytt og prøv igjen' }
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

// "dato" kommer som 'YYYY-MM-DD' fra <input type="date"> i admin-ark.js - formatert om til
// 'DD.MM.YYYY' for visning (samme konvensjon som fmtDatoKort() i frontend). Alt som ikke har
// nøyaktig dette formatet gir tom streng (og dermed ingen datolinje), så ingenting fra klienten
// havner uskadelig-formatert i e-posten. Brukes av både "bestilling" og "klar_for_henting".
function datoVisning(dato: unknown): string {
  return typeof dato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dato) ? dato.split('-').reverse().join('.') : ''
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

// ── LEVERANSE-BESTILLING (2026-11-03) ───────────────────────────────────────────────────────────────────────────────────
const EPOST_FORM = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/
const ORDRE_ID_FORM = /^[A-Za-z0-9_-]{3,80}$/
const FRAKTSELSKAP_UTEN_EPOST = ['Hente selv', 'Levering av oss']

// Kall mot PostgREST med KALLERENS eget token: RLS (krever_innlogget_ansatt) avgjør hva som er lov, aldri en service-nøkkel her.
async function restKall(req: Request, sti: string, init: RequestInit = {}): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL')
  const apikey = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || ''
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  return await fetch(`${url}/rest/v1/${sti}`, {
    ...init,
    headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) || {}) },
    signal: AbortSignal.timeout(8000),
  })
}
const tekstSvar = (tekst: string, status: number) => new Response(tekst, { status, headers: CORS_HEADERS })

async function leveranseBestilling(req: Request, payload: any): Promise<Response> {
  const { ordreId, kontaktpersonEpost, avsenderNavn } = payload
  const paaNytt = payload.paaNytt === true
  if (typeof ordreId !== 'string' || !ORDRE_ID_FORM.test(ordreId)) return tekstSvar('Ugyldig ordre-id', 400)
  // Å sende en bestilling på nytt (selv om en er sendt) er bare for admin. Den vanlige, automatiske bestillingen kan en hvilken som helst innlogget ansatt utløse
  // (ved å sette leveransen til «Klar til sending»); selve skrivingen krever uansett en gyldig ansatt-sesjon via RLS.
  if (paaNytt) {
    const s = await sjekkAnsatt(req).catch(() => ({ via: 'ukjent' } as Sjekk))
    if (s.via !== 'ansatt') return tekstSvar('Bare administrator kan sende fraktbestillingen på nytt', 403)
  }
  const cc = typeof kontaktpersonEpost === 'string' && kontaktpersonEpost.trim() ? splittEposter(kontaktpersonEpost) : []
  if (cc.some(e => !EPOST_FORM.test(e))) return tekstSvar('Ugyldig e-postadresse for kontaktpersonen', 400)

  // 1) Leveransen, slik den står i databasen NÅ (ikke slik klienten tror).
  const ordreRes = await restKall(req, `ordrer?id=eq.${encodeURIComponent(ordreId)}&select=id,ordretype,status,ordre_status,kunde,eier,regnr,chassis,leveranse,frakt_bestilt_at,frakt_bestilt_av,frakt_bestilt_til`)
  if (!ordreRes.ok) return tekstSvar('Kunne ikke lese leveransen (' + ordreRes.status + ')', 502)
  const ordrer = await ordreRes.json()
  const o = Array.isArray(ordrer) ? ordrer[0] : null
  if (!o) return tekstSvar('Fant ikke leveransen (eller du er ikke innlogget)', 404)
  if (o.ordretype !== 'leveranse') return tekstSvar('Ordren er ikke en leveranse', 400)
  if (o.status === 'arkivert') return tekstSvar('Leveransen er arkivert', 400)
  if (!paaNytt && o.ordre_status !== 'klar_sending') return tekstSvar('Leveransen står ikke i «Klar til sending»', 409)
  if (!paaNytt && o.frakt_bestilt_at) return tekstSvar('Fraktbestillingen er allerede sendt', 409)

  const l = (o.leveranse && typeof o.leveranse === 'object' && !Array.isArray(o.leveranse)) ? o.leveranse : {}
  const tekst = (x: unknown) => (typeof x === 'string' || typeof x === 'number') ? String(x).trim() : ''
  const fraktselskap = tekst(l.fraktselskap), adresse = tekst(l.adresse), postnr = tekst(l.postnr), sted = tekst(l.sted)
  const merking = tekst(l.merking), kolli = tekst(l.kolli), tlf = tekst(l.kontaktTlf)
  if (!fraktselskap || FRAKTSELSKAP_UTEN_EPOST.includes(fraktselskap)) return tekstSvar('Velg et fraktselskap som bestilles på e-post', 400)
  if (!adresse) return tekstSvar('Mangler leveringsadresse', 400)
  if (!postnr && !sted) return tekstSvar('Mangler postnr/sted', 400)
  if (!tekst(o.kunde)) return tekstSvar('Mangler kunde', 400)

  // 2) Fraktselskapets e-post: slått opp HER i Kontakter, aldri hentet fra klienten (ingen vilkårlig mottaker).
  const innRes = await restKall(req, 'innstillinger?id=eq.1&select=kontakter')
  if (!innRes.ok) return tekstSvar('Kunne ikke lese Kontakter (' + innRes.status + ')', 502)
  const innRader = await innRes.json()
  const kontakter: any[] = Array.isArray(innRader) && Array.isArray(innRader[0]?.kontakter) ? innRader[0].kontakter : []
  const selskap = kontakter.find(k => k && k.type === 'Fraktselskap' && tekst(k.navn).toLowerCase() === fraktselskap.toLowerCase())
  const mottakere = selskap ? splittEposter(selskap.epost) : []
  if (!mottakere.length || mottakere.some(e => !EPOST_FORM.test(e))) return tekstSvar(`Fant ingen gyldig e-post for «${fraktselskap}» i Kontakter`, 400)

  // 3) CLAIM: ta bestillingen atomisk FØR vi sender. WHERE frakt_bestilt_at IS NULL gjør at bare ÉN av to samtidige kall får raden.
  const tidspunkt = new Date().toISOString()
  const claimFilter = paaNytt ? '' : '&frakt_bestilt_at=is.null'
  const claimRes = await restKall(req, `ordrer?id=eq.${encodeURIComponent(ordreId)}${claimFilter}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ frakt_bestilt_at: tidspunkt, frakt_bestilt_av: tekst(avsenderNavn) || null, frakt_bestilt_til: mottakere.join(', ') }),
  })
  if (!claimRes.ok) return tekstSvar('Kunne ikke reservere bestillingen (' + claimRes.status + ')', 502)
  const claimet = await claimRes.json()
  if (!Array.isArray(claimet) || claimet.length === 0) return tekstSvar('Fraktbestillingen er allerede sendt', 409)

  // 4) Selve e-posten. Alt innhold kommer fra databasen (escapet), ikke fra klienten.
  const hentedato = datoVisning(l.onsketHentedato)
  const ident = merking || tekst(o.regnr) || tekst(o.chassis) || 'Leveranse'
  const emne = `Bestilling av frakt - ${ident}`
  const linjer: [string, string][] = [
    ['Hentes hos', 'Telemark Salmakerverksted, Bataljonvegen 25, 3734 Skien'],
    ['Merking', merking || '-'],
    ...(tekst(o.regnr) ? [['Reg.nr', tekst(o.regnr)] as [string, string]] : []),
    ...(tekst(o.chassis) ? [['Chassis.nr', tekst(o.chassis)] as [string, string]] : []),
    ['Kunde', tekst(o.kunde)],
    ['Kontaktperson', tekst(o.eier) || '-'],
    ['Leveres til', [adresse, [postnr, sted].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
    ['Telefon mottaker', tlf || '-'],
    ['Gods / kolli', kolli || '-'],
  ]
  const klarHtml = hentedato ? `<p style="margin:0 0 16px">Forsendelsen er klar for å bli hentet fra ${escHtml(hentedato)}.</p>` : ''
  const klarTekst = hentedato ? `Forsendelsen er klar for å bli hentet fra ${hentedato}.\n\n` : ''
  const html = `
        <p style="margin:0 0 12px">Hei,</p>
        <p style="margin:0 0 12px">Vi ønsker å bestille frakt for følgende forsendelse:</p>
        <p style="margin:0 0 16px">${linjer.map(([k, v]) => `${escHtml(k)}: ${escHtml(v)}`).join('<br>')}</p>
        ${klarHtml}
        ${await signaturHtml(avsenderNavn)}`
  const tekstBody = `Hei,\n\nVi ønsker å bestille frakt for følgende forsendelse:\n\n`
    + linjer.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n'
    + klarTekst
    + signaturTekst(avsenderNavn)
  try {
    await sendEpost(mottakere.join(','), cc.length ? cc.join(',') : undefined, emne, html, tekstBody)
  } catch (e) {
    // FRIGI claimet (bare hvis det fortsatt er vårt), så et nytt forsøk er mulig. Ved «på nytt» gjenopprettes den forrige bestillingen.
    await restKall(req, `ordrer?id=eq.${encodeURIComponent(ordreId)}&frakt_bestilt_at=eq.${encodeURIComponent(tidspunkt)}`, {
      method: 'PATCH',
      body: JSON.stringify({ frakt_bestilt_at: o.frakt_bestilt_at ?? null, frakt_bestilt_av: o.frakt_bestilt_av ?? null, frakt_bestilt_til: o.frakt_bestilt_til ?? null }),
    }).catch(() => {})
    console.error('Leveranse-bestilling: sending feilet, claim frigitt:', e)
    return tekstSvar('E-posten kunne ikke sendes: ' + (e instanceof Error ? e.message : String(e)), 502)
  }
  return new Response(JSON.stringify({ ok: true, til: mottakere.join(', '), bestiltAt: tidspunkt }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
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
      const { fraktselskapEpost, kontaktpersonEpost, forhandler, kontaktperson, chassisNr, dato, avsenderNavn } = payload
      if (!fraktselskapEpost) return new Response('Mangler e-post for fraktselskap', { status: 400, headers: CORS_HEADERS })
      // Henteklar-dato (valgfri, valgt i dialogen "Bestill frakt"): tas med i bestillingen så fraktselskapet vet
      // FRA NÅR bilen kan hentes (bedt om av Henrik 2026-11-02). Uten dato er e-posten som før.
      const klarDato = datoVisning(dato)
      const klarHtml = klarDato ? `<p style="margin:0 0 16px">Bilen er klar for å bli hentet fra ${escHtml(klarDato)}.</p>` : ''
      const klarTekst = klarDato ? `Bilen er klar for å bli hentet fra ${klarDato}.\n\n` : ''
      const emne = `Bestilling av frakt${chassisNr ? ' - ' + chassisNr : ''}`
      const html = `
        <p style="margin:0 0 12px">Hei,</p>
        <p style="margin:0 0 12px">Vi ønsker å bestille frakt for følgende bil:</p>
        <p style="margin:0 0 16px">
          Forhandler: ${escHtml(forhandler || '-')}<br>
          Kontaktperson: ${escHtml(kontaktperson || '-')}<br>
          Chassis.nr: ${escHtml(chassisNr || '-')}
        </p>
        ${klarHtml}
        ${await signaturHtml(avsenderNavn)}`
      const tekst = `Hei,\n\nVi ønsker å bestille frakt for følgende bil:\n\n`
        + `Forhandler: ${forhandler || '-'}\n`
        + `Kontaktperson: ${kontaktperson || '-'}\n`
        + `Chassis.nr: ${chassisNr || '-'}\n\n`
        + klarTekst
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
      const fraSetning = datoVisning(dato) ? ` fra ${datoVisning(dato)}` : ''
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

    if (payload.type === 'leveranse_bestilling') return await leveranseBestilling(req, payload)

    return new Response('Ukjent type: ' + payload.type, { status: 400, headers: CORS_HEADERS })
  } catch (e) {
    console.error('Kritisk feil:', e)
    return new Response(String(e), { status: 500, headers: CORS_HEADERS })
  }
})
