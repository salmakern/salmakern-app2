import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Regresjonstest, samme root cause som fiken-ombygging.test.js: en oppskrift sin
// Fiken-linje ble kun lagt til/fjernet i selve avkrysningsøyeblikket
// (toggleOppskriftPaaOrdre), aldri gjenskapt for en ordre som allerede hadde
// oppskriften valgt (via lagerhistorikk) uavhengig av det. Fikset ved å kjøre
// samme synk i renderOrdreLagerbruk() ved hvert render.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kode = readFileSync(path.resolve(__dirname, '../js/lager.js'), 'utf8');

function nyEnvironment() {
  const fakeEl = { innerHTML: '' };
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    document: {
      addEventListener() {},
      getElementById(id) { return id.startsWith('ordreLagerbruk_') ? fakeEl : null; },
    },
    window: { addEventListener() {} },
    S: { ordrer: [], lagerOppskrifter: [], lagerhistorikk: [], lagervarer: [] },
    activeOrdreId: null,
    apneOppskriftDropdowns: new Set(),
    esc: s => s,
    fmtAntall: n => String(n),
    merkeModell: o => `${o.merke||''} ${o.modell||''}`.trim(),
    su() {},
    save() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox, { filename: 'lager.js' });
  return sandbox;
}

describe('renderOrdreLagerbruk selv-synkroniserer oppskrift-baserte Fiken-linjer', () => {
  let env, o;
  beforeEach(() => {
    env = nyEnvironment();
    o = { id: 'ord_1', merke: 'KIA', modell: 'EV9', fikenLinjer: [] };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
    env.S.lagerOppskrifter = [
      { id: 'r1', navn: 'Panorama glasstak', type: 'ekstra_utstyr', biltype: 'EV9', fikenProduktnummer: '501', ingredienser: [] },
    ];
    // Oppskriften er "valgt" på ordren via en ekte lagerhistorikk-batch, HELT uavhengig
    // av at fikenLinjer aldri ble oppdatert - nøyaktig bug-scenarioet.
    env.S.lagerhistorikk = [{ ordreId: o.id, batchId: 'batch_1', oppskriftId: 'r1' }];
  });

  it('legger til den manglende Fiken-linjen når oppskriften faktisk er valgt', () => {
    expect(o.fikenLinjer.length).toBe(0);
    env.renderOrdreLagerbruk();
    expect(o.fikenLinjer.some(l => l.produktnummer === '501')).toBe(true);
  });

  it('er en no-op når linjen allerede står riktig', () => {
    env.renderOrdreLagerbruk();
    const etterFørste = JSON.stringify(o.fikenLinjer);
    env.renderOrdreLagerbruk();
    expect(JSON.stringify(o.fikenLinjer)).toBe(etterFørste);
  });

  it('fjerner linjen igjen hvis oppskriften ikke lenger er valgt', () => {
    env.renderOrdreLagerbruk();
    expect(o.fikenLinjer.some(l => l.produktnummer === '501')).toBe(true);
    env.S.lagerhistorikk = [];
    env.renderOrdreLagerbruk();
    expect(o.fikenLinjer.some(l => l.produktnummer === '501')).toBe(false);
  });

  it('rører ikke oppskrifter uten fikenProduktnummer satt', () => {
    env.S.lagerOppskrifter[0].fikenProduktnummer = null;
    expect(() => env.renderOrdreLagerbruk()).not.toThrow();
    expect(o.fikenLinjer.length).toBe(0);
  });

  it('rører ikke oppskrifter som ikke matcher ordrens modell', () => {
    env.S.lagerOppskrifter[0].biltype = 'Geländewagen';
    env.renderOrdreLagerbruk();
    expect(o.fikenLinjer.length).toBe(0);
  });
});
