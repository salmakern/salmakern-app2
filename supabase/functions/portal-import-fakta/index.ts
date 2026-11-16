// Gir Forhandlerportalen et SKRIVEBESKYTTET øyeblikksbilde av aktive bil-ordrer (server til server), til bruk for import av aktive biler i selgernes
// «Mine bestillinger» (etappe 1). Portalen HENTER (pull) og eier all matching, oppretting og skjuling selv; appen skriver aldri til portalen og denne
// funksjonen skriver aldri noe. All uthenting og rensing ligger i Postgres-funksjonen portal_import_fakta (stable, security invoker, bare service_role,
// testet i en transaksjon som rulles tilbake); denne funksjonen er bare døra inn:
//  * Autentisering: x-salmakern-hent-secret = SALMAKERN_HENT_SECRET (valg 9: samme hemmelighet som selgerlisten, nå brukt i motsatt retning), sammenlignet i
//    konstant tid. Både miljøvariabelen og headerverdien trimmes (en hemmelighet limt inn med linjeskift skal ikke gi evig 401; se portalens salmakernHent.ts).
//    Mangler den eller er den kortere enn 32 tegn svarer funksjonen 500 (aldri åpen). Ingen andre hemmelighets-headere åpner noe. I tillegg krever
//    Supabase-porten en gyldig JWT (anon-nøkkelen) fordi funksjonen er utrullet med standard verify_jwt. Hemmeligheten gir lesetilgang til kundenavn,
//    kontaktpersoner og chassis.nr for alle aktive ordrer: det er en bevisst følge av valg 9 (egen hemmelighet er billig å innføre senere).
//  * Validering og avgrensning av input/output: logikk.ts (ren, testet i test/portal-import-fakta.test.js). Bare `versjon` (1) og `ider` slippes gjennom.
//  * Databasen nås med service_role-nøkkelen fra miljøet (SUPABASE_SERVICE_ROLE_KEY, satt av Supabase): ingenting hardkodes.
//  * Et vellykket svar er kontraktens fakta (versjon 1); feilsvar er bare {kode, felt?}, aldri databasetekst. 400/401/405/413/422 er permanente (feil hos oss
//    eller kapasitet), 500 ikke_konfigurert og 502 intern_feil betyr «prøv igjen i neste kjøring» (portalens kjøring er idempotent).
//  * Logger én JSON-linje per kall uten verdier (ingen id-er, navn, chassis eller hemmeligheter).
//  * INGEN skrivende kall og ingen utgående nettverkskall: det eneste databasekallet er rpc('portal_import_fakta'). Ingen push, ingen e-post, ingen import fra
//    søsken-funksjoner (kildetekst-testen V6 vokter dette).
//  * Ingen CORS: nettlesere skal aldri kalle denne.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { MAKS_BODY_BYTES, mapFakta, mapFeil, parseForesporsel } from './logikk.ts'

const FN = 'portal-import-fakta'
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

// Bare faste koder og tall (aldri id-er, navn, chassis eller hemmeligheter).
function logg(utfall: string, start: number, ekstra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ portal_import_fakta: 1, fn: FN, utfall, ms: Date.now() - start, ...ekstra }))
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

    // 2. Body: størrelsesgrense (både oppgitt og faktisk lest), gyldig JSON, allowlist.
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
    const ider = input.foresporsel.ider

    // 3. Selve jobben: én rpc, service_role fra miljøet.
    const url = Deno.env.get('SUPABASE_URL')
    const nokkel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !nokkel) {
      logg('ikke_konfigurert', start, { http: 500 })
      return svar({ kode: 'ikke_konfigurert' }, 500)
    }
    const supabase = createClient(url, nokkel, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await supabase
      .rpc('portal_import_fakta', { p_ider: ider })
      .abortSignal(AbortSignal.timeout(RPC_TIDSAVBRUDD_MS))

    if (error) {
      const feil = mapFeil(error)
      // Bare SQLSTATE/PGRST-koden (aldri meldingen eller detaljene, som kan inneholde verdier): skiller f.eks. 57014 (tidsavbrudd i databasen) og PGRST202
      // (funksjonen er ikke kjørt inn ennå) fra en annen intern feil uten å røpe noe.
      logg(feil.kode, start, {
        http: feil.status, antall_ider: ider.length,
        sqlstate: typeof error.code === 'string' ? error.code.slice(0, 12) : '',
      })
      return svar({ kode: feil.kode, ...(feil.felt ? { felt: feil.felt } : {}) }, feil.status)
    }
    const fakta = mapFakta(data)
    if (!fakta) {
      logg('uventet_svar', start, { http: 502, antall_ider: ider.length })
      return svar({ kode: 'intern_feil' }, 502)
    }

    logg('ok', start, { http: 200, antall_aktive: fakta.aktive.length, antall_utvalgte: fakta.utvalgte.length, antall_ider: ider.length })
    return svar(fakta)
  } catch (e) {
    // Aldri feilteksten til portalen (kan inneholde nøkler/URL-er); bare til loggen, uten verdier fra input.
    logg('unntak', start, { http: 502, feiltype: e instanceof Error ? e.name : typeof e })
    return svar({ kode: 'intern_feil' }, 502)
  }
})
