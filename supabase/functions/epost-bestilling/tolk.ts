// Trinn 5 av «Én produktliste»: leser en videresendt bestillings-e-post fra forhandlernes innkjøpsportal. REN (ingen nettverk, ingen database),
// testet i test/epost-bestilling.test.js. Bygget etter Henriks skjermbilder 17.11 (ingen ekte e-post er sett som rå HTML/tekst ennå):
//  * Tabell «Rad | Art.-nr. | Beskrivelse | Mengde | Pris | Beløp». Hver «Rad N» er én bil. Grunnproduktet har INGEN produktnummer: Art.-nr.-cellen
//    har navnet («KIA EV9 – ombygning til varebil klasse 2 Pris fra: 38 920,00»).
//  * Under hver rad: nøkkel/verdi-linjer. Bare disse leses: «OEM / Bestillingsnummer / Chassis nr», «Totalpris inkl. tilvalg (Eks. MVA)»,
//    «Totalpris på tilvalg» og «Tilvalg produktn og antall». Datoene leses IKKE (Henrik: «nei»).
// Tolkeren gjetter aldri: det den ikke finner, blir null, og vurderingen (logikk.ts) sender da raden til «Innkommende».

export type EpostRad = {
  rad: number
  grunnTekst: string // Art.-nr./Beskrivelse-teksten for grunnproduktet, uten «Pris fra: …»
  mengde: number | null
  pris: number | null
  belop: number | null
  chassis: string | null
  chassisRaa: string | null // teksten etter etiketten når den ikke er et gyldig chassis.nr (vises i Innkommende)
  tilvalgTekst: string
  totalTilvalg: number | null
  totalInkl: number | null
}

export const MAKS_RADER = 30
export const MAKS_TEKST = 400_000

const ENTITETER: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', aelig: 'æ', oslash: 'ø', aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å', shy: '' }

// HTML til tekst: én linje per tabellrad/avsnitt, celler skilt med « | ». Skript/stil fjernes helt.
export function htmlTilTekst(html: string): string {
  let s = String(html || '').slice(0, MAKS_TEKST)
  s = s.replace(/<(script|style|head)[\s\S]*?<\/\1\s*>/gi, ' ')
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<\s*br\s*\/?>/gi, '\n')
  s = s.replace(/<\/\s*(td|th)\s*>/gi, ' | ')
  s = s.replace(/<\/\s*(tr|p|div|li|h[1-6]|table)\s*>/gi, '\n')
  s = s.replace(/<[^>]*>/g, ' ')
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
    }
    return ENTITETER[e] ?? ENTITETER[e.toLowerCase()] ?? m
  })
  return s
}

// Norsk beløp: «38 920,00», «16 578», «38.920,00», «55 498 kr». null hvis ikke et tall.
export function tallFraTekst(t: string | null | undefined): number | null {
  if (t == null) return null
  const m = /-?\d[\d   .]*(,\d+)?/.exec(String(t))
  if (!m) return null
  let s = m[0].replace(/[\s  ]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const CHASSIS = /^[A-HJ-NPR-Z0-9]{17}$/

const ETIKETTER = [
  { felt: 'chassis', re: /OEM\s*\/\s*Bestillingsnummer\s*\/\s*Chassis\s*nr\.?\s*:?/i },
  { felt: 'totalInkl', re: /Totalpris\s+inkl\.?\s*tilvalg\s*(\(\s*eks\.?\s*mva\.?\s*\))?\s*:?/i },
  { felt: 'totalTilvalg', re: /Totalpris\s+p[åa]\s+tilvalg\s*:?/i },
  { felt: 'tilvalg', re: /Tilvalg\s+produktn\w*\.?\s+og\s+antall\s*:?/i },
  { felt: 'dato', re: /Dato\s+kj[øo]ret[øo]yet[^:|\n]*:?/i },
] as const

const linjeRens = (s: string) => s.replace(/[  \t]/g, ' ').replace(/[ ]{2,}/g, ' ').trim()
const celler = (linje: string) => linje.split(/\s*\|\s*|\t+/).map(c => linjeRens(c))

// En linje som starter en ny «Rad»: første ikke-tomme celle er radnummeret og en senere celle har bokstaver (grunnproduktet).
function radStart(linje: string, forventet: number): { grunnTekst: string; mengde: number | null; pris: number | null; belop: number | null } | null {
  const c = celler(linje).filter(x => x !== '')
  if (c.length < 2 || c[0] !== String(forventet)) return null
  const tekstIdx = c.findIndex((x, i) => i > 0 && /[A-Za-zÆØÅæøå]{2}/.test(x))
  if (tekstIdx < 0) return null
  if (ETIKETTER.some(e => e.re.test(c[tekstIdx]))) return null
  const grunnTekst = linjeRens(c[tekstIdx].replace(/Pris\s+fra\s*:?\s*[\d  .,]*(kr)?/i, ''))
  // Mengde, pris og beløp er de siste tallcellene etter teksten (Beskrivelse-cellen kan være tom).
  const tall = c.slice(tekstIdx + 1).filter(x => /^-?[\d  .,]+(kr)?$/i.test(x)).map(x => tallFraTekst(x))
  const [mengde, pris, belop] = tall.length >= 3 ? tall.slice(-3) : [tall[0] ?? null, tall[1] ?? null, null]
  return { grunnTekst, mengde: mengde ?? null, pris: pris ?? null, belop: belop ?? null }
}

// Verdien etter en etikett: fram til neste etikett eller slutten av linjen.
function verdiEtter(linje: string, re: RegExp): string | null {
  const m = re.exec(linje)
  if (!m) return null
  let rest = linje.slice(m.index + m[0].length)
  let slutt = rest.length
  for (const e of ETIKETTER) {
    const n = new RegExp(e.re.source, 'i').exec(rest)
    if (n && n.index < slutt) slutt = n.index
  }
  rest = rest.slice(0, slutt)
  return linjeRens(rest.replace(/\|/g, ' ').replace(/^[\s:·-]+|[\s·|]+$/g, ''))
}

export function tolkEpost(tekst: string): { rader: EpostRad[]; feil: string[] } {
  const linjer = String(tekst || '').slice(0, MAKS_TEKST).replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\t+/g, ' | ').trim()).filter(l => l.replace(/[|\s]/g, '') !== '')
  const rader: EpostRad[] = []
  const feil: string[] = []
  let gjeldende: EpostRad | null = null
  for (const linje of linjer) {
    const start = radStart(linje, rader.length + 1)
    if (start) {
      if (rader.length >= MAKS_RADER) { feil.push('for_mange_rader'); break }
      gjeldende = { rad: rader.length + 1, ...start, chassis: null, chassisRaa: null, tilvalgTekst: '', totalTilvalg: null, totalInkl: null }
      rader.push(gjeldende)
      continue
    }
    if (!gjeldende) continue
    const ch = verdiEtter(linje, ETIKETTER[0].re)
    if (ch !== null && gjeldende.chassis === null && gjeldende.chassisRaa === null) {
      const kandidat = ch.toUpperCase().replace(/[\s-]/g, '')
      const m = /[A-HJ-NPR-Z0-9]{17}/.exec(kandidat)
      if (m && CHASSIS.test(m[0]) && kandidat.length === 17) gjeldende.chassis = m[0]
      else gjeldende.chassisRaa = ch.slice(0, 60)
    }
    const ti = verdiEtter(linje, ETIKETTER[1].re)
    if (ti !== null && gjeldende.totalInkl === null) gjeldende.totalInkl = tallFraTekst(ti)
    const tt = verdiEtter(linje, ETIKETTER[2].re)
    if (tt !== null && gjeldende.totalTilvalg === null) gjeldende.totalTilvalg = tallFraTekst(tt)
    const tv = verdiEtter(linje, ETIKETTER[3].re)
    if (tv !== null && gjeldende.tilvalgTekst === '') gjeldende.tilvalgTekst = tv.slice(0, 2000)
  }
  if (!rader.length) feil.push('ingen_rader')
  return { rader, feil }
}
