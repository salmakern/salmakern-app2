// Trinn 4 av «Én produktliste»: samlesiden «Fakturering» (js/fakturering.js) og sammenligningen «Skal på bilen» mot fakturaen i
// fakturaSjekk. Hele appen i testriggen, syntetiske TEST-ordrer, falsk database. Ingen Fiken-kall (fakturerViaFiken er en spion).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

const app = lastApp();
const { sandbox, S } = app;
const EKTE = { fakturerViaFiken: sandbox.fakturerViaFiken, confirm: sandbox.confirm, visToast: sandbox.visToast, erNyProduktliste: sandbox.erNyProduktliste };

let innhold;
beforeEach(() => {
  app.settMe({ id: 990001, navn: 'TEST Admin', rolle: 'admin' });
  app.settDb(null);
  S.fikenPriser = [{ produktnummer: '500', navn: 'Varebilombygging KIA EV9', pris_kr: 51500 }, { produktnummer: '512', navn: 'Skuffesystem', pris_kr: 14900 }];
  S.portalProdukter = [
    { portal_id: 'v500', type: 'variant', modell_slug: 'kia-ev9', fiken_nummer: '500', nummer_status: 'ok', navn: 'Standard ombygging', app_rolle: 'ombygging', velges_nar: [] },
    { portal_id: 'v512', type: 'variant', modell_slug: 'kia-ev9', fiken_nummer: '512', nummer_status: 'ok', navn: 'Skuffesystem', velges_nar: [] },
  ];
  S.portalProduktRoller = S.portalProdukter.filter((p) => p.app_rolle);
  S.lagerOppskrifter = []; S.lagervarer = []; S.lagerhistorikk = [];
  S.fikenKundeAlias = []; S.fikenKundeRabatt = [];
  app.kjor("_faktureringPriserHentet = true; faktureringFilter = 'alle';");
  innhold = sandbox.document.getElementById('faktureringInnhold');
});
afterEach(() => { Object.assign(sandbox, EKTE); app.settMe(null); });

const ordre = (over = {}) => sandbox.dbToOrdre({ id: 'ord_TEST_F' + Math.random().toString(36).slice(2, 6), status: 'aktiv', ordre_status: 'klar_henting', merke: 'KIA', modell: 'EV9', kunde: 'TEST Kunde AS', chassis: 'TESTWXYZ0000000F1', fiken_linjer: [{ produktnummer: '500', antall: 1 }], ...over });
const leveranse = (over = {}) => sandbox.dbToOrdre({ id: 'ord_TEST_FL' + Math.random().toString(36).slice(2, 6), status: 'aktiv', ordretype: 'leveranse', ordre_status: 'under_arbeid', kunde: 'TEST Kunde AS', fiken_linjer: [{ produktnummer: '500', antall: 1 }], ...over });

describe('utvalg og sum', () => {
  it('biler: bare aktive, ikke fakturerte, i Klar for henting eller Hentet - Vist på biltilsynet er IKKE med (19.11, Henrik: «kun biler som er klar for henting»)', () => {
    const a = ordre(), b = ordre({ ordre_status: 'paabegynt' }), c = ordre({ fakturert: true }), d = ordre({ ordre_status: 'hentet' }), e = ordre({ ordre_status: 'vist_biltilsyn' });
    S.ordrer = [a, b, c, d, e];
    expect(sandbox.faktureringKandidater().map((o) => o.id)).toEqual([a.id, d.id]);
  });
  it('leveranser: bare Sendt gir plass (19.11, Henrik: «leveranser som har blitt sendt») - Under arbeid og Klar til sending er IKKE med', () => {
    const a = leveranse({ ordre_status: 'sendt' }), b = leveranse({ ordre_status: 'under_arbeid' }), c = leveranse({ ordre_status: 'klar_sending' }), d = leveranse({ ordre_status: 'sendt', fakturert: true });
    S.ordrer = [a, b, c, d];
    expect(sandbox.faktureringKandidater().map((o) => o.id)).toEqual([a.id]);
  });
  it('en blanding av biler og leveranser gir begge typer i lista', () => {
    const bil = ordre({ ordre_status: 'klar_henting' }), lev = leveranse({ ordre_status: 'sendt' });
    S.ordrer = [bil, lev];
    expect(sandbox.faktureringKandidater().map((o) => o.id).sort()).toEqual([bil.id, lev.id].sort());
  });
  it('pris per linje: overstyrt beløp, så frosset pris, så Fiken-pris; ukjent telles', () => {
    const o = ordre({ fiken_linjer: [{ produktnummer: '500', antall: 1 }, { produktnummer: '512', antall: 2, pris: 13000 }, { produktnummer: '21', antall: 1, belop: 1500 }, { produktnummer: '999', antall: 1 }] });
    const { linjer, sum, ukjente } = sandbox.faktureringSum(o);
    expect(linjer.map((l) => [l.nr, l.kilde, l.sum])).toEqual([['500', 'fiken', 51500], ['512', 'frosset', 26000], ['21', 'belop', 1500], ['999', null, null]]);
    expect(sum).toBe(79000);
    expect(ukjente).toBe(1);
  });
});

describe('siden', () => {
  it('viser filtre med antall, sum og grunner; «Lag kladd» er sperret når noe stopper', () => {
    const klar = ordre(); const stopper = ordre({ kunde: '' });
    S.ordrer = [klar, stopper];
    sandbox.renderFakturering();
    const html = innhold.innerHTML;
    expect(html).toContain('Alle (2)');
    expect(html).toContain('Stopper (1)');
    expect(html).toContain('51');
    expect(html).toContain('Kunde mangler på ordren');
    expect((html.match(/disabled onclick="faktureringLagKladd/g) || []).length).toBe(1);
  });
  it('filteret «Stopper» viser bare de røde', () => {
    S.ordrer = [ordre(), ordre({ kunde: '' })];
    app.kjor("faktureringFilter = 'rod';");
    sandbox.renderFakturering();
    expect((innhold.innerHTML.match(/Åpne ordren/g) || []).length).toBe(1);
  });
  it('ikke admin: ingenting vises', () => {
    app.settMe({ id: 990002, navn: 'TEST Ansatt', rolle: 'ansatt' });
    S.ordrer = [ordre()];
    sandbox.renderFakturering();
    expect(innhold.innerHTML).toContain('Bare admin');
  });
  it('en sendt leveranse vises på linje med bilene, uten feil', () => {
    const lev = leveranse({ ordre_status: 'sendt' });
    S.ordrer = [ordre(), lev];
    sandbox.renderFakturering();
    const html = innhold.innerHTML;
    expect(html).toContain('Alle (2)');
    expect(html).not.toContain('Kunne ikke vise faktureringen');
    expect(html).not.toContain('Feilet');
  });
});

describe('Lag kladd i Fiken', () => {
  it('avbrutt bekreftelse gjør ingenting; bekreftet kaller den vanlige fakturerViaFiken én gang', async () => {
    const o = ordre(); S.ordrer = [o];
    const kall = [];
    sandbox.fakturerViaFiken = async (id) => { kall.push(id); };
    let spurt = '';
    sandbox.confirm = (t) => { spurt = t; return false; };
    await sandbox.faktureringLagKladd(o.id);
    expect(kall).toEqual([]);
    expect(spurt).toMatch(/TEST Kunde AS/);
    expect(spurt).toMatch(/1 linje\(r\), veiledende 51\s?500 kr før rabatt/);
    sandbox.confirm = () => true;
    await sandbox.faktureringLagKladd(o.id);
    expect(kall).toEqual([o.id]);
  });
  it('en rød ordre: bare en beskjed, ingen kladd', async () => {
    const o = ordre({ kunde: '' }); S.ordrer = [o];
    const kall = []; const toast = [];
    sandbox.fakturerViaFiken = async (id) => { kall.push(id); };
    sandbox.confirm = () => true;
    sandbox.visToast = (t) => toast.push(t);
    await sandbox.faktureringLagKladd(o.id);
    expect(kall).toEqual([]);
    expect(toast[0]).toMatch(/Kunde mangler/);
  });
  it('ikke admin: ingen kladd', async () => {
    app.settMe({ id: 990002, navn: 'TEST Ansatt', rolle: 'ansatt' });
    const o = ordre(); S.ordrer = [o];
    const kall = []; sandbox.fakturerViaFiken = async (id) => { kall.push(id); }; sandbox.confirm = () => true;
    await sandbox.faktureringLagKladd(o.id);
    expect(kall).toEqual([]);
  });
});

describe('fakturaSjekk: «Skal på bilen» mot fakturaen', () => {
  it('ny ordre: står på bilen men ikke på fakturaen, og omvendt, gir gult', () => {
    sandbox.erNyProduktliste = () => true;
    const o = ordre({ ombygging: { nyttKjoretoy: true }, fiken_linjer: [{ produktnummer: '512', antall: 1 }, { produktnummer: '21', antall: 1, belop: 900 }] });
    S.ordrer = [o];
    const s = sandbox.fakturaSjekk(o);
    const tekster = s.grunner.map((g) => g.tekst);
    expect(tekster).toContain('Står på bilen, men ikke på fakturaen: 500');
    expect(tekster).toContain('På fakturaen, men ikke på «Skal på bilen»: 512');
    expect(tekster.join(' ')).not.toContain('21'); // drivstoff er ikke et portalprodukt
    expect(s.niva).toBe('gul');
  });
  it('gammel ordre: ingen slik sammenligning (uendret)', () => {
    sandbox.erNyProduktliste = () => false;
    const o = ordre({ ombygging: { nyttKjoretoy: true }, fiken_linjer: [{ produktnummer: '512', antall: 1 }] });
    expect(sandbox.fakturaSjekk(o).grunner.map((g) => g.kode)).not.toContain('faktura_ikke_paa_liste');
  });
});
