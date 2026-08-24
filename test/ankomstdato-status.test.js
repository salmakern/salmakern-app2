import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// endreStatus() bor i oversikt-kalender.js men bruker globaler fra core.js (S, db,
// STATUSER, statusInfo, STORE) og et par funksjoner fra ordre-detalj.js (tvangsflyt,
// logChange) - alle lastes inn i samme vm-context, akkurat som i den virkelige appen
// der alt deler globalt scope via <script>-tagger.
//
// Regel som testes (bedt om av brukeren 2026-08-24): en ordre med status "På vei" skal
// ALDRI ha en ankomstdato (bilen er ikke fysisk ankommet ennå). Ankomstdato settes
// automatisk først når ordren går til "Ikke påbegynt" - men bare hvis den ikke allerede
// har en dato, og det manuelle datofeltet på ordren skal fortsatt kunne overstyre når
// som helst uavhengig av status (ikke testet her - det er en egen, uendret sf()-sti).

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
  // tvangsflyt/logChange/renderAll/buildOrdreDetail/save/visToast hører egentlig til
  // andre filer (ordre-detalj.js m.fl.) som ikke er lastet her - stubbes minimalt siden
  // endreStatus() bare trenger dem til å eksistere, ikke deres fulle ekte oppførsel.
  vm.runInContext(`
    function tvangsflyt(){ return []; }
    function logChange(o, txt){ o.endringer.push({txt}); }
    function renderAll(){}
    function buildOrdreDetail(){}
    function _getS(){ return S; }
    function _setS(v){ S = v; }
    function _setDb(v){ db = v; }
  `, sandbox);
  return sandbox;
}

function settDbUtfall(sandbox, suksess) {
  sandbox._setDb({
    from() {
      return { update: () => ({ eq: () => Promise.resolve(suksess ? { error: null } : { error: { message: 'nettverksfeil' } }) }) };
    }
  });
}

describe('Ankomstdato følger status (På vei ⇄ Ikke påbegynt)', () => {
  let sandbox, ordre;
  beforeEach(() => {
    sandbox = nyEnvironment();
    ordre = { id: 'ord_1', ordreStatus: 'ikke_paabegynt', status: 'aktiv', ankomstdato: '2026-08-20', endringer: [], godkjent: false };
    sandbox._setS({ ordrer: [ordre] });
    settDbUtfall(sandbox, true);
  });

  it('tømmer ankomstdato når status settes til "På vei"', async () => {
    await sandbox.endreStatus('ord_1', 'paa_vei');
    expect(sandbox._getS().ordrer[0].ankomstdato).toBe('');
  });

  it('setter ankomstdato til dagens dato når en "På vei"-ordre går til "Ikke påbegynt"', async () => {
    await sandbox.endreStatus('ord_1', 'paa_vei');
    expect(sandbox._getS().ordrer[0].ankomstdato).toBe('');

    await sandbox.endreStatus('ord_1', 'ikke_paabegynt');
    const idag = new Date().toISOString().split('T')[0];
    expect(sandbox._getS().ordrer[0].ankomstdato).toBe(idag);
  });

  it('overskriver IKKE en allerede satt ankomstdato ved overgang til "Ikke påbegynt"', async () => {
    // Ordren har allerede 2026-08-20 fra beforeEach - skal stå urørt
    await sandbox.endreStatus('ord_1', 'ikke_paabegynt');
    expect(sandbox._getS().ordrer[0].ankomstdato).toBe('2026-08-20');
  });

  it('andre statusoverganger rører ikke ankomstdato i det hele tatt', async () => {
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(sandbox._getS().ordrer[0].ankomstdato).toBe('2026-08-20');
  });

  it('ruller tilbake ankomstdato hvis lagringen mot databasen feiler', async () => {
    settDbUtfall(sandbox, false);
    await sandbox.endreStatus('ord_1', 'paa_vei');
    // Skal fortsatt være den opprinnelige datoen, ikke tømt, siden lagringen feilet
    expect(sandbox._getS().ordrer[0].ankomstdato).toBe('2026-08-20');
    expect(sandbox._getS().ordrer[0].ordreStatus).toBe('ikke_paabegynt');
  });
});

describe('mkOrdre() respekterer valgt startstatus (Ny ordre-skjemaet)', () => {
  // Regresjonstest for at "Ny ordre"-skjemaet kan velge startstatus - se
  // opprettOrdre() i ordre-diverse.js, som sender status som siste argument.
  it('bruker "ikke_paabegynt" som standard når ingen startstatus er oppgitt (bakoverkompatibelt med de to demo-kallene i core.js)', () => {
    const sandbox = nyEnvironment();
    const o = sandbox.mkOrdre('id1','AB123','Kunde','Eier','Type','Variant','2026-08-24','','','','');
    expect(o.ordreStatus).toBe('ikke_paabegynt');
  });
  it('setter ordreStatus til "paa_vei" når det oppgis som startstatus', () => {
    const sandbox = nyEnvironment();
    const o = sandbox.mkOrdre('id2','AB123','Kunde','Eier','Type','Variant','','','','','','paa_vei');
    expect(o.ordreStatus).toBe('paa_vei');
    expect(o.ankomstdato).toBe(''); // opprettOrdre() sender alltid tom dato for På vei
  });
});
