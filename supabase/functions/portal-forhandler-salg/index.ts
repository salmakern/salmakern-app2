// Gir Forhandlerportalens Kalkyle «lønnsomhet per forhandler» et SKRIVEBESKYTTET, aggregert øyeblikksbilde av faktisk fakturerte bil-ordre (server til
// server). Portalen bruker dette til å sammenligne faktisk fakturert beløp mot Kalkyle sin beregnede kostnad per modell. Appen skriver aldri til
// portalen, og denne funksjonen skriver aldri noe. All uthenting og gruppering ligger i Postgres-funksjonen portal_forhandler_salg (stable,
// security invoker, bare service_role, testet i en transaksjon som rulles tilbake); denne funksjonen er bare døra inn - samme konstruksjon som
// portal-import-fakta:
//  * Autentisering: x-salmakern-hent-secret = SALMAKERN_HENT_SECRET (samme hemmelighet som selgerlisten/rabattene/import-fakta), sammenlignet i
//    konstant tid. Mangler den eller er den kortere enn 32 tegn svarer funksjonen 500 (aldri åpen). Supabase-porten krever i tillegg en gyldig JWT
//    (anon-nøkkelen) siden funksjonen er utrullet med standard verify_jwt.
//  * Validering og avgrensning av input/output: logikk.ts (ren, testet i test/portal-forhandler-salg.test.js). Bare `versjon` (1) og
//    `forhandler_kontakt_ider` slippes gjennom.
//  * Databasen nås med service_role-nøkkelen fra miljøet (SUPABASE_SERVICE_ROLE_KEY, satt av Supabase): ingenting hardkodes.
//  * Et vellykket svar er kontraktens fakta (versjon 1); feilsvar er bare {kode, felt?}, aldri databasetekst.
//  * Logger én JSON-linje per kall uten verdier (ingen forhandler-id-er eller beløp).
//  * INGEN skrivende kall og ingen utgående nettverkskall: det eneste databasekallet er rpc('portal_forhandler_salg'). Ingen push, ingen e-post.
//  * Ingen CORS: nettlesere skal aldri kalle denne.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { MAKS_BODY_BYTES, mapFeil, mapSalg, parseForesporsel } from './logikk.ts'

const FN = 'portal-forhandler-salg'
const MIN_HEMMELIGHET_LENGDE = 32
const RPC_TIDSAVBRUDD_MS = 25_000

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
  console.log(JSON.stringify({ portal_forhandler_salg: 1, fn: FN, utfall, ms: Date.now() - start, ...ekstra }))
}

Deno.serve(async (req) => {
  const start = Date.now()
  try {
    if (req.method !== 'POST') {
      logg('metode', start, { http: 405 })
      return svar({ kode: 'metode_ikke_tillatt' }, 405)
    }

    // 1. Hemmeligheten FØR noe annet (også før body leses).
    const hemmelighet = (Deno.env.get('SALMAKERN_HENT_SECRET') ?? '').trim()
    if (hemmelighet.length < MIN_HEMMELIGHET_LENGDE) {
      logg('ikke_konfigurert', start, { http: 500 })
      return svar({ kode: 'ikke_konfigurert' }, 500)
    }
    const sendt = (req.headers.get('x-salmakern-hent-secret') ?? '').trim()
    if (sendt === '' || !(await likt(sendt, hemmelighet))) {
      logg('uautorisert', start, { http: 401, har_header: sendt !== '' })
      return svar({ kode: 'uautorisert' }, 401)
    }

    // 2. Body: størrelsesgrense, gyldig JSON, allowlist.
    const lengde = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(lengde) && lengde > MAKS_BODY_BYTES) {
      logg('for_stor', start, { http: 413 })
      return svar({ kode: 'ugyldig_input', felt: 'body' }, 413)
    }
    const tekst = await req.text()
    if (new TextEncoder().encode(tekst).length > MAKS_BODY_BYTES) {
      logg('for_stor', start, { http: 413 })
      return svar({ kode: 'ugyldig_input', felt: 'body' }, 413)
    }
    let raa: unknown
    try {
      raa = JSON.parse(tekst)
    } catch {
      logg('ugyldig_json', start, { http: 400 })
      return svar({ kode: 'ugyldig_input', felt: 'body' }, 400)
    }
    const input = parseForesporsel(raa)
    if (!input.ok) {
      logg('ugyldig_input', start, { http: 400, felt: input.felt })
      return svar({ kode: 'ugyldig_input', felt: input.felt }, 400)
    }
    const ider = input.foresporsel.forhandlerKontaktIder

    // 3. Selve jobben: én rpc, service_role fra miljøet.
    const url = Deno.env.get('SUPABASE_URL')
    const nokkel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !nokkel) {
      logg('ikke_konfigurert', start, { http: 500 })
      return svar({ kode: 'ikke_konfigurert' }, 500)
    }
    const supabase = createClient(url, nokkel, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await supabase
      .rpc('portal_forhandler_salg', { p_forhandler_kontakt_ider: ider })
      .abortSignal(AbortSignal.timeout(RPC_TIDSAVBRUDD_MS))

    if (error) {
      const feil = mapFeil(error)
      logg(feil.kode, start, {
        http: feil.status, antall_ider: ider?.length ?? 0,
        sqlstate: typeof error.code === 'string' ? error.code.slice(0, 12) : '',
      })
      return svar({ kode: feil.kode, ...(feil.felt ? { felt: feil.felt } : {}) }, feil.status)
    }
    const salg = mapSalg(data)
    if (!salg) {
      logg('uventet_svar', start, { http: 502 })
      return svar({ kode: 'intern_feil' }, 502)
    }

    logg('ok', start, { http: 200, antall_grupper: salg.grupper.length, antall_ider: ider?.length ?? 0 })
    return svar(salg)
  } catch (e) {
    logg('unntak', start, { http: 502, feiltype: e instanceof Error ? e.name : typeof e })
    return svar({ kode: 'intern_feil' }, 502)
  }
})
