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
    planleggLocalSpeiling() {},
    db: null,
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

  it('blir huket av og BLIR STÅENDE huket i selve HTML-en etter en ny render, selv uten noen lagerhistorikk-rad', async () => {
    const env = nyEnvironmentUtenIngrediens();
    const o = { id: 'ord_1', merke: 'KIA', modell: 'EV9', utstyr: { skalHa: '' }, fikenLinjer: [] };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
    env.S.lagerOppskrifter = [
      { id: 'r1', navn: 'Montering av tilhengerfeste', type: 'ekstra_utstyr', biltype: 'EV9', fikenProduktnummer: null, ingredienser: [] },
    ];

    // toggleOppskriftPaaOrdre/trekkOppskriftForOrdre er async (ekte databaserundtur siden
    // 2026-11-05, selv for en tom oppskrift som bare gjør en rask tidlig-retur) - må ventes på.
    await env.toggleOppskriftPaaOrdre('r1', true);
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
  // Falsk lager_trekk_oppskrift/lager_angre_oppskrift_trekk (2026-11-05): simulerer KUN
  // serverens validering/idempotens-svar ut fra den lokale S-tilstanden (oppskrift/ordre
  // finnes, allerede trukket), akkurat som den ekte RPC-en ville svart - selve
  // beholdningsendringen gjøres fortsatt av klientens EGEN registrerLagerEndring()-kall
  // etterpå (samme ansvarsdeling som i produksjon: tjeneren eier skrivingen, klienten
  // speiler den lokalt for visning), så denne mocken må IKKE selv endre S.lagervarer.
  function fakeLagerDb(S) {
    return {
      rpc: async (navn, args) => {
        if (navn === 'lager_trekk_oppskrift') {
          if ((S.lagerhistorikk||[]).some(h => h.ordreId === args.p_ordre_id && h.oppskriftId === args.p_oppskrift_id)) {
            return { data: null, error: { message: 'ALLEREDE_TRUKKET' } };
          }
          const oppskrift = (S.lagerOppskrifter||[]).find(r => r.id === args.p_oppskrift_id);
          if (!oppskrift) return { data: null, error: { message: 'OPPSKRIFT_FINNES_IKKE' } };
          if (!(S.ordrer||[]).some(o => o.id === args.p_ordre_id)) return { data: null, error: { message: 'ORDRE_FINNES_IKKE' } };
          const ingredienser = oppskrift.ingredienser || [];
          if (!ingredienser.length) return { data: { batchId: null, ikkeFunnet: 0, antallTrukket: 0 }, error: null };
          const ikkeFunnet = ingredienser.filter(i => !(S.lagervarer||[]).some(v => v.id === i.vareId)).length;
          return { data: { batchId: 'batch_test_' + Date.now(), ikkeFunnet, antallTrukket: ingredienser.length - ikkeFunnet }, error: null };
        }
        if (navn === 'lager_angre_oppskrift_trekk') {
          const finnes = (S.lagerhistorikk||[]).some(h => h.ordreId === args.p_ordre_id && h.oppskriftId === args.p_oppskrift_id);
          if (!finnes) return { data: null, error: { message: 'IKKE_TRUKKET' } };
          return { data: { batchId: null, antallRader: 0 }, error: null };
        }
        return { data: null, error: null };
      },
    };
  }

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
      visToast() {},
      me: null,
      confirm: () => true,
      fetch: () => Promise.reject(new Error('ikke brukt i test')),
      SUPA_URL: '', SUPA_KEY: '',
    };
    sandbox.db = fakeLagerDb(sandbox.S);
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

// Nye regresjonstester for selve atomisk/idempotent-fiksen (5.11, s90-20261104-7): dekker
// klientens håndtering av svarene fra lager_trekk_oppskrift/lager_angre_oppskrift_trekk -
// selve databaselogikken (radlås, transaksjon) er dekket av
// supabase/tester/lager_trekk_atomisk_TEST_body.sql mot ekte Postgres.
describe('trekkOppskriftForOrdre/angreLagerBatch - håndtering av serverens svar (atomisk/idempotent-fiksen 5.11)', () => {
  function fakeLagerDb(S, { rpcOverride } = {}) {
    return {
      rpc: async (navn, args) => {
        if (rpcOverride) {
          const r = rpcOverride(navn, args);
          if (r) return r;
        }
        if (navn === 'lager_trekk_oppskrift') {
          if ((S.lagerhistorikk||[]).some(h => h.ordreId === args.p_ordre_id && h.oppskriftId === args.p_oppskrift_id)) {
            return { data: null, error: { message: 'ALLEREDE_TRUKKET' } };
          }
          const oppskrift = (S.lagerOppskrifter||[]).find(r => r.id === args.p_oppskrift_id);
          const ingredienser = oppskrift?.ingredienser || [];
          const ikkeFunnet = ingredienser.filter(i => !(S.lagervarer||[]).some(v => v.id === i.vareId)).length;
          return { data: { batchId: 'batch_test_' + Date.now(), ikkeFunnet, antallTrukket: ingredienser.length - ikkeFunnet }, error: null };
        }
        if (navn === 'lager_angre_oppskrift_trekk') {
          const finnes = (S.lagerhistorikk||[]).some(h => h.ordreId === args.p_ordre_id && h.oppskriftId === args.p_oppskrift_id);
          if (!finnes) return { data: null, error: { message: 'IKKE_TRUKKET' } };
          return { data: { batchId: null, antallRader: 0 }, error: null };
        }
        return { data: null, error: null };
      },
    };
  }

  function nyttMiljo({ rpcOverride } = {}) {
    const fakeEl = { innerHTML: '' };
    const toasts = [];
    const sandbox = {
      console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
      document: { addEventListener() {}, getElementById(id) { return id.startsWith('ordreLagerbruk_') || id.startsWith('skalHaInput_') ? fakeEl : null; } },
      window: { addEventListener() {} },
      S: { ordrer: [], lagerOppskrifter: [], lagerhistorikk: [], lagervarer: [] },
      activeOrdreId: null,
      apneOppskriftDropdowns: new Set(),
      esc: s => s, fmtAntall: n => String(n), merkeModell: o => `${o.merke||''} ${o.modell||''}`.trim(),
      su() {}, save() {},
      toasts,
      visToast(m) { toasts.push(m); },
      me: { navn: 'TEST Ansatt' },
      confirm: () => true,
    };
    sandbox.db = fakeLagerDb(sandbox.S, { rpcOverride });
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(path.resolve(__dirname, '../js/lager.js'), 'utf8'), sandbox, { filename: 'lager.js' });
    return sandbox;
  }

  it('ALLEREDE_TRUKKET fra serveren: ingen feilmelding, lageret trekkes IKKE to ganger', async () => {
    const env = nyttMiljo();
    const o = { id: 'ord_1', utstyr: { skalHa: '' }, fikenLinjer: [] };
    env.S.ordrer = [o]; env.activeOrdreId = o.id;
    env.S.lagervarer = [{ id: 'v1', navn: 'Skinnsete', antall: 10, minAntall: 0 }];
    env.S.lagerOppskrifter = [{ id: 'r1', navn: 'Skinninteriør', type: 'ekstra_utstyr', biltype: '', ingredienser: [{ vareId: 'v1', antall: 2 }] }];
    // Simulerer at en ANNEN fane alt har trukket denne (lagerhistorikk-raden finnes, men ikke i DENNE faneøktens S fra starten av - her setter vi den rett inn for å trigge ALLEREDE_TRUKKET).
    env.S.lagerhistorikk = [{ id: 'lh_annen_fane', vareId: 'v1', ordreId: o.id, oppskriftId: 'r1', batchId: 'batch_annen_fane', endring: -2 }];

    await env.trekkOppskriftForOrdre('r1');
    expect(env.toasts.length).toBe(0); // ingen skummel feilmelding for et helt normalt kappløp
    expect(env.S.lagervarer[0].antall).toBe(10); // IKKE trukket på nytt av denne fanen
    expect(env.S.lagerhistorikk.length).toBe(1); // fortsatt bare den ene (ekte) raden
  });

  it('IKKE_TRUKKET fra serveren ved angre: ingen feilmelding, ingen krasj', async () => {
    const env = nyttMiljo();
    const o = { id: 'ord_1', utstyr: { skalHa: '' }, fikenLinjer: [] };
    env.S.ordrer = [o]; env.activeOrdreId = o.id;
    // batchId finnes lokalt (gammel/stale kopi), men serveren sier den alt er angret av en annen fane.
    env.S.lagerhistorikk = [{ id: 'lh_x', vareId: 'v1', ordreId: o.id, oppskriftId: 'r1', batchId: 'batch_x', endring: -2 }];

    await expect(env.angreLagerBatch('batch_x')).resolves.not.toThrow();
    expect(env.toasts.length).toBe(0);
  });

  it('en reell serverfeil (annet enn ALLEREDE_TRUKKET) vises som toast til ansatt', async () => {
    const env = nyttMiljo({ rpcOverride: (navn) => navn === 'lager_trekk_oppskrift' ? { data: null, error: { message: 'Nettverksfeil' } } : null });
    const o = { id: 'ord_1', utstyr: { skalHa: '' }, fikenLinjer: [] };
    env.S.ordrer = [o]; env.activeOrdreId = o.id;
    env.S.lagerOppskrifter = [{ id: 'r1', navn: 'Skinninteriør', type: 'ekstra_utstyr', biltype: '', ingredienser: [{ vareId: 'v1', antall: 1 }] }];

    await env.trekkOppskriftForOrdre('r1');
    expect(env.toasts.some(t => t.includes('Nettverksfeil'))).toBe(true);
    expect(env.S.lagerhistorikk.length).toBe(0);
  });

  it('ingrediens som ikke lenger finnes i lageret: varsles med toast, resten trekkes fortsatt', async () => {
    const env = nyttMiljo();
    const o = { id: 'ord_1', utstyr: { skalHa: '' }, fikenLinjer: [] };
    env.S.ordrer = [o]; env.activeOrdreId = o.id;
    env.S.lagervarer = [{ id: 'v1', navn: 'Skinnsete', antall: 10, minAntall: 0 }];
    env.S.lagerOppskrifter = [{ id: 'r1', navn: 'Skinninteriør', type: 'ekstra_utstyr', biltype: '', ingredienser: [
      { vareId: 'v1', antall: 1 }, { vareId: 'finnes-ikke', antall: 1 },
    ] }];

    await env.trekkOppskriftForOrdre('r1');
    expect(env.S.lagervarer[0].antall).toBe(9); // den ene som finnes ER trukket
    expect(env.toasts.some(t => t.includes('1 vare(r)') && t.includes('finnes ikke lenger'))).toBe(true);
  });

  it('ingen databasetilkobling: viser en forklarende toast i stedet for å krasje', async () => {
    const env = nyttMiljo();
    env.db = null;
    const o = { id: 'ord_1', utstyr: { skalHa: '' }, fikenLinjer: [] };
    env.S.ordrer = [o]; env.activeOrdreId = o.id;
    env.S.lagerOppskrifter = [{ id: 'r1', navn: 'Skinninteriør', type: 'ekstra_utstyr', biltype: '', ingredienser: [{ vareId: 'v1', antall: 1 }] }];

    await expect(env.trekkOppskriftForOrdre('r1')).resolves.not.toThrow();
    expect(env.toasts.length).toBe(1);
  });
});
