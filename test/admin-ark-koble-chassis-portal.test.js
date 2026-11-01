import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Regresjonstest for adminArkKobleChassisTilPortalHvisAktuelt() (s90-20261101-1), konvertert fra
// den uavhengige gjennomgangens engangs-harness (test_etter_fiks.mjs/lib.mjs i
// C:/Users/GroAnitaMartinsen/.claude/portal-scratch/bruksanvisning/gjennomgang-chassis-senere/
// agent_klient/) til en fast vitest-fil (s08-058 punkt 2). Dekker de konkrete funnene fra
// gjennomgangen: busy-flagget er fjernet (ingen test av det her - det finnes ikke lenger),
// F05 (status "koblet" skal IKKE gi en grønn "ok"-toast) og F08 (en kjent forretningsfeil fra
// databasen, f.eks. et feiltastet chassis, skal IKKE falle tilbake til å lage en ikke-koblet
// ordre stille - den skal stoppe og si fra).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreKode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');
const adminArkKode = readFileSync(path.resolve(__dirname, '../js/admin-ark.js'), 'utf8');

function nyEnvironment() {
  const toastKall = [];
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: { addEventListener() {}, getElementById() { return null; }, createElement() { return { style: {}, appendChild(){} }; }, head: { appendChild() {} } },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout(fn) { fn(); }, clearTimeout() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  vm.runInContext(adminArkKode, sandbox, { filename: 'admin-ark.js' });
  // portalLoggFeil hører egentlig til i ordre-diverse.js (ikke lastet her) - en enkel
  // opptaker holder for denne filens formål (den tester bare adminArkKobleChassisTilPortalHvisAktuelt,
  // ikke selve loggingen). visToast overstyres til en opptaker slik testene kan sjekke
  // nøyaktig tekst og type uten en ekte DOM.
  vm.runInContext(`
    function _setDb(v){ db = v; }
    function portalLoggFeil(hva, feil){}
  `, sandbox);
  sandbox.visToast = (melding, type) => { toastKall.push([melding, type]); };
  return { sandbox, toastKall };
}

function lagRad(over = {}) {
  return { _arkId: 'ark_1', _erOrdre: false, chassisNr: '', ...over };
}

function lagDb(rpcFn) {
  return { rpc: (navn, args) => Promise.resolve().then(() => rpcFn(navn, args)) };
}

describe('adminArkKobleChassisTilPortalHvisAktuelt', () => {
  it('ingen db satt: returnerer {tilknyttet:false} uten å kaste', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: false });
    expect(toastKall).toHaveLength(0);
  });

  it('raden mangler _arkId: returnerer {tilknyttet:false} uten å kalle RPC-en', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    const rpcKall = [];
    sandbox._setDb(lagDb((navn, args) => { rpcKall.push([navn, args]); return { data: null, error: null }; }));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad({ _arkId: null }), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: false });
    expect(rpcKall).toHaveLength(0);
    expect(toastKall).toHaveLength(0);
  });

  it('RPC-en svarer tilknyttet:false (vanlig, ikke-portal-rad): returnerer false, ingen toast', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb(lagDb(() => ({ data: { tilknyttet: false }, error: null })));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: false });
    expect(toastKall).toHaveLength(0);
  });

  it('kaller RPC-en med riktig admin_ark_id og chassis', async () => {
    const { sandbox } = nyEnvironment();
    const rpcKall = [];
    sandbox._setDb(lagDb((navn, args) => { rpcKall.push([navn, args]); return { data: { tilknyttet: false }, error: null }; }));
    await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad({ _arkId: 'ark_42' }), 'WVWZZZ1KZAM222222');
    expect(rpcKall).toEqual([['portal_koble_chassis_fra_losrad', { p_admin_ark_id: 'ark_42', p_chassis: 'WVWZZZ1KZAM222222' }]]);
  });

  it('nettverksfeil (usikkert utfall): returnerer {tilknyttet:false}, ingen toast vises til bruker', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb(lagDb(() => ({ data: null, error: { message: 'TypeError: Failed to fetch' } })));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: false });
    expect(toastKall).toHaveLength(0);
  });

  it('RPC-kallet avvises (kaster): fanges, behandles som nettverksfeil, returnerer {tilknyttet:false}', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb({ rpc: () => Promise.reject(new Error('rpc kastet')) });
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: false });
    expect(toastKall).toHaveLength(0);
  });

  it('status ny_ordre: tilknyttet:true, grønn ok-toast', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb(lagDb(() => ({ data: { tilknyttet: true, resultat: { status: 'ny_ordre', ordre_id: 'ord_1' } }, error: null })));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: true });
    expect(toastKall).toHaveLength(1);
    expect(toastKall[0][1]).toBe('ok');
    expect(toastKall[0][0]).toMatch(/Husk å trykke Bekreft/);
  });

  it('status bekreftet: tilknyttet:true, grønn ok-toast', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb(lagDb(() => ({ data: { tilknyttet: true, resultat: { status: 'bekreftet' } }, error: null })));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: true });
    expect(toastKall[0][1]).toBe('ok');
  });

  it('F05: status koblet - tilknyttet:true, men IKKE en grønn ok-toast (ordren får ikke status i portalen)', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb(lagDb(() => ({ data: { tilknyttet: true, resultat: { status: 'koblet', ordre_id: 'ord_gammel' } }, error: null })));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: true });
    expect(toastKall).toHaveLength(1);
    expect(toastKall[0][1]).toBe('feil');
    expect(toastKall[0][0]).toMatch(/IKKE endret/);
  });

  it('ukjent/manglende status: tilknyttet:true, fallback-tekst, ikke ok-type', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb(lagDb(() => ({ data: { tilknyttet: true, resultat: { status: 'noe_ukjent' } }, error: null })));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: true });
    expect(toastKall[0]).toEqual(['Portal-bestillingen ble behandlet.', 'feil']);
  });

  it('F08: forretningsfeil UGYLDIG_INPUT: chassis - tilknyttet:true (stopper, ingen ikke-koblet ordre lages), rød toast med forklaring', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb(lagDb(() => ({ data: null, error: { message: 'UGYLDIG_INPUT: chassis', code: 'P0001' } })));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM12345');
    expect(svar).toEqual({ tilknyttet: true });
    expect(toastKall).toHaveLength(1);
    expect(toastKall[0][1]).toBe('feil');
    expect(toastKall[0][0]).toMatch(/17 tegn/);
  });

  it('forretningsfeil KUN_ADMIN: tilknyttet:true, egen tekst om å logge inn på nytt', async () => {
    const { sandbox, toastKall } = nyEnvironment();
    sandbox._setDb(lagDb(() => ({ data: null, error: { message: 'KUN_ADMIN', code: 'P0001' } })));
    const svar = await sandbox.adminArkKobleChassisTilPortalHvisAktuelt(lagRad(), 'WVWZZZ1KZAM111111');
    expect(svar).toEqual({ tilknyttet: true });
    expect(toastKall[0][1]).toBe('feil');
    expect(toastKall[0][0]).toMatch(/administrator/);
  });
});
