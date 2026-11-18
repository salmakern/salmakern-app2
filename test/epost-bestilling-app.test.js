// Trinn 5 av «Én produktliste»: appdelen av bestilling på e-post (js/epost-bestilling.js, merket i core.js, «Skal på bilen» med e-postlinjer).
// Hele appen i testriggen, falsk database, syntetiske TEST-data (TESTWXYZ-chassis, TEST-kunder). Ingen ekte e-post eller Fiken-kall.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

const app = lastApp();
const { sandbox, S } = app;
const EKTE = { erNyProduktliste: sandbox.erNyProduktliste, visToast: sandbox.visToast, confirm: sandbox.confirm, autoVelgUtstyrMal: sandbox.autoVelgUtstyrMal, buildOrdreDetail: sandbox.buildOrdreDetail };

function lagDb() {
  const rpc = []; const svar = {}; let tabell = { data: [], error: null };
  const kjede = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? (res) => Promise.resolve(tabell).then(res) : () => kjede()) });
  const db = {
    rpc: (navn, args) => { rpc.push({ navn, args }); const s = svar[navn]; return Promise.resolve(typeof s === 'function' ? s(args) : (s || { data: null, error: null })); },
    from: () => kjede(),
    settTabell: (t) => { tabell = t; },
  };
  return { db, rpc, svar };
}

const PRODUKTER = [
  { portal_id: 'v500', type: 'variant', modell_slug: 'kia-ev9', fiken_nummer: '500', nummer_status: 'ok', navn: 'Standard ombygging', app_rolle: 'ombygging', velges_nar: [] },
  { portal_id: 't510', type: 'tillegg', modell_slug: 'kia-ev9', fiken_nummer: '510', nummer_status: 'ok', navn: 'Gummimatte heldekkende gulv', app_rolle: null, velges_nar: [] },
];
const EPOSTLINJER = [{ produktnummer: '500', navn: 'Standard ombygging', antall: 1, kilde: 'epost' }, { produktnummer: '510', navn: 'Gummimatte heldekkende gulv', antall: 2, kilde: 'epost' }];

let fake;
beforeEach(() => {
  sandbox.erNyProduktliste = (o) => !!o && o.ordretype !== 'leveranse';
  sandbox.visToast = () => {};
  sandbox.autoVelgUtstyrMal = async () => {};
  sandbox.buildOrdreDetail = () => {};
  S.portalProdukter = PRODUKTER.map((p) => ({ ...p }));
  S.portalProduktRoller = S.portalProdukter.filter((p) => p.app_rolle);
  S.lagerOppskrifter = []; S.lagervarer = []; S.lagerhistorikk = [];
  fake = lagDb();
  app.settDb(fake.db);
  app.settMe({ id: 990001, navn: 'TEST Admin', rolle: 'admin' });
});
afterEach(() => { Object.assign(sandbox, EKTE); app.settMe(null); S.epostInnkommende = []; });

const ordre = (over = {}) => {
  const o = sandbox.dbToOrdre({ id: 'ord_TEST_EP1', status: 'aktiv', ordre_status: 'paa_vei', merke: 'KIA', modell: 'EV9', kunde: 'TEST Kunde AS', chassis: 'TESTWXYZ000000081',
    created_at: '2026-11-18T08:00:00Z', portal_modell_slug: 'kia-ev9', portal_linjer: EPOSTLINJER, epost_bestilling_id: 'epb_test1', ...over });
  S.ordrer = [o];
  return o;
};

describe('merke og banner', () => {
  it('ikke bekreftet: amber merke og Bekreft-banner; bekreftet: blått merke, ingen banner', () => {
    const o = ordre();
    expect(o.epostBestillingId).toBe('epb_test1');
    expect(sandbox.portalBadgeHTML(o)).toContain('E-POST · IKKE BEKREFTET');
    expect(sandbox.epostBekreftBannerHTML(o)).toContain('Bekreft bestilling');
    const b = ordre({ epost_bekreftet_at: '2026-11-18T09:00:00Z', epost_bekreftet_av: 'TEST Admin' });
    expect(sandbox.portalBadgeHTML(b)).toContain('>E-POST<');
    expect(sandbox.epostBekreftBannerHTML(b)).toBe('');
  });
  it('vanlig ordre og portalordre er uendret', () => {
    expect(sandbox.portalBadgeHTML(ordre({ epost_bestilling_id: null }))).toBe('');
    expect(sandbox.portalBadgeHTML(ordre({ epost_bestilling_id: null, portal_bestilling_id: 'p1' }))).toContain('PORTAL');
  });
  it('e-postfeltene skrives aldri av ordreToDb', () => {
    const db = sandbox.ordreToDb(ordre({ epost_bekreftet_at: '2026-11-18T09:00:00Z' }));
    expect(Object.keys(db).filter((k) => k.startsWith('epost_'))).toEqual([]);
  });
});

describe('«Skal på bilen» med e-postlinjer', () => {
  it('bestillingen gjelder, med antall og «Bestilt på e-post»', () => {
    const { rader, bestilt } = sandbox.beregnSkalPaaBilen(ordre());
    expect(bestilt).toBe(true);
    expect(rader.map((r) => [r.nr, r.antall, r.grunn, r.fraEpost])).toEqual([['500', 1, 'Bestilt på e-post', true], ['510', 2, 'Bestilt på e-post', true]]);
    const html = sandbox.skalPaaBilenHTML(ordre());
    expect(html).toContain('Fra e-post');
    expect(html).toContain('× 2');
  });
  it('ikke bekreftet: ingen fakturalinjer; bekreftet: én linje per produkt med antall og uten rabatt', async () => {
    const o = ordre();
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((r) => r.navn === 'oppdater_ordre_fiken_linje')).toEqual([]);
    fake.svar.oppdater_ordre_fiken_linje = (a) => ({ data: { fikenLinjer: [...(o.fikenLinjer || []), a.p_linje] }, error: null });
    o.epostBekreftetAt = '2026-11-18T09:00:00Z';
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((r) => r.navn === 'oppdater_ordre_fiken_linje').map((r) => r.args.p_linje)).toEqual([{ produktnummer: '500', antall: 1 }, { produktnummer: '510', antall: 2 }]);
    await sandbox.synkProduktliste(o); // ingen dobbel linje
    expect(fake.rpc.filter((r) => r.navn === 'oppdater_ordre_fiken_linje')).toHaveLength(2);
  });
  it('en ordre som fantes fra før (ingen e-post-id) får linjene med en gang', async () => {
    const o = ordre({ epost_bestilling_id: null });
    fake.svar.oppdater_ordre_fiken_linje = (a) => ({ data: { fikenLinjer: [...(o.fikenLinjer || []), a.p_linje] }, error: null });
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((r) => r.navn === 'oppdater_ordre_fiken_linje')).toHaveLength(2);
  });
  it('portal-bestilling er uendret: ingen linjer fra synk (de kommer ved Bekreft med frosset rabatt)', async () => {
    const o = ordre({ epost_bestilling_id: null, portal_bestilling_id: 'p1', portal_linjer: [{ produktnummer: '510', navn: 'Gummimatte heldekkende gulv', rabatt_prosent: 10 }] });
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((r) => r.navn === 'oppdater_ordre_fiken_linje')).toEqual([]);
    expect(sandbox.beregnSkalPaaBilen(o).rader[0].grunn).toBe('Bestilt i portalen');
  });
});

describe('Bekreft', () => {
  it('kaller epost_bekreft_ordre, setter feltene og lager fakturalinjene', async () => {
    const o = ordre();
    fake.svar.epost_bekreft_ordre = { data: { kode: 'ok', epost_bekreftet_at: '2026-11-18T09:00:00Z', epost_bekreftet_av: 'TEST Admin', endringer: [] }, error: null };
    fake.svar.oppdater_ordre_fiken_linje = (a) => ({ data: { fikenLinjer: [...(o.fikenLinjer || []), a.p_linje] }, error: null });
    await sandbox.epostBekreftOrdre(o.id);
    expect(o.epostBekreftetAv).toBe('TEST Admin');
    expect(fake.rpc.map((r) => r.navn)).toEqual(['epost_bekreft_ordre', 'oppdater_ordre_fiken_linje', 'oppdater_ordre_fiken_linje']);
  });
  it('feil fra databasen: beskjed, ingen fakturalinjer', async () => {
    const o = ordre(); const toast = [];
    sandbox.visToast = (t) => toast.push(t);
    fake.svar.epost_bekreft_ordre = { data: null, error: { message: 'IKKE_INNLOGGET' } };
    await sandbox.epostBekreftOrdre(o.id);
    expect(o.epostBekreftetAt).toBe(null);
    expect(toast[0]).toMatch(/ikke innlogget/);
    expect(fake.rpc.map((r) => r.navn)).toEqual(['epost_bekreft_ordre']);
  });
});

describe('Innkommende (Oversikt, admin)', () => {
  const rad = (over = {}) => ({ id: 'epb_test_i1', rad: 1, mottatt_at: '2026-11-18T07:00:00Z', avsender: 'selger@example.no', kontakt_id: 'k_test_a', kontakt_navn: 'TEST Kunde AS', selger_navn: 'TEST Selger',
    chassis: 'TESTWXYZ000000081', chassis_raa: null, modell_slug: 'kia-ev9', grunn_tekst: 'KIA EV9 – ombygning', tilvalg_tekst: '599 <b>Takboks</b>', linjer: [{ produktnummer: '500', navn: 'Standard ombygging', antall: 1 }], grunner: ['Tilvalg som ikke kjennes igjen'], ...over });
  const kort = () => sandbox.document.getElementById('innkommendeEpostKort');
  const liste = () => sandbox.document.getElementById('innkommendeEpostListe');
  it('viser raden med grunn, escaper tekst og tilbyr «Legg på» når én ordre har chassis.nr', () => {
    ordre({ epost_bestilling_id: null });
    S.epostInnkommende = [rad()];
    sandbox.renderInnkommendeEpost(false);
    expect(kort().style.display).toBe('block');
    expect(liste().innerHTML).toContain('Tilvalg som ikke kjennes igjen');
    expect(liste().innerHTML).toContain('&lt;b>Takboks'); expect(liste().innerHTML).not.toContain('<b>Takboks');
    expect(liste().innerHTML).toContain("innkommendeLeggPaa('epb_test_i1','ord_TEST_EP1')");
    expect(liste().innerHTML).not.toContain('Lag ny ordre');
  });
  it('ingen ordre med chassis.nr og kjent forhandler: «Lag ny ordre»; ukjent forhandler: bare Avvis', () => {
    S.ordrer = [];
    S.epostInnkommende = [rad()];
    sandbox.renderInnkommendeEpost(false);
    expect(liste().innerHTML).toContain('Lag ny ordre');
    S.epostInnkommende = [rad({ kontakt_id: null, kontakt_navn: null })];
    sandbox.renderInnkommendeEpost(false);
    expect(liste().innerHTML).not.toContain('Lag ny ordre');
    expect(liste().innerHTML).toContain('Avvis');
  });
  it('skjult for andre enn admin og når lista er tom', () => {
    S.epostInnkommende = [rad()];
    app.settMe({ id: 990002, navn: 'TEST Ansatt', rolle: 'ansatt' });
    sandbox.renderInnkommendeEpost(false);
    expect(kort().style.display).toBe('none');
    app.settMe({ id: 990001, navn: 'TEST Admin', rolle: 'admin' });
    S.epostInnkommende = [];
    sandbox.renderInnkommendeEpost(false);
    expect(kort().style.display).toBe('none');
  });
  it('knappen på Ordre-siden (flyttet fra Oversikt 18.11): tall-badge for admin, skjult for andre', () => {
    const btn = () => sandbox.document.getElementById('innkommendeEpostBtn');
    const badge = () => sandbox.document.getElementById('innkommendeEpostBadge');
    S.epostInnkommende = [rad(), rad({ id: 'epb_test_i2' })];
    sandbox.renderInnkommendeEpost(false);
    expect(btn().style.display).toBe('inline-flex');
    expect(badge().style.display).toBe('flex');
    expect(String(badge().textContent)).toBe('2');
    S.epostInnkommende = [];
    sandbox.renderInnkommendeEpost(false);
    expect(btn().style.display).toBe('inline-flex');
    expect(badge().style.display).toBe('none');
    app.settMe({ id: 990002, navn: 'TEST Ansatt', rolle: 'ansatt' });
    S.epostInnkommende = [rad()];
    sandbox.renderInnkommendeEpost(false);
    expect(btn().style.display).toBe('none');
  });
  it('apneInnkommendeEpostModal kaller openModal uten å feile (samme mønster som apneTilGodkjenningModal)', () => {
    expect(() => sandbox.apneInnkommendeEpostModal()).not.toThrow();
  });
  it('Legg på: bekreftelse, RPC og raden forsvinner; avbrutt gjør ingenting', async () => {
    ordre({ epost_bestilling_id: null });
    S.epostInnkommende = [rad()];
    sandbox.confirm = () => false;
    await sandbox.innkommendeLeggPaa('epb_test_i1', 'ord_TEST_EP1');
    expect(fake.rpc).toEqual([]);
    sandbox.confirm = () => true;
    fake.svar.epost_bestilling_legg_paa = { data: { kode: 'ok', ordre_id: 'ord_TEST_EP1' }, error: null };
    await sandbox.innkommendeLeggPaa('epb_test_i1', 'ord_TEST_EP1');
    expect(fake.rpc[0]).toEqual({ navn: 'epost_bestilling_legg_paa', args: { p_id: 'epb_test_i1', p_ordre_id: 'ord_TEST_EP1' } });
  });
  it('feiltekst fra databasen vises forståelig', () => {
    expect(sandbox.epostFeilTekst({ message: 'IKKE_LAGT_PAA: Ordren har allerede en bestilling med andre produkter' })).toBe('Ordren har allerede en bestilling med andre produkter.');
    expect(sandbox.epostFeilTekst({ message: 'CHASSIS_FINNES' })).toMatch(/Legg på ordren/);
  });
});
