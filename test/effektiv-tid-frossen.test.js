import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// s09-020 (Henrik, "ja legg det til" 2026-11-04): effektiv ordretid (Bil-effektivitet-tallet)
// skal fryses når bilen settes til "Hentet", slik at tallet ikke fortsetter å endre seg i
// ettertid (f.eks. ved en senere rettet timeføring), og kan vises som en kostnad
// (timesats x tid) uten en ny DB-spørring hver gang ordren åpnes. Se CLAUDE.md,
// "renderBilEffektivitetBadge()" (ordre-diverse.js) og endreStatus() (oversikt-kalender.js).
//
// Dekker KUN orkestreringen i endreStatus() (fryse/nullstille/rulle tilbake) - selve
// beregningen (effektivOrdreTidPerAnsattMs) er stubbet, se bil-effektivitet.test.js for de
// rene beregningsfunksjonene, og hentet-auto-gronn.test.js for samme test-mønster.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreKode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');
const oversiktKode = readFileSync(path.resolve(__dirname, '../js/oversikt-kalender.js'), 'utf8');

function nyEnvironment() {
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      activeElement: null,
      createElement() { return { style: {}, classList: { add(){}, remove(){} }, appendChild(){} }; },
      body: { appendChild() {} },
      head: { appendChild() {} }
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  vm.runInContext(oversiktKode, sandbox, { filename: 'oversikt-kalender.js' });
  vm.runInContext(`
    function tvangsflyt(){ return []; }
    function logChange(o, txt){ o.endringer.push({txt}); }
    function renderAll(){}
    function buildOrdreDetail(){}
    function _getS(){ return S; }
    function _setS(v){ S = v; }
    function _setDb(v){ db = v; }
    function samsvarerChassis(a, b) { return String(a||'').trim().toLowerCase() === String(b||'').trim().toLowerCase(); }
    function ordreAktivFase(){ return null; }
    function feltTilKolonne(felt) { return felt==='ordreTimerSessions' ? 'ordre_timer_sessions' : 'klargjoring_timer_sessions'; }
    var ORDRE_TIMER_LABEL = { ordreTimerSessions:'Ombygging', klargjoringTimerSessions:'Klargjøring' };
    async function adminArkLagreFelter() {}
    var _effektivTidSvar = { totalMs: 0, perAnsatt: [] };
    var _effektivTidKall = 0;
    async function effektivOrdreTidPerAnsattMs(o) { _effektivTidKall++; return _effektivTidSvar; }
    function _setEffektivTidSvar(v) { _effektivTidSvar = v; }
    function _getEffektivTidKall() { return _effektivTidKall; }
  `, sandbox);
  return sandbox;
}

// Fanger opp hva som faktisk ble sendt til .update(), ikke bare om kallet lykkes/feiler.
function settDbMedFangst(sandbox, suksess) {
  const kall = [];
  sandbox._setDb({
    from(tabell) {
      return {
        update: (payload) => {
          kall.push({ tabell, payload });
          return { eq: () => Promise.resolve(suksess ? { error: null } : { error: { message: 'nettverksfeil' } }) };
        }
      };
    },
    rpc: () => Promise.resolve({ data: { sessions: [], ansatteSignert: [] }, error: null })
  });
  return kall;
}

describe('endreStatus() fryser effektiv tid når ordren settes til "Hentet" (s09-020)', () => {
  let sandbox, ordre;
  beforeEach(() => {
    sandbox = nyEnvironment();
    ordre = { id: 'ord_1', chassis: 'WBA12345', ordreStatus: 'klar_henting', status: 'aktiv', ankomstdato: '2026-08-20', endringer: [], godkjent: false, ansatteSignert: [] };
    sandbox._setS({ ordrer: [ordre], adminArk: [] });
  });

  it('fryser totalMs/perAnsatt fra effektivOrdreTidPerAnsattMs() med et tidsstempel når status blir "hentet"', async () => {
    const kall = settDbMedFangst(sandbox, true);
    sandbox._setEffektivTidSvar({ totalMs: 3600000, perAnsatt: [{ ansattId: 1, navn: 'Per', ms: 3600000 }] });
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(ordre.effektivTidFrossen).toMatchObject({ totalMs: 3600000, perAnsatt: [{ ansattId: 1, navn: 'Per', ms: 3600000 }] });
    expect(typeof ordre.effektivTidFrossen.frossetVed).toBe('string');
    expect(new Date(ordre.effektivTidFrossen.frossetVed).getTime()).not.toBeNaN();
    // Sendes med i SAMME skriving som resten av statusendringen, ikke et eget kall.
    expect(kall.length).toBe(1);
    expect(kall[0].tabell).toBe('ordrer');
    expect(kall[0].payload.effektiv_tid_frossen).toEqual(ordre.effektivTidFrossen);
  });

  it('kaller IKKE effektivOrdreTidPerAnsattMs() for andre statusoverganger, og rører ikke et evt. frossent tall fra før', async () => {
    ordre.ordreStatus = 'ikke_paabegynt'; ordre.ansatteSignert = ['x']; ordre.bilderAnkomst = [1];
    settDbMedFangst(sandbox, true);
    ordre.effektivTidFrossen = { totalMs: 999, perAnsatt: [], frossetVed: '2026-01-01T00:00:00.000Z' };
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(sandbox._getEffektivTidKall()).toBe(0);
    expect(ordre.effektivTidFrossen).toEqual({ totalMs: 999, perAnsatt: [], frossetVed: '2026-01-01T00:00:00.000Z' });
  });

  it('nullstiller frossen tid igjen hvis ordren flyttes BORT fra "Hentet" til en annen status', async () => {
    ordre.ordreStatus = 'hentet';
    ordre.effektivTidFrossen = { totalMs: 12345, perAnsatt: [], frossetVed: '2026-01-01T00:00:00.000Z' };
    const kall = settDbMedFangst(sandbox, true);
    await sandbox.endreStatus('ord_1', 'klar_henting');
    expect(ordre.effektivTidFrossen).toBeNull();
    expect(kall[0].payload.effektiv_tid_frossen).toBeNull();
  });

  it('settes til "hentet" på nytt (etter en korrigering): fryses på nytt med FERSK verdi, gammel frossen verdi erstattes', async () => {
    ordre.effektivTidFrossen = { totalMs: 1, perAnsatt: [], frossetVed: '2026-01-01T00:00:00.000Z' };
    settDbMedFangst(sandbox, true);
    sandbox._setEffektivTidSvar({ totalMs: 7200000, perAnsatt: [] });
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(ordre.effektivTidFrossen.totalMs).toBe(7200000);
  });

  it('ruller tilbake den frosne verdien (sammen med status) hvis selve databaseskrivingen feiler', async () => {
    ordre.effektivTidFrossen = { totalMs: 111, perAnsatt: [], frossetVed: '2026-01-01T00:00:00.000Z' };
    settDbMedFangst(sandbox, false);
    sandbox._setEffektivTidSvar({ totalMs: 999999, perAnsatt: [] });
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(ordre.ordreStatus).toBe('klar_henting');       // uendret, rullet tilbake
    expect(ordre.effektivTidFrossen).toEqual({ totalMs: 111, perAnsatt: [], frossetVed: '2026-01-01T00:00:00.000Z' });
  });

  it('en feil i selve beregningen (kastet unntak) stopper ikke statusendringen - frysingen hoppes bare over', async () => {
    settDbMedFangst(sandbox, true);
    vm.runInContext(`async function effektivOrdreTidPerAnsattMs(){ throw new Error('db nede'); }`, sandbox);
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(ordre.ordreStatus).toBe('hentet');
    expect(ordre.effektivTidFrossen).toBeUndefined();
  });
});
