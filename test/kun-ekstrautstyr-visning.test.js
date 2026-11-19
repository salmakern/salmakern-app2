import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';
import { byggReferanser, vanligRad, medOpptak, ID_VANLIG } from './helpers/kun-visning-scenarier.js';

// «Kun ekstrautstyr (ingen ombygging)»: enklere ordre (Henrik 2026-11-19). Ordren skal ikke ha vekter, drivstoff, time på biltilsynet, diagnose, dokumenter,
// «Utstyr - Har ved ankomst», forhandler.nr, hengerfeste, manglende deler, ankomst- og skadebilder, og i kundekortet ikke Type, Variant, Versjon, Farge, org.nr,
// COC/Fullmakt/Typegodkjenning/Egenvekt, serienummer og flåte. Statusene er bare På vei, Ikke påbegynt, Påbegynt, Klar for henting og Hentet (Hentet kreves for å lukke ordren). Alt annet er som før.
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
for (const n of ['visToast', 'renderAll', 'buildOrdreDetail', 'save', 'edgeFetch', 'oppdaterFikenLinjeForOppskrift', 'oppdaterOrdreFikenLinje', 'vegvesenFlateKontext', 'synkroniserForhandlerKontaktId', 'openOrdre', 'closeModal', 'effektivOrdreTidPerAnsattMs', 'tilbakeOrdreList', 'Event']) ORIG[n] = sandbox[n];

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
// Fotoboksene (`foboks_a_0`, `fo_s_1`) har ikke ordre-id i navnet, men er like fullt bare der når kortet er tegnet.
// MÅ vente på callbacken (async + await): uten det ble modellen gjenopprettet ved første `await` i callbacken, og alt etter den kjørte mot testriggens stubber som alltid finnes
// (funnet 2026-11-19: 14 av 15 fjernede null-vern overlevde).
async function medEkteDom(html, ordreId, fn) {
  const doc = sandbox.document;
  const finnes = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const origGet = doc.getElementById, origQ = doc.querySelector;
  const borte = (id) => (String(id).includes(ordreId) || id === 'uMalValgAnkomst' || /^(foboks|fo)_[as]_/.test(String(id))) && !finnes.has(id);
  doc.getElementById = (id) => (borte(id) ? null : origGet(id));
  doc.querySelector = (sel) => (sel === '#ordreDetail table' && !/<table/.test(html) ? null : origQ(sel));
  try { return await fn(); } finally { doc.getElementById = origGet; doc.querySelector = origQ; }
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
    expect(boks).toContain('Bare statusene På vei, Ikke påbegynt, Påbegynt, Klar for henting og Hentet');
    expect(boks).toContain('kan bare lukkes når den er Hentet');
    expect(boks).not.toContain('sjekklista');
    expect(boks).not.toContain('ingen tvangsflyt');
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
  it('«mangler Forhandler.nr og org.nr» vises ikke for en kun-ordre (de feltene er ikke med), men stavekontrollen av kundenavnet («Fant ingen forhandler») gjelder, uten teksten om Forhandler.nr/org.nr/fullmakt; en vanlig ordre er som før', () => {
    const toast = []; sandbox.visToast = (m) => toast.push(m);
    const kun = lagOrdre(kunRad({ kunde: 'TEST Ukjent Forhandler AS' })); const vanlig = lagOrdre(kunRad({ kun_ekstrautstyr: false, id: 'ord_1700000000011', kunde: 'TEST Ukjent Forhandler AS' }));
    S.ordrer = [kun, vanlig];
    sandbox.varsleHvisForhandlerDataMangler(kun.id);
    expect(toast).toEqual(['Fant ingen forhandler med navnet "TEST Ukjent Forhandler AS" i Kontakter - sjekk stavemåten, eller legg den til der.']);
    toast.length = 0;
    sandbox.varsleHvisForhandlerDataMangler(vanlig.id);
    expect(toast.join('|')).toContain('Fant ingen forhandler');
    expect(toast.join('|')).toContain('Forhandler.nr/org.nr/fullmakt fylles ikke ut automatisk');
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
        await sandbox.sv(o.id, 'foraksel', 'a', '1500'); // grenen som leter etter vekt-tabellen
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
describe('statuser: bare På vei, Ikke påbegynt, Påbegynt, Klar for henting og Hentet', () => {
  const FIRE = [['paa_vei', 'På vei'], ['ikke_paabegynt', 'Ikke påbegynt'], ['paabegynt', 'Påbegynt'], ['klar_henting', 'Klar for henting'], ['hentet', 'Hentet']]; // (navnet FIRE er historisk: Hentet ble lagt til 2026-11-19)
  const dropdown = (status, id = KUN_ID, over = {}) => { const o = lagOrdre(kunRad({ ordre_status: status, ...over })); S.ordrer = [o]; return sandbox.statusDropdown(o.id, status); };

  for (const [status] of FIRE) {
    it(`nedtrekket (nåværende ${status}) har nøyaktig de fem statusene i den rekkefølgen, og ingen er utilgjengelig`, () => {
      const v = statusValg(dropdown(status), KUN_ID);
      expect(v.map((x) => [x.id, x.tekst])).toEqual(FIRE);
      expect(v.filter((x) => x.valgt).map((x) => x.id)).toEqual([status]);
      expect(v.some((x) => x.utilgjengelig)).toBe(false);
    });
  }
  for (const status of ['ikke_veid', 'klar_visning', 'vist_biltilsyn']) {
    it(`står ordren alt i ${status}, vises den i tillegg (valgt, men ikke valgbar tilbake), og de fem er der`, () => {
      const v = statusValg(dropdown(status), KUN_ID);
      expect(v.length).toBe(6);
      expect(FIRE.every(([id]) => v.some((x) => x.id === id))).toBe(true);
      const ekstra = v.find((x) => x.id === status);
      expect(ekstra.valgt).toBe(true);
      expect(ekstra.utilgjengelig).toBe(true);
      expect(v.filter((x) => x.utilgjengelig).length).toBe(1);
    });
  }
  it('rekkefølgen med en ekstra nåværende status er fortsatt appens (Klar for visning mellom Påbegynt og Klar for henting, Hentet sist)', () => {
    expect(statusValg(dropdown('klar_visning'), KUN_ID).map((x) => x.id)).toEqual(['paa_vei', 'ikke_paabegynt', 'paabegynt', 'klar_visning', 'klar_henting', 'hentet']);
    expect(statusValg(dropdown('ikke_veid'), KUN_ID).map((x) => x.id)).toEqual(['paa_vei', 'ikke_paabegynt', 'paabegynt', 'ikke_veid', 'klar_henting', 'hentet']);
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
    for (const [o, forventet] of [[kunPaabegynt, 5], [kunIkke, 5], [kunHentet, 6]]) {
      expect(statusValg(alleListe, o.id).length, 'Ordre-lista ' + o.id).toBe(forventet);
    }
    const oversiktHtml = Object.values(oversikt).join('\n');
    for (const o of [kunPaabegynt, kunIkke]) expect(statusValg(oversiktHtml, o.id).length, 'Oversikt ' + o.id).toBe(5);
    // ordredetaljen
    const d = detalj(lagOrdre(kunRad({ ordre_status: 'ikke_paabegynt' })));
    expect(statusValg(d, KUN_ID).map((x) => x.id)).toEqual(FIRE.map(([id]) => id));
  });

  describe('endreStatus avviser alt utenfor de fem (ingen skriving, ingen logglinje)', () => {
    const oppsett = (status = 'ikke_paabegynt', over = {}) => {
      const o = lagOrdre(kunRad({ ordre_status: status, ...over })); S.ordrer = [o];
      const { db, kall } = lagDb(); app.settDb(db);
      const toast = []; sandbox.visToast = (m) => toast.push(m);
      const rend = []; sandbox.renderAll = () => rend.push('renderAll'); sandbox.buildOrdreDetail = () => rend.push('buildOrdreDetail');
      return { o, kall, toast, rend };
    };
    for (const status of ['ikke_veid', 'klar_visning', 'vist_biltilsyn']) {
      it(`${status}: avvist med forklaring, ordren og loggen er uendret, ingen databasekall, og skjermen tegnes på nytt (nedtrekket mister fokus og nullstilles)`, async () => {
        const { o, kall, toast, rend } = oppsett('paabegynt');
        app.settAktivOrdre(o.id);
        const logg = o.endringer.length;
        // Nedtrekket har fokus (brukeren valgte nettopp en status): ellers hopper tegningen over det (buildOrdreDetail/renderOversikt) og valget blir stående på skjermen.
        const aktivOrig = sandbox.document.activeElement; let blurret = 0;
        sandbox.document.activeElement = { tagName: 'SELECT', blur() { blurret++; } };
        try { await sandbox.endreStatus(o.id, status); } finally { sandbox.document.activeElement = aktivOrig; }
        expect(blurret).toBe(1);
        expect(o.ordreStatus).toBe('paabegynt');
        expect(o.status).toBe('aktiv');
        expect(o.endringer.length).toBe(logg);
        expect(kall).toEqual([]);
        expect(toast.join('|')).toContain('Klar for henting og Hentet');
        expect(rend).toEqual(['renderAll', 'buildOrdreDetail']);
      });
    }
    for (const status of ['paa_vei', 'ikke_paabegynt', 'paabegynt', 'klar_henting', 'hentet']) {
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
    it('en kun-ordre som står i en status utenfor de fem (Klar for visning) kan flyttes til en av de fem, og en i Hentet kan flyttes tilbake til Klar for henting', async () => {
      const { o } = oppsett('klar_visning');
      await sandbox.endreStatus(o.id, 'klar_henting');
      expect(o.ordreStatus).toBe('klar_henting');
      const h = oppsett('hentet');
      await sandbox.endreStatus(h.o.id, 'klar_henting');
      expect(h.o.ordreStatus).toBe('klar_henting');
    });
    it('statusTillattForOrdre: bare kun-ordrer er begrenset; vanlige biler, leveranser og ukjente ordrer er det ikke', () => {
      const kun = lagOrdre(kunRad()), vanlig = lagOrdre(kunRad({ kun_ekstrautstyr: false })), lev = lagOrdre({ id: 'l', ordretype: 'leveranse', kun_ekstrautstyr: true, leveranse: {} });
      for (const s of ['ikke_veid', 'klar_visning', 'vist_biltilsyn']) expect(sandbox.statusTillattForOrdre(kun, s), s).toBe(false);
      for (const s of ['paa_vei', 'ikke_paabegynt', 'paabegynt', 'klar_henting', 'hentet']) expect(sandbox.statusTillattForOrdre(kun, s), s).toBe(true);
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
  it('Tvangsflyt-boksen: kravet er status Hentet (Henrik 2026-11-19), «Godkjenn og lukk» er mulig for godkjenner først da, og en godkjent ordre har «Arkiver ordre»', () => {
    app.settMe({ id: 1, navn: 'TEST - Godkjenner', rolle: 'godkjenner' });
    const ikkeHentet = sandbox.tvangsflytBoksHTML(lagOrdre(kunRad({ ordre_status: 'klar_henting' })));
    expect(ikkeHentet).toContain('Status er Hentet');
    expect(ikkeHentet).not.toContain('Ingen krav');
    expect(ikkeHentet).toMatch(/<button class="btn red" style="width:100%" +disabled onclick="openModal\('godkjenn'\)">Ufullstendig<\/button>/);
    const o = lagOrdre(kunRad({ ordre_status: 'hentet' }));
    const boks = sandbox.tvangsflytBoksHTML(o);
    expect(boks).toContain('1 av 1 krav');
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
// Rettelser etter den uavhengige gjennomgangen 19.11 (hvert funn har egne tester som feiler mot koden fra før rettelsen)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Fabrikker, ikke delte objekter: dbToOrdre beholder referansen, og appen skriver rett inn i dem (su(), leggOrdreIFlate()).
const alleAv = () => ({ nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false });
const tomUtstyr = () => ({ har: '', skalHa: '', forhandlerNr: '', hengerfeste: 'ikke_hengerfeste', skalHaBekreftet: false });
const ventLitt = () => new Promise((ok) => setTimeout(ok, 15));

describe('«Kun ekstrautstyr» slått AV igjen: Forhandler.nr, org.nr og fullmakt fylles (bare det som er tomt)', () => {
  const slaaAv = async (o) => {
    S.ordrer = [o]; app.settAktivOrdre(o.id);
    sandbox.buildOrdreDetail = () => {}; sandbox.renderAll = () => {}; sandbox.save = () => {}; sandbox.visToast = () => {};
    const { db, kall } = lagDb(); app.settDb(db);
    await sandbox.settKunEkstrautstyr(o.id, false);
    await ventLitt();
    return kall;
  };
  it('en ordre som ble laget som kun-ordre (felt aldri fylt) får Forhandler.nr, org.nr, fullmakt-fil og Fullmakt-status når avkrysningen tas av', async () => {
    const o = lagOrdre(kunRad({ utstyr: tomUtstyr(), forhandler_orgnr: '', dokumenter: [], fullmakt: 'har_ikke', flate_id: null }));
    const kall = await slaaAv(o);
    expect(o.kunEkstrautstyr).toBe(false);
    expect(o.utstyr.forhandlerNr).toBe('12345');
    expect(o.forhandlerOrgnr).toBe('984993188');
    expect(o.dokumenter.length).toBe(1);
    expect(o.dokumenter[0].navn).toBe('Fullmakt.pdf');
    expect(o.fullmakt).toBe('har');
    expect(kall.filter((k) => k.rpc === 'oppdater_ordre_dokument').length).toBe(1);
  });
  it('en verdi noen har tastet inn overskrives aldri (Forhandler.nr og org.nr), men det som mangler fylles', async () => {
    const o = lagOrdre(kunRad({ utstyr: { ...tomUtstyr(), forhandlerNr: '99' }, forhandler_orgnr: '111222333', dokumenter: [], fullmakt: 'har_ikke', flate_id: null }));
    await slaaAv(o);
    expect(o.utstyr.forhandlerNr).toBe('99');
    expect(o.forhandlerOrgnr).toBe('111222333');
    expect(o.dokumenter.length).toBe(1);
  });
  it('en fullmakt som alt er på plass legges ikke til en gang til', async () => {
    const o = lagOrdre(kunRad({ utstyr: tomUtstyr(), forhandler_orgnr: '', fullmakt: 'har', flate_id: null,
      dokumenter: [{ navn: 'Fullmakt.pdf', url: 'https://eksempel.test/F.pdf', lastetOppAv: 'TEST', dato: '2026-11-01T10:00:00Z' }] }));
    const kall = await slaaAv(o);
    expect(o.dokumenter.length).toBe(1);
    expect(kall.filter((k) => k.rpc === 'oppdater_ordre_dokument')).toEqual([]);
  });
  it('uten kunde, eller med en kunde som ikke er en forhandler i Kontakter, skjer ingenting', async () => {
    for (const kunde of ['', 'TEST Privatkunde']) {
      const o = lagOrdre(kunRad({ kunde, utstyr: tomUtstyr(), forhandler_orgnr: '', dokumenter: [], fullmakt: 'har_ikke', flate_id: null }));
      await slaaAv(o);
      expect([o.utstyr.forhandlerNr, o.forhandlerOrgnr, o.dokumenter.length, o.fullmakt], kunde).toEqual(['', '', 0, 'har_ikke']);
    }
  });
  it('å slå avkrysningen PÅ fyller ingenting', async () => {
    const o = lagOrdre(kunRad({ kun_ekstrautstyr: false, utstyr: tomUtstyr(), forhandler_orgnr: '', dokumenter: [], fullmakt: 'har_ikke', flate_id: null }));
    S.ordrer = [o]; sandbox.buildOrdreDetail = () => {}; sandbox.renderAll = () => {}; sandbox.save = () => {}; sandbox.visToast = () => {};
    const { db } = lagDb(); app.settDb(db);
    await sandbox.settKunEkstrautstyr(o.id, true); await ventLitt();
    expect([o.kunEkstrautstyr, o.utstyr.forhandlerNr, o.forhandlerOrgnr, o.dokumenter.length, o.fullmakt]).toEqual([true, '', '', 0, 'har_ikke']);
  });
});

describe('avkrysningen «Kun ekstrautstyr» tegner detaljen på nytt selv når den har fokus (Edge/Chrome gir den fokus ved museklikk)', () => {
  const medFokus = async (utfoer) => {
    const detaljEl = sandbox.document.getElementById('ordreDetail');
    const aktivOrig = sandbox.document.activeElement;
    const avkrysning = { tagName: 'INPUT', blurKall: 0, blur() { this.blurKall++; sandbox.document.activeElement = aktivOrig; } };
    sandbox.document.activeElement = avkrysning;
    detaljEl.contains = (el) => el === avkrysning; // som i en nettleser: avkrysningen ligger inne i #ordreDetail
    try { await utfoer(detaljEl); } finally { sandbox.document.activeElement = aktivOrig; delete detaljEl.contains; }
    return avkrysning;
  };
  it('PÅ: avkrysningen mister fokus og detaljen tegnes med kun-visningen (uten Vekter, med KUN EKSTRAUTSTYR)', async () => {
    const o = lagOrdre(kunRad({ kun_ekstrautstyr: false, flate_id: null }));
    expect(detalj(o)).toContain('Vekter (kg)');
    const { db } = lagDb(); app.settDb(db);
    sandbox.renderAll = () => {}; sandbox.visToast = () => {};
    const knapp = await medFokus(async (el) => {
      await sandbox.settKunEkstrautstyr(o.id, true);
      expect(el.innerHTML).not.toContain('Vekter (kg)');
      expect(el.innerHTML).toContain('KUN EKSTRAUTSTYR');
      expect(statusValg(el.innerHTML, o.id).length).toBe(5);
    });
    expect(knapp.blurKall).toBe(1);
  });
  it('AV: detaljen tegnes med alle kortene og alle åtte statusene igjen', async () => {
    const o = lagOrdre(kunRad({ flate_id: null }));
    expect(detalj(o)).not.toContain('Vekter (kg)');
    const { db } = lagDb(); app.settDb(db);
    sandbox.renderAll = () => {}; sandbox.visToast = () => {}; sandbox.save = () => {};
    await medFokus(async (el) => {
      await sandbox.settKunEkstrautstyr(o.id, false);
      expect(el.innerHTML).toContain('Vekter (kg)');
      expect(statusValg(el.innerHTML, o.id).length).toBe(8);
    });
  });
  it('avvist avkrysning (Ombygging er huket av): skjermen tegnes på nytt, så avkrysningen ikke blir stående krysset av', async () => {
    const o = lagOrdre(kunRad({ kun_ekstrautstyr: false, flate_id: null, ombygging: { ...alleAv(), nyttKjoretoy: true } }));
    const html0 = detalj(o);
    const { db } = lagDb(); app.settDb(db);
    sandbox.renderAll = () => {}; const toast = []; sandbox.visToast = (m) => toast.push(m);
    // Nettleseren har alt krysset av boksen; en omtegning er det som setter den tilbake. «Gammel» innhold står som markør på om detaljen faktisk ble tegnet på nytt.
    sandbox.document.getElementById('ordreDetail').innerHTML = 'MED-AVKRYSNINGEN-SOM-BLE-AVVIST';
    await medFokus(async () => { await sandbox.settKunEkstrautstyr(o.id, true); });
    expect(toast.join('|')).toContain('Fjern avkrysningen i Ombygging');
    expect(o.kunEkstrautstyr).toBe(false);
    expect(sandbox.document.getElementById('ordreDetail').innerHTML).toBe(html0);
  });
});

describe('en kun-ordre kan ikke legges i en flåte, og tar ikke imot noe fra en flåte', () => {
  const P_ID = 'ord_1700000000051', K_ID = 'ord_1700000000052', V_ID = 'ord_1700000000053';
  const tomVekt = { totalvekt: { a: '', e: '', v: '' }, vogntog: { a: '', e: '', v: '' }, foraksel: { a: '', e: '', v: '' }, bakaksel: { a: '', e: '', v: '' } };
  let primaer, kun, vanlig, flate;
  const oppsett = (kunIFlaate = false) => {
    primaer = lagOrdre(kunRad({ id: P_ID, chassis: 'TESTWXYZ0000000P1', kun_ekstrautstyr: false, flate_id: 'flate_P', ombygging: { ...alleAv(), nyttKjoretoy: true } }));
    kun = lagOrdre(kunRad({ id: K_ID, chassis: 'TESTWXYZ0000000P2', flate_id: kunIFlaate ? 'flate_P' : null, type: '', variant: '', versjon: '', vekter: tomVekt, typegodkjenning: '', ombygging: alleAv(), dokumenter: [] }));
    vanlig = lagOrdre(kunRad({ id: V_ID, chassis: 'TESTWXYZ0000000P3', kun_ekstrautstyr: false, flate_id: null, type: '', variant: '', versjon: '', vekter: tomVekt, typegodkjenning: '', ombygging: alleAv(), dokumenter: [] }));
    flate = { id: 'flate_P', flatenummer: 'TEST-FLÅTE-P', primaerOrdreId: P_ID };
    S.flater = [flate]; S.ordrer = [primaer, kun, vanlig];
    sandbox.save = () => {}; sandbox.closeModal = () => {};
    sandbox.visFlateDetalj('flate_P'); // setter aktivFlateId
  };
  let toast;
  beforeEach(() => { toast = []; sandbox.visToast = (m) => toast.push(m); });

  it('flåtesøkene (ny flåte og «+ Legg til») viser en vanlig ordre, men aldri en kun-ordre', () => {
    oppsett();
    sandbox.renderFlateSok('TESTWXYZ0000000P');
    const liste = sandbox.document.getElementById('flateSokResultat').innerHTML;
    expect(liste).toContain(`leggOrdreIFlate('${V_ID}')`);
    expect(liste).not.toContain(K_ID);
    sandbox.renderNyFlatePrimaerSok('TESTWXYZ0000000P');
    const ny = sandbox.document.getElementById('nyFlatePrimaerResultat').innerHTML;
    expect(ny).toContain(`velgNyFlatePrimaer('${V_ID}')`);
    expect(ny).not.toContain(K_ID);
  });
  it('leggOrdreIFlate avviser en kun-ordre: ingen flåte, ingen kopiering av type/variant/versjon/vekter, ingen Nytt Kjøretøy (en vanlig ordre får alt som før)', () => {
    oppsett();
    sandbox.leggOrdreIFlate(K_ID);
    expect([kun.flateId, kun.type, kun.vekter.totalvekt.a, kun.typegodkjenning, kun.ombygging.nyttKjoretoy]).toEqual([null, '', '', '', false]);
    expect(toast.join('|')).toContain('kan ikke legges i en flåte');
    toast.length = 0;
    sandbox.leggOrdreIFlate(V_ID);
    expect([vanlig.flateId, vanlig.type, vanlig.vekter.totalvekt.a, vanlig.ombygging.nyttKjoretoy]).toEqual(['flate_P', 'GT-Line', '3000', true]);
    expect(toast).toEqual([]);
  });
  it('ny flåte med en kun-ordre som primær lagres ikke; med en vanlig ordre som primær lagres den som før', () => {
    oppsett();
    const felt = sandbox.document.getElementById('nyFlateNummer'); const primFelt = sandbox.document.getElementById('nyFlatePrimaerId');
    felt.value = 'TEST-NY'; primFelt.value = K_ID;
    const antall = S.flater.length;
    sandbox.lagreNyFlate();
    expect(S.flater.length).toBe(antall);
    expect(kun.flateId).toBeNull();
    expect(toast.join('|')).toContain('kan ikke legges i en flåte');
    primFelt.value = V_ID;
    sandbox.lagreNyFlate();
    expect(S.flater.length).toBe(antall + 1);
    expect(vanlig.flateId).toBe(S.flater[S.flater.length - 1].id);
    felt.value = ''; primFelt.value = '';
  });
  it('velgNyFlatePrimaer tar ikke imot en kun-ordre (men en vanlig ordre)', () => {
    oppsett();
    const primFelt = sandbox.document.getElementById('nyFlatePrimaerId'); primFelt.value = '';
    sandbox.velgNyFlatePrimaer(K_ID);
    expect(primFelt.value).toBe('');
    expect(toast.join('|')).toContain('kan ikke legges i en flåte');
    sandbox.velgNyFlatePrimaer(V_ID);
    expect(primFelt.value).toBe(V_ID);
    primFelt.value = '';
  });
  it('en kun-ordre kan ikke gjøres til primær i en flåte', () => {
    oppsett(true);
    sandbox.settFlatePrimaer(K_ID);
    expect(flate.primaerOrdreId).toBe(P_ID);
    expect(toast.join('|')).toContain('kan ikke legges i en flåte');
    sandbox.settFlatePrimaer(V_ID);
    expect(flate.primaerOrdreId).toBe(V_ID);
  });
  it('en kun-ordre som alt står i en flåte får ikke type/variant/versjon/vekter/Nytt Kjøretøy fra primæren, og en vanlig sekundær får det som før', async () => {
    oppsett(true);
    vanlig.flateId = 'flate_P';
    app.settDb(null);
    await sandbox.synkroniserFraPrimaer(P_ID);
    expect([kun.type, kun.variant, kun.versjon, kun.vekter.totalvekt.a, kun.typegodkjenning, kun.ombygging.nyttKjoretoy]).toEqual(['', '', '', '', '', false]);
    expect([vanlig.type, vanlig.variant, vanlig.versjon, vanlig.vekter.totalvekt.a, vanlig.ombygging.nyttKjoretoy]).toEqual(['GT-Line', 'AWD', '7-seter', '3000', true]);
  });
  it('en kun-ordre som primær er aldri kilde: de andre bilene i flåten beholder sine verdier', async () => {
    oppsett(true);
    flate.primaerOrdreId = K_ID; vanlig.flateId = 'flate_P'; vanlig.type = 'BEHOLDES';
    app.settDb(null);
    await sandbox.synkroniserFraPrimaer(K_ID);
    expect(vanlig.type).toBe('BEHOLDES');
    expect(primaer.type).toBe('GT-Line');
  });
  it('flåtekonteksten for Vegvesen-dokumenter har ikke kun-ordren som medlem, og kun-ordren selv har ingen kontekst (en vanlig flåte er som før)', () => {
    oppsett(true);
    const k = sandbox.vegvesenFlateKontext(primaer);
    expect(k.medlemmer.map((x) => x.id)).toEqual([P_ID]);
    expect(sandbox.vegvesenFlateKontext(kun)).toBeNull();
    vanlig.flateId = 'flate_P';
    expect(sandbox.vegvesenFlateKontext(primaer).medlemmer.map((x) => x.id).sort()).toEqual([P_ID, V_ID]);
  });
  it('ombyggingslinjen legges aldri på fakturaen til en kun-ordre, selv om et Nytt Kjøretøy-flagg skulle stå der (en vanlig ordre får linjen som før)', () => {
    oppsett(true);
    const kall = []; sandbox.oppdaterFikenLinjeForOppskrift = (nr, aktiv, id) => { kall.push([nr, aktiv, id]); };
    kun.ombygging = { ...alleAv(), nyttKjoretoy: true };
    sandbox.synkroniserOmbyggingFikenLinjer(kun);
    expect(kall).toEqual([]);
    sandbox.synkroniserOmbyggingFikenLinjer(primaer);
    expect(kall.some(([nr, aktiv]) => nr === '500' && aktiv === true)).toBe(true);
  });
  it('å åpne en kun-ordre med Nytt Kjøretøy-flagg legger ingen ombyggingslinje på den (buildOrdreDetail)', () => {
    oppsett(true);
    const kall = []; sandbox.oppdaterFikenLinjeForOppskrift = (nr, aktiv, id) => { kall.push([nr, aktiv, id]); };
    kun.ombygging = { ...alleAv(), nyttKjoretoy: true };
    detalj(kun);
    expect(kall.filter(([, aktiv]) => aktiv)).toEqual([]);
  });
});

describe('«🔍 Søk» (reg.nr-oppslag) på en kun-ordre skriver ikke til skjulte felt', () => {
  const KJENT = { merke: 'KIA', modell: 'EV9', aar: '2024', chassis: 'TESTWXYZ0000000R1' };
  const oppslag = (data = KJENT) => { sandbox.edgeFetch = async () => ({ ok: true, status: 200, json: async () => data }); };
  const tom = (over = {}) => lagOrdre(kunRad({ merke: '', modell: '', type: '', versjon: '', variant: '', chassis: '', flate_id: null, ...over }));
  beforeEach(() => { sandbox.save = () => {}; sandbox.buildOrdreDetail = () => {}; sandbox.visToast = () => {}; oppslag(); });

  it('kun-ordre: Merke og Modell fylles (de vises), Type og Versjon røres ikke (de er skjult), chassis fylles', async () => {
    const o = tom(); S.ordrer = [o];
    await sandbox.slaOppRegnr(o.id);
    expect([o.merke, o.modell, o.type, o.versjon, o.chassis]).toEqual(['KIA', 'EV9', '', '', 'TESTWXYZ0000000R1']);
    expect(sandbox.ordreToDb(o)).toMatchObject({ type: '', versjon: '' }); // det som ville blitt skrevet til databasen
  });
  it('kun-ordre: et Merke/Modell noen har skrevet inn overskrives ikke, bare det som er tomt fylles', async () => {
    const o = tom({ merke: 'Kia', modell: '' }); S.ordrer = [o];
    await sandbox.slaOppRegnr(o.id);
    expect([o.merke, o.modell]).toEqual(['Kia', 'EV9']);
  });
  it('vanlig ordre: Type og Versjon fylles som før, og Merke/Modell røres ikke', async () => {
    const o = tom({ kun_ekstrautstyr: false }); S.ordrer = [o];
    await sandbox.slaOppRegnr(o.id);
    expect([o.merke, o.modell, o.type, o.versjon, o.chassis]).toEqual(['', '', 'KIA EV9', '2024', 'TESTWXYZ0000000R1']);
  });
  it('«Funnet»-meldingen skrives til elementet som finnes ETTER at detaljen er tegnet på nytt (det gamle sitter ikke lenger i siden)', async () => {
    for (const kun of [true, false]) {
      const o = tom({ kun_ekstrautstyr: kun }); S.ordrer = [o];
      const gen = { n: 0 }; const elementer = {};
      const origGet = sandbox.document.getElementById;
      sandbox.buildOrdreDetail = () => { gen.n++; };
      sandbox.document.getElementById = (id) => (String(id).startsWith('regnrStatus_') ? (elementer[gen.n] ??= { innerHTML: '' }) : origGet(id));
      try { await sandbox.slaOppRegnr(o.id); } finally { sandbox.document.getElementById = origGet; }
      expect(gen.n, 'omtegninger').toBe(1);
      expect(elementer[1].innerHTML, `kun=${kun}`).toContain('Funnet: KIA EV9 2024');
    }
  });
  it('ikke funnet: meldingen står i det eksisterende elementet, og ordren er uendret', async () => {
    sandbox.edgeFetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'Ikke funnet' }) });
    const o = tom(); S.ordrer = [o];
    await sandbox.slaOppRegnr(o.id);
    expect([o.merke, o.modell, o.type, o.versjon, o.chassis]).toEqual(['', '', '', '', '']);
    expect(sandbox.document.getElementById('regnrStatus_' + o.id).innerHTML).toContain('Ikke funnet');
  });
});

describe('«+ Ny ordre» med «Kun ekstrautstyr»: Type, Variant, Versjon og Farge er ikke med', () => {
  const HTML = readFileSync(path.join(__dirname, '../salmakern.html'), 'utf8');
  const verdier = { n_regnr: '', n_chassis: 'TESTWXYZ0000000F1', n_kunde: 'TEST Forhandler AS', n_eier: '', n_merke: 'KIA', n_type: 'GT-Line', n_modell: 'EV9', n_variant: 'AWD', n_farge: 'Hvit', n_versjon: '2024', n_dato: '', n_status: 'ikke_paabegynt' };
  const fyllSkjema = (kun, chassis) => {
    for (const [id, v] of Object.entries({ ...verdier, n_chassis: chassis })) sandbox.document.getElementById(id).value = v;
    sandbox.document.getElementById('n_kunEkstrautstyr').checked = kun;
  };
  beforeEach(() => { sandbox.edgeFetch = async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) }); sandbox.openOrdre = () => {}; sandbox.renderAll = () => {}; sandbox.closeModal = () => {}; });

  it('opprettOrdre tar ikke med det som står i de skjulte feltene for en kun-ordre (Merke og Modell blir), men gjør det for en vanlig ordre', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    fyllSkjema(true, 'TESTWXYZ0000000F1'); sandbox.opprettOrdre();
    const kun = S.ordrer.find((x) => x.chassis === 'TESTWXYZ0000000F1');
    expect(kun.kunEkstrautstyr).toBe(true);
    expect([kun.merke, kun.modell]).toEqual(['KIA', 'EV9']);
    expect([kun.type, kun.variant, kun.versjon, kun.farge]).toEqual(['', '', '', '']);
    const ins = kall.filter((k) => k.tabell === 'ordrer' && k.kall.some(([m]) => m === 'insert')).map((k) => k.kall.find(([m]) => m === 'insert')[1][0]);
    expect(ins[0]).toMatchObject({ type: '', variant: '', versjon: '', farge: '' });
    fyllSkjema(false, 'TESTWXYZ0000000F2'); sandbox.opprettOrdre();
    const vanlig = S.ordrer.find((x) => x.chassis === 'TESTWXYZ0000000F2');
    expect([vanlig.type, vanlig.variant, vanlig.versjon, vanlig.farge]).toEqual(['GT-Line', 'AWD', '2024', 'Hvit']);
  });
  it('oppdaterNyOrdreKunFelt skjuler Type, Variant, Versjon og Farge når avkrysningen er på, og viser dem igjen når den tas av', () => {
    const vis = () => ['n_felt_type', 'n_felt_variant', 'n_felt_farge', 'n_felt_versjon'].map((i) => sandbox.document.getElementById(i).style.display);
    sandbox.document.getElementById('n_kunEkstrautstyr').checked = true;
    sandbox.oppdaterNyOrdreKunFelt();
    expect(vis()).toEqual(['none', 'none', 'none', 'none']);
    sandbox.document.getElementById('n_kunEkstrautstyr').checked = false;
    sandbox.oppdaterNyOrdreKunFelt();
    expect(vis()).toEqual(['', '', '', '']);
  });
  it('skjemaet: feltene ligger i egne elementer som avkrysningen styrer, Merke og Modell står utenfor, og teksten under avkrysningen sier hva som er enklere', () => {
    for (const [wrap, felt] of [['n_felt_type', 'n_type'], ['n_felt_variant', 'n_variant'], ['n_felt_farge', 'n_farge'], ['n_felt_versjon', 'n_versjon']]) {
      const m = new RegExp(`<div[^>]*id="${wrap}"[^>]*>([\\s\\S]*?)</div>\\s*(?:<div class="felt-wrap"|</div>)`).exec(HTML);
      expect(m, wrap).not.toBeNull();
      expect(m[1], wrap).toContain(`id="${felt}"`);
    }
    for (const felt of ['n_merke', 'n_modell']) expect(HTML).not.toMatch(new RegExp(`id="n_felt_[a-z]+"[^>]*>\\s*<label>[^<]*</label>\\s*<input id="${felt}"`));
    expect(HTML).toMatch(/<input type="checkbox" id="n_kunEkstrautstyr" onchange="oppdaterNyOrdreKunFelt\(\)"/);
    expect(HTML).toContain('Enklere ordre med bare statusene På vei, Ikke påbegynt, Påbegynt, Klar for henting og Hentet, uten Type, Variant, Versjon og Farge. Ordren kan bare lukkes når den er Hentet.');
  });
  it('apneNyOrdreModal og tilbakestillingen etter opprettelse viser feltene igjen', () => {
    const { db } = lagDb(); app.settDb(db);
    fyllSkjema(true, 'TESTWXYZ0000000F3'); sandbox.oppdaterNyOrdreKunFelt();
    sandbox.opprettOrdre(); // nullstiller avkrysningen
    expect(sandbox.document.getElementById('n_kunEkstrautstyr').checked).toBe(false);
    expect(sandbox.document.getElementById('n_felt_type').style.display).toBe('');
    sandbox.document.getElementById('n_kunEkstrautstyr').checked = true; sandbox.oppdaterNyOrdreKunFelt();
    sandbox.document.getElementById('n_kunEkstrautstyr').checked = false; // Avbryt lar avkrysningen stå, men et nytt åpnet skjema skal alltid være konsistent
    sandbox.apneNyOrdreModal();
    expect(sandbox.document.getElementById('n_felt_versjon').style.display).toBe('');
  });
  it('reg.nr-oppslaget i skjemaet (🔍 Søk) fyller Merke og Modell (bare tomme) for en kun-ordre, og Type og Versjon for en vanlig ordre', async () => {
    sandbox.Event = function Event() {};
    sandbox.edgeFetch = async () => ({ ok: true, status: 200, json: async () => ({ merke: 'KIA', modell: 'EV9', aar: '2024', chassis: 'TESTWXYZ0000000F4' }) });
    const sett = (kun, merke) => { for (const [id, v] of Object.entries({ n_regnr: 'AB12345', n_merke: merke, n_modell: '', n_type: '', n_versjon: '' })) sandbox.document.getElementById(id).value = v; sandbox.document.getElementById('n_kunEkstrautstyr').checked = kun; };
    sett(true, '');
    await sandbox.slaOppRegnrNyOrdre();
    const v = (id) => sandbox.document.getElementById(id).value;
    expect([v('n_merke'), v('n_modell'), v('n_type'), v('n_versjon'), v('n_chassis')]).toEqual(['KIA', 'EV9', '', '', 'TESTWXYZ0000000F4']);
    sett(true, 'Kia');
    await sandbox.slaOppRegnrNyOrdre();
    expect([v('n_merke'), v('n_modell')]).toEqual(['Kia', 'EV9']);
    sett(false, '');
    await sandbox.slaOppRegnrNyOrdre();
    expect([v('n_merke'), v('n_modell'), v('n_type'), v('n_versjon')]).toEqual(['', '', 'KIA EV9', '2024']);
  });
});

describe('kun-ordre og lager/Admin-ark: lukkede ordrer er ikke «i arbeid», og sletting rører ikke bilens Admin-ark-rad', () => {
  it('Materialbehov: delene til en lukket (arkivert) kun-ordre, en lukket leveranse og en lukket Hentet-bil telles ikke som bundet opp, men en aktiv ordre gjør det', () => {
    S.lagervarer = ['A', 'B', 'C', 'D', 'E'].map((x) => ({ id: 'vare_' + x, navn: 'TEST Vare ' + x, antall: 5, enhet: 'stk' }));
    const ordrer = [
      lagOrdre(kunRad({ id: 'ord_1700000000061', chassis: 'TESTWXYZ0000000M1', kun_ekstrautstyr: false, ordre_status: 'paabegynt' })),
      lagOrdre(kunRad({ id: 'ord_1700000000062', chassis: 'TESTWXYZ0000000M2', ordre_status: 'klar_henting', status: 'arkivert', godkjent: true })),
      lagOrdre(kunRad({ id: 'ord_1700000000063', chassis: 'TESTWXYZ0000000M3', kun_ekstrautstyr: false, ordre_status: 'hentet', status: 'arkivert' })),
      lagOrdre({ id: 'ord_1700000000064', ordretype: 'leveranse', status: 'arkivert', ordre_status: 'sendt', leveranse: { merking: 'TEST' } }),
      lagOrdre(kunRad({ id: 'ord_1700000000065', chassis: 'TESTWXYZ0000000M5', ordre_status: 'klar_henting' })), // aktiv kun-ordre: teller (den er ikke lukket)
    ];
    S.ordrer = ordrer;
    S.lagerhistorikk = ordrer.map((o, i) => ({ id: 'h' + i, ordreId: o.id, oppskriftId: 'opp_' + i, vareId: 'vare_' + 'ABCDE'[i], endring: -(i + 1) }));
    sandbox.renderMaterialbehov();
    const html = sandbox.document.getElementById('materialbehovListe').innerHTML;
    expect(html).toContain('TEST Vare A');
    expect(html).toContain('TEST Vare E');
    for (const v of ['B', 'C', 'D']) expect(html, v).not.toContain('TEST Vare ' + v);
  });

  describe('slettOrdre', () => {
    const AAR = new Date().getFullYear();
    const CH = 'TESTWXYZ0000000S1';
    const oppsett = () => {
      const bil = lagOrdre(kunRad({ id: 'ord_1700000000071', chassis: CH, kun_ekstrautstyr: false, flate_id: null, ankomstdato: `${AAR}-03-01` }));
      const kun = lagOrdre(kunRad({ id: 'ord_1700000000072', chassis: CH, flate_id: null, ankomstdato: `${AAR}-11-10` }));
      const lev = lagOrdre({ id: 'ord_1700000000073', ordretype: 'leveranse', status: 'aktiv', ordre_status: 'under_arbeid', chassis: CH, ankomstdato: `${AAR}-11-10`, leveranse: { merking: 'TEST' } });
      S.ordrer = [bil, kun, lev]; S.timer = [];
      S.adminArk = [{ id: 'ark_1', aar: AAR, chassisNr: CH }];
      sandbox.renderAll = () => {}; sandbox.tilbakeOrdreList = () => {};
      const { db, kall } = lagDb(); db.storage.from = () => ({ remove: async () => ({ error: null }), list: async () => ({ data: [], error: null }) }); app.settDb(db);
      return { bil, kun, lev, kall };
    };
    const adminArkSlettet = (kall) => kall.filter((k) => k.tabell === 'admin_ark' && k.kall.some(([m]) => m === 'delete')).length;
    it('å slette en kun-ordre med samme chassis.nr og år som en bil sletter ikke bilens Admin-ark-rad', () => {
      const { kun, kall } = oppsett();
      sandbox.slettOrdre(kun.id);
      expect(S.ordrer.some((o) => o.id === kun.id)).toBe(false);
      expect(S.adminArk.length).toBe(1);
      expect(adminArkSlettet(kall)).toBe(0);
    });
    it('det samme gjelder en leveranse', () => {
      const { lev, kall } = oppsett();
      sandbox.slettOrdre(lev.id);
      expect(S.adminArk.length).toBe(1);
      expect(adminArkSlettet(kall)).toBe(0);
    });
    it('kontroll: å slette selve bil-ordren tar Admin-ark-raden med seg som før', () => {
      const { bil, kall } = oppsett();
      sandbox.slettOrdre(bil.id);
      expect(S.adminArk.length).toBe(0);
      expect(adminArkSlettet(kall)).toBe(1);
    });
  });
});

describe('gjenopprett bilder fra Storage for en kun-ordre: bare Levering (ankomst, skader og manglende deler er ikke med i ordren)', () => {
  const fotoDb = () => {
    const { db, kall } = lagDb();
    db.storage.from = () => ({ list: async () => ({ data: [{ name: 'a_0.jpg' }, { name: 's_1.jpg' }, { name: 'l_2.jpg' }], error: null }), getPublicUrl: (sti) => ({ data: { publicUrl: 'https://eksempel.test/' + sti } }) });
    app.settDb(db);
    return kall;
  };
  const tomme = { bilder_ankomst: [null, null, null, null, null, null], bilder_levering: [null, null, null, null, null, null], bilder_avstand_skader: [null, null, null] };
  it('kun-ordre: Levering gjenopprettes, ankomst og avstand/skader røres ikke', async () => {
    sandbox.save = () => {}; sandbox.buildOrdreDetail = () => {}; sandbox.visToast = () => {};
    const o = lagOrdre(kunRad({ ...tomme })); S.ordrer = [o]; fotoDb();
    await sandbox.gjenopprettFotos(o.id);
    expect(o.bilderLevering[2]).toBe(`https://eksempel.test/${o.id}/l_2.jpg`);
    expect(o.bilderAnkomst.some(Boolean)).toBe(false);
    expect(o.bilderAvstandSkader.some(Boolean)).toBe(false);
  });
  it('kontroll: en vanlig ordre får alle tre gjenopprettet som før', async () => {
    sandbox.save = () => {}; sandbox.buildOrdreDetail = () => {}; sandbox.visToast = () => {};
    const o = lagOrdre(kunRad({ ...tomme, kun_ekstrautstyr: false })); S.ordrer = [o]; fotoDb();
    await sandbox.gjenopprettFotos(o.id);
    expect([!!o.bilderAnkomst[0], !!o.bilderAvstandSkader[1], !!o.bilderLevering[2]]).toEqual([true, true, true]);
  });
});

describe('effektiv tid (Bil-effektivitet): en kun-ordre fryses ved Hentet som en vanlig bil, og holdes utenfor effektivitetstallene', () => {
  const FROSSET = { totalMs: 3600000, perAnsatt: [{ navn: 'TEST - Admin', ms: 3600000 }] };
  const oppsett = (over = {}) => {
    const o = lagOrdre(kunRad({ ordre_status: 'paabegynt', flate_id: null, ...over })); S.ordrer = [o];
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.visToast = () => {}; sandbox.renderAll = () => {}; sandbox.buildOrdreDetail = () => {};
    sandbox.effektivOrdreTidPerAnsattMs = async () => FROSSET;
    return { o, kall };
  };
  it('kun-ordre: Hentet fryser tallet (og skriver det), Klar for henting fryser ikke, og flyttes den tilbake fra Hentet nullstilles frysingen', async () => {
    const { o, kall } = oppsett();
    await sandbox.endreStatus(o.id, 'klar_henting');
    expect(o.effektivTidFrossen).toBeNull();
    await sandbox.endreStatus(o.id, 'hentet');
    expect(o.effektivTidFrossen).toMatchObject({ totalMs: 3600000 });
    expect(oppdateringer(kall).filter((u) => 'ordre_status' in u).pop().effektiv_tid_frossen).toMatchObject({ totalMs: 3600000 });
    await sandbox.endreStatus(o.id, 'klar_henting');
    expect(o.effektivTidFrossen).toBeNull();
  });
  it('kun-ordre: andre statuser fryser ikke', async () => {
    const { o } = oppsett({ ordre_status: 'paa_vei' });
    await sandbox.endreStatus(o.id, 'ikke_paabegynt');
    expect(o.effektivTidFrossen).toBeNull();
  });
  it('kontroll: en vanlig bil fryses ved Hentet som før, ikke ved Klar for henting', async () => {
    const { o } = oppsett({ kun_ekstrautstyr: false });
    await sandbox.endreStatus(o.id, 'klar_henting');
    expect(o.effektivTidFrossen).toBeNull();
    await sandbox.endreStatus(o.id, 'hentet');
    expect(o.effektivTidFrossen).toMatchObject({ totalMs: 3600000 });
  });
  it('badgen: en kun-ordre viser bare «Brukt tid» og kostnad (ingen standardtid, ingen vurdering), en vanlig bil sammenligner med standard; begge sier «bilen er hentet» når tiden er frosset', async () => {
    S.standardtider = { EV9: { ombygging: 600 } };
    try {
      for (const kun of [true, false]) {
        const o = lagOrdre(kunRad({ kun_ekstrautstyr: kun, ordre_status: 'hentet', flate_id: null })); o.effektivTidFrossen = { ...FROSSET, frossetVed: '2026-11-19T10:00:00Z' }; S.ordrer = [o];
        await sandbox.renderBilEffektivitetBadge(o);
        const h = sandbox.document.getElementById('bilEffektivitetBadge_' + o.id).innerHTML;
        expect(h, `kun=${kun}`).toContain('Tiden er frosset (bilen er hentet)');
        if (kun) {
          expect(h).toContain('Brukt tid');
          expect(h).toContain(sandbox.fmtTime(3600000));
          for (const s of ['Bil-effektivitet', 'standard', 'God', 'Bør følges opp']) expect(h, s).not.toContain(s);
        } else {
          expect(h).toContain('Bil-effektivitet');
          expect(h).toContain('(standard');
        }
      }
    } finally { delete S.standardtider; }
  });
  it('en kun-ordre uten standardtid for modellen gir fortsatt brukt tid (ingen «Ingen standardtid satt»-melding)', async () => {
    S.standardtider = {};
    try {
      const o = lagOrdre(kunRad({ ordre_status: 'klar_henting', flate_id: null })); S.ordrer = [o];
      sandbox.effektivOrdreTidPerAnsattMs = async () => FROSSET;
      await sandbox.renderBilEffektivitetBadge(o);
      const h = sandbox.document.getElementById('bilEffektivitetBadge_' + o.id).innerHTML;
      expect(h).toContain('Brukt tid');
      expect(h).not.toContain('Ingen standardtid');
    } finally { delete S.standardtider; }
  });

  describe('Mer → Bil-effektivitet holder en kun-ordre utenfor (per ansatt og snitt per modell)', () => {
    const SESJON = [{ ansattId: 1, ansatt: 'TEST - Admin', start: 1700000000000, stopp: 1700003600000 }];
    const ordre = (id, chassis, kun) => { const o = lagOrdre(kunRad({ id, chassis, kun_ekstrautstyr: kun, ordre_status: 'klar_henting', flate_id: null })); o.datoKlarHenting = '2026-11-10'; o.ordreTimerSessions = SESJON; return o; };
    const EKTE = { hentArbeidsintervaller: sandbox.hentArbeidsintervaller, beregnOverlappMs: sandbox.beregnOverlappMs };
    beforeEach(() => {
      S.standardtider = { EV9: { ombygging: 600 } };
      sandbox.hentArbeidsintervaller = async () => ({});
      sandbox.beregnOverlappMs = () => 3600000;
    });
    afterEach(() => { delete S.standardtider; Object.assign(sandbox, EKTE); });
    it('bare en kun-ordre: ingen rad per ansatt og ingen modell i snittet', async () => {
      S.ordrer = [ordre('ord_1700000000070', 'TESTWXYZ0000000Q1', true)];
      expect(await sandbox.beregnBilEffektivitetPerAnsatt('2026-11-01', '2026-11-30')).toEqual([]);
      expect(await sandbox.beregnGjennomsnittTidPerModell()).toEqual({});
    });
    it('kontroll: samme ordre uten «Kun ekstrautstyr» teller (så testen kan feile)', async () => {
      S.ordrer = [ordre('ord_1700000000071', 'TESTWXYZ0000000Q2', false)];
      const perAnsatt = await sandbox.beregnBilEffektivitetPerAnsatt('2026-11-01', '2026-11-30');
      expect(perAnsatt.map((r) => r.antallBiler)).toEqual([1]);
      expect((await sandbox.beregnGjennomsnittTidPerModell()).EV9.antallBiler).toBe(1);
    });
    it('en kun-ordre og en vanlig bil sammen: bare den vanlige telles', async () => {
      S.ordrer = [ordre('ord_1700000000072', 'TESTWXYZ0000000Q3', true), ordre('ord_1700000000073', 'TESTWXYZ0000000Q4', false)];
      expect((await sandbox.beregnBilEffektivitetPerAnsatt('2026-11-01', '2026-11-30')).map((r) => r.antallBiler)).toEqual([1]);
      expect((await sandbox.beregnGjennomsnittTidPerModell()).EV9.antallBiler).toBe(1);
    });
  });
});

describe('ordrekortene i Ordre-lista og på Oversikt viser ikke det som ikke er med i en kun-ordre', () => {
  const html = () => {
    app.settAktivOrdre(null);
    const liste = medOpptak(app, () => sandbox.renderOrdreList()).ordreListeResultat;
    const oversikt = Object.values(medOpptak(app, () => sandbox.renderOversikt())).join('\n');
    return { liste, oversikt };
  };
  it('kun-ordre (med gamle data i de skjulte feltene): ingen COC/Fullmakt/flåte, ingen Drivstoff-rad, ingen hengerfeste, ingen variant/farge', () => {
    S.ordrer = [lagOrdre(kunRad({ ordre_status: 'paabegynt', coc: 'har_ikke', fullmakt: 'har_ikke' }))];
    const { liste, oversikt } = html();
    expect(liste).toContain('KUN EKSTRAUTSTYR');
    for (const s of ['COC:', 'Fullmakt:', 'Flåte', 'flåte', 'Drivstoff', 'Hengerfeste', 'AWD', 'Hvit']) expect(liste, 'Ordre-lista: ' + s).not.toContain(s);
    expect(liste).toContain('Tilvalg'); // resten av kortet er som før
    expect(oversikt).toContain('KUN EKSTRAUTSTYR');
    for (const s of ['Flåte', 'flåte', 'Farge:', 'Hvit']) expect(oversikt, 'Oversikt: ' + s).not.toContain(s);
  });
  it('Oversikt (ventende): ingen flåte og ingen farge for en kun-ordre', () => {
    S.ordrer = [lagOrdre(kunRad({ ordre_status: 'ikke_paabegynt' }))];
    const { oversikt } = html();
    expect(oversikt).toContain('KUN EKSTRAUTSTYR');
    for (const s of ['Flåte', 'flåte', 'Farge:']) expect(oversikt, s).not.toContain(s);
  });
  it('kontroll: den samme ordren uten kun-flagget har alt dette på kortene', () => {
    S.ordrer = [lagOrdre(kunRad({ kun_ekstrautstyr: false, ordre_status: 'paabegynt', coc: 'har_ikke', fullmakt: 'har_ikke' }))];
    const { liste, oversikt } = html();
    for (const s of ['COC: Mangler', 'Fullmakt: Mangler', 'TEST-FLÅTE-1', 'Drivstoff', 'Hengerfeste', 'AWD · Hvit']) expect(liste, 'Ordre-lista: ' + s).toContain(s);
    for (const s of ['TEST-FLÅTE-1', 'Farge: Hvit']) expect(oversikt, 'Oversikt: ' + s).toContain(s);
  });
});

describe('sw.js og dokumentasjonen følger endringen', () => {
  const SW = readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  const CLAUDE = readFileSync(path.join(__dirname, '../CLAUDE.md'), 'utf8');
  it('CACHE er bumpet med en kommentar for denne endringen (v100 eller nyere), og CLAUDE.md nevner samme versjon', () => {
    const cache = Number(/const CACHE = 'salmakern-v(\d+)'/.exec(SW)[1]);
    const kommentar = /\/\/ v(\d+) - «Kun ekstrautstyr»/.exec(SW);
    expect(kommentar, 'sw.js har en kommentarlinje «// vN - «Kun ekstrautstyr»...»').not.toBeNull();
    const dennesVersjon = Number(kommentar[1]);
    expect(dennesVersjon).toBeGreaterThanOrEqual(100); // origin/main sto på v99 da denne endringen ble klargjort
    expect(cache).toBeGreaterThanOrEqual(dennesVersjon);
    const avsnitt = /\*\*Enklere ordre \(2026-11-19[\s\S]*?\*\*Test\*\*[^\n]*/.exec(CLAUDE);
    expect(avsnitt, 'CLAUDE.md har avsnittet «Enklere ordre»').not.toBeNull();
    expect(avsnitt[0]).toContain(`\`sw.js\` CACHE v${dennesVersjon}`);
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
