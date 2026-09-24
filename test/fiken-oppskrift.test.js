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

  it('rører ikke "ombygging"-type oppskrifter selv om fikenProduktnummer er satt - ombygging fakturers via Ombygging-boksene, ikke via lagerbruk-oppskrifter', () => {
    env.S.lagerOppskrifter[0].type = 'ombygging';
    env.S.lagerhistorikk = [{ ordreId: o.id, batchId: 'batch_1', oppskriftId: 'r1' }];
    env.renderOrdreLagerbruk();
    expect(o.fikenLinjer.length).toBe(0);
  });
});

// Regresjonstest for feil rapportert av Henrik 2026-09-24: en Ekstra utstyr-oppskrift
// UTEN ingredienser (rent arbeid) forble ikke huket av - erOppskriftHuket() sjekket kun
// lagerhistorikk, som trekkOppskriftForOrdre() aldri skriver til når ingredienser er tom.
describe('erOppskriftHuket (via toggleOppskriftPaaOrdre) - oppskrift uten ingredienser', () => {
  function nyEnvironmentUtenIngrediens() {
    const fakeEl = { innerHTML: '' };
    const sandbox = {
      console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
      document: {
        addEventListener() {},
        getElementById(id) { return id.startsWith('ordreLagerbruk_') || id.startsWith('skalHaInput_') ? fakeEl : null; },
      },
      window: { addEventListener() {} },
      S: { ordrer: [], lagerOppskrifter: [], lagerhistorikk: [], lagervarer: [] },
      activeOrdreId: null,
      apneOppskriftDropdowns: new Set(),
      esc: s => s,
      fmtAntall: n => String(n),
      merkeModell: o => `${o.merke||''} ${o.modell||''}`.trim(),
      su(id, felt, val) { const ord = sandbox.S.ordrer.find(x=>x.id===id); if (ord) { ord.utstyr = ord.utstyr||{}; ord.utstyr[felt] = val; } },
      save() {},
      db: null,
    };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(path.resolve(__dirname, '../js/lager.js'), 'utf8'), sandbox, { filename: 'lager.js' });
    return sandbox;
  }

  it('blir huket av og BLIR STÅENDE huket i selve HTML-en etter en ny render, selv uten noen lagerhistorikk-rad', () => {
    const env = nyEnvironmentUtenIngrediens();
    const o = { id: 'ord_1', merke: 'KIA', modell: 'EV9', utstyr: { skalHa: '' }, fikenLinjer: [] };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
    env.S.lagerOppskrifter = [
      { id: 'r1', navn: 'Montering av tilhengerfeste', type: 'ekstra_utstyr', biltype: 'EV9', fikenProduktnummer: null, ingredienser: [] },
    ];

    env.toggleOppskriftPaaOrdre('r1', true);
    expect(env.S.lagerhistorikk.length).toBe(0); // ingen varer å trekke - bekrefter selve premisset
    expect(o.utstyr.skalHa.split('\n')).toContain('Montering av tilhengerfeste');

    // Simulerer en helt ny render av seksjonen (samme som ville skjedd om siden ble bygget
    // om, f.eks. ved navigering) - selve avkrysningsboksen i HTML-en skal fortsatt vise
    // "checked", IKKE hoppe tilbake til uhuket (dette var selve buggen - fikenLinjer/
    // skalHa var riktige internt, men boksen så uhuket ut igjen).
    env.renderOrdreLagerbruk();
    const el = env.document.getElementById('ordreLagerbruk_' + o.id);
    expect(el.innerHTML).toContain('checked');
    expect(el.innerHTML).toContain('Montering av tilhengerfeste');
  });
});

// Regresjonstest for race-condition rapportert av Henrik 2026-09-24: fjerning av en
// oppskrift MED ingredienser (ekte lagertrekk, ekte lagerhistorikk-rad) fjernet ikke
// linjen fra "Skal ha etter visning" med en gang. Root cause: angreLagerBatch() er async
// og starter med en confirm()-dialog før den fjerner raden fra S.lagerhistorikk; kalleren
// leste "faktiskHuket" FØR det var ferdig (manglende await), så den så fortsatt den gamle
// (uslettede) lagerhistorikk-raden og trodde oppskriften fortsatt var valgt.
describe('toggleOppskriftPaaOrdre - race condition ved fjerning av oppskrift MED ingredienser', () => {
  function nyEnvironmentMedIngrediens() {
    const fakeEl = { innerHTML: '' };
    const sandbox = {
      console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
      document: {
        addEventListener() {},
        getElementById(id) { return id.startsWith('ordreLagerbruk_') || id.startsWith('skalHaInput_') || id === 'fikenLinjer_ord_1' ? fakeEl : null; },
      },
      window: { addEventListener() {} },
      S: { ordrer: [], lagerOppskrifter: [], lagerhistorikk: [], lagervarer: [] },
      activeOrdreId: null,
      apneOppskriftDropdowns: new Set(),
      esc: s => s,
      fmtAntall: n => String(n),
      merkeModell: o => `${o.merke||''} ${o.modell||''}`.trim(),
      su(id, felt, val) { const ord = sandbox.S.ordrer.find(x=>x.id===id); if (ord) { ord.utstyr = ord.utstyr||{}; ord.utstyr[felt] = val; } },
      save() {},
      db: null,
      me: null,
      confirm: () => true,
      fetch: () => Promise.reject(new Error('ikke brukt i test')),
      SUPA_URL: '', SUPA_KEY: '',
    };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(path.resolve(__dirname, '../js/lager.js'), 'utf8'), sandbox, { filename: 'lager.js' });
    return sandbox;
  }

  it('venter på angreLagerBatch() før "Skal ha etter visning"-linjen fjernes', async () => {
    const env = nyEnvironmentMedIngrediens();
    const o = { id: 'ord_1', merke: 'KIA', modell: 'EV9', utstyr: { skalHa: '' }, fikenLinjer: [] };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
    env.S.lagervarer = [{ id: 'v1', navn: 'Skinnsete', antall: 10, minAntall: 0 }];
    env.S.lagerOppskrifter = [
      { id: 'r1', navn: 'Skinninteriør', type: 'ekstra_utstyr', biltype: 'EV9', fikenProduktnummer: null, ingredienser: [{ vareId: 'v1', antall: 1 }] },
    ];

    await env.toggleOppskriftPaaOrdre('r1', true);
    expect(env.S.lagerhistorikk.length).toBe(1); // ekte lagertrekk denne gangen
    expect(o.utstyr.skalHa.split('\n')).toContain('Skinninteriør');

    await env.toggleOppskriftPaaOrdre('r1', false);
    expect(env.S.lagerhistorikk.length).toBe(0);
    // Uten await på angreLagerBatch() ville denne linjen fortsatt stå igjen her, siden
    // faktiskHuket ville blitt lest før lagerhistorikk-raden faktisk ble fjernet.
    expect(o.utstyr.skalHa.split('\n')).not.toContain('Skinninteriør');
  });
});
