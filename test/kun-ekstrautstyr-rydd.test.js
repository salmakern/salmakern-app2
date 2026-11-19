import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';
import { vanligRad, frysTid, settOppTilstand } from './helpers/kun-visning-scenarier.js';
import { byggRyddReferanser, tegnSteder, ryddRader, R_AKTIV, R_VENTER, R_ARKIVERT, R_ARKIVERT_FAKT, R_LEVERANSE, R_SMALT_1, R_SMALT_2, KUNDE } from './helpers/kun-rydd-scenarier.js';

// «Kun ekstrautstyr (ingen ombygging)»: de ANDRE stedene enn ordredetaljen (Henrik 2026-11-19, «Ja, rydd alle»). Ordredetaljen, ordrekortene og statusene ble ryddet i forrige runde
// (test/kun-ekstrautstyr-visning.test.js). Nå viser heller ikke disse stedene det som er skjult i ordren:
//   - Arkiv-lista («Arkiv»-fanen): farge og Drivstoff-linja
//   - kalenderkortene i ukekalenderen og kalenderlinja på Oversikt-kortene og Ordre-kortene: biltilsynssted (kalenderdato og -tid står som før)
//   - kundehistorikken (modalen bak «📋 Historikk»): type og variant (merke og modell står igjen)
//   - PDF-rapporten (genPDFSkriv): variant, farge, type, versjon, flåte, COC, fullmakt, diagnose, time på biltilsyn, vekter, drivstoff, hengerfeste, sjekklista «Har ved ankomst»,
//     ankomst-/skade-/manglende-deler-bildene og Tvangsflyt-merket
//
// BEVIS for at vanlige bil-ordrer og leveranser er UENDRET: test/fixtures/kun-rydd-referanse-vanlig.json er HTML-en den ekte appen tegnet for de samme stedene FØR endringen
// (origin/main 9fef219, git archive i en mappe utenfor arbeidstreet, klokka fryst, likt i Europe/Oslo, UTC og America/Los_Angeles). Testen bygger referansen mot dagens kode og krever
// byte-lik HTML. Lages på nytt (bare hvis en vanlig ordre bevisst skal se annerledes ut) som beskrevet øverst i test/helpers/kun-rydd-scenarier.js.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERANSE = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/kun-rydd-referanse-vanlig.json'), 'utf8'));

const app = lastApp();
const { sandbox, S } = app;
afterAll(() => { app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' }); }); // se CLAUDE.md (leveranse, «Test»): me skal ikke være admin når worker-prosessen avsluttes

function foersteForskjell(a, b) {
  const sa = typeof a === 'string' ? a : JSON.stringify(a), sb = typeof b === 'string' ? b : JSON.stringify(b);
  if (sa === sb) return null;
  let i = 0; while (i < sa.length && i < sb.length && sa[i] === sb[i]) i++;
  return `første forskjell ved tegn ${i}: «${sa.slice(Math.max(0, i - 60), i + 80)}» mot referansen «${sb.slice(Math.max(0, i - 60), i + 80)}»`;
}

// ───────────────────────────── sentinelverdier: hver kun-ordre har sine egne, så en test ser hvilken som (ikke) er tegnet ─────────────────────────────
const TAG = { [R_AKTIV]: 'A', [R_VENTER]: 'V', [R_ARKIVERT]: 'X', [R_SMALT_1]: 'S' };
const BASE = { A: 91000, V: 92000, X: 93000, S: 94000 };
const sent = (t) => ({
  farge: 'KUNFARGE_' + t, type: 'KUNTYPE_' + t, variant: 'KUNVARIANT_' + t, versjon: 'KUNVERSJON_' + t, sted: 'KUNSTED_' + t,
  orgnr: 'KUNORG_' + t, typegodkjenning: 'KUNTG_' + t, egenvekt: 'KUNEV_' + t, diagnoseAv: 'KUNDIAG_' + t, dokument: 'KUNDOK_' + t + '.pdf', har: 'KUNHAR_' + t, skalHa: 'KUNSKALHA_' + t,
  forhandlerNr: 'KUNFNR_' + t, sjekkpunkt: 'KUNSJEKK_' + t, mal: 'KUNMAL_' + t, totalpris: String(7000000 + BASE[t] / 1000), notat: 'KUNNOTAT_' + t,
  vekt: (n) => String(BASE[t] + n), bilde: (side) => `https://eksempel.test/storage/v1/object/public/bilder/TEST/KUN_${t}_${side}0.jpg`,
});
const VEKTER = (t) => { const s = sent(t); const v = (a) => ({ a: s.vekt(a), e: s.vekt(a + 1), v: s.vekt(a + 2) }); return { totalvekt: v(1), vogntog: v(4), foraksel: v(7), bakaksel: v(10) }; };

function radMedSentinel(rad, t, kun) {
  const s = sent(t);
  return {
    ...rad, kun_ekstrautstyr: kun, ombygging: { nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false },
    farge: s.farge, type: s.type, variant: s.variant, versjon: s.versjon, tid_biltilsynet_sted: s.sted, tid_biltilsynet: '2026-11-25', tid_biltilsynet_tid: '09:30',
    forhandler_orgnr: s.orgnr, typegodkjenning: s.typegodkjenning, egenvekt_coc: s.egenvekt, diagnose: true, diagnose_av: s.diagnoseAv,
    dokumenter: [{ navn: s.dokument, url: 'https://eksempel.test/storage/v1/object/public/ordre-dokumenter/TEST/' + s.dokument, lastetOppAv: 'TEST', dato: '2026-11-01T10:00:00Z' }],
    utstyr: { har: s.har, skalHa: s.skalHa, forhandlerNr: s.forhandlerNr, hengerfeste: 'hengerfeste', hengerfesteMontert: 'ikke_montert', hengerfesteBestilt: 'ikke_bestilt', skalHaBekreftet: false },
    utstyr_sjekkliste: [{ punkt: s.sjekkpunkt, ok: true }], utstyr_mal_navn: s.mal, drivstoff: { totalpris: s.totalpris, satsId: 'sats1' }, vekter: VEKTER(t), notater: s.notat,
    flate_id: t === 'A' ? 'flate_1' : null,
    bilder_ankomst: [s.bilde('a'), null, null, null, null, null], bilder_avstand_skader: [s.bilde('s'), null, null], bilder_manglende_deler: [s.bilde('m')], bilder_levering: [s.bilde('l'), null, null, null, null, null],
  };
}
const kunRader = (kun = true) => ryddRader().map((r) => (TAG[r.id] ? radMedSentinel(r, TAG[r.id], kun) : r));

function tegnKun(kun = true, rader = kunRader(kun)) {
  frysTid(app);
  settOppTilstand(app);
  S.ordrer = rader.map((r) => sandbox.dbToOrdre(r));
  S.flater = [{ id: 'flate_1', flatenummer: 'TEST-FLÅTE-1', primaerOrdreId: R_AKTIV }];
  S.moter = []; S.fravaer = [];
  app.consoleFeil.length = 0;
  const ut = tegnSteder(app, { pdf: [R_AKTIV, R_VENTER, R_ARKIVERT, R_SMALT_1, R_LEVERANSE] });
  const kundepris = Object.fromEntries(S.ordrer.filter((o) => TAG[o.id]).map((o) => [TAG[o.id], sandbox.drivstoffKundeprisTekst(o)]));
  return { ut, kundepris, feil: [...app.consoleFeil] };
}
const SKJULTE = ['farge', 'type', 'variant', 'versjon', 'sted', 'orgnr', 'typegodkjenning', 'egenvekt', 'diagnoseAv', 'dokument', 'har', 'forhandlerNr', 'sjekkpunkt', 'mal', 'totalpris'];
const del = (ut, sti) => sti.split('.').reduce((x, k) => x?.[k], ut); // 'oversikt_admin.weekCal' → HTML-en i det elementet
const med = (ut, sti, tekst) => String(del(ut, sti) ?? '').includes(tekst);
const alt = (ut) => JSON.stringify(ut);
const pdfAv = (ut, id) => ut['pdf_' + id];

// ═══════════════════════════════════════════════════════════════════════════════
describe('en vanlig bil-ordre og en leveranse er BYTE-LIKE som før (referanse fra origin/main 9fef219)', () => {
  const faktisk = byggRyddReferanser(lastApp());
  it('referansen har alle nøklene og er ikke tom', () => {
    expect(Object.keys(faktisk)).toEqual(Object.keys(REFERANSE));
    expect(Object.keys(REFERANSE)).toEqual(expect.arrayContaining(['ordreListe_admin', 'oversikt_admin', 'arkivAktiv_admin', 'arkivFerdig_admin', 'oversikt_ansatt', 'kundeHistorikk', 'pdf_' + R_AKTIV, 'pdf_' + R_LEVERANSE]));
    expect(REFERANSE['pdf_' + R_AKTIV].length).toBeGreaterThan(15000);
  });
  for (const navn of Object.keys(REFERANSE)) {
    it(`${navn}`, () => { expect(foersteForskjell(faktisk[navn], REFERANSE[navn])).toBeNull(); });
  }
  it('referansen er ikke vacuous: en vanlig ordre HAR alle de tingene som skjules for en kun-ordre', () => {
    const r = REFERANSE;
    expect(med(r, 'oversikt_admin.weekCal', 'Skien')).toBe(true); // kalenderkortet viser stedet
    expect(med(r, 'oversikt_admin.activeList', ' · Skien')).toBe(true);
    expect(med(r, 'ordreListe_admin.ordreListeResultat', ' · Drammen')).toBe(true);
    expect(med(r, 'arkivFerdig_admin.arkivListe', 'Drivstoff')).toBe(true);
    expect(med(r, 'arkivFerdig_admin.arkivListe', 'Sort')).toBe(true);
    expect(med(r, 'kundeHistorikk.kundeHistorikkInnhold', 'GT-Line AWD')).toBe(true);
    const pdf = r['pdf_' + R_AKTIV];
    for (const s of ['>Type<', '>Variant<', '>Versjon<', '>Farge<', 'Flåte', '>COC<', '>Fullmakt<', '>Diagnose<', 'Time biltilsyn', 'Vekter (kg)', '>Drivstoff<', 'Hengerfeste', 'Utstyr — har ved ankomst', 'Bilder — ankomst', 'Bilder — avstand / skader', 'Bilder — manglende deler', 'Tvangsflyt', 'Kunde og dokumenter', 'GT-Line', 'AWD', 'Hvit']) expect(pdf, s).toContain(s);
  });
  it('en leveranse ignorerer kun-flagget (erKunEkstrautstyr er aldri sann for en leveranse): samme HTML som referansen', () => {
    const rader = ryddRader().map((r) => (r.id === R_LEVERANSE ? { ...r, kun_ekstrautstyr: true } : r));
    expect(foersteForskjell(byggRyddReferanser(lastApp(), rader), REFERANSE)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('«kun ekstrautstyr»: ingen av de skjulte verdiene vises noe sted', () => {
  let kontroll, kun;
  beforeAll(() => { kontroll = tegnKun(false); kun = tegnKun(true); });

  it('tegningen gir ingen console.error (hverken kun eller kontroll)', () => {
    expect(kun.feil).toEqual([]);
    expect(kontroll.feil).toEqual([]);
  });

  const TAGGER = ['A', 'V', 'X', 'S'];
  it('ingen av de skjulte verdiene til en kun-ordre står i NOEN av stedene (Ordre-lista, Oversikt, kalenderen, Arkiv, kundehistorikken, PDF; admin og ansatt)', () => {
    const tekst = alt(kun.ut);
    for (const t of TAGGER) {
      for (const felt of SKJULTE) expect(tekst, `${felt} for ${t}`).not.toContain(sent(t)[felt]);
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) expect(tekst, `vekt ${n} for ${t}`).not.toContain(sent(t).vekt(n));
      expect(tekst, `kundepris for ${t}`).not.toContain(kun.kundepris[t]);
      for (const side of ['a', 's', 'm']) expect(tekst, `bilde ${side} for ${t}`).not.toContain(sent(t).bilde(side));
    }
    expect(tekst).not.toContain('TEST-FLÅTE-1'); // flåten til kun-ordren A
  });
  it('kontroll: de samme dataene UTEN kun-flagget vises (så testen over ikke er vacuous)', () => {
    const tekst = alt(kontroll.ut);
    for (const t of TAGGER) {
      for (const felt of ['farge', 'type', 'variant', 'sted']) expect(tekst, `${felt} for ${t}`).toContain(sent(t)[felt]);
      expect(tekst, `kundepris for ${t}`).toContain(kontroll.kundepris[t]);
    }
    expect(tekst).toContain('TEST-FLÅTE-1');
  });

  // Der hver ting faktisk ble vist før denne endringen (kontroll) og ikke lenger vises (kun). Hver linje er en egen regel som mutasjonssjekken ødelegger for seg.
  const STEDER = [
    // [sentinel, sted (nøkkel.element), hva]
    ['sted', 'A', 'oversikt_admin.weekCal', 'kalenderkort i ukekalenderen'],
    ['sted', 'V', 'oversikt_admin.weekCal', 'kalenderkort i ukekalenderen'],
    ['sted', 'A', 'oversikt_ansatt.weekCal', 'kalenderkort i ukekalenderen (ansatt)'],
    ['sted', 'A', 'oversikt_admin.activeList', 'kalenderlinja på Oversikt-kortet'],
    ['sted', 'A', 'ordreListe_admin.ordreListeResultat', 'kalenderlinja på Ordre-kortet'],
    ['sted', 'V', 'ordreListe_admin.ordreListeResultat', 'kalenderlinja på Ordre-kortet'],
    ['sted', 'S', 'ordreListe_admin.ordreListeResultat', 'kalenderlinja på Ordre-kortet'],
    ['farge', 'X', 'arkivFerdig_admin.arkivListe', 'Arkiv-lista: farge'],
    ['farge', 'X', 'arkivFerdig_ansatt.arkivListe', 'Arkiv-lista: farge (ansatt)'],
    ['kundepris', 'X', 'arkivFerdig_admin.arkivListe', 'Arkiv-lista: Drivstoff-linja'],
    ['kundepris', 'X', 'arkivFerdig_ansatt.arkivListe', 'Arkiv-lista: Drivstoff-linja (ansatt)'],
    ['type', 'A', 'kundeHistorikk.kundeHistorikkInnhold', 'kundehistorikken: type'],
    ['variant', 'A', 'kundeHistorikk.kundeHistorikkInnhold', 'kundehistorikken: variant'],
    ['type', 'V', 'kundeHistorikk.kundeHistorikkInnhold', 'kundehistorikken: type'],
    ['variant', 'X', 'kundeHistorikk.kundeHistorikkInnhold', 'kundehistorikken: variant'],
    ['type', 'S', 'kundeHistorikk.kundeHistorikkInnhold', 'kundehistorikken: type'],
    ['farge', 'A', 'oversikt_admin.activeList', 'Oversikt (aktive): farge (rettet i forrige runde)'],
    ['farge', 'V', 'oversikt_admin.pendingList', 'Oversikt (ventende): farge (rettet i forrige runde)'],
    ['variant', 'A', 'ordreListe_admin.ordreListeResultat', 'Ordre-kortet: variant og farge (rettet i forrige runde)'],
  ];
  for (const [felt, t, sti, hva] of STEDER) {
    it(`${hva} (${felt}, ${t})`, () => {
      const verdi = felt === 'kundepris' ? (u) => u.kundepris[t] : (u) => sent(t)[felt];
      expect(med(kontroll.ut, sti, verdi(kontroll)), 'kontroll: vises uten kun-flagget').toBe(true);
      expect(med(kun.ut, sti, verdi(kun)), 'kun: vises ikke').toBe(false);
    });
  }

  it('kalenderdato og -tid står som før for en kun-ordre (bare stedet er borte): kalenderkortet, Oversikt-kortet og Ordre-kortet', () => {
    expect(med(kun.ut, 'oversikt_admin.weekCal', '10:00 - ')).toBe(true);
    expect(med(kun.ut, 'oversikt_admin.weekCal', '11:00 - ')).toBe(true);
    expect(med(kun.ut, 'oversikt_admin.activeList', '📅 2026-11-19 10:00</div>')).toBe(true);
    expect(med(kun.ut, 'ordreListe_admin.ordreListeResultat', '2026-11-19 10:00</span>')).toBe(true);
    expect(med(kun.ut, 'ordreListe_admin.ordreListeResultat', '2026-11-18 11:00</span>')).toBe(true);
    expect(med(kun.ut, 'oversikt_admin.weekCal', 'AB10001')).toBe(true); // kortet er der: bare stedet mangler
    expect(med(kun.ut, 'oversikt_admin.weekCal', 'AB10002')).toBe(true);
  });
  it('en leveranse i samme kalender viser fortsatt sted (leveranser er ikke kun-ordrer): kalenderkortet, og kort for vanlige biler er som før', () => {
    expect(med(kun.ut, 'oversikt_admin.weekCal', '13:00 - Skien - ')).toBe(true);
    expect(del(kun.ut, 'oversikt_admin.weekCal')).toContain('🚚');
  });
  it('de smale kalenderkortene (to biler samtidig) er uendret for den vanlige biten i paret', () => {
    // SMALT_1 er kun-ordre, SMALT_2 er vanlig: sted vises aldri på smale kort (hverken før eller nå)
    expect(med(kun.ut, 'oversikt_admin.weekCal', 'Arendal')).toBe(false);
    expect(med(kontroll.ut, 'oversikt_admin.weekCal', 'Arendal')).toBe(false);
    expect(med(kun.ut, 'oversikt_admin.weekCal', 'AB10006')).toBe(true);
  });
  it('Arkiv-lista: resten av kortet står (reg.nr, forhandler, ankomst, utstyr, knapper), og en vanlig ordre i samme liste har farge og Drivstoff som før', () => {
    const lista = del(kun.ut, 'arkivFerdig_admin.arkivListe');
    for (const s of ['AB10003', 'Forhandler', KUNDE, 'Ankomst', 'Utstyr', sent('X').skalHa, '✔ Merk fakturert', 'genPDF', 'Gjenopprett', 'Ikke fakturert']) expect(lista, s).toContain(s);
    // den vanlige arkiverte ordren (AB10004: tom farge, ingen drivstoff) har aldri hatt dem; kontrollen viser at kun-flagget er det som fjerner dem fra AB10003
    expect(med(kontroll.ut, 'arkivFerdig_admin.arkivListe', 'Drivstoff')).toBe(true);
    expect(lista).not.toContain('Drivstoff');
  });
  it('Arkiv-fanen «Aktive» viser ingen av de skjulte tingene (den hadde dem aldri) og har kort for kun-ordrene', () => {
    const lista = del(kun.ut, 'arkivAktiv_admin.arkivListe');
    expect(lista).toContain('AB10001');
    expect(lista).toContain(sent('A').skalHa); // «Utstyr (skal ha etter visning)» BLIR
  });
  it('kundehistorikken: merke og modell står igjen i stedet for type og variant, og resten av raden er som før', () => {
    const h = del(kun.ut, 'kundeHistorikk.kundeHistorikkInnhold');
    for (const t of ['A', 'V', 'X', 'S']) {
      expect(h).not.toContain(sent(t).type);
      expect(h).not.toContain(sent(t).variant);
    }
    expect(h).toContain('<div class="small muted" style="margin-top:4px">KIA EV9</div>');
    expect(h).toContain('AB10001'); // reg.nr
    expect(h).toContain('Aktiv');
    expect(h).toContain('Arkivert');
    expect(h).toContain('2026-11-10'); // ankomstdato
    expect(del(kun.ut, 'kundeHistorikk.kundeHistorikkInnhold')).toContain('LEVTYPE'); // leveransen i samme historikk har det den alltid hadde
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('PDF-rapporten (genPDFSkriv) for en kun-ordre', () => {
  let kun, kontroll, pdf, kontrollPdf;
  beforeAll(() => { kun = tegnKun(true); kontroll = tegnKun(false); pdf = pdfAv(kun.ut, R_AKTIV); kontrollPdf = pdfAv(kontroll.ut, R_AKTIV); });

  it('har ikke Variant, Farge, Type, Versjon, flåte, COC, fullmakt, diagnose, time på biltilsyn, vekter, drivstoff, hengerfeste, sjekklista «Har ved ankomst» eller ankomst-/skade-/manglende-deler-bildene', () => {
    for (const s of ['>Type<', '>Variant<', '>Versjon<', '>Farge<', 'Flåte', '>COC<', '>Fullmakt<', '>Diagnose<', 'Time biltilsyn', 'Vekter (kg)', 'Ved ankomst', '>Drivstoff<', 'Totalpris', 'Kundepris', 'Hengerfeste', 'Utstyr — har ved ankomst', 'Ingen mal valgt',
      'Bilder — ankomst', 'Bilder — avstand / skader', 'Bilder — manglende deler', 'Rødt tall = endret', 'Kunde og dokumenter', 'Tvangsflyt']) expect(pdf, s).not.toContain(s);
    for (const side of ['a', 's', 'm']) expect(pdf, side).not.toContain(`KUN_A_${side}0.jpg`);
  });
  it('kontroll: den samme ordren uten kun-flagget har alt dette i PDF-en', () => {
    for (const s of ['>Type<', '>Variant<', '>Versjon<', '>Farge<', 'Flåte', '>COC<', '>Fullmakt<', '>Diagnose<', 'Time biltilsyn', 'Vekter (kg)', 'Ved ankomst', '>Drivstoff<', 'Totalpris', 'Kundepris', 'Hengerfeste', 'Utstyr — har ved ankomst',
      'Bilder — ankomst', 'Bilder — avstand / skader', 'Bilder — manglende deler', 'Rødt tall = endret', 'Kunde og dokumenter', 'Tvangsflyt', 'KUN_A_a0.jpg', 'KUN_A_s0.jpg', 'KUN_A_m0.jpg']) expect(kontrollPdf, s).toContain(s);
  });
  it('har det som BLIR: kunde, kontaktperson, merke, modell, reg.nr, chassis, ankomst, «skal ha etter visning», levering-bilder, ansatte på ordren, notater og fakturert', () => {
    for (const s of ['Ordrebekreftelse', 'AB10001', 'TESTWXYZ0000000R1', 'KIA · EV9', '>Merke<', '>Modell<', '>Reg.nr<', '>Ankomstdato<', '10.11.2026', '>Forhandler<', KUNDE, '>Kontaktperson<', 'TEST Kontaktperson', 'Kunde</span>', '>Fakturert<',
      'Utstyr — skal ha etter visning', sent('A').skalHa, 'Bilder — levering', 'KUN_A_l0.jpg', 'Ansatte på ordren', 'TEST - Admin', '08:00', '>Notater<', sent('A').notat, 'Utført av', 'Mottatt av forhandler', 'Merknader ved overlevering',
      'Status: Påbegynt', 'Ikke godkjent', 'Kun ekstrautstyr (ingen ombygging)']) expect(pdf, s).toContain(s);
  });
  it('merket «Kun ekstrautstyr» står i stedet for Tvangsflyt-merket (kravet «Status er Hentet» sier det samme som Status-merket)', () => {
    expect(pdf).toContain('>Kun ekstrautstyr</span>');
    expect(pdf).not.toMatch(/Tvangsflyt \d+\/\d+/);
    expect(kontrollPdf).toMatch(/Tvangsflyt \d+\/\d+/);
    expect(kontrollPdf).not.toContain('>Kun ekstrautstyr</span>');
  });
  it('Ombygging-boksene (som aldri kan være huket av i en kun-ordre) er erstattet av én linje', () => {
    for (const s of ['Nytt Kjøretøy', 'Brukt Kjøretøy', 'Lafinto', 'Personbil']) expect(pdf, s).not.toContain(s);
    for (const s of ['Nytt Kjøretøy', 'Brukt Kjøretøy', 'Lafinto', 'Personbil']) expect(kontrollPdf, s).toContain(s);
  });
  it('identlinja har merke og modell, ikke type, variant eller farge', () => {
    expect(pdf).toContain('<div class="ident-sub">KIA · EV9</div>');
    expect(kontrollPdf).toContain('KIA · KUNTYPE_A · EV9 · KUNVARIANT_A · KUNFARGE_A');
  });
  it('de to seksjonene som ble alene står over full bredde (ingen tom halvdel), og begge blir kol2 med én kolonne', () => {
    expect(pdf).toContain('<div class="kol2" style="grid-template-columns:1fr">'); // «Skal ha etter visning»
    expect(pdf.match(/<div class="kol2"[^>]*>/g)).toEqual(['<div class="kol2">', '<div class="kol2" style="grid-template-columns:1fr">', '<div class="kol2" style="grid-template-columns:1fr">']);
    expect(kontrollPdf.match(/<div class="kol2"[^>]*>/g)).toEqual(['<div class="kol2">', '<div class="kol2">', '<div class="kol2" style="grid-template-columns:1.35fr 1fr">']);
    expect(pdf).not.toContain('margin-top:20px"><span class="s-tittel">Ansatte'); // ingen tom plass over «Ansatte på ordren»
    expect(kontrollPdf).toContain('margin-top:20px"><span class="s-tittel">Ansatte');
  });
  it('HTML-en er i balanse (like mange <div som </div>) for kun og kontroll, og for alle fire kun-ordrene', () => {
    const balanse = (x) => (x.match(/<div\b/g) || []).length - (x.match(/<\/div>/g) || []).length;
    for (const id of [R_AKTIV, R_VENTER, R_ARKIVERT, R_SMALT_1]) {
      expect(balanse(pdfAv(kun.ut, id)), 'kun ' + id).toBe(0);
      expect(balanse(pdfAv(kontroll.ut, id)), 'kontroll ' + id).toBe(0);
    }
    expect(balanse(pdfAv(kun.ut, R_LEVERANSE))).toBe(0);
  });
  it('alle fire kun-ordrene gir en PDF uten sentinelverdiene (også en arkivert og godkjent ordre)', () => {
    for (const [id, t] of [[R_VENTER, 'V'], [R_ARKIVERT, 'X'], [R_SMALT_1, 'S']]) {
      const p = pdfAv(kun.ut, id);
      for (const felt of SKJULTE) expect(p, `${felt} ${t}`).not.toContain(sent(t)[felt]);
      expect(p, t).toContain('Kun ekstrautstyr (ingen ombygging)');
      expect(p, t).toContain(sent(t).notat);
    }
    expect(pdfAv(kun.ut, R_ARKIVERT)).toContain('Godkjent / lukket');
  });
  it('en tom kun-ordre (uten data i de skjulte feltene og uten levering-bilder) gir en gyldig PDF uten feil', () => {
    frysTid(app); settOppTilstand(app);
    S.ordrer = [sandbox.dbToOrdre({ id: 'ord_1700000000200', status: 'aktiv', ordre_status: 'ikke_paabegynt', chassis: 'TESTWXYZ0000000T1', kun_ekstrautstyr: true })];
    app.consoleFeil.length = 0;
    const p = tegnSteder(app, { pdf: ['ord_1700000000200'] })['pdf_ord_1700000000200'];
    expect(p).toContain('TESTWXYZ0000000T1');
    expect(p).toContain('Ingen tilvalg');
    expect(p).toContain('Ingen meldt på');
    expect((p.match(/<div\b/g) || []).length).toBe((p.match(/<\/div>/g) || []).length);
    expect(app.consoleFeil).toEqual([]);
  });
  it('genPDF-inngangen virker for en kun-ordre: vinduet åpnes synkront og rapporten skrives (bildene signeres først når noen mangler signert lenke; testriggen har ingen timere, så her uten bilder)', () => {
    frysTid(app); settOppTilstand(app);
    const utenBilder = { bilder_ankomst: [], bilder_avstand_skader: [], bilder_manglende_deler: [], bilder_levering: [] };
    S.ordrer = [sandbox.dbToOrdre({ ...radMedSentinel(vanligRad({ id: 'ord_1700000000201', chassis: 'TESTWXYZ0000000T2' }), 'A', true), ...utenBilder })];
    let skrevet = '', apnet = 0;
    const vindu = { document: { images: [], write(x) { skrevet += x; }, close() {} }, focus() {}, print() {} };
    const origOpen = sandbox.window.open;
    sandbox.window.open = () => { apnet++; return vindu; };
    try { sandbox.genPDF('ord_1700000000201'); } finally { sandbox.window.open = origOpen; }
    expect(apnet).toBe(1);
    expect(skrevet).toContain('Kun ekstrautstyr (ingen ombygging)');
    expect(skrevet).not.toContain('KUNFARGE_A');
    expect(skrevet).not.toContain('Bilder — ankomst');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('det som BEVISST står igjen for en kun-ordre (Henrik avgjør)', () => {
  let kun;
  beforeAll(() => { kun = tegnKun(true); });
  it('«Vedtak»-avkrysningen står på Ordre-kortet for admin (ikke endret, ikke nevnt av Henrik)', () => {
    expect(med(kun.ut, 'ordreListe_admin.ordreListeResultat', 'Vedtak')).toBe(true);
    expect(med(kun.ut, 'ordreListe_ansatt.ordreListeResultat', 'Vedtak')).toBe(false); // bare admin
  });
  it('søket i Ordre-lista treffer fortsatt type og «har ved ankomst» (felter som ikke vises for en kun-ordre)', () => {
    frysTid(app); settOppTilstand(app);
    S.ordrer = kunRader(true).map((r) => sandbox.dbToOrdre(r));
    const sok = (tekst) => { sandbox.document.getElementById('ordreSok').value = tekst; sandbox.renderOrdreList(); return sandbox.document.getElementById('ordreListeResultat').innerHTML; };
    try {
      expect(sok('KUNTYPE_A')).toContain('AB10001');
      expect(sok('KUNHAR_V')).toContain('AB10002');
    } finally { sandbox.document.getElementById('ordreSok').value = ''; }
  });
  it('Mer → «Til godkjenning» og ordrelabelen (reg.nr, chassis, kunde, merke, modell, ankomst) er uendret for en kun-ordre', () => {
    frysTid(app); settOppTilstand(app);
    app.settMe({ id: 1, navn: 'TEST - Godkjenner', rolle: 'godkjenner' });
    S.ordrer = [sandbox.dbToOrdre(radMedSentinel(vanligRad({ id: 'ord_1700000000202', chassis: 'TESTWXYZ0000000T3', ordre_status: 'hentet', regnr: 'AB20202' }), 'A', true))];
    S.ansatte = [{ id: 1, navn: 'TEST - Godkjenner', rolle: 'godkjenner', aktiv: true }];
    try { sandbox.renderMer(); } catch (e) { /* resten av Mer-siden trenger mer enn testriggen har */ }
    const liste = sandbox.document.getElementById('tilGodkjenningInnhold').innerHTML;
    expect(liste).toContain('AB20202');
    expect(liste).toContain(`${KUNDE} · KIA EV9 · Ankomst`);
    expect(liste).not.toContain('KUNTYPE_A');
    expect(liste).not.toContain('KUNFARGE_A');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sw.js og dokumentasjonen følger endringen', () => {
  const SW = readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  const CLAUDE = readFileSync(path.join(__dirname, '../CLAUDE.md'), 'utf8');
  it('CACHE er bumpet (v102 eller nyere) med en kommentar for denne endringen, og CLAUDE.md nevner samme versjon i «Kun ekstrautstyr»-avsnittet', () => {
    const cache = Number(/const CACHE = 'salmakern-v(\d+)'/.exec(SW)[1]);
    const kommentar = /\/\/ v(\d+) - «Kun ekstrautstyr»: rydder de andre stedene/.exec(SW);
    expect(kommentar, 'sw.js har kommentarlinjen «// vN - «Kun ekstrautstyr»: rydder de andre stedene ...»').not.toBeNull();
    const dennesVersjon = Number(kommentar[1]);
    expect(dennesVersjon).toBeGreaterThanOrEqual(102); // origin/main sto på v101 da denne endringen ble klargjort
    expect(cache).toBeGreaterThanOrEqual(dennesVersjon);
    const avsnitt = /\*\*Ryddet i de andre stedene \(2026-11-19[\s\S]*?\*\*Test\*\*[^\n]*/.exec(CLAUDE);
    expect(avsnitt, 'CLAUDE.md har avsnittet «Ryddet i de andre stedene»').not.toBeNull();
    expect(avsnitt[0]).toContain(`\`sw.js\` CACHE v${dennesVersjon}`);
    expect(avsnitt[0]).toContain('IKKE utrullet');
  });
});
