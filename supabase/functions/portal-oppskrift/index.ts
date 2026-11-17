// Gir Forhandlerportalen lagervarene og oppskriften til en variant/et tillegg, og lagrer delene derfra (trinn 1 av «Én produktliste», Henrik 17.11.2026).
// Portalen er fasit for navn og pris; delene (lager_oppskrifter) bor her. Bygget etter portal-timer-fakta:
//  * Autentisering: x-salmakern-oppskrift-secret = SALMAKERN_OPPSKRIFT_SECRET, EGEN hemmelighet (denne funksjonen SKRIVER, i motsetning til hente-funksjonene som
//    deler SALMAKERN_HENT_SECRET). Sammenlignet i konstant tid, trimmet. Mangler den eller er den kortere enn 32 tegn svarer funksjonen 500 (aldri åpen).
//    I tillegg krever Supabase-porten en gyldig JWT (anon-nøkkelen), standard verify_jwt.
//  * Metode: bare POST. Hemmeligheten sjekkes før body leses.
//  * Input/svar valideres i logikk.ts (ren, testet i test/portal-oppskrift.test.js). All databaselogikk ligger i portal_oppskrift_hent / portal_oppskrift_lagre
//    (migrasjon 20261117200000, testet i supabase/tester/portal_oppskrift_TEST_body.sql). Det eneste databasekallet er én rpc.
//  * Feilsvar er bare {kode, felt?}. 400/401/405/409/413/422 er permanente, 500 ikke_konfigurert og 502 intern_feil betyr «prøv igjen senere».
//  * Logger én JSON-linje per kall uten verdier (ingen navn, numre eller hemmeligheter).
//  * Ingen utgående nettverkskall, ingen push, ingen e-post, ingen Fiken. Ingen CORS: nettlesere skal aldri kalle denne.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { MAKS_BODY_BYTES, mapFeil, mapHent, mapLagre, parseForesporsel, rpcFor } from './logikk.ts'

const FN = 'portal-oppskrift'
const MIN_HEMMELIGHET_LENGDE = 32
const RPC_TIDSAVBRUDD_MS = 20_000

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
  console.log(JSON.stringify({ portal_oppskrift: 1, fn: FN, utfall, ms: Date.now() - start, ...ekstra }))
}

Deno.serve(async (req) => {
  const start = Date.now()
  try {
    if (req.method !== 'POST') {
      logg('metode', start, { http: 405 })
      return svar({ kode: 'metode_ikke_tillatt' }, 405)
    }

    const hemmelighet = (Deno.env.get('SALMAKERN_OPPSKRIFT_SECRET') ?? '').trim()
    if (hemmelighet.length < MIN_HEMMELIGHET_LENGDE) {
      logg('ikke_konfigurert', start, { http: 500 })
      return svar({ kode: 'ikke_konfigurert' }, 500)
    }
    const sendt = (req.headers.get('x-salmakern-oppskrift-secret') ?? '').trim()
    if (sendt === '' || !(await likt(sendt, hemmelighet))) {
      logg('uautorisert', start, { http: 401, har_header: sendt !== '' })
      return svar({ kode: 'uautorisert' }, 401)
    }

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
    const parsed = parseForesporsel(raa)
    if (!parsed.ok) {
      logg('ugyldig_input', start, { http: 400, felt: parsed.felt })
      return svar({ kode: 'ugyldig_input', felt: parsed.felt }, 400)
    }
    const handling = parsed.input.handling

    const url = Deno.env.get('SUPABASE_URL')
    const nokkel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !nokkel) {
      logg('ikke_konfigurert', start, { http: 500 })
      return svar({ kode: 'ikke_konfigurert' }, 500)
    }
    const supabase = createClient(url, nokkel, { auth: { persistSession: false, autoRefreshToken: false } })
    const { navn, args } = rpcFor(parsed.input)
    const { data, error } = await supabase.rpc(navn, args).abortSignal(AbortSignal.timeout(RPC_TIDSAVBRUDD_MS))

    if (error) {
      const feil = mapFeil(error)
      logg(feil.kode, start, { http: feil.status, handling, sqlstate: typeof error.code === 'string' ? error.code.slice(0, 12) : '' })
      return svar(feil.felt ? { kode: feil.kode, felt: feil.felt } : { kode: feil.kode }, feil.status)
    }
    const ut = handling === 'hent' ? mapHent(data) : mapLagre(data)
    if (!ut) {
      logg('uventet_svar', start, { http: 502, handling })
      return svar({ kode: 'intern_feil' }, 502)
    }
    logg('ok', start, handling === 'hent'
      ? { http: 200, handling, antall_varer: (ut as { varer: unknown[] }).varer.length }
      : { http: 200, handling, status: (ut as { status: string }).status, antall_deler: (ut as { antallDeler: number }).antallDeler })
    return svar(ut)
  } catch (e) {
    logg('unntak', start, { http: 502, feiltype: e instanceof Error ? e.name : typeof e })
    return svar({ kode: 'intern_feil' }, 502)
  }
})
