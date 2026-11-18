// Trinn 5: vurderer hver tolket «Rad» mot portalens produktliste (portal_produkter), Fiken-prisene og avsenderen. REN, testet i
// test/epost-bestilling.test.js. Henriks regel (18.11): RETT PÅ ORDREN BARE VED SIKKERT TREFF, ellers «Innkommende». Derfor er hver kontroll
// en grunn til å stoppe, aldri en gjetning. Databasen (epost_bestilling_lagre) kontrollerer i tillegg ordretilstanden (chassis, forhandler).
import type { EpostRad } from './tolk.ts'

export type Produkt = {
  portal_id: string; type: string; modell_slug: string; modell_navn: string
  fiken_nummer: string | null; nummer_status: string; navn: string; app_rolle: string | null
}
export type FikenPris = { produktnummer: string; pris_kr: number | null }
export type Kontakt = { id?: string; navn?: string; type?: string; kontaktpersoner?: Array<{ navn?: string; epost?: string }> }
export type Linje = { produktnummer: string; navn: string; antall: number }
export type Vurdering = { rad: number; chassis: string | null; modell_slug: string | null; linjer: Linje[]; sikker: boolean; grunner: string[]; grunnTekst: string; tilvalgTekst: string; chassisRaa: string | null }

export const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFC').replace(/[–—\-_/,.:;()«»"']/g, ' ').replace(/\s+/g, ' ').trim()
const ord = (s: string) => norm(s).split(' ').filter(w => w.length >= 2 && !/^\d+$/.test(w))
const kr = (n: number) => Math.round(n).toLocaleString('nb-NO') + ' kr'
const likt = (a: number, b: number) => Math.abs(a - b) <= 1 // øreavrunding

// Avsenderen fra From-headeren («Navn <x@y.no>» eller bare adressen).
export function avsenderAdresse(from: string | null | undefined): string | null {
  const s = String(from ?? '')
  const m = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(s) || /([^\s<>"']+@[^\s<>"']+)/.exec(s)
  if (!m) return null
  const a = m[1].toLowerCase().trim()
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(a) && a.length <= 200 ? a : null
}

// Selgeren er en kontaktperson (med e-post) under ÉN forhandler i Kontakter (selgerne hentes fra portalen, hent-selgere-fra-portalen).
export function finnSelger(adresse: string | null, kontakter: Kontakt[]): { kontakt_id: string; kontakt_navn: string; selger_navn: string } | { feil: string } {
  if (!adresse) return { feil: 'Avsenderens e-postadresse kunne ikke leses' }
  const treff = new Map<string, { kontakt_id: string; kontakt_navn: string; selger_navn: string }>()
  for (const k of Array.isArray(kontakter) ? kontakter : []) {
    if (!k || k.type !== 'Forhandler' || !k.id) continue
    for (const kp of Array.isArray(k.kontaktpersoner) ? k.kontaktpersoner : []) {
      if (String(kp?.epost ?? '').trim().toLowerCase() === adresse) treff.set(k.id, { kontakt_id: k.id, kontakt_navn: String(k.navn ?? ''), selger_navn: String(kp?.navn ?? '') })
    }
  }
  if (treff.size === 1) return [...treff.values()][0]
  if (treff.size === 0) return { feil: `Ukjent avsender: ${adresse} er ikke en selger hos noen forhandler i Kontakter` }
  return { feil: `Avsenderen ${adresse} er selger hos flere forhandlere` }
}

// Modellen ut fra grunnproduktets tekst: den lengste portalmodellen (modell_navn) som står i teksten. To ulike modeller like lange = tvetydig.
export function finnModell(grunnTekst: string, produkter: Produkt[]): { slug: string; navn: string } | null {
  const t = ' ' + norm(grunnTekst) + ' '
  const modeller = new Map<string, string>()
  for (const p of produkter) if (p.modell_slug && p.modell_navn) modeller.set(p.modell_slug, p.modell_navn)
  const treff = [...modeller].filter(([, navn]) => norm(navn) && t.includes(' ' + norm(navn) + ' ')).sort((a, b) => norm(b[1]).length - norm(a[1]).length)
  if (!treff.length) return null
  if (treff.length > 1 && norm(treff[0][1]).length === norm(treff[1][1]).length) return null
  return { slug: treff[0][0], navn: treff[0][1] }
}

export function grunnRolle(grunnTekst: string): 'ombygging' | 'personbil' | 'lafinto' {
  const t = norm(grunnTekst)
  if (/\bpersonbil\b/.test(t)) return 'personbil'
  if (/\blafinto\b/.test(t)) return 'lafinto'
  return 'ombygging'
}

// Navnet i e-posten passer produktet når nesten alle ordene finnes begge veier (rekkefølge og tegn spiller ingen rolle).
export function navnPasser(tekst: string, navn: string): boolean {
  const a = new Set(ord(tekst)), b = new Set(ord(navn))
  if (!a.size || !b.size) return false
  // Et tall i e-postteksten som ikke står i navnet (f.eks. et ukjent produktnummer «599 Takboks» etter navnet), gjør at den ikke passer.
  const navnTall = new Set(norm(navn).split(' ').filter(w => /^\d+$/.test(w)))
  if (norm(tekst).split(' ').some(w => /^\d{2,}$/.test(w) && !navnTall.has(w))) return false
  const iB = [...a].filter(w => b.has(w)).length / a.size
  const iA = [...b].filter(w => a.has(w)).length / b.size
  return iA >= 0.75 && iB >= 0.75
}

// «Tilvalg produktn og antall»: «505 Heldekkende gulv … 510 Gummimatte …» eller «501 - Tillegg for panorama glasstak». Et tall er et produktnummer
// bare når modellen har det OG teksten fram til neste godtatte nummer passer navnet. Alt annet (ukjent nummer, tekst som ikke passer) er en grunn.
// Antall: «x 2», «2 stk» eller «(2)» sist i teksten for et produkt, ellers 1 (formatet for antall er ikke sett ennå).
export function tolkTilvalg(tekst: string, produkter: Produkt[]): { linjer: Linje[]; grunner: string[] } {
  const grunner: string[] = []
  const s = String(tekst ?? '').trim()
  if (!s || /^(-|–|ingen|0)$/i.test(s)) return { linjer: [], grunner }
  const kjente = new Map(produkter.filter(p => p.nummer_status === 'ok' && p.fiken_nummer && !p.app_rolle).map(p => [p.fiken_nummer as string, p]))
  const tall = [...s.matchAll(/(?<![\d])(\d{2,5})(?![\d])/g)].map(m => ({ nr: m[1], i: m.index as number, slutt: (m.index as number) + m[0].length }))
  // Velg kandidater fra venstre: et kjent nummer der teksten fram til neste kjente nummer passer navnet.
  const kandidater = tall.filter(t => kjente.has(t.nr))
  const godtatt: Array<{ nr: string; i: number; slutt: number; segment: string }> = []
  for (let k = 0; k < kandidater.length; k++) {
    const t = kandidater[k]
    if (godtatt.length && t.i < godtatt[godtatt.length - 1].slutt) continue
    // Neste kjente nummer som ikke er en del av dette navnet: prøv de nærmeste først.
    const lead = (/^\s*(?:[-–:]\s*)?/.exec(s.slice(t.slutt)) as RegExpExecArray)[0].length
    let valgt: string | null = null
    for (let j = k + 1; j <= kandidater.length; j++) {
      const slutt = j < kandidater.length ? kandidater[j].i : s.length
      const seg = s.slice(t.slutt + lead, slutt).trimEnd()
      const utenAntall = seg.replace(/\s*(x\s*\d+|\d+\s*stk\.?|\(\s*\d+\s*\))\s*$/i, '')
      if (navnPasser(utenAntall, (kjente.get(t.nr) as Produkt).navn)) { valgt = seg; break }
    }
    if (valgt !== null) godtatt.push({ nr: t.nr, i: t.i, slutt: t.slutt + lead + valgt.length, segment: valgt })
  }
  // Det som står utenfor de godtatte produktene, må være tomt (bare skilletegn).
  let dekket = ''
  let pos = 0
  for (const g of godtatt) { dekket += s.slice(pos, g.i); pos = g.slutt }
  dekket += s.slice(pos)
  if (dekket.replace(/\bog\b/gi, ' ').replace(/[\s,;·|–\-+&]+/g, '').length > 0) grunner.push(`Tilvalg som ikke kjennes igjen for modellen: «${dekket.trim().slice(0, 120)}»`)
  const linjer: Linje[] = []
  for (const g of godtatt) {
    const p = kjente.get(g.nr) as Produkt
    const m = /(?:x\s*(\d+)|(\d+)\s*stk\.?|\(\s*(\d+)\s*\))\s*$/i.exec(g.segment)
    const antall = m ? Number(m[1] || m[2] || m[3]) : 1
    if (!(antall >= 1 && antall <= 50)) { grunner.push(`Ugyldig antall for ${g.nr}`); continue }
    const fra = linjer.find(l => l.produktnummer === g.nr)
    if (fra) fra.antall += antall
    else linjer.push({ produktnummer: g.nr, navn: p.navn, antall })
  }
  if (!linjer.length && !grunner.length) grunner.push(`Ingen kjente tilvalg i «${s.slice(0, 120)}»`)
  return { linjer, grunner }
}

// Hele vurderingen av én rad. sikker = ingen grunner. ctx.avsender er resultatet av finnSelger (feil gir en grunn på alle rader).
export function vurderRad(r: EpostRad, ctx: { produkter: Produkt[]; fikenPriser: FikenPris[]; avsenderFeil: string | null; autentiseringFeil: string | null }): Vurdering {
  const grunner: string[] = []
  if (ctx.avsenderFeil) grunner.push(ctx.avsenderFeil)
  if (ctx.autentiseringFeil) grunner.push(ctx.autentiseringFeil)
  if (!r.chassis) grunner.push(r.chassisRaa ? `Ikke et gyldig chassis.nr: «${r.chassisRaa}»` : 'Chassis.nr mangler')
  const modell = finnModell(r.grunnTekst, ctx.produkter)
  const linjer: Linje[] = []
  const pris = (nr: string) => { const f = ctx.fikenPriser.find(x => String(x.produktnummer) === nr); return f && Number.isFinite(Number(f.pris_kr)) && f.pris_kr !== null ? Number(f.pris_kr) : null }
  if (!modell) grunner.push(`Modellen kjennes ikke igjen i «${r.grunnTekst.slice(0, 120)}»`)
  else {
    const modellProdukter = ctx.produkter.filter(p => p.modell_slug === modell.slug)
    const rolle = grunnRolle(r.grunnTekst)
    const grunn = modellProdukter.filter(p => p.app_rolle === rolle && p.nummer_status === 'ok' && p.fiken_nummer)
    if (grunn.length !== 1) grunner.push(`Fant ikke ${rolle === 'ombygging' ? 'ombyggingen' : rolle} for ${modell.navn} i portalen`)
    else {
      const mengde = r.mengde ?? 1
      if (!(Number.isInteger(mengde) && mengde >= 1 && mengde <= 50)) grunner.push(`Ugyldig mengde: ${r.mengde}`)
      linjer.push({ produktnummer: grunn[0].fiken_nummer as string, navn: grunn[0].navn, antall: Number.isInteger(mengde) && mengde >= 1 ? mengde : 1 })
      const fp = pris(grunn[0].fiken_nummer as string)
      if (r.pris === null) grunner.push('Grunnprisen mangler i e-posten')
      else if (fp === null) grunner.push(`Ingen Fiken-pris for ${grunn[0].fiken_nummer} å kontrollere mot`)
      else if (!likt(r.pris, fp)) grunner.push(`Grunnprisen ${kr(r.pris)} er ikke Fiken-prisen ${kr(fp)} for ${grunn[0].fiken_nummer}`)
    }
    const tv = tolkTilvalg(r.tilvalgTekst, modellProdukter)
    grunner.push(...tv.grunner)
    linjer.push(...tv.linjer)
    // Summene: tilvalgene etter Fiken-pris = «Totalpris på tilvalg», og grunnbeløp + tilvalg = «Totalpris inkl. tilvalg».
    const tt = r.totalTilvalg
    if (tt === null) { if (tv.linjer.length) grunner.push('«Totalpris på tilvalg» mangler') }
    else if (tt === 0 && tv.linjer.length) grunner.push('Tilvalg står oppført, men «Totalpris på tilvalg» er 0')
    else if (tt > 0 && !tv.linjer.length && !tv.grunner.length) grunner.push(`«Totalpris på tilvalg» er ${kr(tt)}, men ingen tilvalg står oppført`)
    else if (tv.linjer.length && !tv.grunner.length) {
      const priser = tv.linjer.map(l => pris(l.produktnummer))
      if (priser.some(p => p === null)) grunner.push('Ingen Fiken-pris for alle tilvalgene å kontrollere mot')
      else {
        const sum = tv.linjer.reduce((s, l, i) => s + (priser[i] as number) * l.antall, 0)
        if (!likt(sum, tt)) grunner.push(`Summen går ikke opp: tilvalgene er ${kr(sum)} etter Fiken-pris, e-posten sier ${kr(tt)}`)
      }
    }
    const grunnBelop = r.belop ?? (r.pris !== null ? r.pris * (r.mengde ?? 1) : null)
    if (r.totalInkl === null) grunner.push('«Totalpris inkl. tilvalg» mangler')
    else if (grunnBelop === null || !likt(grunnBelop + (tt ?? 0), r.totalInkl)) grunner.push(`Summen går ikke opp: ${grunnBelop === null ? '?' : kr(grunnBelop)} + ${kr(tt ?? 0)} er ikke ${kr(r.totalInkl)}`)
  }
  return { rad: r.rad, chassis: r.chassis, modell_slug: modell?.slug ?? null, linjer, sikker: grunner.length === 0, grunner, grunnTekst: r.grunnTekst.slice(0, 200), tilvalgTekst: r.tilvalgTekst.slice(0, 500), chassisRaa: r.chassisRaa }
}
