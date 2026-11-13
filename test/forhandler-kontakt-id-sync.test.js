import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// s08-004 (Henrik, "lag noe som skiller de fra hverandre" 2026-11-13): org.nr alene skiller
// ikke forhandler-AVDELINGER som deler org.nr (f.eks. Bertel O. Steen Innlandet AS dekker
// Gjøvik/Hamar/Lillehammer under samme org.nr). sf() (js/ordre-detalj.js) utløser derfor en
// fire-and-forget-synk av ordrer.forhandler_kontakt_id hver gang 'forhandlerOrgnr' endres -
// ALDRI en gjetning, se synkroniserForhandlerKontaktId(). Selve databasebackfillen for
// eksisterende ordre testes ikke her (ren SQL, verifisert mot produksjon i rullet-tilbake
// transaksjon før kjøring - se migrasjon 20261113090000).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../js', f), 'utf8');
const coreKode = les('core.js');
const detaljKode = les('ordre-detalj.js');

function nyttMiljo() {
  const logg = { update: [] };
  const sandbox = {
    console: { log() {}, error() {}, warn(...a) { (logg.warn = logg.warn || []).push(a); }, info() {} },
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
  vm.runInContext(`
    function _setDb(v) { db = v; }
    function _setS(v) { S = v; }
  `, sandbox);
  sandbox.logChange = (o, txt) => {};
  sandbox.save = (id) => {};
  sandbox._setDb({
    from(tabell) {
      return { update: (payload) => { logg.update.push({ tabell, payload }); return { eq: () => Promise.resolve({ error: null }) }; } };
    }
  });
  sandbox._getLogg = () => logg;
  return sandbox;
}

const KONTAKTER = [
  { id: 'k_akauto', navn: 'AK Auto AS', type: 'Forhandler', orgnr: '831862122' },
  { id: 'k25', navn: 'Bertel O. Steen Innlandet AS Gjøvik', type: 'Forhandler', orgnr: '919426233' },
  { id: 'k27', navn: 'Bertel O. Steen Innlandet AS Hamar', type: 'Forhandler', orgnr: '919426233' },
  { id: 'k29', navn: 'Bertel O. Steen Innlandet AS Lillehammer', type: 'Forhandler', orgnr: '919426233' },
  { id: 'k_frakt', navn: 'Et fraktselskap', type: 'Fraktselskap', orgnr: '919426233' },   // samme org.nr, men IKKE type Forhandler - skal ignoreres
];

async function flush() { await new Promise((r) => setTimeout(r, 0)); }

describe('sf() synker forhandler_kontakt_id når org.nr settes/endres (s08-004)', () => {
  let env, ordre;
  beforeEach(() => {
    env = nyttMiljo();
    ordre = { id: 'ord_1', kunde: 'AK Auto AS', forhandlerOrgnr: '' };
    env._setS({ ordrer: [ordre], kontakter: KONTAKTER });
  });

  it('org.nr som matcher nøyaktig ÉN forhandler-kontakt: setter kontakt-id direkte', async () => {
    env.sf('ord_1', 'forhandlerOrgnr', '831862122');
    await flush();
    const logg = env._getLogg();
    expect(logg.update).toHaveLength(1);
    expect(logg.update[0].tabell).toBe('ordrer');
    expect(logg.update[0].payload).toEqual({ forhandler_kontakt_id: 'k_akauto' });
  });

  it('org.nr som deles av flere avdelinger, kunde-teksten matcher EKSAKT én av dem: velger den riktige', async () => {
    ordre.kunde = 'Bertel O. Steen Innlandet AS Lillehammer';
    env.sf('ord_1', 'forhandlerOrgnr', '919426233');
    await flush();
    expect(env._getLogg().update[0].payload).toEqual({ forhandler_kontakt_id: 'k29' });
  });

  it('samme deling, men kunde-teksten er generisk/ikke et eksakt treff mot NOEN avdeling: gjør INGENTING (aldri en gjetning)', async () => {
    ordre.kunde = 'Bertel O. Steen Innlandet AS';   // uten stedsnavn - matcher ingen av de tre eksakt
    env.sf('ord_1', 'forhandlerOrgnr', '919426233');
    await flush();
    expect(env._getLogg().update).toHaveLength(0);
  });

  it('kunde-tekst med avvikende store/små bokstaver og mellomrom gir fortsatt treff', async () => {
    ordre.kunde = '  bertel o. steen innlandet as hamar  ';
    env.sf('ord_1', 'forhandlerOrgnr', '919426233');
    await flush();
    expect(env._getLogg().update[0].payload).toEqual({ forhandler_kontakt_id: 'k27' });
  });

  it('org.nr med mellomrom (formatert) matcher likevel en kontakt sitt rene org.nr', async () => {
    env.sf('ord_1', 'forhandlerOrgnr', '831 862 122');
    await flush();
    expect(env._getLogg().update[0].payload).toEqual({ forhandler_kontakt_id: 'k_akauto' });
  });

  it('ukjent org.nr (ingen kontakt i det hele tatt): gjør ingenting', async () => {
    env.sf('ord_1', 'forhandlerOrgnr', '000000000');
    await flush();
    expect(env._getLogg().update).toHaveLength(0);
  });

  it('samme org.nr som før (ingen reell endring): synker ikke på nytt', async () => {
    ordre.forhandlerOrgnr = '831862122';
    env.sf('ord_1', 'forhandlerOrgnr', '831862122');
    await flush();
    expect(env._getLogg().update).toHaveLength(0);
  });

  it('org.nr tømmes: gjør ingenting', async () => {
    ordre.forhandlerOrgnr = '831862122';
    env.sf('ord_1', 'forhandlerOrgnr', '');
    await flush();
    expect(env._getLogg().update).toHaveLength(0);
  });

  it('ignorerer kontakter av type Fraktselskap selv om org.nr tilfeldigvis er likt', async () => {
    ordre.kunde = 'Et fraktselskap';
    env.sf('ord_1', 'forhandlerOrgnr', '919426233');
    await flush();
    // Skal fortsatt bare se de TRE forhandler-kandidatene, ikke fraktselskapet - ingen eksakt treff mot "Et fraktselskap" blant dem.
    expect(env._getLogg().update).toHaveLength(0);
  });

  it('andre felt enn forhandlerOrgnr utløser ikke synken', async () => {
    env.sf('ord_1', 'kunde', 'Noe annet navn');
    await flush();
    expect(env._getLogg().update).toHaveLength(0);
  });
});
