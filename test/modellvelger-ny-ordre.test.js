import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { lastApp } from './helpers/app-harness.js';

// Modellvelger i «+ Ny ordre» (Henger igjen s90-20261120-modellvelger, 2026-11-25): den ansatte velger modellen fra katalogen
// (portal_modell_kobling), Merke/Modell fylles med katalogens tekst, og ordren får modellnøkkelen (portal_modell_slug) i insert-en.
// Fritekst er reserven. Viktigst: nøkkelen skal ALDRI gi andre Fiken-numre eller en annen «Skal på bilen»-liste enn den samme teksten
// skrevet for hånd (bevist under for hver katalograd, med portalens roller og produkter slik de var i databasen 25.11).

const app = lastApp();
const { sandbox, S } = app;
const ekteSave = sandbox.save;

// portal_modell_kobling slik den var i den ekte databasen 2026-11-25 (14 rader, bare lesing).
const KOBLING = [
  ['dodge-durango', 'Dodge', 'Durango'], ['kgm-rexton', 'KGM', 'Rexton'], ['kia-ev9', 'KIA', 'EV9'],
  ['land-rover-defender-110', 'Land Rover', 'Defender 110'], ['land-rover-discovery-5', 'Land Rover', 'Discovery 5'],
  ['mercedes-eqv', 'Mercedes-Benz', 'EQV'], ['mercedes-g', 'Mercedes-Benz', 'Geländewagen'], ['mercedes-gls', 'Mercedes-Benz', 'GLS'],
  ['mercedes-vito', 'Mercedes-Benz', 'Vito'], ['mercedes-vklasse', 'Mercedes-Benz', 'V-Klasse'], ['toyota-lc-150', 'Toyota', 'Land Cruiser 150'],
  ['toyota-lc-250', 'Toyota', 'Land Cruiser 250'], ['vw-id-buzz-kort', 'Volkswagen', 'ID BUZZ'], ['vw-id-buzz-lang', 'Volkswagen', 'ID BUZZ'],
].map(([portal_modell_slug, merke, modell]) => ({ portal_modell_slug, merke, modell }));
// portal_produkter (bare modell_slug, fiken_nummer, app_rolle) slik den var 2026-11-25.
const PRODUKTER = JSON.parse(readFileSync(new URL('./fixtures/portal-produkter-slug-2026-11-25.json', import.meta.url), 'utf8'));

function lagDb({ feil = false } = {}) {
  const kall = [];
  const kjede = (info) => new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') return (res) => Promise.resolve({ data: null, error: feil ? { message: 'TEST-feil' } : null }).then(res);
      return (...args) => { info.kall.push([String(k), args]); return kjede(info); };
    },
  });
  return {
    kall,
    db: {
      from: (tabell) => { const info = { tabell, kall: [] }; kall.push(info); return kjede(info); },
      rpc: (navn, args) => { kall.push({ rpc: navn, args }); return Promise.resolve({ data: null, error: null }); },
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    },
  };
}
const metodeKall = (kall, metode) => kall.filter((k) => k.tabell === 'ordrer' && k.kall.some(([m]) => m === metode));
const el = (id) => sandbox.document.getElementById(id);
const fyll = (verdier) => { for (const [id, v] of Object.entries(verdier)) el(id).value = v; };
const TOMT_SKJEMA = { n_regnr: '', n_chassis: '', n_kunde: 'TEST Kunde AS', n_eier: '', n_merke: '', n_type: '', n_modell: '', n_variant: '', n_farge: '', n_versjon: '', n_dato: '', n_status: 'ikke_paabegynt', n_modellvalg: '' };

beforeEach(() => {
  S.ordrer = []; S.ansatte = []; S.lagerOppskrifter = []; S.utstyrMaler = []; S.adminArk = [];
  S.portalModellKobling = KOBLING.map((r) => ({ ...r }));
  S.portalProdukter = PRODUKTER.map((r) => ({ ...r }));
  S.portalProduktRoller = S.portalProdukter.filter((r) => r.app_rolle);
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  app.settDb(null);
  sandbox.edgeFetch = async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });
  sandbox.openOrdre = () => {}; sandbox.renderAll = () => {}; sandbox.closeModal = () => {};
  sandbox.save = ekteSave;
  fyll(TOMT_SKJEMA);
  el('n_kunEkstrautstyr').checked = false;
});
afterAll(() => { app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' }); });

describe('nedtrekket', () => {
  it('har én rad per katalogmodell, sortert, og skiller ID BUZZ kort/lang', () => {
    const valg = sandbox.nyOrdreModellValg();
    expect(valg.length).toBe(14);
    expect(valg.map((v) => v.etikett)).toContain('Volkswagen ID BUZZ (kort)');
    expect(valg.map((v) => v.etikett)).toContain('Volkswagen ID BUZZ (lang)');
    expect(valg.map((v) => v.etikett)).toContain('KIA EV9'); // ingen hale når teksten er unik
    const etiketter = valg.map((v) => v.etikett);
    expect(etiketter).toEqual([...etiketter].sort((a, b) => a.localeCompare(b, 'no')));
    sandbox.renderNyOrdreModellValg();
    const html = el('n_modellvalg').innerHTML;
    expect(html.startsWith('<option value="">')).toBe(true);
    expect((html.match(/<option /g) || []).length).toBe(15);
    expect(html).toContain('value="vw-id-buzz-lang"');
  });
  it('tåler at katalogen mangler eller har ufullstendige rader (aldri et kast, bare færre valg)', () => {
    S.portalModellKobling = undefined;
    expect(sandbox.nyOrdreModellValg()).toEqual([]);
    S.portalModellKobling = [null, { portal_modell_slug: 'x' }, { portal_modell_slug: '', merke: 'A', modell: 'B' }, { portal_modell_slug: 'ok', merke: ' A ', modell: 'B' }];
    expect(sandbox.nyOrdreModellValg()).toEqual([{ slug: 'ok', merke: 'A', modell: 'B', etikett: 'A B' }]);
  });
  it('escaper katalogtekst i nedtrekket', () => {
    S.portalModellKobling = [{ portal_modell_slug: 'x"y', merke: '<b>', modell: 'M&M' }];
    sandbox.renderNyOrdreModellValg();
    expect(el('n_modellvalg').innerHTML).toContain('value="x&quot;y"');
    expect(el('n_modellvalg').innerHTML).toContain('&lt;b');
    expect(el('n_modellvalg').innerHTML).toContain('M&amp;M');
    expect(el('n_modellvalg').innerHTML).not.toContain('<b>');
  });
  it('å velge en modell fyller Merke og Modell med katalogens tekst; «skriv selv» rører ikke feltene', () => {
    sandbox.velgNyOrdreModell('mercedes-g');
    expect(el('n_merke').value).toBe('Mercedes-Benz');
    expect(el('n_modell').value).toBe('Geländewagen');
    fyll({ n_merke: 'Noe', n_modell: 'Annet' });
    sandbox.velgNyOrdreModell('');
    expect(el('n_merke').value).toBe('Noe');
    expect(el('n_modell').value).toBe('Annet');
  });
  it('skrives Merke/Modell om etter valget, nullstilles valget', () => {
    fyll({ n_modellvalg: 'kia-ev9' }); sandbox.velgNyOrdreModell('kia-ev9');
    sandbox.nyOrdreModellTekstEndret();
    expect(el('n_modellvalg').value).toBe('kia-ev9'); // uendret tekst: valget står
    fyll({ n_modell: ' ev9 ' });
    sandbox.nyOrdreModellTekstEndret();
    expect(el('n_modellvalg').value).toBe('kia-ev9'); // bare store/små bokstaver og mellomrom: fortsatt samme
    fyll({ n_modell: 'EV9 GT-Line' });
    sandbox.nyOrdreModellTekstEndret();
    expect(el('n_modellvalg').value).toBe('');
  });
});

describe('«+ Ny ordre» lagrer modellnøkkelen', () => {
  it('valgt modell: insert-en har portal_modell_slug, og den lokale ordren har nøkkelen', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    fyll({ n_chassis: 'TESTWXYZ0000000M1', n_modellvalg: 'kia-ev9' }); sandbox.velgNyOrdreModell('kia-ev9');
    sandbox.opprettOrdre();
    const ins = metodeKall(kall, 'insert').map((k) => k.kall.find(([m]) => m === 'insert')[1][0]);
    expect(ins.length).toBe(1);
    expect(ins[0].portal_modell_slug).toBe('kia-ev9');
    expect(ins[0]).toMatchObject({ merke: 'KIA', modell: 'EV9' });
    const o = S.ordrer.find((x) => x.chassis === 'TESTWXYZ0000000M1');
    expect(o.portalModellSlug).toBe('kia-ev9');
    expect(el('n_modellvalg').value).toBe(''); // nullstilt for neste ordre
  });
  it('fritekst (ingen modell valgt): ingen portal_modell_slug i insert-en, som før', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    fyll({ n_chassis: 'TESTWXYZ0000000M2', n_merke: 'KIA', n_modell: 'EV9' });
    sandbox.opprettOrdre();
    const ins = metodeKall(kall, 'insert').map((k) => k.kall.find(([m]) => m === 'insert')[1][0]);
    expect('portal_modell_slug' in ins[0]).toBe(false);
    expect(S.ordrer[0].portalModellSlug).toBe(null);
  });
  it('valgt modell, men Merke/Modell endret etterpå (uten at valget ble nullstilt): ingen nøkkel lagres', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    fyll({ n_chassis: 'TESTWXYZ0000000M3', n_modellvalg: 'kia-ev9', n_merke: 'KIA', n_modell: 'Sorento' });
    sandbox.opprettOrdre();
    const ins = metodeKall(kall, 'insert').map((k) => k.kall.find(([m]) => m === 'insert')[1][0]);
    expect('portal_modell_slug' in ins[0]).toBe(false);
  });
  it('en nøkkel som ikke finnes i katalogen (gammel side, katalogen endret) lagres aldri (fremmednøkkelen ville avvist hele ordren)', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    fyll({ n_chassis: 'TESTWXYZ0000000M4', n_modellvalg: 'finnes-ikke', n_merke: 'KIA', n_modell: 'EV9' });
    sandbox.opprettOrdre();
    const ins = metodeKall(kall, 'insert').map((k) => k.kall.find(([m]) => m === 'insert')[1][0]);
    expect('portal_modell_slug' in ins[0]).toBe(false);
  });
  it('save() og ordreToDb skriver aldri portal_modell_slug (bare insert-en ved opprettelse)', async () => {
    const o = sandbox.dbToOrdre({ id: 'ord_1795000000000', status: 'aktiv', ordre_status: 'paabegynt', merke: 'KIA', modell: 'EV9', portal_modell_slug: 'kia-ev9' });
    expect('portal_modell_slug' in sandbox.ordreToDb(o)).toBe(false);
    const { db, kall } = lagDb(); app.settDb(db); S.ordrer = [o];
    await ekteSave(o.id);
    const up = metodeKall(kall, 'upsert').map((k) => k.kall.find(([m]) => m === 'upsert')[1][0]);
    expect(up.length).toBe(1);
    expect('portal_modell_slug' in up[0]).toBe(false);
  });
});

describe('ingen endring i fakturering: nøkkel + katalogtekst gir det samme som katalogteksten skrevet for hånd', () => {
  const tall = (m) => m && { ombygging: m.ombygging, personbil: m.personbil, lafinto: m.lafinto };
  for (const k of KOBLING) {
    it(`${k.portal_modell_slug}: samme Fiken-numre, samme kanoniske tekst og samme «Skal på bilen»-produkter`, () => {
      const medNokkel = { merke: k.merke, modell: k.modell, portalModellSlug: k.portal_modell_slug, fikenLinjer: [] };
      const utenNokkel = { merke: k.merke, modell: k.modell, portalModellSlug: null, fikenLinjer: [] };
      expect(sandbox.kanoniskMerkeModell(medNokkel)).toEqual(sandbox.kanoniskMerkeModell(utenNokkel));
      const a = sandbox.finnFikenOmbyggingModell(k.merke, k.modell, k.portal_modell_slug);
      const b = sandbox.finnFikenOmbyggingModell(k.merke, k.modell, null);
      expect(tall(a)).toEqual(tall(b));
      expect(a).not.toBe(null); // hver katalogmodell har en ombyggingslinje
      for (const rolle of ['ombygging', 'personbil', 'lafinto']) {
        expect(sandbox.ombyggingNummerFor(medNokkel, a, rolle)).toEqual(sandbox.ombyggingNummerFor(utenNokkel, b, rolle));
      }
      const pa = sandbox.produktlisteModell(medNokkel), pb = sandbox.produktlisteModell(utenNokkel);
      expect(pa.slug).toBe(pb.slug);
      expect(pa.produkter.map((p) => p.fiken_nummer)).toEqual(pb.produkter.map((p) => p.fiken_nummer));
    });
  }
  it('kontroll: testen ville sett en forskjell (en portalrolle bare på ID BUZZ lang gir et annet nummer med nøkkel)', () => {
    S.portalProduktRoller = [...S.portalProduktRoller, { modell_slug: 'vw-id-buzz-lang', app_rolle: 'ombygging', fiken_nummer: '1899' }];
    expect(sandbox.finnFikenOmbyggingModell('Volkswagen', 'ID BUZZ', 'vw-id-buzz-lang').ombygging).toBe('1899');
    expect(sandbox.finnFikenOmbyggingModell('Volkswagen', 'ID BUZZ', null).ombygging).toBe('1800');
  });
});

describe('en nøkkel valgt i appen følger Merke/Modell i ordredetaljen', () => {
  const ordre = (over = {}) => sandbox.dbToOrdre({ id: 'ord_1795000000001', status: 'aktiv', ordre_status: 'paabegynt', merke: 'KIA', modell: 'EV9', portal_modell_slug: 'kia-ev9', ...over });
  beforeEach(() => { sandbox.save = () => {}; });
  it('endres Modell til noe annet enn katalogens tekst, fjernes nøkkelen (målrettet update, bare hvis databasen har samme nøkkel)', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    const o = ordre(); S.ordrer = [o];
    sandbox.sf(o.id, 'modell', 'Sorento');
    expect(o.portalModellSlug).toBe(null);
    const upd = metodeKall(kall, 'update');
    expect(upd.length).toBe(1);
    expect(upd[0].kall).toEqual([['update', [{ portal_modell_slug: null }]], ['eq', ['id', o.id]], ['eq', ['portal_modell_slug', 'kia-ev9']]]);
  });
  it('bare store/små bokstaver eller mellomrom endret: nøkkelen står, ingen skriving', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    const o = ordre(); S.ordrer = [o];
    sandbox.sf(o.id, 'modell', ' ev9 ');
    expect(o.portalModellSlug).toBe('kia-ev9');
    expect(metodeKall(kall, 'update').length).toBe(0);
  });
  it('portal- og e-postordrer røres aldri (bestillingen er fasit)', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    const p = ordre({ portal_bestilling_id: 'pb_1' }), e = ordre({ id: 'ord_1795000000002', epost_bestilling_id: 'epb_1' });
    S.ordrer = [p, e];
    sandbox.sf(p.id, 'modell', 'Sorento'); sandbox.sf(e.id, 'merke', 'Kia Motors');
    expect(p.portalModellSlug).toBe('kia-ev9');
    expect(e.portalModellSlug).toBe('kia-ev9');
    expect(metodeKall(kall, 'update').length).toBe(0);
  });
  it('katalogen ikke lastet: nøkkelen står (ingenting å sammenligne med)', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    S.portalModellKobling = [];
    const o = ordre(); S.ordrer = [o];
    sandbox.sf(o.id, 'modell', 'Sorento');
    expect(o.portalModellSlug).toBe('kia-ev9');
    expect(metodeKall(kall, 'update').length).toBe(0);
  });
  it('feiler skrivingen, settes nøkkelen tilbake lokalt', async () => {
    const { db } = lagDb({ feil: true }); app.settDb(db);
    let toast = ''; const ekteToast = sandbox.visToast; sandbox.visToast = (t) => { toast = t; };
    try {
      const o = ordre(); S.ordrer = [o];
      sandbox.sf(o.id, 'modell', 'Sorento');
      expect(o.portalModellSlug).toBe(null);
      await new Promise((r) => setImmediate(r));
      expect(o.portalModellSlug).toBe('kia-ev9');
      expect(toast).toContain('modellnøkkelen');
    } finally { sandbox.visToast = ekteToast; }
  });
  it('etter at nøkkelen er fjernet, følger fakturering den rettede teksten (ikke katalogen)', () => {
    const { db } = lagDb(); app.settDb(db);
    const o = ordre(); S.ordrer = [o];
    sandbox.sf(o.id, 'modell', 'Rexton'); sandbox.sf(o.id, 'merke', 'KGM');
    expect(sandbox.kanoniskMerkeModell(o)).toEqual({ merke: 'KGM', modell: 'Rexton' });
    expect(sandbox.finnFikenOmbyggingModell('KGM', 'Rexton', o.portalModellSlug).ombygging).toBe('2400');
  });
});

describe('sw.js', () => {
  it('CACHE er hevet til minst v110', () => {
    const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    const v = Number((sw.match(/const CACHE = 'salmakern-v(\d+)'/) || [])[1]);
    expect(v).toBeGreaterThanOrEqual(110);
  });
});
