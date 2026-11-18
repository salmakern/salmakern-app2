// Trinn 5: hele flyten for én mottatt e-post, uten Deno og uten nettverk (avhengighetene sendes inn), testet i test/epost-bestilling.test.js.
// index.ts gjør bare signaturkontroll av Resend-varselet og kobler inn de ekte avhengighetene.
import { htmlTilTekst, tolkEpost } from './tolk.ts'
import { avsenderAdresse, finnSelger, vurderRad, type FikenPris, type Kontakt, type Produkt } from './logikk.ts'

export type Autentisering = { spf?: string; dkim?: string; dmarc?: string } | null
export type MottattEpost = { from?: string | null; to?: unknown; html?: string | null; text?: string | null; headers?: unknown; authentication?: Autentisering }
export type Avhengigheter = {
  hentEpost: (id: string) => Promise<MottattEpost | null>
  hentData: () => Promise<{ produkter: Produkt[]; fikenPriser: FikenPris[]; kontakter: Kontakt[] }>
  lagre: (p: Record<string, unknown>) => Promise<unknown>
}

// Henter én header uansett form (objekt eller liste av {name, value}).
export function header(headers: unknown, navn: string): string {
  const n = navn.toLowerCase()
  if (Array.isArray(headers)) {
    return headers.filter(h => String(h?.name ?? h?.key ?? '').toLowerCase() === n).map(h => String(h?.value ?? '')).join('\n')
  }
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) if (k.toLowerCase() === n) return Array.isArray(v) ? v.join('\n') : String(v ?? '')
  }
  return ''
}

// Avsenderen kan forfalskes. Resend gir resultatet av kontrollen i `authentication` ({spf, dkim, dmarc}: pass/fail/gray/processing_failed/unknown).
// Henrik 18.11: feilet kontroll går alltid til Innkommende. Regelen: DMARC fail stopper; DMARC pass slipper; ellers må SPF eller DKIM være pass.
// Mangler feltet (eldre e-post), brukes Authentication-Results-headeren som reserve; mangler begge, stoppes ikke e-posten (en ny ordre er uansett ikke bekreftet).
export function autentiseringFeil(headers: unknown, auth?: Autentisering): string | null {
  if (auth && typeof auth === 'object') {
    const v = (x: unknown) => String(x ?? '').toLowerCase()
    if (v(auth.dmarc) === 'fail') return 'Avsenderen er ikke bekreftet (DMARC feilet)'
    if (v(auth.dmarc) === 'pass') return null
    if (v(auth.spf) === 'pass' || v(auth.dkim) === 'pass') return null
    return `Avsenderen er ikke bekreftet (SPF: ${v(auth.spf) || 'ukjent'}, DKIM: ${v(auth.dkim) || 'ukjent'})`
  }
  const ar = header(headers, 'authentication-results').toLowerCase()
  if (!ar) return null
  if (/\bdmarc=(fail|reject|quarantine)\b/.test(ar)) return 'Avsenderen er ikke bekreftet (DMARC feilet)'
  if (/\bdmarc=pass\b/.test(ar)) return null
  if (/\bspf=(fail|softfail)\b/.test(ar) && !/\bdkim=pass\b/.test(ar)) return 'Avsenderen er ikke bekreftet (SPF/DKIM feilet)'
  return null
}

export const ID_FORM = /^[A-Za-z0-9_.:@-]{1,120}$/

export async function behandleEpost(emailId: string, dep: Avhengigheter): Promise<{ utfall: string; rader?: number; sikre?: number }> {
  if (!ID_FORM.test(emailId)) return { utfall: 'ugyldig_id' }
  const e = await dep.hentEpost(emailId)
  if (!e) return { utfall: 'fant_ikke_epost' }
  const avsender = avsenderAdresse(e.from)
  const data = await dep.hentData()
  const selger = finnSelger(avsender, data.kontakter)
  const avsenderFeil = 'feil' in selger ? selger.feil : null
  const authFeil = autentiseringFeil(e.headers, e.authentication)
  // HTML-en har tabellen; tekstversjonen er reserve.
  const tekst = e.html ? htmlTilTekst(e.html) : String(e.text ?? '')
  const { rader, feil } = tolkEpost(tekst)
  const vurderinger = rader.map(r => vurderRad(r, { produkter: data.produkter, fikenPriser: data.fikenPriser, avsenderFeil, autentiseringFeil: authFeil }))
  const ut = vurderinger.length ? vurderinger.map(v => ({
    rad: v.rad, chassis: v.chassis, chassis_raa: v.chassisRaa, modell_slug: v.modell_slug, grunn_tekst: v.grunnTekst, tilvalg_tekst: v.tilvalgTekst,
    linjer: v.linjer, sikker: v.sikker, grunner: v.grunner,
  })) : [{ rad: 1, chassis: null, chassis_raa: null, modell_slug: null, grunn_tekst: '', tilvalg_tekst: '', linjer: [], sikker: false,
    grunner: [feil.includes('for_mange_rader') ? 'For mange rader i én e-post' : 'Fant ingen bestilling (Rad / Art.-nr.) i e-posten', ...(avsenderFeil ? [avsenderFeil] : [])] }]
  await dep.lagre({
    melding_id: emailId, avsender: avsender ?? '',
    kontakt_id: 'feil' in selger ? null : selger.kontakt_id, kontakt_navn: 'feil' in selger ? null : selger.kontakt_navn, selger_navn: 'feil' in selger ? null : selger.selger_navn,
    rader: ut,
  })
  return { utfall: 'lagret', rader: ut.length, sikre: ut.filter(r => r.sikker).length }
}
