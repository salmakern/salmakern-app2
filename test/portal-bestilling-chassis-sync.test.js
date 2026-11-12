import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// s08-058 (Henrik, "ja synk automatisk" 2026-11-12): retter en ansatt en tastefeil i
// chassis.nr på en ordre fra Forhandlerportalen, skal sf() (js/ordre-detalj.js) utløse en
// fire-and-forget-synk av portal_bestillinger.ident via RPC-en portal_oppdater_bestilling_chassis.
// Selve RPC-en (begge koblings-veiene, feilkoder) testes i
// supabase/tester/portal_oppdater_bestilling_chassis_TEST_body.sql.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../js', f), 'utf8');
const coreKode = les('core.js');
const detaljKode = les('ordre-detalj.js');

function nyttMiljo({ rpcFeil = null } = {}) {
  const logg = { rpc: [], logChange: [], save: [] };
  const sandbox = {
    console: { log() {}, error() {}, warn(...a) { logg.warn = (logg.warn || []); logg.warn.push(a); }, info() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: {
      addEventListener() {}, getElementById() { return null; }, activeElement: null,
      createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; },
      body: { appendChild() {} }, head: { appendChild() {} },
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
    alert: (m) => { logg.alert = m; },
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  vm.runInContext(detaljKode, sandbox, { filename: 'ordre-detalj.js' });
  // db/S er deklarert med `let` i core.js - usynlige som sandbox-egenskaper etterpå (se
  // CLAUDE.md, "Node vm-særtrekk å huske på"). _setDb()/_setS() deler toppnivå-scope med
  // kildefilene og kan derfor skrive de "usynlige" bindingene.
  vm.runInContext(`
    function _setDb(v) { db = v; }
    function _setS(v) { S = v; }
  `, sandbox);
  sandbox.logChange = (o, txt) => { logg.logChange.push(txt); };
  sandbox.save = (id) => { logg.save.push(id); };
  sandbox._setDb({
    rpc: (fn, args) => {
      logg.rpc.push({ fn, args });
      const p = Promise.resolve(rpcFeil ? { data: null, error: { message: rpcFeil } } : { data: { kode: 'ok', antall_oppdatert: 1 }, error: null });
      logg.rpcPromise = p;   // slik at testen kan vente presist på selve kallet, ikke bare gjette antall "tick"
      return p;
    }
  });
  sandbox._getLogg = () => logg;
  return sandbox;
}

describe('sf() synker portal-bestillingens chassis ved rettelse av tastefeil', () => {
  let env, ordre;
  beforeEach(() => {
    env = nyttMiljo();
    ordre = { id: 'ord_1', chassis: 'WBA12345678901234', portalBestillingId: 'cmw_test' };
    env._setS({ ordrer: [ordre] });
  });

  it('kaller RPC-en med nytt chassis når chassis faktisk endres til en gyldig, annen verdi', async () => {
    const ok = env.sf('ord_1', 'chassis', 'wba98765432109876');
    expect(ok).toBe(true);
    expect(ordre.chassis).toBe('WBA98765432109876');
    await Promise.resolve(); await Promise.resolve();
    const logg = env._getLogg();
    expect(logg.rpc).toHaveLength(1);
    expect(logg.rpc[0].fn).toBe('portal_oppdater_bestilling_chassis');
    expect(logg.rpc[0].args).toEqual({ p_ordre_id: 'ord_1', p_nytt_chassis: 'WBA98765432109876' });
  });

  it('kaller IKKE RPC-en når chassis settes til nøyaktig samme verdi (ingen reell endring)', () => {
    env.sf('ord_1', 'chassis', 'wba12345678901234');
    expect(env._getLogg().rpc).toHaveLength(0);
  });

  it('kaller IKKE RPC-en når chassis tømmes (klarering, ikke en rettelse)', () => {
    env.sf('ord_1', 'chassis', '');
    expect(ordre.chassis).toBe('');
    expect(env._getLogg().rpc).toHaveLength(0);
  });

  it('kaller IKKE RPC-en ved ugyldig lengde (sf avviser og returnerer false FØR synk)', () => {
    const ok = env.sf('ord_1', 'chassis', 'for-kort');
    expect(ok).toBe(false);
    expect(ordre.chassis).toBe('WBA12345678901234');   // urørt
    expect(env._getLogg().rpc).toHaveLength(0);
    expect(env._getLogg().alert).toMatch(/17 tegn/);
  });

  it('kaller IKKE RPC-en for andre felt enn chassis', () => {
    env.sf('ord_1', 'notater', 'noe tekst');
    expect(env._getLogg().rpc).toHaveLength(0);
  });

  it('en ordre uten portal-tilknytning synker også (RPC-en selv avgjør om noe skal oppdateres - klienten trenger ikke vite det)', async () => {
    ordre.portalBestillingId = null;
    env.sf('ord_1', 'chassis', 'wba98765432109876');
    await Promise.resolve(); await Promise.resolve();
    expect(env._getLogg().rpc).toHaveLength(1);
  });

  it('en feilet RPC logges som advarsel, men stopper ikke selve lagringen (sf returnerer fortsatt true)', async () => {
    env = nyttMiljo({ rpcFeil: 'ORDRE_FINNES_IKKE' });
    env._setS({ ordrer: [ordre] });
    const ok = env.sf('ord_1', 'chassis', 'wba98765432109876');
    expect(ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));   // ekte makrotask (ikke sandboxens setTimeout-stub) - garanterer at alle mikrotasks er kjørt
    expect(env._getLogg().warn?.[0]?.join(' ')).toContain('ORDRE_FINNES_IKKE');
  });
});
