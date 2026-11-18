// Trinn 5 av «Én produktliste»: tar imot Resend sitt varsel «email.received» når en selger videresender en bestilling fra innkjøpsportalen til
// bestillingsadressen (Resend inbound på et eget underdomene, se supabase/README.md «Bestilling på e-post»). IKKE UTRULLET: krever Henriks ja, en MX-post
// (DNS, varsle Henrik først) og hemmelighetene under.
//  * Døra: Resend signerer varselet (Svix). RESEND_INBOUND_WEBHOOK_SECRET (whsec_…) kontrolleres i konstant tid, og tidsstempelet må være innen 5 minutter.
//    Funksjonen rulles ut med --no-verify-jwt (Resend sender ingen Supabase-JWT); signaturen er eneste nøkkel.
//  * Bare e-post til EPOST_BESTILLING_ADRESSE behandles (annet på underdomenet ignoreres).
//  * Innholdet hentes fra Resend (varselet har bare metadata) med RESEND_API_KEY, tolkes og vurderes (flyt.ts, tolk.ts, logikk.ts), og lagres med
//    rpc('epost_bestilling_lagre') (service_role). Selve e-posten lagres aldri.
//  * Svar: 200 når e-posten er behandlet eller bevisst ignorert; 5xx ved midlertidig feil, så Resend prøver igjen (lagringen er idempotent per e-post og rad).
//  * Logger én JSON-linje per kall uten verdier (ingen adresser, chassis, navn eller hemmeligheter). Ingen Fiken, ingen e-post ut, ingen push.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { behandleEpost, type MottattEpost } from './flyt.ts'
import { signaturOk } from './signatur.ts'

const FN = 'epost-bestilling'
const MAKS_BODY = 256 * 1024

function svar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
function logg(utfall: string, start: number, ekstra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ fn: FN, utfall, ms: Date.now() - start, ...ekstra }))
}
const tilListe = (to: unknown): string[] => (Array.isArray(to) ? to : [to]).map(x => String((x as { email?: string })?.email ?? x ?? '').toLowerCase())

Deno.serve(async (req) => {
  const start = Date.now()
  try {
    if (req.method !== 'POST') { logg('metode', start, { http: 405 }); return svar({ kode: 'metode_ikke_tillatt' }, 405) }
    const hemmelighet = (Deno.env.get('RESEND_INBOUND_WEBHOOK_SECRET') ?? '').trim()
    const apiNokkel = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
    const adresse = (Deno.env.get('EPOST_BESTILLING_ADRESSE') ?? '').trim().toLowerCase()
    if (!hemmelighet || !apiNokkel || !adresse) { logg('ikke_konfigurert', start, { http: 500 }); return svar({ kode: 'ikke_konfigurert' }, 500) }
    const lengde = Number(req.headers.get('content-length') ?? '0')
    if (lengde > MAKS_BODY) { logg('for_stor', start, { http: 413 }); return svar({ kode: 'for_stor' }, 413) }
    const body = await req.text()
    if (body.length > MAKS_BODY) { logg('for_stor', start, { http: 413 }); return svar({ kode: 'for_stor' }, 413) }
    const ok = await signaturOk(hemmelighet, req.headers.get('svix-id') ?? '', req.headers.get('svix-timestamp') ?? '', body, req.headers.get('svix-signature') ?? '')
    if (!ok) { logg('uautorisert', start, { http: 401 }); return svar({ kode: 'uautorisert' }, 401) }

    let varsel: { type?: string; data?: { email_id?: string; id?: string; to?: unknown } }
    try { varsel = JSON.parse(body) } catch { logg('ugyldig_json', start, { http: 400 }); return svar({ kode: 'ugyldig_json' }, 400) }
    if (varsel?.type !== 'email.received') { logg('ignorert_type', start); return svar({ ok: true, ignorert: 'type' }) }
    if (!tilListe(varsel.data?.to).includes(adresse)) { logg('ignorert_mottaker', start); return svar({ ok: true, ignorert: 'mottaker' }) }
    const emailId = String(varsel.data?.email_id ?? varsel.data?.id ?? '')

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const db = createClient(url, service, { auth: { persistSession: false } })
    const resultat = await behandleEpost(emailId, {
      hentEpost: async (id) => {
        const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${apiNokkel}` } })
        if (r.status === 404) return null
        if (!r.ok) throw new Error('resend_' + r.status)
        return await r.json() as MottattEpost
      },
      hentData: async () => {
        const [p, f, i] = await Promise.all([
          db.from('portal_produkter').select('portal_id, type, modell_slug, modell_navn, fiken_nummer, nummer_status, navn, app_rolle'),
          db.from('fiken_priser').select('produktnummer, pris_kr'),
          db.from('innstillinger').select('kontakter').eq('id', 1).maybeSingle(),
        ])
        if (p.error || f.error || i.error) throw new Error('les_feil')
        return { produkter: p.data ?? [], fikenPriser: f.data ?? [], kontakter: (i.data?.kontakter as never) ?? [] }
      },
      lagre: async (p) => {
        const { data, error } = await db.rpc('epost_bestilling_lagre', { p })
        if (error) throw new Error('lagre_feil_' + (error.code ?? ''))
        return data
      },
    })
    logg(resultat.utfall, start, { rader: resultat.rader ?? 0, sikre: resultat.sikre ?? 0 })
    return svar({ ok: true, utfall: resultat.utfall })
  } catch (e) {
    logg('intern_feil', start, { http: 502, feil: String((e as Error)?.message ?? '').slice(0, 40) })
    return svar({ kode: 'intern_feil' }, 502)
  }
})
