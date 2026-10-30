// Tar imot ÉN bestilling fra Forhandlerportalen (server til server) og gir den til Postgres-funksjonen portal_koble_bestilling, som enten kobler den til
// en eksisterende ordre, oppretter en ny ordre «På vei» (ikke bekreftet fra portal), lager en løs rad i Admin-ark (serienummer) eller legger den til
// avklaring. All forretningslogikk ligger i Postgres-funksjonen (testet i en transaksjon som rulles tilbake); denne funksjonen er bare døra inn:
//  * Autentisering: x-sync-secret = PORTAL_BESTILLING_SECRET (egen hemmelighet, aldri FIKEN_SYNC_SECRET), sammenlignet i konstant tid. Ingen myk modus:
//    det finnes ingen gamle kallere, så den håndhever fra dag én. Mangler hemmeligheten i miljøet svarer den 500 (aldri åpen). I tillegg krever
//    Supabase-porten en gyldig JWT (anon-nøkkelen) fordi funksjonen er utrullet med standard verify_jwt.
//  * Validering og avgrensning av input/output: logikk.ts (ren, testet i test/portal-bestilling.test.js). Bare ti navngitte felt slippes gjennom,
//    `kjor_pa_nytt` kastes alltid.
//  * Databasen nås med service_role-nøkkelen fra miljøet (SUPABASE_SERVICE_ROLE_KEY, satt av Supabase): ingenting hardkodes. Postgres-funksjonen kan
//    BARE kalles av service_role.
//  * Et vellykket svar til portalen er bare {kode, status, ordre_id?}; feilsvar er bare {kode, felt?}. Detaljer (også andre forhandleres navn) står kun i
//    portal_bestillinger.detalj (bare admin). 200 er endelig (også kode «trenger_avklaring»: mottatt, ikke feil, ikke retry); 400/401/405/413 er permanente;
//    500 ikke_konfigurert og 502 intern_feil betyr «prøv igjen med SAMME bestilling_id» (idempotent, også etter tidsavbrudd midt i en transaksjon).
//  * Logger én JSON-linje per kall uten verdier (ingen chassis, e-poster eller navn).
//  * Push-varsel til ADMINISTRATORER (push.ts, G9) når en ny bestilling kommer inn eller venter på avklaring: best-effort ETTER at bestillingen er behandlet, nøyaktig én gang
//    per bestilling (claim på portal_bestillinger.push_sendt_at), tekst bygget av databaseraden, og kan aldri endre svaret til portalen (tidsavbrudd 6 s).
//  * Ingen CORS: nettlesere skal aldri kalle denne.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { MAKS_BODY_BYTES, mapFeil, mapSvar, parseInnkommende } from './logikk.ts'
import { sendPushTilAdmin } from './push.ts'

const FN = 'portal-bestilling'
const SECRET = Deno.env.get('PORTAL_BESTILLING_SECRET')
const RPC_TIDSAVBRUDD_MS = 25_000
const PUSH_TIDSAVBRUDD_MS = 6_000

// web-push lastes først når et varsel faktisk skal sendes (og bare hvis VAPID-hemmelighetene er satt opp), så en feil her aldri kan ramme selve bestillingen.
// Samme pakke og hemmeligheter som send-push (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL).
async function hentWebPushSender() {
  const offentlig = Deno.env.get('VAPID_PUBLIC_KEY')
  const privat = Deno.env.get('VAPID_PRIVATE_KEY')
  const epost = Deno.env.get('VAPID_EMAIL')
  if (!offentlig || !privat || !epost) return null
  const webpush = (await import('npm:web-push@3.6.7')).default
  webpush.setVapidDetails(`mailto:${epost}`, offentlig, privat)
  return async (sub: { endpoint: string; p256dh: string; auth: string }, melding: string) => {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, melding)
  }
}

// Push-varsel til administratorer (G9). Best-effort: alle feil og tidsavbrudd svelges, og resultatet er bare tall til loggen (aldri verdier).
async function pushBestEffort(supabase: unknown, bestillingId: string, status: string): Promise<Record<string, unknown>> {
  let timer: number | undefined
  try {
    return await Promise.race([
      sendPushTilAdmin(supabase, bestillingId, status, hentWebPushSender) as Promise<Record<string, unknown>>,
      new Promise<Record<string, unknown>>((fullfor) => { timer = setTimeout(() => fullfor({ feil: 'tidsavbrudd' }), PUSH_TIDSAVBRUDD_MS) }),
    ])
  } catch (e) {
    return { feil: e instanceof Error ? e.name : 'ukjent' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function likt(a: string, b: string): Promise<boolean> {
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

function svar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

function logg(utfall: string, start: number, ekstra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ portal_bestilling: 1, fn: FN, utfall, ms: Date.now() - start, ...ekstra }))
}

Deno.serve(async (req) => {
  const start = Date.now()
  try {
    if (req.method !== 'POST') {
      logg('metode', start)
      return svar({ kode: 'metode_ikke_tillatt' }, 405)
    }

    // 1. Hemmeligheten FØR noe annet (også før body leses).
    if (!SECRET) {
      logg('ikke_konfigurert', start)
      return svar({ kode: 'ikke_konfigurert' }, 500)
    }
    const sendt = req.headers.get('x-sync-secret') ?? ''
    if (sendt === '' || !(await likt(sendt, SECRET))) {
      logg('uautorisert', start, { har_header: sendt !== '' })
      return svar({ kode: 'uautorisert' }, 401)
    }

    // 2. Body: størrelsesgrense, gyldig JSON, allowlist.
    const lengde = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(lengde) && lengde > MAKS_BODY_BYTES) {
      logg('for_stor', start)
      return svar({ kode: 'ugyldig_input', felt: 'body' }, 413)
    }
    const tekst = await req.text()
    if (new TextEncoder().encode(tekst).length > MAKS_BODY_BYTES) {
      logg('for_stor', start)
      return svar({ kode: 'ugyldig_input', felt: 'body' }, 413)
    }
    let raa: unknown
    try {
      raa = JSON.parse(tekst)
    } catch {
      logg('ugyldig_json', start)
      return svar({ kode: 'ugyldig_input', felt: 'body' }, 400)
    }
    const input = parseInnkommende(raa)
    if (!input.ok) {
      logg('ugyldig_input', start, { felt: input.felt })
      return svar({ kode: 'ugyldig_input', felt: input.felt }, 400)
    }

    // 3. Selve jobben: én RPC, service_role fra miljøet.
    const url = Deno.env.get('SUPABASE_URL')
    const nokkel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !nokkel) {
      logg('ikke_konfigurert', start)
      return svar({ kode: 'ikke_konfigurert' }, 500)
    }
    const supabase = createClient(url, nokkel, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await supabase
      .rpc('portal_koble_bestilling', { p: input.p })
      .abortSignal(AbortSignal.timeout(RPC_TIDSAVBRUDD_MS))

    if (error) {
      const feil = mapFeil(error)
      // Bare SQLSTATE/PGRST-koden (aldri meldingen eller detaljene, som kan inneholde verdier) og om det var et tidsavbrudd, så en feil i loggen kan
      // skilles fra en annen uten å røpe noe: 57014 = statement timeout, 40P01 = vranglås, PGRST* = PostgREST, tom kode + tidsavbrudd = vår egen 25 s.
      const melding = typeof error.message === 'string' ? error.message : ''
      logg(feil.kode, start, {
        http: feil.status, felt: feil.felt, ignorerte: input.ignorerte,
        sqlstate: typeof error.code === 'string' ? error.code.slice(0, 12) : '',
        tidsavbrudd: /^(TimeoutError|AbortError)\b/.test(melding),
      })
      return svar({ kode: feil.kode, ...(feil.felt ? { felt: feil.felt } : {}) }, feil.status)
    }
    const ut = mapSvar(data)
    if (!ut) {
      logg('uventet_svar', start, { ignorerte: input.ignorerte })
      return svar({ kode: 'intern_feil' }, 502)
    }
    // Push-varsel til administratorer (G9): best-effort, ETTER at bestillingen er behandlet, og kan aldri endre svaret til portalen.
    const push = await pushBestEffort(supabase, input.p.bestilling_id.replace(/^ +| +$/g, ''), ut.status)
    logg(ut.status, start, { kode: ut.kode, ignorerte: input.ignorerte, push })
    return svar(ut)
  } catch (e) {
    // Aldri feilteksten til portalen (kan inneholde nøkler/URL-er); bare til loggen, uten verdier fra input.
    logg('unntak', start, { feiltype: e instanceof Error ? e.name : typeof e })
    return svar({ kode: 'intern_feil' }, 502)
  }
})
