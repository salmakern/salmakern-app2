import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Regresjonstest for feil rapportert 2026-08-24: "Henteklar"-datoen i Admin-ark
// forsvant fra visningen så snart en ordre gikk videre fra status "Klar for henting"
// til "Hentet" (eller en hvilken som helst annen status). Selve datoen (o.datoKlarHenting)
// ble hele tiden lagret riktig - bugen satt i visningslogikken i adminArkByggRader(),
// som bare viste den mens ordren FORTSATT sto i akkurat den statusen.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreKode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');
const adminArkKode = readFileSync(path.resolve(__dirname, '../js/admin-ark.js'), 'utf8');

function nyEnvironment() {
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: { addEventListener() {}, getElementById() { return null; } },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  vm.runInContext(adminArkKode, sandbox, { filename: 'admin-ark.js' });
  vm.runInContext(`
    function _setS(v){ S = v; }
    function _getAdminArkAar(){ return adminArkAar; }
  `, sandbox);
  return sandbox;
}

describe('Admin-ark "Henteklar"-kolonnen', () => {
  function lagOrdre(sandbox, overrides) {
    const aar = sandbox._getAdminArkAar();
    return {
      id: 'ord_1', chassis: 'WBA12345', kunde: 'Kunde', eier: 'Eier',
      ankomstdato: `${aar}-01-15`, fakturert: false, endringer: [],
      ordreStatus: 'klar_henting', datoKlarHenting: '',
      ...overrides
    };
  }

  it('viser et kryss når ordren er Klar for henting men ingen dato er lagret ennå (gammel ordre)', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({ ordrer: [lagOrdre(sandbox, {})], adminArk: [] });
    const rader = sandbox.adminArkByggRader();
    expect(rader[0].henteklarVis).toBe('✓');
  });

  it('viser datoen mens ordren står i Klar for henting', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({ ordrer: [lagOrdre(sandbox, { datoKlarHenting: '2026-08-20' })], adminArk: [] });
    const rader = sandbox.adminArkByggRader();
    expect(rader[0].henteklarVis).toBe('20.08.2026');
  });

  it('FORTSETTER å vise datoen etter at ordren har gått videre til Hentet (dette var bugen)', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({ ordrer: [lagOrdre(sandbox, { ordreStatus: 'hentet', datoKlarHenting: '2026-08-20' })], adminArk: [] });
    const rader = sandbox.adminArkByggRader();
    expect(rader[0].henteklarVis).toBe('20.08.2026');
  });

  it('viser ingenting for en ordre som aldri har vært Klar for henting', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({ ordrer: [lagOrdre(sandbox, { ordreStatus: 'paabegynt', datoKlarHenting: '' })], adminArk: [] });
    const rader = sandbox.adminArkByggRader();
    expect(rader[0].henteklarVis).toBe('');
  });
});
