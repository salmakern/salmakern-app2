import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';
import { byggReferanser, vanligRad, medOpptak, ID_VANLIG } from './helpers/kun-visning-scenarier.js';

// «Kun ekstrautstyr (ingen ombygging)»: enklere ordre (Henrik 2026-11-19). Ordren skal ikke ha vekter, drivstoff, time på biltilsynet, diagnose, dokumenter,
// «Utstyr - Har ved ankomst», forhandler.nr, hengerfeste, manglende deler, ankomst- og skadebilder, og i kundekortet ikke Type, Variant, Versjon, Farge, org.nr,
// COC/Fullmakt/Typegodkjenning/Egenvekt, serienummer og flåte. Statusene er bare På vei, Ikke påbegynt, Påbegynt og Klar for henting. Alt annet er som før.
//
// BEVIS for at vanlige ordrer og leveranser er UENDRET: test/fixtures/kun-visning-referanse-vanlig.json er HTML-en den ekte appen tegnet for en vanlig bil-ordre
// (som admin, ansatt og godkjenner, ordre uten data, ordre etter «Skal på bilen»-porten), en leveranse, hvert statusnedtrekk, Ordre-lista og Oversikt, laget av
// koden på origin/main 8f6f52d FØR visningen ble endret. Testen bygger de samme referansene mot dagens kode og krever byte-lik HTML.
// Slik lages fixturen på nytt (bare hvis en vanlig ordre bevisst skal se annerledes ut): sjekk ut koden som skal være fasit, kjør
// `byggReferanser(lastApp(rot))` fra test/helpers/kun-visning-scenarier.js og skriv resultatet som JSON med JSON.stringify(ref, null, 1).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERANSE = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/kun-visning-referanse-vanlig.json'), 'utf8'));

const app = lastApp();
const { sandbox, S } = app;
const ORIG = {};
for (const n of ['visToast', 'renderAll', 'buildOrdreDetail', 'save', 'edgeFetch', 'oppdaterFikenLinjeForOppskrift', 'oppdaterOrdreFikenLinje', 'vegvesenFlateKontext', 'synkroniserForhandlerKontaktId', 'openOrdre', 'closeModal']) ORIG[n] = sandbox[n];

const KUN_ID = 'ord_1700000000010';
const NY_KUN_ID = 'ord_' + Date.parse('2026-11-18T08:00:00Z');
const kunRad = (over = {}) => vanligRad({ id: KUN_ID, chassis: 'TESTWXYZ0000000K1', kun_ekstrautstyr: true, flate_id: 'flate_1', ombygging: { nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false }, ...over });
const lagOrdre = (rad) => sandbox.dbToOrdre(rad);

function lagDb() {
  const kall = [];
  const kjede = (info) => new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') return (res) => Promise.resolve({ data: null, error: null }).then(res);
      return (...args) => { info.kall.push([String(k), args]); return kjede(info); };
    },
  });
  return {
    kall,
    db: {
      from: (tabell) => { const info = { tabell, kall: [] }; kall.push(info); return kjede(info); },
      rpc: (navn, args) => { kall.push({ rpc: navn, args }); return Promise.resolve({ data: navn === 'oppdater_ordre_timer_fase' ? { sessions: [], ansatteSignert: [], ikkeStemplet: [] } : null, error: null }); },
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    },
  };
}
const oppdateringer = (kall) => kall.filter((k) => k.tabell === 'ordrer').flatMap((k) => k.kall.filter(([m]) => m === 'update').map(([, a]) => a[0]));

beforeEach(() => {
  Object.assign(sandbox, ORIG);
  S.ordrer = []; S.ansatte = []; S.lagerOppskrifter = []; S.lagerhistorikk = []; S.lagervarer = []; S.utstyrMaler = []; S.adminArk = []; S.portalProdukter = [];
  S.kontakter = [{ id: 'k1', type: 'Forhandler', navn: 'TEST Forhandler AS', orgnr: '984993188', forhandlerNr: '12345', fullmaktUrl: 'https://eksempel.test/storage/v1/object/public/forhandler/F.pdf', fullmaktNavn: 'Fullmakt.pdf', kontaktpersoner: [{ navn: 'TEST Kontaktperson' }] }];
  S.flater = [{ id: 'flate_1', flatenummer: 'TEST-FLÅTE-1', primaerOrdreId: KUN_ID }]; S.drivstoffSatser = [{ id: 'sats1', navn: 'TEST sats', type: 'kr_rabatt', verdi: 100 }];
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  app.settAktivOrdre(null);
  app.settDb(null);
  app.consoleFeil.length = 0;
});
// Se CLAUDE.md (leveranse, «Test»): avsluttes en fil mens me er admin, kan worker-prosessen dø ved nedstenging.
afterAll(() => { app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' }); });

function detalj(o, rolle = 'admin') {
  app.settMe({ id: 1, navn: 'TEST - ' + rolle, rolle });
  S.ordrer = [o];
  app.settAktivOrdre(o.id);
  sandbox.buildOrdreDetail();
  return sandbox.document.getElementById('ordreDetail').innerHTML;
}
const labler = (html) => [...html.matchAll(/<label>([^<]*)<\/label>/g)].map((m) => m[1].trim());
const overskrifter = (html) => [...html.matchAll(/<div class="(?:h|card-title)"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
const harOverskrift = (ov, tekst) => ov.some((x) => x.startsWith(tekst)); // fotokortene har telleren («0/6») bak teksten
const statusValg = (html, id) => {
  const m = new RegExp(`<select[^>]*endreStatus\\('${id}'[^>]*>([\\s\\S]*?)</select>`).exec(html);
  return m ? [...m[1].matchAll(/<option value="(\w+)"([^>]*)>([^<]*)<\/option>/g)].map((x) => ({ id: x[1], tekst: x[3], valgt: /\bselected\b/.test(x[2]), utilgjengelig: /\bdisabled\b/.test(x[2]) })) : null;
};

// En «ekte» DOM for rendringen: et element med ordrens id i navnet finnes bare hvis det ligger i HTML-en som ble tegnet (testriggens stubber finnes ellers alltid).
function medEkteDom(html, ordreId, fn) {
  const doc = sandbox.document;
  const finnes = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const origGet = doc.getElementById, origQ = doc.querySelector;
  const borte = (id) => (String(id).includes(ordreId) || id === 'uMalValgAnkomst') && !finnes.has(id);
  doc.getElementById = (id) => (borte(id) ? null : origGet(id));
  doc.querySelector = (sel) => (sel === '#ordreDetail table' && !/<table/.test(html) ? null : origQ(sel));
  try { return fn(); } finally { doc.getElementById = origGet; doc.querySelector = origQ; }
}

function foersteForskjell(a, b) {
  const sa = typeof a === 'string' ? a : JSON.stringify(a), sb = typeof b === 'string' ? b : JSON.stringify(b);
  if (sa === sb) return null;
  let i = 0; while (i < sa.length && i < sb.length && sa[i] === sb[i]) i++;
  return `første forskjell ved tegn ${i}: «${sa.slice(Math.max(0, i - 60), i + 80)}» mot referansen «${sb.slice(Math.max(0, i - 60), i + 80)}»`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('en vanlig bil-ordre og en leveranse er BYTE-LIKE som før (referanse fra origin/main 8f6f52d)', () => {
  const faktisk = byggReferanser(lastApp());
  it('referansen har alle nøklene og er ikke tom', () => {
    expect(Object.keys(faktisk)).toEqual(Object.keys(REFERANSE));
    expect(Object.keys(REFERANSE).length).toBeGreaterThanOrEqual(17);
    for (const n of ['detaljAdmin', 'detaljAnsatt', 'detaljGodkjenner', 'detaljEnkel', 'detaljNyAdmin', 'detaljLeveranse']) expect(REFERANSE[n].ordreDetail.length, n).toBeGreaterThan(10000);
  });
  for (const navn of Object.keys(REFERANSE)) {
    it(`${navn}`, () => { expect(foersteForskjell(faktisk[navn], REFERANSE[navn])).toBeNull(); });
  }
  it('referansen er ikke vacuous: en vanlig ordre HAR alle de skjulte tingene (som kontroll av testen selv)', () => {
    const h = REFERANSE.detaljAdmin.ordreDetail;
    for (const s of ['Vekter (kg)', 'Drivstoff', 'Utstyr – Har ved ankomst', 'Forhandler.nr', 'Hengerfeste', 'Bilder – Ankomst', 'Bilder – Avstand/skader', 'Bilder – Manglende deler', 'Time på biltilsynet', 'Diagnose', 'Forhandler org.nr', 'Typegodkjenning', 'Egenvekt (fra COC)', 'Serienummer', 'Flåte', 'TEST-FLÅTE-1', 'id="dokumenterListe_', 'Hent drivstoff']) expect(h, s).toContain(s);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('ordredetaljen for «kun ekstrautstyr»: hva som ikke tegnes', () => {
  const SKJULTE_OVERSKRIFTER = ['Vekter (kg)', 'Drivstoff', 'Utstyr – Har ved ankomst', 'Forhandler.nr', 'Hengerfeste', 'Bilder – Ankomst', 'Bilder – Avstand/skader', 'Bilder – Manglende deler', 'Time på biltilsynet', 'Diagnose', 'Dokumenter'];
  const SKJULTE_LABLER = ['Type', 'Variant', 'Farge', 'Versjon', 'Forhandler org.nr', 'COC', 'Fullmakt', 'Typegodkjenning', 'Egenvekt (fra COC)', 'Serienummer', 'Flåte'];
  const SKJULTE_ID_ER = ['dokumenterListe_', 'dokDropzone_', 'utstyrSjekkliste_', 'drivstoffKort_', 'hengerfesteNrVisning_', 'forhandlerNrInput_', 'forhandlerOrgnrInput_', 'typeInput_', 'variantInput_', 'versjonInput_', 'typegodkjenningInput_', 'manglendeDelerListe_', 'mdelInput_', 'foboks_a_', 'foboks_s_', 'dokStatus_coc_', 'dokStatus_fullmakt_', 'bildeTeller_a_', 'bildeTeller_s_', 'typeForslag_type_', 'typeForslag_var_', 'typeForslag_ver_', 'typeForslag_forhandlerOrgnr_', 'typeForslag_typegodkjenning_', 'typeForslag_forhandlerNr_'];
  const SKJULTE_VERDIER = ['984993188', 'e4*2018/858*00178*04', 'TEST-FLÅTE-1', 'GT-Line', 'AWD', '7-seter', 'Fullmakt.pdf', 'TEST EV9-mal', 'TEST sats', 'Skien', '3010'];
  const SKJULTE_FUNKSJONER = ['sv(', 'sd(', 'toggleDiagnose(', 'settHengerfeste(', 'applyUtstyrMal', 'toggleUtstyrPunkt', 'vektEnter', `lastOppFoto(event,'${KUN_ID}','a'`, `lastOppFoto(event,'${KUN_ID}','s'`, 'lastOppBildeManglendeDel', 'lastOppDokument', 'genererVegvesenDokumenter', 'vegvesenSkrivUt'];

  for (const rolle of ['admin', 'ansatt', 'godkjenner']) {
    it(`${rolle}: ingen av de skjulte kortene, feltene, id-ene eller verdiene`, () => {
      const h = detalj(lagOrdre(kunRad()), rolle);
      const ov = overskrifter(h);
      for (const s of SKJULTE_OVERSKRIFTER) expect(harOverskrift(ov, s), s).toBe(false);
      for (const s of SKJULTE_LABLER) expect(labler(h), s).not.toContain(s);
      for (const s of SKJULTE_ID_ER) expect(h, s).not.toContain(`id="${s}`);
      for (const s of SKJULTE_VERDIER) expect(h, s).not.toContain(s);
      for (const s of SKJULTE_FUNKSJONER) expect(h, s).not.toContain(s);
    });
  }
  it('samme ordre UTEN kun-flagget har alle de skjulte tingene (kontroll: det er flagget som skjuler, ikke dataene)', () => {
    const h = detalj(lagOrdre(kunRad({ kun_ekstrautstyr: false })));
    const ov = overskrifter(h);
    for (const s of SKJULTE_OVERSKRIFTER) expect(harOverskrift(ov, s), s).toBe(true);
    for (const s of SKJULTE_LABLER) expect(labler(h), s).toContain(s);
    for (const s of SKJULTE_ID_ER.filter((x) => !/^typeForslag_|^dokStatus_|^bildeTeller_/.test(x))) expect(h, s).toContain(`id="${s}`);
    for (const s of SKJULTE_VERDIER) expect(h, s).toContain(s);
  });
  it('kundekortet har bare Forhandler, Kontaktperson, Merke, Modell, Ankomstdato, Reg.nr og Chassis-nr (i den rekkefølgen)', () => {
    const h = detalj(lagOrdre(kunRad()));
    const kort = /<div class="h">Kunde og bilinfo<\/div>([\s\S]*?)<div class="card" style="[^"]*">\s*<div class="h">Ansatte på ordren/.exec(h);
    expect(kort).not.toBeNull();
    expect(labler(kort[1])).toEqual(['Forhandler', 'Kontaktperson', 'Merke', 'Modell', 'Ankomstdato', 'Reg.nr', 'Chassis-nr (VIN)']);
    expect(kort[1]).toContain('Identifikasjon');
    expect(kort[1]).not.toContain('>Dokumenter<');
  });
  it('Forhandler (kunden), Kontaktperson, Merke, Modell, Ankomstdato, Reg.nr og Chassis-nr har sine verdier og feltene virker som før', () => {
    const h = detalj(lagOrdre(kunRad()));
    for (const s of ['value="TEST Forhandler AS"', 'value="TEST Kontaktperson"', 'value="KIA"', 'value="EV9"', 'value="2026-11-10"', 'value="AB12345"', 'value="TESTWXYZ0000000K1"']) expect(h, s).toContain(s);
    for (const s of ["sf('" + KUN_ID + "','kunde',this.value)", "sf('" + KUN_ID + "','eier',this.value)", "sf('" + KUN_ID + "','merke',this.value)", "sf('" + KUN_ID + "','modell',this.value)", "sf('" + KUN_ID + "','ankomstdato',this.value)", "sf('" + KUN_ID + "','regnr'"]) expect(h, s).toContain(s);
  });
  it('de som BLIR: kort og knapper (admin)', () => {
    const h = detalj(lagOrdre(kunRad()), 'admin');
    const ov = overskrifter(h);
    for (const s of ['Kunde og bilinfo', 'Ansatte på ordren', 'Ombygging', 'Varer fra lager', 'Utstyr – Skal ha etter visning', 'Bilder – Levering', 'Notater', 'Endringer', 'Tvangsflyt', 'Fakturering']) expect(harOverskrift(ov, s), s).toBe(true);
    for (const s of [`id="skalHaInput_${KUN_ID}"`, `id="ordreLagerbruk_${KUN_ID}"`, `id="ombyggingBoks_${KUN_ID}"`, `id="kunEkstrautstyr_${KUN_ID}"`, `id="tvangsflytBoks_${KUN_ID}"`, `id="fikenLinjer_${KUN_ID}"`, `id="foboks_l_0"`, `id="ordretimerKort_ordreTimerSessions_${KUN_ID}"`, `id="ordretimerKort_klargjoringTimerSessions_${KUN_ID}"`, `id="kundeInput_${KUN_ID}"`, `id="eierInput_${KUN_ID}"`, `id="merkeInput_${KUN_ID}"`, `id="modellInput_${KUN_ID}"`, `id="regnr_${KUN_ID}"`, 'Utstyr bekreftet klargjort', 'KUN EKSTRAUTSTYR', 'Meld meg av']) expect(h, s).toContain(s);
    expect(h).toContain('toggleSkalHaBekreftet');
    expect(h).toContain('su(\'' + KUN_ID + '\',\'skalHa\'');
  });
  it('ansatt og godkjenner: de samme kortene som bevares, uten Fakturering', () => {
    for (const rolle of ['ansatt', 'godkjenner']) {
      const ov = overskrifter(detalj(lagOrdre(kunRad()), rolle));
      for (const s of ['Kunde og bilinfo', 'Ansatte på ordren', 'Ombygging', 'Utstyr – Skal ha etter visning', 'Bilder – Levering', 'Notater', 'Endringer', 'Tvangsflyt']) expect(harOverskrift(ov, s), `${rolle}: ${s}`).toBe(true);
      expect(harOverskrift(ov, 'Fakturering'), rolle).toBe(false);
    }
  });
  it('en tom kun-ordre (uten data i de skjulte feltene) tegnes uten feil og uten de skjulte kortene', () => {
    const h = detalj(lagOrdre({ id: KUN_ID, status: 'aktiv', ordre_status: 'ikke_paabegynt', chassis: 'TESTWXYZ0000000K1', kun_ekstrautstyr: true }));
    expect(h).toContain('Kunde og bilinfo');
    expect(h).not.toContain('Vekter (kg)');
    expect(app.consoleFeil).toEqual([]);
  });
  it('Ombygging-kortet sier hva som gjelder, uten å nevne sjekklista', () => {
    const boks = sandbox.ombyggingBoksHTML(lagOrdre(kunRad()));
    expect(boks).toContain('Bare statusene På vei, Ikke påbegynt, Påbegynt og Klar for henting');
    expect(boks).not.toContain('sjekklista');
  });
  it('en arkivert kun-ordre og en godkjent kun-ordre tegnes uten feil', () => {
    expect(detalj(lagOrdre(kunRad({ status: 'arkivert' })))).toContain('Arkivert ordre');
    const godkjent = detalj(lagOrdre(kunRad({ godkjent: true, godkjenner_navn: 'TEST - Admin' })));
    expect(godkjent).toContain('Arkiver ordre');
    expect(app.consoleFeil).toEqual([]);
  });
  it('Fakturering-kortet har ingen «Hent drivstoff» for en kun-ordre, men fortsatt «Hent fra Utstyr-boksen» og «+ Legg til linje»', () => {
    const o = lagOrdre(kunRad());
    const html = sandbox.fikenLinjerHTML(o);
    expect(html).not.toContain('Hent drivstoff');
    expect(html).toContain('Hent fra Utstyr-boksen');
    expect(html).toContain('+ Legg til linje');
    expect(sandbox.fikenLinjerHTML(lagOrdre(kunRad({ kun_ekstrautstyr: false })))).toContain('Hent drivstoff');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('skjulte felt skrives ikke, og skjulte elementer som mangler gir ingen feil', () => {
  it('Forhandler endres: ingen Forhandler.nr, org.nr eller fullmakt skrives til ordren, og ingen advarsel om dem', async () => {
    const o = lagOrdre(kunRad({ utstyr: { har: '', skalHa: '', forhandlerNr: '', hengerfeste: 'ikke_hengerfeste', skalHaBekreftet: false }, forhandler_orgnr: '', dokumenter: [], fullmakt: 'har_ikke' }));
    S.ordrer = [o];
    const toast = []; sandbox.visToast = (m) => toast.push(m);
    sandbox.save = () => {};
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.sf(o.id, 'kunde', 'TEST Forhandler AS');
    sandbox.autoFyllForhandlerNr(o.id); sandbox.autoFyllForhandlerOrgnr(o.id); sandbox.autoFyllForhandlerFullmakt(o.id); sandbox.varsleHvisForhandlerDataMangler(o.id);
    await new Promise((ok) => setTimeout(ok, 10));
    expect(o.utstyr.forhandlerNr).toBe('');
    expect(o.forhandlerOrgnr).toBe('');
    expect(o.dokumenter).toEqual([]);
    expect(o.fullmakt).toBe('har_ikke');
    expect(toast).toEqual([]);
    expect(kall.filter((k) => k.rpc === 'oppdater_ordre_dokument')).toEqual([]);
    expect(oppdateringer(kall).filter((u) => 'dokumenter' in u || 'forhandler_orgnr' in u)).toEqual([]);
  });
  it('advarselen «Fant ingen forhandler / mangler Forhandler.nr og org.nr» vises ikke for en kun-ordre (de feltene er ikke med), men for en vanlig ordre som før', () => {
    const toast = []; sandbox.visToast = (m) => toast.push(m);
    const kun = lagOrdre(kunRad({ kunde: 'TEST Ukjent Forhandler AS' })); const vanlig = lagOrdre(kunRad({ kun_ekstrautstyr: false, id: 'ord_1700000000011', kunde: 'TEST Ukjent Forhandler AS' }));
    S.ordrer = [kun, vanlig];
    sandbox.varsleHvisForhandlerDataMangler(kun.id);
    expect(toast).toEqual([]);
    sandbox.varsleHvisForhandlerDataMangler(vanlig.id);
    expect(toast.join('|')).toContain('Fant ingen forhandler');
    toast.length = 0;
    S.kontakter = [{ id: 'k2', type: 'Forhandler', navn: 'TEST Forhandler AS', kontaktpersoner: [] }]; // finnes, men uten Forhandler.nr og org.nr
    kun.kunde = vanlig.kunde = 'TEST Forhandler AS';
    sandbox.varsleHvisForhandlerDataMangler(kun.id);
    expect(toast).toEqual([]);
    sandbox.varsleHvisForhandlerDataMangler(vanlig.id);
    expect(toast.join('|')).toContain('mangler Forhandler.nr og org.nr');
  });
  it('kontroll: samme endring på en VANLIG ordre fyller ut Forhandler.nr, org.nr og fullmakt som før', async () => {
    const o = lagOrdre(kunRad({ kun_ekstrautstyr: false, utstyr: { har: '', skalHa: '', forhandlerNr: '', hengerfeste: 'ikke_hengerfeste', skalHaBekreftet: false }, forhandler_orgnr: '', dokumenter: [], fullmakt: 'har_ikke' }));
    S.ordrer = [o];
    sandbox.save = () => {}; sandbox.visToast = () => {};
    const { db } = lagDb(); app.settDb(db);
    sandbox.autoFyllForhandlerNr(o.id); sandbox.autoFyllForhandlerOrgnr(o.id); sandbox.autoFyllForhandlerFullmakt(o.id);
    await new Promise((ok) => setTimeout(ok, 10));
    expect(o.utstyr.forhandlerNr).toBe('12345');
    expect(o.forhandlerOrgnr).toBe('984993188');
    expect(o.dokumenter.length).toBe(1);
    expect(o.fullmakt).toBe('har');
  });
  it('kundens rabatt i portalen: forhandler_kontakt_id settes fortsatt fra kundenavnet (bare den kolonnen), uten å skrive org.nr', async () => {
    const o = lagOrdre(kunRad({ forhandler_orgnr: '' }));
    S.ordrer = [o];
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.autoFyllForhandlerOrgnr(o.id);
    await new Promise((ok) => setTimeout(ok, 10));
    expect(oppdateringer(kall)).toEqual([{ forhandler_kontakt_id: 'k1' }]);
    expect(o.forhandlerOrgnr).toBe('');
  });
  it('«+ Ny ordre» med avkrysningen: ingen Forhandler.nr, org.nr eller fullmakt, og ingen oppfølgende dokumentskriving', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.edgeFetch = async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });
    sandbox.openOrdre = () => {}; sandbox.renderAll = () => {}; sandbox.closeModal = () => {};
    const sett = (kun, chassis) => {
      const verdier = { n_regnr: '', n_chassis: chassis, n_kunde: 'TEST Forhandler AS', n_eier: '', n_merke: 'KIA', n_type: '', n_modell: 'EV9', n_variant: '', n_farge: '', n_versjon: '', n_dato: '', n_status: 'ikke_paabegynt' };
      for (const [id, v] of Object.entries(verdier)) sandbox.document.getElementById(id).value = v;
      sandbox.document.getElementById('n_kunEkstrautstyr').checked = kun;
      sandbox.opprettOrdre();
    };
    sett(true, 'TESTWXYZ0000000N1');
    await new Promise((ok) => setTimeout(ok, 10));
    const kun = S.ordrer.find((x) => x.chassis === 'TESTWXYZ0000000N1');
    expect(kun.kunEkstrautstyr).toBe(true);
    expect(kun.utstyr.forhandlerNr || '').toBe('');
    expect(kun.forhandlerOrgnr || '').toBe('');
    expect(kun.dokumenter || []).toEqual([]);
    expect(oppdateringer(kall).filter((u) => 'dokumenter' in u)).toEqual([]);
    sett(false, 'TESTWXYZ0000000N2');
    await new Promise((ok) => setTimeout(ok, 10));
    const vanlig = S.ordrer.find((x) => x.chassis === 'TESTWXYZ0000000N2');
    expect(vanlig.utstyr.forhandlerNr).toBe('12345');
    expect(vanlig.forhandlerOrgnr).toBe('984993188');
    expect(vanlig.dokumenter.length).toBe(1);
    expect(oppdateringer(kall).filter((u) => 'dokumenter' in u).length).toBe(1);
  });
  it('drivstofflinjen legges ikke på en kun-ordre, selv om drivstoffdata skulle stå der fra før (en vanlig ordre får den som før)', async () => {
    const kall = [];
    sandbox.oppdaterOrdreFikenLinje = async (...a) => { kall.push(a); };
    const kun = lagOrdre(kunRad()); const vanlig = lagOrdre(kunRad({ kun_ekstrautstyr: false, id: 'ord_1700000000011' }));
    S.ordrer = [kun, vanlig];
    expect(sandbox.drivstoffKundepris(kun)).toBeGreaterThan(0);
    await sandbox.synkroniserDrivstoffFikenLinje(kun);
    await sandbox.leggTilFikenLinjeDrivstoff(kun.id);
    expect(kall).toEqual([]);
    await sandbox.synkroniserDrivstoffFikenLinje(vanlig);
    expect(kall.length).toBe(1);
    expect(kall[0][1]).toBe('21');
    await sandbox.leggTilFikenLinjeDrivstoff(vanlig.id); // kontroll: knappen virker som før for en vanlig ordre
    expect(kall.length).toBe(2);
  });
  it('Vegvesen-dokumenter genereres ikke automatisk for en kun-ordre (en vanlig ordre går videre til kontrollene som før)', async () => {
    const kall = [];
    sandbox.vegvesenFlateKontext = (o) => { kall.push(o.id); return null; };
    const kun = lagOrdre(kunRad({ ombygging: { nyttKjoretoy: true } })); const vanlig = lagOrdre(kunRad({ kun_ekstrautstyr: false, id: 'ord_1700000000011' }));
    await sandbox.vegvesenAutoGenererHvisKomplett(kun);
    expect(kall).toEqual([]);
    await sandbox.vegvesenAutoGenererHvisKomplett(vanlig);
    expect(kall).toEqual(['ord_1700000000011']);
  });
  it('buildOrdreDetail for en kun-ordre med Nytt Kjøretøy i dataene genererer ikke dokumenter og legger ingen drivstofflinje (en vanlig ordre går til kontrollene)', () => {
    const kall = []; sandbox.vegvesenErKomplett = (k) => { kall.push(k.id); return false; };
    const lin = []; sandbox.oppdaterOrdreFikenLinje = async (...a) => { lin.push(a); };
    detalj(lagOrdre(kunRad({ ombygging: { nyttKjoretoy: true } })));
    expect(kall).toEqual([]);
    expect(lin.filter((a) => a[1] === '21')).toEqual([]);
    detalj(lagOrdre(kunRad({ kun_ekstrautstyr: false, ombygging: { nyttKjoretoy: true } })));
    expect(kall).toEqual([KUN_ID]);
    expect(lin.filter((a) => a[1] === '21').length).toBe(1);
  });

  describe('alt som skriver til ID-ene til de skjulte kortene tåler at elementet mangler', () => {
    it('felt-, vekt-, drivstoff-, hengerfeste-, dokument-, foto- og sjekklistefunksjonene kaster ikke og skriver ikke til DOM-en', async () => {
      sandbox.save = () => {}; sandbox.visToast = () => {};
      const o = lagOrdre(kunRad({ utstyr_sjekkliste: [{ punkt: 'Gummimatte', ok: false }] }));
      const html = detalj(o);
      sandbox.buildOrdreDetail = () => {}; // tegner ikke på nytt midt i kallene (det er DOM-oppdateringene som skal prøves)
      await medEkteDom(html, o.id, async () => {
        expect(sandbox.document.getElementById('drivstoffKort_' + o.id)).toBeNull(); // kontroll: modellen av DOM-en har ikke elementene
        expect(sandbox.document.querySelector('#ordreDetail table')).toBeNull();
        sandbox.sf(o.id, 'merke', 'KIA'); sandbox.sf(o.id, 'modell', 'EV9'); sandbox.sf(o.id, 'kunde', 'TEST Forhandler AS'); sandbox.sf(o.id, 'ankomstdato', '2026-11-11');
        sandbox.autoFyllForhandlerNr(o.id); sandbox.autoFyllForhandlerOrgnr(o.id); sandbox.autoFyllForhandlerFullmakt(o.id); sandbox.varsleHvisForhandlerDataMangler(o.id);
        await sandbox.sv(o.id, 'totalvekt', 'a', '3000');
        sandbox.oppdaterVektFarge(o.id, 'totalvekt'); sandbox.oppdaterVektInputVerdierIDOM(o);
        sandbox.sd(o.id, 'totalpris', '500');
        sandbox.su(o.id, 'forhandlerNr', '99'); sandbox.settHengerfeste(o.id, 'hengerfeste'); sandbox.oppdaterHengerfesteNrVisning(o.id);
        sandbox.toggleDiagnose(o.id);
        await sandbox.lastOppFlereDokumenter([], o.id);
        sandbox.oppdaterFotoboks(o, 'a', 0); sandbox.oppdaterFotoboks(o, 's', 1);
        await sandbox.autoVelgUtstyrMal(o.id);
        sandbox.toggleUtstyrPunkt(o.id, 0);
        sandbox.renderForhandlerOrgnrForslag('kundeInput_' + o.id, 'forhandlerOrgnrInput_' + o.id, 'typeForslag_forhandlerOrgnr_' + o.id);
        sandbox.renderForhandlerNrForslag('kundeInput_' + o.id, 'forhandlerNrInput_' + o.id, 'typeForslag_forhandlerNr_' + o.id);
        sandbox.renderTypeForslag('merkeInput_' + o.id, 'modellInput_' + o.id, 'typeInput_' + o.id, 'typeForslag_type_' + o.id);
        sandbox.renderVariantForslag('merkeInput_' + o.id, 'modellInput_' + o.id, 'typeInput_' + o.id, 'variantInput_' + o.id, 'typeForslag_var_' + o.id);
        sandbox.renderVersjonForslag('merkeInput_' + o.id, 'modellInput_' + o.id, 'typeInput_' + o.id, 'versjonInput_' + o.id, 'typeForslag_ver_' + o.id);
        sandbox.renderOrdreLagerbruk();
        sandbox.oppdaterTvangsflytBoks(o);
      });
      expect(app.consoleFeil).toEqual([]);
    });
    it('Realtime/oppdatering av en kun-ordre som er åpen tegner den uten feil (de samme kallene som en omtegning gjør)', () => {
      const o = lagOrdre(kunRad());
      detalj(o);
      sandbox.buildOrdreDetail(); sandbox.buildOrdreDetail();
      expect(app.consoleFeil).toEqual([]);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('«Skal på bilen»: sjekklista styrer ikke radene for en kun-ordre', () => {
  const PRODUKTER = [{ modell_slug: 'kia-ev9', fiken_nummer: '501', navn: 'Takluke', portal_id: 'p501', type: 'tillegg', nummer_status: 'ok', velges_nar: ['Panorama glasstak'], app_rolle: null }];
  const ny = (over = {}) => lagOrdre(kunRad({ id: NY_KUN_ID, created_at: '2026-11-18T08:00:00Z', utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }], ...over }));
  beforeEach(() => { S.portalProdukter = structuredClone(PRODUKTER); });

  it('et avkrysset sjekklistepunkt gir ingen rad for en kun-ordre, men en rad for en vanlig ordre med samme data', () => {
    const kun = ny();
    expect(sandbox.erNyProduktliste(kun)).toBe(true);
    expect(sandbox.beregnSkalPaaBilen(kun).rader).toEqual([]);
    const vanlig = ny({ kun_ekstrautstyr: false });
    expect(sandbox.beregnSkalPaaBilen(vanlig).rader.map((r) => [r.nr, r.kilde])).toEqual([['501', 'sjekkliste']]);
  });
  it('«+ Legg til utstyr» (rettelse) gir raden som før', () => {
    const kun = ny({ produkt_rettelser: [{ handling: 'legg_til', produktnummer: '501', navn: 'Takluke', av: 'TEST', at: '2026-11-18T10:00:00Z' }] });
    expect(sandbox.beregnSkalPaaBilen(kun).rader.map((r) => [r.nr, r.kilde, r.fjernet])).toEqual([['501', 'manuell', false]]);
  });
  it('«Rett → Fjern»: en vanlig ordre med avkrysset sjekklistepunkt får en overstrøket rad; en kun-ordre har ingen rad å overstryke (sjekklista teller ikke)', () => {
    const fjern = [{ handling: 'fjern', produktnummer: '501', av: 'TEST', at: '2026-11-18T11:00:00Z' }];
    expect(sandbox.beregnSkalPaaBilen(ny({ kun_ekstrautstyr: false, produkt_rettelser: fjern })).rader.map((r) => [r.nr, r.fjernet])).toEqual([['501', true]]);
    expect(sandbox.beregnSkalPaaBilen(ny({ produkt_rettelser: fjern })).rader).toEqual([]);
  });
  it('tom-teksten nevner hverken Nytt/Brukt eller «Har ved ankomst»', () => {
    const html = sandbox.skalPaaBilenHTML(ny());
    expect(html).toContain('Ingenting valgt ennå. Legg til utstyret med «+ Legg til utstyr».');
    expect(html).not.toContain('Har ved ankomst');
    expect(html).not.toContain('Nytt/Brukt');
    expect(html).toContain('+ Legg til utstyr');
  });
  it('en vanlig ordre uten rader har den gamle teksten (byte-likt, også dekket av referansen)', () => {
    const html = sandbox.skalPaaBilenHTML(ny({ kun_ekstrautstyr: false, utstyr_sjekkliste: [] }));
    expect(html).toContain('Ingenting valgt ennå. Huk av Nytt/Brukt kjøretøy, fyll ut «Har ved ankomst», eller legg til utstyr.');
  });
  it('kortet viser ingen rad med «Sjekklista:» som grunn for en kun-ordre', () => {
    expect(sandbox.skalPaaBilenHTML(ny())).not.toContain('Sjekklista:');
    expect(sandbox.skalPaaBilenHTML(ny({ kun_ekstrautstyr: false }))).toContain('Sjekklista:');
  });
  it('en bestilling med sjekkliste-treff gir ingen «Sjekklista sier»-varsel for en kun-ordre (sjekklista er ikke en del av ordren)', () => {
    const kun = ny({ portal_linjer: [{ produktnummer: '999', navn: 'Annet', rabatt_prosent: 0 }] });
    expect(sandbox.beregnSkalPaaBilen(kun).varsler).toEqual([]);
  });
  it('synkProduktliste fjerner ikke en fakturalinje som en eldre sjekkliste-avkrysning la inn (en vanlig ordre rydder som før)', async () => {
    const kall = [];
    sandbox.oppdaterFikenLinjeForOppskrift = async (nr, aktiv, id) => { kall.push([nr, aktiv, id]); };
    app.settDb(null);
    const kun = ny({ fiken_linjer: [{ id: 'fl_1', produktnummer: '501', antall: 1 }] });
    await sandbox.synkProduktliste(kun);
    expect(kall).toEqual([]);
    const vanlig = ny({ kun_ekstrautstyr: false, utstyr_sjekkliste: [], fiken_linjer: [{ id: 'fl_1', produktnummer: '501', antall: 1 }] });
    await sandbox.synkProduktliste(vanlig);
    expect(kall).toEqual([['501', false, vanlig.id]]);
  });
  it('en rad lagt til for hånd får fortsatt fakturalinje (kilden er rettelsen, ikke sjekklista)', async () => {
    const kall = [];
    sandbox.oppdaterFikenLinjeForOppskrift = async (nr, aktiv, id) => { kall.push([nr, aktiv, id]); };
    const kun = ny({ produkt_rettelser: [{ handling: 'legg_til', produktnummer: '501', navn: 'Takluke', av: 'TEST', at: '2026-11-18T10:00:00Z' }] });
    await sandbox.synkProduktliste(kun);
    expect(kall).toContainEqual(['501', true, kun.id]);
  });
  it('en ordre fra før «Skal på bilen» er uendret for en kun-ordre (Varer fra lager med bare Ekstra utstyr, som før)', () => {
    S.lagerOppskrifter = [{ id: 'opp_ekstra', navn: 'TEST Gummimatte', biltype: 'KIA EV9', type: 'ekstra_utstyr', ingredienser: [], fikenProduktnummer: '' }, { id: 'opp_omb', navn: 'TEST Standard ombygging', biltype: 'KIA EV9', type: 'ombygging', ingredienser: [], fikenProduktnummer: '' }];
    const o = lagOrdre(kunRad()); S.ordrer = [o]; app.settAktivOrdre(o.id);
    sandbox.renderOrdreLagerbruk();
    const html = sandbox.document.getElementById('ordreLagerbruk_' + o.id).innerHTML;
    expect(html).toContain('TEST Gummimatte');
    expect(html).not.toContain('TEST Standard ombygging');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('statuser: bare På vei, Ikke påbegynt, Påbegynt og Klar for henting', () => {
  const FIRE = [['paa_vei', 'På vei'], ['ikke_paabegynt', 'Ikke påbegynt'], ['paabegynt', 'Påbegynt'], ['klar_henting', 'Klar for henting']];
  const dropdown = (status, id = KUN_ID, over = {}) => { const o = lagOrdre(kunRad({ ordre_status: status, ...over })); S.ordrer = [o]; return sandbox.statusDropdown(o.id, status); };

  for (const [status] of FIRE) {
    it(`nedtrekket (nåværende ${status}) har nøyaktig de fire statusene i den rekkefølgen, og ingen er utilgjengelig`, () => {
      const v = statusValg(dropdown(status), KUN_ID);
      expect(v.map((x) => [x.id, x.tekst])).toEqual(FIRE);
      expect(v.filter((x) => x.valgt).map((x) => x.id)).toEqual([status]);
      expect(v.some((x) => x.utilgjengelig)).toBe(false);
    });
  }
  for (const status of ['ikke_veid', 'klar_visning', 'vist_biltilsyn', 'hentet']) {
    it(`står ordren alt i ${status}, vises den i tillegg (valgt, men ikke valgbar tilbake), og de fire er der`, () => {
      const v = statusValg(dropdown(status), KUN_ID);
      expect(v.length).toBe(5);
      expect(FIRE.every(([id]) => v.some((x) => x.id === id))).toBe(true);
      const ekstra = v.find((x) => x.id === status);
      expect(ekstra.valgt).toBe(true);
      expect(ekstra.utilgjengelig).toBe(true);
      expect(v.filter((x) => x.utilgjengelig).length).toBe(1);
    });
  }
  it('rekkefølgen med en ekstra nåværende status er fortsatt appens (hentet sist, Klar for visning mellom Påbegynt og Klar for henting)', () => {
    expect(statusValg(dropdown('hentet'), KUN_ID).map((x) => x.id)).toEqual(['paa_vei', 'ikke_paabegynt', 'paabegynt', 'klar_henting', 'hentet']);
    expect(statusValg(dropdown('klar_visning'), KUN_ID).map((x) => x.id)).toEqual(['paa_vei', 'ikke_paabegynt', 'paabegynt', 'klar_visning', 'klar_henting']);
  });
  it('en vanlig bil har fortsatt alle åtte, og en leveranse sine tre (se også referansen)', () => {
    const o = lagOrdre(kunRad({ kun_ekstrautstyr: false })); S.ordrer = [o];
    expect(statusValg(sandbox.statusDropdown(o.id, 'paabegynt'), o.id).length).toBe(8);
    const lev = lagOrdre({ id: 'ord_lev', ordretype: 'leveranse', status: 'aktiv', ordre_status: 'under_arbeid', leveranse: { merking: 'TEST' } }); S.ordrer = [lev];
    expect(statusValg(sandbox.statusDropdown(lev.id, 'under_arbeid'), lev.id).map((x) => x.id)).toEqual(['under_arbeid', 'klar_sending', 'sendt']);
  });
  it('alle steder nedtrekket tegnes: ordredetaljen, Ordre-lista og Oversikt (aktive og ventende)', () => {
    const kunPaabegynt = lagOrdre(kunRad({ id: 'ord_1700000000020', chassis: 'TESTWXYZ0000000A1', ordre_status: 'paabegynt' }));
    const kunIkke = lagOrdre(kunRad({ id: 'ord_1700000000021', chassis: 'TESTWXYZ0000000A2', ordre_status: 'ikke_paabegynt' }));
    const kunHentet = lagOrdre(kunRad({ id: 'ord_1700000000022', chassis: 'TESTWXYZ0000000A3', ordre_status: 'klar_visning' }));
    S.ordrer = [kunPaabegynt, kunIkke, kunHentet];
    app.settAktivOrdre(null);
    const liste = medOpptak(app, () => sandbox.renderOrdreList());
    const oversikt = medOpptak(app, () => sandbox.renderOversikt());
    const alleListe = liste.ordreListeResultat;
    for (const [o, forventet] of [[kunPaabegynt, 4], [kunIkke, 4], [kunHentet, 5]]) {
      expect(statusValg(alleListe, o.id).length, 'Ordre-lista ' + o.id).toBe(forventet);
    }
    const oversiktHtml = Object.values(oversikt).join('\n');
    for (const o of [kunPaabegynt, kunIkke]) expect(statusValg(oversiktHtml, o.id).length, 'Oversikt ' + o.id).toBe(4);
    // ordredetaljen
    const d = detalj(lagOrdre(kunRad({ ordre_status: 'ikke_paabegynt' })));
    expect(statusValg(d, KUN_ID).map((x) => x.id)).toEqual(FIRE.map(([id]) => id));
  });

  describe('endreStatus avviser alt utenfor de fire (ingen skriving, ingen logglinje)', () => {
    const oppsett = (status = 'ikke_paabegynt', over = {}) => {
      const o = lagOrdre(kunRad({ ordre_status: status, ...over })); S.ordrer = [o];
      const { db, kall } = lagDb(); app.settDb(db);
      const toast = []; sandbox.visToast = (m) => toast.push(m);
      const rend = []; sandbox.renderAll = () => rend.push('renderAll'); sandbox.buildOrdreDetail = () => rend.push('buildOrdreDetail');
      return { o, kall, toast, rend };
    };
    for (const status of ['ikke_veid', 'klar_visning', 'vist_biltilsyn', 'hentet']) {
      it(`${status}: avvist med forklaring, ordren og loggen er uendret, ingen databasekall, og skjermen tegnes på nytt (nedtrekket nullstilles)`, async () => {
        const { o, kall, toast, rend } = oppsett('paabegynt');
        app.settAktivOrdre(o.id);
        const logg = o.endringer.length;
        await sandbox.endreStatus(o.id, status);
        expect(o.ordreStatus).toBe('paabegynt');
        expect(o.status).toBe('aktiv');
        expect(o.endringer.length).toBe(logg);
        expect(kall).toEqual([]);
        expect(toast.join('|')).toContain('Klar for henting');
        expect(rend).toEqual(['renderAll', 'buildOrdreDetail']);
      });
    }
    for (const status of ['paa_vei', 'ikke_paabegynt', 'paabegynt', 'klar_henting']) {
      it(`${status}: godtatt (én målrettet oppdatering av ordre_status, logglinje, ingen avvisning)`, async () => {
        const { o, kall, toast } = oppsett(status === 'ikke_paabegynt' ? 'paa_vei' : 'ikke_paabegynt');
        await sandbox.endreStatus(o.id, status);
        expect(o.ordreStatus).toBe(status);
        expect(oppdateringer(kall).filter((u) => 'ordre_status' in u).map((u) => u.ordre_status)).toEqual([status]);
        expect(JSON.stringify(o.endringer)).toContain('Status endret til');
        expect(toast.join('|')).not.toContain('kan bare ha statusene');
      });
    }
    it('Påbegynt krever fortsatt en påmeldt ansatt, men ikke et ankomstbilde (kortet finnes ikke i ordren)', async () => {
      const a = oppsett('ikke_paabegynt', { ansatte_signert: [] });
      await sandbox.endreStatus(a.o.id, 'paabegynt');
      expect(a.o.ordreStatus).toBe('ikke_paabegynt');
      expect(a.toast.join('|')).toContain('Minst én ansatt må meldes på');
      const b = oppsett('ikke_paabegynt', { bilder_ankomst: [null, null, null, null, null, null] });
      expect((b.o.bilderAnkomst || []).some(Boolean)).toBe(false);
      await sandbox.endreStatus(b.o.id, 'paabegynt');
      expect(b.o.ordreStatus).toBe('paabegynt');
      expect(b.toast.join('|')).not.toContain('bilde');
    });
    it('kontroll: en vanlig bil uten ankomstbilde stoppes fortsatt, og en vanlig bil kan settes til Hentet og Klar for visning', async () => {
      const a = oppsett('ikke_paabegynt', { kun_ekstrautstyr: false, bilder_ankomst: [null, null, null, null, null, null] });
      await sandbox.endreStatus(a.o.id, 'paabegynt');
      expect(a.o.ordreStatus).toBe('ikke_paabegynt');
      expect(a.toast.join('|')).toContain('Minst ett bilde fra ankomst');
      const b = oppsett('paabegynt', { kun_ekstrautstyr: false });
      await sandbox.endreStatus(b.o.id, 'klar_visning');
      expect(b.o.ordreStatus).toBe('klar_visning');
    });
    it('en kun-ordre som står i Hentet kan flyttes tilbake til en av de fire', async () => {
      const { o } = oppsett('hentet');
      await sandbox.endreStatus(o.id, 'klar_henting');
      expect(o.ordreStatus).toBe('klar_henting');
    });
    it('statusTillattForOrdre: bare kun-ordrer er begrenset; vanlige biler, leveranser og ukjente ordrer er det ikke', () => {
      const kun = lagOrdre(kunRad()), vanlig = lagOrdre(kunRad({ kun_ekstrautstyr: false })), lev = lagOrdre({ id: 'l', ordretype: 'leveranse', kun_ekstrautstyr: true, leveranse: {} });
      expect(sandbox.statusTillattForOrdre(kun, 'hentet')).toBe(false);
      expect(sandbox.statusTillattForOrdre(kun, 'klar_henting')).toBe(true);
      expect(sandbox.statusTillattForOrdre(vanlig, 'hentet')).toBe(true);
      expect(sandbox.statusTillattForOrdre(lev, 'sendt')).toBe(true);
      expect(sandbox.statusTillattForOrdre(undefined, 'hentet')).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Fakturering, godkjenning og arkivering virker som før for en kun-ordre', () => {
  it('Fakturering-siden tar med en kun-ordre i «Klar for henting» (og ikke en som allerede er fakturert)', () => {
    S.ordrer = [lagOrdre(kunRad({ ordre_status: 'klar_henting' })), lagOrdre(kunRad({ id: 'ord_1700000000030', chassis: 'TESTWXYZ0000000F1', ordre_status: 'klar_henting', fakturert: true })), lagOrdre(kunRad({ id: 'ord_1700000000031', chassis: 'TESTWXYZ0000000F2', ordre_status: 'paabegynt' }))];
    expect(sandbox.faktureringKandidater().map((o) => o.id)).toEqual([KUN_ID]);
  });
  it('fakturaSjekk stopper ikke en kun-ordre på noe som hører til de skjulte kortene', () => {
    const o = lagOrdre(kunRad({ ordre_status: 'klar_henting', fiken_linjer: [{ id: 'fl_1', produktnummer: '2402', antall: 1, pris: 100 }] })); S.ordrer = [o];
    const rod = sandbox.fakturaSjekk(o).grunner.filter((g) => g.niva === 'rod' || ['ukjent_modell', 'ingen_kunde', 'ingen_linjer'].includes(g.kode));
    expect(rod).toEqual([]);
  });
  it('Tvangsflyt-boksen: ingen krav, «Godkjenn og lukk» er mulig for godkjenner, og en godkjent ordre har «Arkiver ordre»', () => {
    app.settMe({ id: 1, navn: 'TEST - Godkjenner', rolle: 'godkjenner' });
    const o = lagOrdre(kunRad({ ordre_status: 'klar_henting' }));
    const boks = sandbox.tvangsflytBoksHTML(o);
    expect(boks).toContain('Ingen krav');
    expect(boks).toMatch(/<button class="btn red" style="width:100%" +onclick="openModal\('godkjenn'\)">Godkjenn og lukk<\/button>/);
    expect(detalj(lagOrdre(kunRad({ ordre_status: 'klar_henting', godkjent: true, godkjenner_navn: 'X' })), 'godkjenner')).toContain(`arkiver('${KUN_ID}')`);
  });
  it('arkiver() arkiverer en godkjent kun-ordre (målrettet status) uten Hentet', async () => {
    sandbox.renderAll = () => {}; sandbox.tilbakeOrdreList = () => {};
    const o = lagOrdre(kunRad({ ordre_status: 'klar_henting', godkjent: true })); S.ordrer = [o];
    const { db, kall } = lagDb(); app.settDb(db);
    await sandbox.arkiver(o.id);
    expect(o.status).toBe('arkivert');
    expect(oppdateringer(kall)).toContainEqual({ status: 'arkivert' });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('konsollen er ren', () => {
  it('ingen console.error under hele fila (utover det hver test selv tømmer)', () => {
    detalj(lagOrdre(kunRad()), 'admin');
    detalj(lagOrdre(vanligRad({ id: ID_VANLIG })), 'admin');
    expect(app.consoleFeil).toEqual([]);
  });
});
