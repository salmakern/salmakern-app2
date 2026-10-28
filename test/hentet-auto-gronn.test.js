import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Bedt om av Henrik 2026-10-28: når en ordre sin status settes til "Hentet", skal
// "hentetVarslet" (den grønne kantlinjen på ✔ Hentet-knappen i Admin-ark) settes
// automatisk - BEVISST uten å sende den ekte varsel-e-posten (adminArkKallFraktEpost
// kalles ALDRI herfra, kun fra adminArkVarsleHentet() sin egen knapp). Henrik fikk og
// aksepterte forbeholdet: grønn betyr ikke lenger garantert "kunden er faktisk varslet".
//
// endreStatus() bor i oversikt-kalender.js men kaller adminArkLagreFelter()/samsvarerChassis
// (egentlig admin-ark.js, lastes sist i den virkelige appen) - stubbes her akkurat som i
// ankomstdato-status.test.js, pluss en enkel kall-logg for adminArkLagreFelter siden det er
// selve atferden som testes.

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
      body: { appendChild() {} }
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
    var adminArkLagreFelterKall = [];
    async function adminArkLagreFelter(rad, endringer) { adminArkLagreFelterKall.push({ rad, endringer }); }
    function _getAdminArkLagreFelterKall(){ return adminArkLagreFelterKall; }
  `, sandbox);
  return sandbox;
}

function settDbUtfall(sandbox, suksess) {
  sandbox._setDb({
    from() {
      return { update: () => ({ eq: () => Promise.resolve(suksess ? { error: null } : { error: { message: 'nettverksfeil' } }) }) };
    },
    rpc: () => Promise.resolve({ data: { sessions: [], ansatteSignert: [] }, error: null })
  });
}

describe('Hentet-knappen i Admin-ark merkes automatisk grønn ved status→"Hentet" (bedt om av Henrik 2026-10-28)', () => {
  let sandbox, ordre;
  beforeEach(() => {
    sandbox = nyEnvironment();
    ordre = { id: 'ord_1', chassis: 'WBA12345', ordreStatus: 'klar_henting', status: 'aktiv', ankomstdato: '2026-08-20', endringer: [], godkjent: false, ansatteSignert: [] };
    sandbox._setS({ ordrer: [ordre], adminArk: [] });
    settDbUtfall(sandbox, true);
  });

  it('kaller adminArkLagreFelter({hentetVarslet:true}) når status settes til "hentet"', async () => {
    await sandbox.endreStatus('ord_1', 'hentet');
    const kall = sandbox._getAdminArkLagreFelterKall();
    expect(kall.length).toBe(1);
    expect(kall[0].endringer).toEqual({ hentetVarslet: true });
    expect(kall[0].rad.chassisNr).toBe('WBA12345');
  });

  it('matcher case-uavhengig mot en eksisterende admin-ark-rad og gjenbruker dens id', async () => {
    sandbox._getS().adminArk.push({ id: 'ark_1', chassisNr: 'wba12345', arkivert: false, hentetVarslet: false });
    await sandbox.endreStatus('ord_1', 'hentet');
    const kall = sandbox._getAdminArkLagreFelterKall();
    expect(kall.length).toBe(1);
    expect(kall[0].rad._arkId).toBe('ark_1');
  });

  it('kaller IKKE adminArkLagreFelter på nytt hvis raden allerede er merket hentetVarslet', async () => {
    sandbox._getS().adminArk.push({ id: 'ark_1', chassisNr: 'WBA12345', arkivert: false, hentetVarslet: true });
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(sandbox._getAdminArkLagreFelterKall().length).toBe(0);
  });

  it('ignorerer en arkivert admin-ark-rad med samme chassis (oppretter ny i stedet for å gjenbruke den)', async () => {
    sandbox._getS().adminArk.push({ id: 'ark_gammel', chassisNr: 'WBA12345', arkivert: true, hentetVarslet: true });
    await sandbox.endreStatus('ord_1', 'hentet');
    const kall = sandbox._getAdminArkLagreFelterKall();
    expect(kall.length).toBe(1);
    expect(kall[0].rad._arkId).toBeNull();
  });

  it('rører ikke adminArkLagreFelter ved andre statusoverganger', async () => {
    await sandbox.endreStatus('ord_1', 'klar_henting');
    expect(sandbox._getAdminArkLagreFelterKall().length).toBe(0);
  });

  it('sender ALDRI den ekte varsel-e-posten herfra (kun adminArkLagreFelter kalles, ingen adminArkKallFraktEpost/confirm)', async () => {
    let confirmKalt = false;
    sandbox.confirm = () => { confirmKalt = true; return true; };
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(confirmKalt).toBe(false);
  });
});
