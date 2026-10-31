// Push-varsel til ADMINISTRATORER når en ny bestilling fra Forhandlerportalen kommer inn (G9). Henrik 2026-10-30: «admin bare».
// Best-effort: aldri noe som kan endre svaret til portalen eller stoppe en bestilling (index.ts kaller alt dette i try/catch med tidsavbrudd).
// Ingen eksterne importer og ingen Deno-API-er her (web-push sendes via en injisert funksjon fra index.ts), så Vitest kan teste logikken direkte.
//
//  * ÉN gang per bestilling: raden i portal_bestillinger «claimes» atomisk (`push_sendt_at` settes bare hvis den er NULL) FØR noe sendes. En ny sending av samme
//    bestilling fra portalen (retry) eller to samtidige kall gir dermed aldri to varsler. Prisen er at et varsel som feiler etter claimet ikke prøves på nytt.
//  * Bare statuser en admin skal gjøre noe med: ny ordre (bekreft), ny løs Admin-ark-rad (serienummer) og alt som venter på avklaring. «koblet» (bilen var
//    allerede på en ordre hos samme forhandler), «avvist» og «bekreftet» gir aldri varsel.
//  * Teksten bygges her av DATABASERADEN (Kontakter-navn, merke/modell fra oversettelsen, chassis/serienummer), aldri av noe selgeren har skrevet fritt.
//    Mottakere er aktive ansatte med rolle admin som har et push-abonnement.

export const PUSH_STATUSER = [
  'ny_ordre', 'admin_ark', 'venter_forhandler', 'venter_modell', 'avklaring_chassis', 'avklaring_annen_forhandler', 'avklaring_tak',
] as const

const AVKLARING_TEKST: Record<string, string> = {
  venter_forhandler: 'forhandleren er ikke koblet til Kontakter',
  venter_modell: 'modellen mangler oversettelse',
  avklaring_chassis: 'chassis.nr må avklares',
  avklaring_annen_forhandler: 'bilen står på en annen forhandler',
  avklaring_tak: 'for mange ubekreftede ordrer hos forhandleren',
}

export type BestillingRad = {
  forhandler_navn?: string | null
  merke?: string | null
  modell?: string | null
  ident?: string | null
  ident_type?: string | null
  ordre_id?: string | null
}
export type Varsel = { title: string; body: string; url: string }

// Fjerner kontrolltegn og retningstegn, samler mellomrom og kapper: varselet vises på en låseskjerm.
function ren(tekst: unknown, maks: number): string {
  const t = typeof tekst === 'string' ? tekst : ''
  const uten = t.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
  return uten.length > maks ? uten.slice(0, maks - 1) + '…' : uten
}

export function byggVarsel(status: string, rad: BestillingRad): Varsel | null {
  if (!(PUSH_STATUSER as readonly string[]).includes(status)) return null
  const forhandler = ren(rad.forhandler_navn, 60) || 'Ukjent forhandler'
  const bil = ren(`${rad.merke ?? ''} ${rad.modell ?? ''}`, 50)
  const ident = ren(rad.ident, 40)
  const erBestillingsnr = rad.ident_type === 'BESTILLINGSNR'
  const identTekst = ident ? (rad.ident_type === 'SERIENUMMER' ? `serienr ${ident}` : erBestillingsnr ? `bestillingsnr ${ident}` : ident) : ''
  const ordreId = typeof rad.ordre_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(rad.ordre_id) ? rad.ordre_id : null
  const delerOrdre = [forhandler, bil, identTekst].filter(Boolean).join(' · ')

  if (status === 'ny_ordre') {
    return { title: 'Ny bestilling fra portalen', body: `${delerOrdre} (ikke bekreftet)`, url: '/salmakern.html' + (ordreId ? `?ordre=${ordreId}` : '') }
  }
  if (status === 'admin_ark') {
    return { title: erBestillingsnr ? 'Ny bestilling (bestillingsnr) fra portalen' : 'Ny serienummer-bestilling fra portalen', body: `${delerOrdre} - ligger i Admin-ark`, url: '/salmakern.html' }
  }
  return { title: 'Bestilling fra portalen trenger avklaring', body: `${delerOrdre} - ${AVKLARING_TEKST[status] ?? 'må avklares'}`, url: '/salmakern.html' }
}

// Minimale former for det vi bruker av supabase-klienten og web-push (testene gir falske).
type Q = any
export type Abonnement = { endpoint: string; p256dh: string; auth: string }
export type Sender = (sub: Abonnement, melding: string) => Promise<void>
export type PushUtfall = { hoppet?: 'ikke_aktuell' | 'ingen_vapid' | 'allerede_sendt' | 'ingen_mottakere' | 'ingen_varsel'; sendt: number; feilet: number; fjernet: number; feil?: string }

// `hentSender` gir en funksjon som sender til ett abonnement, eller null når web-push ikke er satt opp (mangler VAPID-hemmeligheter). Den kalles FØR claimet, så et
// manglende oppsett aldri bruker opp varselet for en bestilling.
export async function sendPushTilAdmin(supabase: Q, bestillingId: string, status: string, hentSender: () => Promise<Sender | null>): Promise<PushUtfall> {
  const tom: PushUtfall = { sendt: 0, feilet: 0, fjernet: 0 }
  if (!(PUSH_STATUSER as readonly string[]).includes(status)) return { ...tom, hoppet: 'ikke_aktuell' }
  const send = await hentSender()
  if (!send) return { ...tom, hoppet: 'ingen_vapid' }

  // 1. Claim: bare den som setter push_sendt_at (fra NULL) sender.
  const claim = await supabase.from('portal_bestillinger')
    .update({ push_sendt_at: new Date().toISOString() })
    .eq('portal_bestilling_id', bestillingId)
    .is('push_sendt_at', null)
    .select('forhandler_navn, merke, modell, ident, ident_type, ordre_id')
  if (claim.error) return { ...tom, feil: 'claim' }
  const rad = (claim.data ?? [])[0]
  if (!rad) return { ...tom, hoppet: 'allerede_sendt' }

  const varsel = byggVarsel(status, rad)
  if (!varsel) return { ...tom, hoppet: 'ingen_varsel' }

  // 2. Mottakere: aktive admin-ansatte med abonnement.
  const adminer = await supabase.from('ansatte').select('id').eq('rolle', 'admin').eq('aktiv', true)
  if (adminer.error) return { ...tom, feil: 'adminer' }
  const ider = (adminer.data ?? []).map((a: { id: number }) => a.id)
  if (!ider.length) return { ...tom, hoppet: 'ingen_mottakere' }
  const subs = await supabase.from('push_abonnement').select('endpoint, p256dh, auth').in('ansatt_id', ider)
  if (subs.error) return { ...tom, feil: 'abonnement' }
  const mottakere: Abonnement[] = subs.data ?? []
  if (!mottakere.length) return { ...tom, hoppet: 'ingen_mottakere' }

  // 3. Send til hver enhet; utløpte abonnement (404/410) ryddes bort som i send-push.
  const melding = JSON.stringify(varsel)
  const utfall: PushUtfall = { ...tom }
  await Promise.allSettled(mottakere.map(async (sub) => {
    try {
      await send(sub, melding)
      utfall.sendt++
    } catch (e) {
      utfall.feilet++
      const kode = (e as { statusCode?: number })?.statusCode
      if (kode === 404 || kode === 410) {
        try {
          await supabase.from('push_abonnement').delete().eq('endpoint', sub.endpoint)
          utfall.fjernet++
        } catch { /* opprydding er best-effort */ }
      }
    }
  }))
  return utfall
}
