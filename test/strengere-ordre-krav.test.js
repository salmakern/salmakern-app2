import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Henrik (2026-11-20): kravene for å begynne å jobbe på en bil (minst én ansatt meldt på, ankomstbilder)
// gjaldt tidligere KUN ved overgangen "Ikke påbegynt" → "Påbegynt" - en bil kunne derfor hoppe forbi hele
// sjekken ved å gå rett fra "På vei" til "Påbegynt" eller lenger, eller rett forbi "Påbegynt" til en senere
// status. To ting er rettet samtidig (valgt av Henrik blant 4 forslag):
//  1) De to kravene gjelder nå ved ETHVERT hopp til "Påbegynt" eller lenger, uansett hvilken status
//     overgangen kommer FRA.
//  2) Kravet er skjerpet: ALLE 6 ankomstbilder må være tatt (ikke bare ett). Samme dag ble også
//     «Diagnose utført» lagt til som et tredje krav her - men det er FJERNET IGJEN 2026-11-25
//     (Henrik: «diagnose skal ikke være der», etter at en ansatt ble stoppet av det i praksis).
//     Diagnose kan fortsatt krysses av på ordren og er fortsatt ett av tvangsflyt-kravene for å
//     lukke ordren - det er bare denne ene statussjekken det ikke lenger inngår i.
// Admin kan overstyre de gjenværende kravene, men bare med et bevisst, synlig valg (en confirm()-dialog
// som sier nøyaktig hva som mangler) - aldri en stille bakvei. Se endreStatus() i js/oversikt-kalender.js.
//
// Se også test/ankomstdato-status.test.js (ansatt-/bilde-kravet isolert, fra "Ikke påbegynt")
// og test/kun-ekstrautstyr-visning.test.js (samspillet med «kun ekstrautstyr»-ordre sin egen statusliste).

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
  // tvangsflyt/logChange/renderAll/buildOrdreDetail hører til andre filer - stubbes minimalt, se
  // ankomstdato-status.test.js for samme mønster og begrunnelse.
  vm.runInContext(`
    function tvangsflyt(){ return []; }
    function logChange(o, txt){ o.endringer.push({txt}); }
    function renderAll(){}
    function buildOrdreDetail(){}
    function _getS(){ return S; }
    function _setS(v){ S = v; }
    function _setDb(v){ db = v; }
    function _setMe(v){ me = v; }
    function samsvarerChassis(a, b) { return String(a||'').trim().toLowerCase() === String(b||'').trim().toLowerCase(); }
    function ordreAktivFase(o) { if (o.ordreStatus === 'paabegynt') return 'ordreTimerSessions'; return null; }
    function feltTilKolonne(felt) { return felt==='ordreTimerSessions' ? 'ordre_timer_sessions' : 'klargjoring_timer_sessions'; }
    var ORDRE_TIMER_LABEL = { ordreTimerSessions:'Ombygging', klargjoringTimerSessions:'Klargjøring' };
  `, sandbox);
  return sandbox;
}

function settDbUtfall(sandbox, suksess = true) {
  sandbox._setDb({
    from() { return { update: () => ({ eq: () => Promise.resolve(suksess ? { error: null } : { error: { message: 'nettverksfeil' } }) }) }; },
    rpc: () => Promise.resolve({ data: { sessions: [], ansatteSignert: [], ikkeStemplet: [] }, error: null })
  });
}

// Fullt oppfylt ordre - ingen krav mangler. Testene fjerner/endrer det de vil teste manglende.
function fullOrdre(over = {}) {
  return {
    id: 'ord_1', ordreStatus: 'ikke_paabegynt', status: 'aktiv', ankomstdato: '2026-08-20', endringer: [],
    godkjent: false, ansatteSignert: [{ id: 1, navn: 'Test Testesen', tid: '09:00' }],
    bilderAnkomst: Array(6).fill('data:image/png;base64,x'), diagnose: true,
    ...over
  };
}

describe('Kravene gjelder ved ETHVERT hopp til "Påbegynt" eller lenger, uansett hvilken status det kommer FRA (hull tettet 2026-11-20)', () => {
  let sandbox, ordre;
  beforeEach(() => {
    sandbox = nyEnvironment();
    settDbUtfall(sandbox, true);
  });
  function kjor(fraStatus, tilStatus, mangler = {}) {
    ordre = fullOrdre({ ordreStatus: fraStatus, ...mangler });
    sandbox._setS({ ordrer: [ordre] });
    return sandbox.endreStatus('ord_1', tilStatus);
  }

  it('På vei → Påbegynt (tidligere HELT uten kontroll) blokkeres nå når ansatt mangler', async () => {
    await kjor('paa_vei', 'paabegynt', { ansatteSignert: [] });
    expect(ordre.ordreStatus).toBe('paa_vei');
    expect(ordre.endringer.length).toBe(0);
  });

  it('På vei → Påbegynt går gjennom når alt er oppfylt', async () => {
    await kjor('paa_vei', 'paabegynt');
    expect(ordre.ordreStatus).toBe('paabegynt');
  });

  it('Ikke påbegynt → Ikke veid (hopper FORBI Påbegynt, tidligere HELT uten kontroll) blokkeres når bilder mangler', async () => {
    await kjor('ikke_paabegynt', 'ikke_veid', { bilderAnkomst: [null,null,null,null,null,null] });
    expect(ordre.ordreStatus).toBe('ikke_paabegynt');
  });

  it('Ikke påbegynt → Ikke veid går gjennom når alt er oppfylt', async () => {
    await kjor('ikke_paabegynt', 'ikke_veid');
    expect(ordre.ordreStatus).toBe('ikke_veid');
  });

  it('På vei → Hentet (lengste hoppet) blokkeres når bilder mangler', async () => {
    await kjor('paa_vei', 'hentet', { bilderAnkomst: ['a', 'b', 'c', 'd', 'e', null] });
    expect(ordre.ordreStatus).toBe('paa_vei');
  });

  it('allerede forbi Påbegynt (Klar for henting → Hentet) krever IKKE ansatt/bilder på nytt', async () => {
    await kjor('klar_henting', 'hentet', { ansatteSignert: [], bilderAnkomst: [null,null,null,null,null,null] });
    expect(ordre.ordreStatus).toBe('hentet');
  });

  it('allerede forbi Påbegynt (Vist på biltilsynet → Klar for henting, bakover i rekkefølgen men fortsatt i sonen) krever heller ikke kravene på nytt', async () => {
    await kjor('vist_biltilsyn', 'klar_henting', { ansatteSignert: [], bilderAnkomst: [null,null,null,null,null,null] });
    expect(ordre.ordreStatus).toBe('klar_henting');
  });

  it('tilbake til Ikke påbegynt og frem igjen: kravene gjelder på nytt andre gang', async () => {
    ordre = fullOrdre({ ordreStatus: 'hentet' });
    sandbox._setS({ ordrer: [ordre] });
    await sandbox.endreStatus('ord_1', 'ikke_paabegynt');
    expect(ordre.ordreStatus).toBe('ikke_paabegynt');
    ordre.ansatteSignert = []; // mister påmeldingen mens den står i Ikke påbegynt
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(ordre.ordreStatus).toBe('ikke_paabegynt'); // blokkert på nytt
  });
});

describe('Alle 6 ankomstbilder kreves (skjerpet 2026-11-20); diagnose kreves IKKE (fjernet igjen 2026-11-25)', () => {
  let sandbox, ordre;
  beforeEach(() => { sandbox = nyEnvironment(); settDbUtfall(sandbox, true); });
  function kjor(over = {}) {
    ordre = fullOrdre(over);
    sandbox._setS({ ordrer: [ordre] });
    return sandbox.endreStatus('ord_1', 'paabegynt');
  }

  it('0 av 6 bilder: blokkert', async () => { await kjor({ bilderAnkomst: [null,null,null,null,null,null] }); expect(ordre.ordreStatus).toBe('ikke_paabegynt'); });
  it('1 av 6 bilder (den gamle "minst ett"-terskelen): fortsatt blokkert', async () => { await kjor({ bilderAnkomst: ['a',null,null,null,null,null] }); expect(ordre.ordreStatus).toBe('ikke_paabegynt'); });
  it('5 av 6 bilder: fortsatt blokkert', async () => { await kjor({ bilderAnkomst: ['a','b','c','d','e',null] }); expect(ordre.ordreStatus).toBe('ikke_paabegynt'); });
  it('6 av 6 bilder: går gjennom', async () => { await kjor({ bilderAnkomst: ['a','b','c','d','e','f'] }); expect(ordre.ordreStatus).toBe('paabegynt'); });
  it('diagnose ikke utført: går gjennom likevel (kravet er fjernet 2026-11-25)', async () => { await kjor({ diagnose: false }); expect(ordre.ordreStatus).toBe('paabegynt'); });
  it('diagnose utført: går gjennom', async () => { await kjor({ diagnose: true }); expect(ordre.ordreStatus).toBe('paabegynt'); });

  it('toasten lister manglende krav samtidig, ikke bare det første - og nevner aldri diagnose', async () => {
    const toasts = []; sandbox.visToast = (m) => toasts.push(m);
    await kjor({ ansatteSignert: [], bilderAnkomst: [null,null,null,null,null,null], diagnose: false });
    expect(ordre.ordreStatus).toBe('ikke_paabegynt');
    const t = toasts.join('|');
    expect(t).toContain('minst én ansatt er meldt på ordren');
    expect(t).toContain('alle 6 bilder fra ankomst er tatt');
    expect(t).not.toContain('iagnose');
  });
});

describe('«Kun ekstrautstyr»: bare ansatt-kravet gjelder (ordren har ikke noe bilder-kort, og diagnose kreves uansett ikke lenger)', () => {
  let sandbox, ordre;
  beforeEach(() => { sandbox = nyEnvironment(); settDbUtfall(sandbox, true); });

  it('blokkeres av manglende ansatt, akkurat som en vanlig bil', async () => {
    ordre = fullOrdre({ kunEkstrautstyr: true, ansatteSignert: [], bilderAnkomst: [null,null,null,null,null,null] });
    sandbox._setS({ ordrer: [ordre] });
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(ordre.ordreStatus).toBe('ikke_paabegynt');
  });

  it('går gjennom med ansatt meldt på, selv uten bilder (kortet finnes ikke)', async () => {
    ordre = fullOrdre({ kunEkstrautstyr: true, bilderAnkomst: [null,null,null,null,null,null] });
    sandbox._setS({ ordrer: [ordre] });
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(ordre.ordreStatus).toBe('paabegynt');
  });

  it('toasten for en «kun ekstrautstyr»-ordre nevner aldri bilder eller diagnose', async () => {
    const toasts = []; sandbox.visToast = (m) => toasts.push(m);
    ordre = fullOrdre({ kunEkstrautstyr: true, ansatteSignert: [], bilderAnkomst: [null,null,null,null,null,null] });
    sandbox._setS({ ordrer: [ordre] });
    await sandbox.endreStatus('ord_1', 'paabegynt');
    const t = toasts.join('|');
    expect(t).toContain('minst én ansatt er meldt på ordren');
    expect(t).not.toContain('bilde');
    expect(t).not.toContain('diagnose');
  });
});

describe('Admin kan overstyre begge kravene, men bare med et bevisst, synlig valg', () => {
  let sandbox, ordre;
  beforeEach(() => { sandbox = nyEnvironment(); settDbUtfall(sandbox, true); });
  function settOppMangelfull() {
    ordre = fullOrdre({ ansatteSignert: [], bilderAnkomst: [null,null,null,null,null,null] });
    sandbox._setS({ ordrer: [ordre] });
    sandbox._setMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  }

  it('spør med confirm() (ikke bare lar det gli gjennom) og fortsetter når admin svarer ja', async () => {
    settOppMangelfull();
    let sporsmal = null;
    sandbox.confirm = (t) => { sporsmal = t; return true; };
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(sporsmal).not.toBeNull();
    expect(sporsmal).toContain('minst én ansatt er meldt på ordren');
    expect(sporsmal).toContain('alle 6 bilder fra ankomst er tatt');
    expect(ordre.ordreStatus).toBe('paabegynt');
  });

  it('avbryter hele overgangen når admin svarer nei på overstyringen', async () => {
    settOppMangelfull();
    sandbox.confirm = () => false;
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(ordre.ordreStatus).toBe('ikke_paabegynt');
  });

  it('logglinjen nevner overstyringen når admin sa ja, men ikke ellers', async () => {
    settOppMangelfull();
    sandbox.confirm = () => true;
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(JSON.stringify(ordre.endringer)).toContain('krav overstyrt av');
  });

  it('spør ALDRI confirm() når alt uansett er i orden (ingen unødvendig dialog)', async () => {
    ordre = fullOrdre();
    sandbox._setS({ ordrer: [ordre] });
    sandbox._setMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
    let kalt = false;
    sandbox.confirm = () => { kalt = true; return true; };
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(kalt).toBe(false);
    expect(ordre.ordreStatus).toBe('paabegynt');
    expect(JSON.stringify(ordre.endringer)).not.toContain('krav overstyrt av');
  });

  it('en VANLIG ansatt (ikke admin) får ALDRI en overstyringsdialog - bare blokkert med forklarende melding', async () => {
    ordre = fullOrdre({ ansatteSignert: [] });
    sandbox._setS({ ordrer: [ordre] });
    sandbox._setMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' });
    let kalt = false;
    sandbox.confirm = () => { kalt = true; return true; };
    const toasts = []; sandbox.visToast = (m) => toasts.push(m);
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(kalt).toBe(false);
    expect(ordre.ordreStatus).toBe('ikke_paabegynt');
    expect(toasts.join('|')).toContain('minst én ansatt er meldt på ordren');
  });

  it('en godkjenner (ikke admin) er heller ikke unntatt - samme blokkering som en vanlig ansatt', async () => {
    ordre = fullOrdre({ ansatteSignert: [] });
    sandbox._setS({ ordrer: [ordre] });
    sandbox._setMe({ id: 3, navn: 'TEST - Godkjenner', rolle: 'godkjenner' });
    await sandbox.endreStatus('ord_1', 'paabegynt');
    expect(ordre.ordreStatus).toBe('ikke_paabegynt');
  });
});
