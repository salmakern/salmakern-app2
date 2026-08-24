import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// core.js har mer rundt seg enn de andre filene (event-listenere på toppnivå,
// DOMContentLoaded osv.), så denne testen bygger sin egen minimale
// document/window/localStorage-stub i stedet for å bruke test/helpers/load-script.js.
// Det som faktisk testes er den nye offline-køen: mislykkede save()-kall skal havne i
// en kø som lagres i localStorage og prøves på nytt automatisk, uten å miste eller
// duplisere noe, og uten å bli sittende fast på en ordre som ikke lenger finnes.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');

function nyEnvironment(startLagret = {}) {
  const lagerData = { ...startLagret };
  const localStorage = {
    getItem: k => (k in lagerData ? lagerData[k] : null),
    setItem: (k, v) => { lagerData[k] = String(v); },
    removeItem: k => { delete lagerData[k]; }
  };
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage,
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      // visToast() lager en toast-boks via createElement/appendChild hvis den
      // ikke finnes fra før - trenger derfor en minimal falsk DOM-node.
      createElement() { return { style: {}, classList: { add(){}, remove(){} }, appendChild(){} }; },
      body: { appendChild() {} }
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() { /* kjør aldri automatisk i testen */ }, clearTimeout() {},
    fetch: undefined
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox, { filename: 'core.js' });
  // `let`/`const` på toppnivå i en vm-kjørt fil blir IKKE synlige som egenskaper på
  // sandbox-objektet etterpå (kjent Node vm-særtrekk) - S, db og offlineKo er alle
  // deklarert med let/const i core.js. Løsningen: kjør ekte funksjonsdeklarasjoner i
  // SAMME context rett etter - de deler samme toppnivå-scope som første kjøring og kan
  // derfor lese/skrive de "usynlige" let-bindingene direkte. Funksjonsdeklarasjoner blir
  // derimot alltid synlige på sandbox-objektet, så disse hjelperne fungerer som bro.
  vm.runInContext(`
    function _getS(){ return S; }
    function _setS(v){ S = v; }
    function _getOfflineKo(){ return offlineKo; }
    function _setDb(v){ db = v; }
  `, sandbox);
  return { sandbox, lagerData };
}

function settDbUtfall(env, suksess) {
  env.sandbox._setDb({
    from() {
      return {
        upsert: () => Promise.resolve(suksess ? { error: null } : { error: { message: 'nettverksfeil' } })
      };
    }
  });
}

describe('Offline-kø for mislykkede ordre-lagringer', () => {
  let env;
  beforeEach(() => {
    env = nyEnvironment();
    // ordreToDb() er en vanlig function-deklarasjon i core.js og kan derfor
    // overstyres direkte på sandbox-objektet (samme prinsipp som _getS/_setS
    // over, bare at function-deklarasjoner allerede er synlige av seg selv).
    env.sandbox.ordreToDb = o => ({ id: o.id });
    env.sandbox._setS({
      ordrer: [
        { id: 'ord_1', regnr: 'AB12345' },
        { id: 'ord_2', regnr: 'CD67890' }
      ]
    });
  });

  it('starter med tom kø', () => {
    expect(env.sandbox._getOfflineKo().size).toBe(0);
  });

  it('en mislykket lagring havner i køen og lagres i localStorage', async () => {
    settDbUtfall(env, false);
    const feil = await env.sandbox.save('ord_1');
    expect(feil).toBe('nettverksfeil');
    expect(env.sandbox._getOfflineKo().has('ord_1')).toBe(true);
    expect(JSON.parse(env.lagerData['salmakern_offline_ko'])).toEqual(['ord_1']);
  });

  it('flere mislykkede lagringer for ulike ordrer legges til uten å miste hverandre', async () => {
    settDbUtfall(env, false);
    await env.sandbox.save('ord_1');
    await env.sandbox.save('ord_2');
    expect([...env.sandbox._getOfflineKo()].sort()).toEqual(['ord_1', 'ord_2']);
  });

  it('en vellykket lagring fjerner ordren fra køen igjen', async () => {
    settDbUtfall(env, false);
    await env.sandbox.save('ord_1');
    expect(env.sandbox._getOfflineKo().has('ord_1')).toBe(true);

    settDbUtfall(env, true);
    await env.sandbox.save('ord_1');
    expect(env.sandbox._getOfflineKo().has('ord_1')).toBe(false);
    expect(JSON.parse(env.lagerData['salmakern_offline_ko'])).toEqual([]);
  });

  it('prosesserOfflineKo() prøver alle køede ordrer på nytt når nettet er tilbake', async () => {
    settDbUtfall(env, false);
    await env.sandbox.save('ord_1');
    await env.sandbox.save('ord_2');
    expect(env.sandbox._getOfflineKo().size).toBe(2);

    settDbUtfall(env, true); // "nettet er tilbake"
    await env.sandbox.prosesserOfflineKo();
    expect(env.sandbox._getOfflineKo().size).toBe(0);
  });

  it('en ordre som er slettet lokalt mens den lå i køen renskes ut uten feil', async () => {
    settDbUtfall(env, false);
    await env.sandbox.save('ord_1');
    // Ordren slettes lokalt (f.eks. av en admin) mens vi fortsatt er offline
    const s = env.sandbox._getS();
    s.ordrer = s.ordrer.filter(o => o.id !== 'ord_1');
    env.sandbox._setS(s);

    settDbUtfall(env, true);
    await env.sandbox.prosesserOfflineKo();
    expect(env.sandbox._getOfflineKo().has('ord_1')).toBe(false);
  });

  it('gjenoppretter køen fra localStorage ved en frisk innlasting (f.eks. etter at siden ble lukket offline)', () => {
    const gjenopprettetMiljo = nyEnvironment({ salmakern_offline_ko: JSON.stringify(['ord_9']) });
    expect(gjenopprettetMiljo.sandbox._getOfflineKo().has('ord_9')).toBe(true);
  });
});
