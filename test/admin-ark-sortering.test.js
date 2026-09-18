import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Regresjonstest for endring bedt om av Henrik 2026-09-18: Admin-ark skal alltid vise
// radene sortert etter Time bekreftet (dato+tid), tidligst øverst - i stedet for den
// tidligere manuelle dra-og-slipp-rekkefølgen (rekkefolge-feltet). Rader uten Time
// bekreftet ennå havner sist.

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

function lagOrdre(sandbox, id, chassis, overrides) {
  const aar = sandbox._getAdminArkAar();
  return {
    id, chassis, kunde: 'Kunde', eier: 'Eier',
    ankomstdato: `${aar}-01-15`, fakturert: false, endringer: [],
    ordreStatus: 'paabegynt', datoKlarHenting: '',
    ...overrides
  };
}

describe('Admin-ark sortering etter Time bekreftet', () => {
  it('sorterer rader med Time bekreftet kronologisk, tidligst øverst', () => {
    const sandbox = nyEnvironment();
    const aar = sandbox._getAdminArkAar();
    sandbox._setS({
      ordrer: [
        lagOrdre(sandbox, 'ord_1', 'AAA111'),
        lagOrdre(sandbox, 'ord_2', 'BBB222'),
        lagOrdre(sandbox, 'ord_3', 'CCC333'),
      ],
      adminArk: [
        { id: 'ark_1', chassisNr: 'AAA111', aar, rekkefolge: 0, timeBekreftet: `${aar}-08-20`, timeBekreftetTid: '10:00' },
        { id: 'ark_2', chassisNr: 'BBB222', aar, rekkefolge: 1, timeBekreftet: `${aar}-06-01`, timeBekreftetTid: '09:00' },
        { id: 'ark_3', chassisNr: 'CCC333', aar, rekkefolge: 2, timeBekreftet: `${aar}-06-01`, timeBekreftetTid: '14:00' },
      ],
    });
    const rader = sandbox.adminArkByggRader();
    expect(rader.map(r => r.chassisNr)).toEqual(['BBB222', 'CCC333', 'AAA111']);
  });

  it('rader uten Time bekreftet havner etter alle daterte rader', () => {
    const sandbox = nyEnvironment();
    const aar = sandbox._getAdminArkAar();
    sandbox._setS({
      ordrer: [
        lagOrdre(sandbox, 'ord_1', 'AAA111'),
        lagOrdre(sandbox, 'ord_2', 'BBB222'),
      ],
      adminArk: [
        { id: 'ark_1', chassisNr: 'AAA111', aar, rekkefolge: 0, timeBekreftet: '' },
        { id: 'ark_2', chassisNr: 'BBB222', aar, rekkefolge: 1, timeBekreftet: `${aar}-06-01`, timeBekreftetTid: '09:00' },
      ],
    });
    const rader = sandbox.adminArkByggRader();
    expect(rader.map(r => r.chassisNr)).toEqual(['BBB222', 'AAA111']);
  });

  it('rader uten Time bekreftet beholder sin innbyrdes rekkefolge-rekkefølge seg imellom', () => {
    const sandbox = nyEnvironment();
    const aar = sandbox._getAdminArkAar();
    sandbox._setS({
      ordrer: [
        lagOrdre(sandbox, 'ord_1', 'AAA111'),
        lagOrdre(sandbox, 'ord_2', 'BBB222'),
      ],
      adminArk: [
        { id: 'ark_1', chassisNr: 'AAA111', aar, rekkefolge: 5, timeBekreftet: '' },
        { id: 'ark_2', chassisNr: 'BBB222', aar, rekkefolge: 2, timeBekreftet: '' },
      ],
    });
    const rader = sandbox.adminArkByggRader();
    expect(rader.map(r => r.chassisNr)).toEqual(['BBB222', 'AAA111']);
  });
});
