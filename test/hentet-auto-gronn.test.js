import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Henger igjen 2026-11-17 (Henrik): «når en ordre endrer status til hentet så skal det
// automatisk sendes ut en mail at bilen er hentet ... den knappen som sender ut denne i admin
// skal bli fjernet ... den skal bare si at den er hentet og hvem den er hentet av».
// Erstatter 2026-10-28-regelen (raden ble merket grønn UTEN e-post).
//
// Laster core.js, oversikt-kalender.js og admin-ark.js i samme vm-context og bytter ut
// edgeFetch med en falsk som bare logger kallet: INGEN ekte e-post sendes herfra.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../js/' + f), 'utf8');

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
  vm.runInContext(les('core.js'), sandbox, { filename: 'core.js' });
  vm.runInContext(les('oversikt-kalender.js'), sandbox, { filename: 'oversikt-kalender.js' });
  vm.runInContext(les('admin-ark.js'), sandbox, { filename: 'admin-ark.js' });
  vm.runInContext(`
    function tvangsflyt(){ return []; }
    function logChange(o, txt){ o.endringer.push({txt}); }
    function renderAll(){}
    function buildOrdreDetail(){}
    function _getS(){ return S; }
    function _setS(v){ S = v; }
    function _setDb(v){ db = v; }
    function _setMe(v){ me = v; }
    function ordreAktivFase(){ return null; }
    async function effektivOrdreTidPerAnsattMs(){ return { totalMs: 0, perAnsatt: {} }; }
    function feltTilKolonne(felt) { return felt==='ordreTimerSessions' ? 'ordre_timer_sessions' : 'klargjoring_timer_sessions'; }
    var ORDRE_TIMER_LABEL = { ordreTimerSessions:'Ombygging', klargjoringTimerSessions:'Klargjøring' };
    var lagreKall = [], epostKall = [], toaster = [], epostSvar = { ok: true, tekst: 'ok' };
    async function adminArkLagreFelter(rad, endringer) { lagreKall.push({ rad, endringer }); }
    async function edgeFetch(fn, init) {
      epostKall.push({ fn, body: JSON.parse(init.body) });
      return { ok: epostSvar.ok, text: async () => epostSvar.tekst };
    }
    function visToast(m, t){ toaster.push({ m, t }); }
    function _logg(){ return { lagreKall, epostKall, toaster }; }
    function _settEpostSvar(ok, tekst){ epostSvar = { ok, tekst }; }
  `, sandbox);
  return sandbox;
}

function settDb(sandbox) {
  sandbox._setDb({
    from() { return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) }; },
    rpc: () => Promise.resolve({ data: { sessions: [], ansatteSignert: [] }, error: null })
  });
}

const KONTAKTER = [
  { id: 'k1', navn: 'TEST Bilhuset AS', type: 'Forhandler', kontaktpersoner: [{ id: 'kp1', navn: 'TEST Ola', epost: 'ola@example.test' }] },
  { id: 'f1', navn: 'BOS', type: 'Fraktselskap', epost: 'frakt@example.test' }
];

describe('Hentet-varsel sendes automatisk når status settes til «Hentet» (Henger igjen 2026-11-17)', () => {
  let sandbox, ordre;
  beforeEach(() => {
    sandbox = nyEnvironment();
    ordre = { id: 'ord_1', chassis: 'WBA12345', kunde: 'TEST Bilhuset AS', eier: 'TEST Ola', ordreStatus: 'klar_henting', status: 'aktiv',
      ankomstdato: '2026-08-20', endringer: [], godkjent: false, ansatteSignert: [] };
    sandbox._setS({ ordrer: [ordre], adminArk: [{ id: 'ark_1', chassisNr: 'wba12345', fraktselskap: 'BOS', arkivert: false, hentetVarslet: false }], kontakter: KONTAKTER });
    sandbox._setMe({ id: 1, navn: 'TEST Admin', rolle: 'admin' });
    settDb(sandbox);
  });

  it('sender én hentet-e-post til kontaktpersonen med chassis.nr og hvem som hentet (fraktselskapets visningsnavn)', async () => {
    await sandbox.endreStatus('ord_1', 'hentet');
    const { epostKall, lagreKall } = sandbox._logg();
    expect(epostKall.length).toBe(1);
    expect(epostKall[0].fn).toBe('send-frakt-epost');
    expect(epostKall[0].body).toEqual({ type: 'hentet', kontaktpersonEpost: 'ola@example.test', chassisNr: 'WBA12345', fraktselskap: 'Axess', avsenderNavn: 'TEST Admin' });
    expect(lagreKall.length).toBe(1);
    expect(lagreKall[0].endringer).toEqual({ hentetVarslet: true });
    expect(lagreKall[0].rad._arkId).toBe('ark_1');
  });

  it('spør ikke om bekreftelse (automatisk)', async () => {
    let confirmKalt = false;
    sandbox.confirm = () => { confirmKalt = true; return true; };
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(confirmKalt).toBe(false);
    expect(sandbox._logg().epostKall.length).toBe(1);
  });

  it('sender ingenting ved andre statusoverganger', async () => {
    await sandbox.endreStatus('ord_1', 'vist_biltilsyn');
    expect(sandbox._logg().epostKall.length).toBe(0);
    expect(sandbox._logg().lagreKall.length).toBe(0);
  });

  it('sender ikke på nytt når raden allerede er varslet (status flippet frem og tilbake)', async () => {
    sandbox._getS().adminArk[0].hentetVarslet = true;
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(sandbox._logg().epostKall.length).toBe(0);
  });

  it('sender ikke når ordren allerede sto på Hentet', async () => {
    ordre.ordreStatus = 'hentet';
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(sandbox._logg().epostKall.length).toBe(0);
  });

  it('«Hente selv»: e-posten nevner ikke «Hente selv» som den som hentet', async () => {
    sandbox._getS().adminArk[0].fraktselskap = 'Hente selv';
    await sandbox.endreStatus('ord_1', 'hentet');
    const kall = sandbox._logg().epostKall;
    expect(kall.length).toBe(1);
    expect(kall[0].body.type).toBe('hentet');
    expect(kall[0].body.fraktselskap).toBe('');
  });

  it('«Levering av oss»: samme som knappen gjorde før, «på vei til dere»-varselet', async () => {
    sandbox._getS().adminArk[0].fraktselskap = 'Levering av oss';
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(sandbox._logg().epostKall[0].body.type).toBe('paa_vei');
  });

  it('uten e-post i Kontakter: ingen sending, ingen grønn merking, men en beskjed - og statusen står', async () => {
    ordre.eier = 'TEST Ukjent person';
    await sandbox.endreStatus('ord_1', 'hentet');
    const { epostKall, lagreKall, toaster } = sandbox._logg();
    expect(epostKall.length).toBe(0);
    expect(lagreKall.length).toBe(0);
    expect(toaster.some(t => /Hentet-varsel ikke sendt/.test(t.m))).toBe(true);
    expect(ordre.ordreStatus).toBe('hentet');
  });

  it('når sendingen feiler (f.eks. 403 for en ikke-admin): ingen grønn merking, beskjed med serverens melding, statusen står', async () => {
    sandbox._settEpostSvar(false, 'Rollen din har ikke tilgang til dette');
    await sandbox.endreStatus('ord_1', 'hentet');
    const { lagreKall, toaster } = sandbox._logg();
    expect(lagreKall.length).toBe(0);
    expect(toaster.some(t => /Rollen din har ikke tilgang/.test(t.m))).toBe(true);
    expect(ordre.ordreStatus).toBe('hentet');
  });

  it('ignorerer en arkivert Admin-ark-rad (lager ny rad, sender varsel)', async () => {
    sandbox._getS().adminArk[0].arkivert = true;
    sandbox._getS().adminArk[0].hentetVarslet = true;
    await sandbox.endreStatus('ord_1', 'hentet');
    const { epostKall, lagreKall } = sandbox._logg();
    expect(epostKall.length).toBe(1);
    expect(lagreKall[0].rad._arkId).toBeNull();
  });

  it('sender ikke når statuslagringen feiler', async () => {
    sandbox._setDb({
      from() { return { update: () => ({ eq: () => Promise.resolve({ error: { message: 'nettverksfeil' } }) }) }; },
      rpc: () => Promise.resolve({ data: {}, error: null })
    });
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(sandbox._logg().epostKall.length).toBe(0);
  });
});

// Henrik 2026-11-25 (alternativ C): send-frakt-epost slipper bare admin gjennom, og 49 av 133
// Hentet-endringer er gjort av vanlige ansatte/godkjennere. Automatikken prøver alltid først,
// men admin har en reserveknapp i Admin-ark når raden står «ikke varslet».
describe('Hentet-varsel: automatikken prøver uansett rolle, og sier hvor reserven er (2026-11-25)', () => {
  let sandbox, ordre;
  beforeEach(() => {
    sandbox = nyEnvironment();
    ordre = { id: 'ord_1', chassis: 'WBA12345', kunde: 'TEST Bilhuset AS', eier: 'TEST Ola', ordreStatus: 'klar_henting', status: 'aktiv',
      ankomstdato: '2026-08-20', endringer: [], godkjent: false, ansatteSignert: [] };
    sandbox._setS({ ordrer: [ordre], adminArk: [{ id: 'ark_1', chassisNr: 'WBA12345', fraktselskap: 'BOS', arkivert: false, hentetVarslet: false }], kontakter: KONTAKTER });
    settDb(sandbox);
  });

  it('en vanlig ansatt som setter Hentet: e-posten forsøkes likevel (serveren avgjør)', async () => {
    sandbox._setMe({ id: 2, navn: 'TEST Ansatt', rolle: 'ansatt' });
    sandbox._settEpostSvar(false, 'Rollen din har ikke tilgang til dette');
    await sandbox.endreStatus('ord_1', 'hentet');
    const { epostKall, lagreKall, toaster } = sandbox._logg();
    expect(epostKall.length).toBe(1);
    expect(lagreKall.length).toBe(0);
    expect(toaster.some(t => /En administrator kan sende den fra Admin-ark/.test(t.m))).toBe(true);
  });

  it('en vanlig ansatt der serveren godtar: merkes varslet som for admin', async () => {
    sandbox._setMe({ id: 2, navn: 'TEST Ansatt', rolle: 'ansatt' });
    await sandbox.endreStatus('ord_1', 'hentet');
    const { epostKall, lagreKall } = sandbox._logg();
    expect(epostKall.length).toBe(1);
    expect(lagreKall[0].endringer).toEqual({ hentetVarslet: true });
  });

  it('admin som får feil: beskjeden peker på reserveknappen', async () => {
    sandbox._setMe({ id: 1, navn: 'TEST Admin', rolle: 'admin' });
    sandbox._settEpostSvar(false, 'Tjenesten svarte ikke');
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(sandbox._logg().toaster.some(t => /Tjenesten svarte ikke.*Send hentet-varsel/.test(t.m))).toBe(true);
  });

  it('en «kun ekstrautstyr»-ordre får ingen e-post og ingen Admin-ark-merking', async () => {
    sandbox._setMe({ id: 1, navn: 'TEST Admin', rolle: 'admin' });
    ordre.kunEkstrautstyr = true;
    await sandbox.endreStatus('ord_1', 'hentet');
    expect(sandbox._logg().epostKall.length).toBe(0);
    expect(sandbox._logg().lagreKall.length).toBe(0);
    // og ingen misvisende «Hentet-varsel ikke sendt»-beskjed (den ordren skal ikke ha e-post i det hele tatt)
    expect(sandbox._logg().toaster.some(t => /Hentet-varsel/.test(t.m))).toBe(false);
  });
});

describe('Admin-ark: reserveknapp «📧 Send hentet-varsel» for admin (2026-11-25)', () => {
  let sandbox, ordre, confirmSvar, confirmTekst;
  beforeEach(() => {
    sandbox = nyEnvironment();
    ordre = { id: 'ord_1', chassis: 'WBA12345', kunde: 'TEST Bilhuset AS', eier: 'TEST Ola', ordreStatus: 'hentet', status: 'aktiv',
      ankomstdato: '2026-08-20', endringer: [], godkjent: false, ansatteSignert: [] };
    sandbox._setS({ ordrer: [ordre], adminArk: [{ id: 'ark_1', chassisNr: 'WBA12345', fraktselskap: 'BOS', arkivert: false, hentetVarslet: false }], kontakter: KONTAKTER });
    sandbox._setMe({ id: 1, navn: 'TEST Admin', rolle: 'admin' });
    settDb(sandbox);
    confirmSvar = true; confirmTekst = null;
    sandbox.confirm = (t) => { confirmTekst = t; return confirmSvar; };
  });

  describe('adminArkVisHentetReserveknapp', () => {
    const rad = (ekstra) => ({ chassisNr: 'WBA12345', hentetVarslet: false, _erOrdre: true, _ordreStatus: 'hentet', ...ekstra });
    it('vises for admin på en hentet bil som ikke er varslet', () => {
      expect(sandbox.adminArkVisHentetReserveknapp(rad())).toBe(true);
    });
    it('vises ikke når raden alt er varslet', () => {
      expect(sandbox.adminArkVisHentetReserveknapp(rad({ hentetVarslet: true }))).toBe(false);
    });
    it('vises ikke før bilen er hentet (automatikken sender selv ved Hentet)', () => {
      for (const st of ['paa_vei', 'ikke_paabegynt', 'paabegynt', 'klar_henting', 'vist_biltilsyn']) {
        expect(sandbox.adminArkVisHentetReserveknapp(rad({ _ordreStatus: st }))).toBe(false);
      }
    });
    it('vises på en løs rad uten ordre (ingen automatikk der) som ikke er varslet', () => {
      expect(sandbox.adminArkVisHentetReserveknapp(rad({ _erOrdre: false, _ordreStatus: null }))).toBe(true);
    });
    it('vises ikke uten chassis.nr', () => {
      expect(sandbox.adminArkVisHentetReserveknapp(rad({ chassisNr: '' }))).toBe(false);
    });
    it('vises aldri for godkjenner eller vanlig ansatt', () => {
      for (const rolle of ['godkjenner', 'ansatt']) {
        sandbox._setMe({ id: 2, navn: 'TEST', rolle });
        expect(sandbox.adminArkVisHentetReserveknapp(rad())).toBe(false);
      }
    });
  });

  describe('adminArkVarsleHentetManuelt', () => {
    it('spør først, sender samme e-post som automatikken og merker raden varslet', async () => {
      const ok = await sandbox.adminArkVarsleHentetManuelt('WBA12345');
      expect(ok).toBe(true);
      expect(confirmTekst).toMatch(/TEST Ola \(ola@example\.test\).*at bilen er hentet/);
      const { epostKall, lagreKall } = sandbox._logg();
      expect(epostKall.length).toBe(1);
      expect(epostKall[0].body).toEqual({ type: 'hentet', kontaktpersonEpost: 'ola@example.test', chassisNr: 'WBA12345', fraktselskap: 'Axess', avsenderNavn: 'TEST Admin' });
      expect(lagreKall.length).toBe(1);
      expect(lagreKall[0].endringer).toEqual({ hentetVarslet: true });
      expect(lagreKall[0].rad._arkId).toBe('ark_1');
      expect(lagreKall[0].rad._erOrdre).toBe(true);
    });

    it('Avbryt i bekreftelsen: ingenting sendes eller lagres', async () => {
      confirmSvar = false;
      expect(await sandbox.adminArkVarsleHentetManuelt('WBA12345')).toBe(false);
      expect(sandbox._logg().epostKall.length).toBe(0);
      expect(sandbox._logg().lagreKall.length).toBe(0);
    });

    it('«Levering av oss»: «på vei til dere» som før', async () => {
      sandbox._getS().adminArk[0].fraktselskap = 'Levering av oss';
      await sandbox.adminArkVarsleHentetManuelt('WBA12345');
      expect(confirmTekst).toMatch(/på vei til dere/);
      expect(sandbox._logg().epostKall[0].body.type).toBe('paa_vei');
      expect(sandbox._logg().epostKall[0].body.fraktselskap).toBe('');
    });

    it('«Hente selv»: nevner ikke «Hente selv» som den som hentet', async () => {
      sandbox._getS().adminArk[0].fraktselskap = 'Hente selv';
      await sandbox.adminArkVarsleHentetManuelt('WBA12345');
      expect(sandbox._logg().epostKall[0].body).toMatchObject({ type: 'hentet', fraktselskap: '' });
    });

    it('feil fra serveren: ingen grønn merking, beskjed', async () => {
      sandbox._settEpostSvar(false, 'Tjenesten svarte ikke');
      expect(await sandbox.adminArkVarsleHentetManuelt('WBA12345')).toBe(false);
      expect(sandbox._logg().lagreKall.length).toBe(0);
      expect(sandbox._logg().toaster.some(t => /Kunne ikke sende varsel: .*Tjenesten svarte ikke/.test(t.m))).toBe(true);
    });

    it('allerede varslet: sender ikke en gang til', async () => {
      sandbox._getS().adminArk[0].hentetVarslet = true;
      expect(await sandbox.adminArkVarsleHentetManuelt('WBA12345')).toBe(false);
      expect(confirmTekst).toBeNull();
      expect(sandbox._logg().epostKall.length).toBe(0);
    });

    it('ikke admin: sender ingenting (også om noen kaller funksjonen direkte)', async () => {
      sandbox._setMe({ id: 2, navn: 'TEST Godkjenner', rolle: 'godkjenner' });
      expect(await sandbox.adminArkVarsleHentetManuelt('WBA12345')).toBe(false);
      expect(confirmTekst).toBeNull();
      expect(sandbox._logg().epostKall.length).toBe(0);
    });

    it('uten e-post i Kontakter: ingen bekreftelse, ingen sending, beskjed', async () => {
      ordre.eier = 'TEST Ukjent person';
      expect(await sandbox.adminArkVarsleHentetManuelt('WBA12345')).toBe(false);
      expect(confirmTekst).toBeNull();
      expect(sandbox._logg().epostKall.length).toBe(0);
      expect(sandbox._logg().toaster.some(t => /Fant ingen e-post/.test(t.m))).toBe(true);
    });

    it('dobbelttrykk mens den sender: bare én e-post', async () => {
      const a = sandbox.adminArkVarsleHentetManuelt('WBA12345');
      const b = sandbox.adminArkVarsleHentetManuelt('WBA12345');
      await Promise.all([a, b]);
      expect(sandbox._logg().epostKall.length).toBe(1);
    });
  });

  describe('Frakt-e-post-kolonnen i Admin-ark (formatteren)', () => {
    // Kjører den ekte renderAdminArk og fanger kolonnene i en falsk Tabulator.
    function fraktFormatter() {
      vm.runInContext(`
        function adminArkOppdaterStatus(){}
        function adminArkTilpassHoyde(){}
        function adminArkSikreTommeRader(){}
        function adminArkByggRader(){ return []; }
        function adminArkMaalBredde(){ return 90; }
        function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
        var __kolonner = null;
        function Tabulator(sel, opts){ __kolonner = opts.columns; throw new Error('STOPP_TEST'); }
      `, sandbox);
      sandbox.window.innerWidth = 1400;
      sandbox.document.getElementById = () => ({ style: {}, getBoundingClientRect: () => ({ left: 0 }), querySelector: () => null });
      try { sandbox.renderAdminArk(); } catch (e) { if (e.message !== 'STOPP_TEST') throw e; }
      const kol = vm.runInContext('__kolonner', sandbox).find(k => k.field === '_fraktKnapper');
      return (rad) => kol.formatter({ getRow: () => ({ getData: () => rad }) });
    }
    const rad = (ekstra) => ({ chassisNr: 'WBA12345', fraktselskap: 'BOS', bestiltFrakt: true, hentetVarslet: false, _erOrdre: true, _ordreStatus: 'hentet', ...ekstra });

    it('hentet bil, ikke varslet: admin ser reserveknappen i stedet for den røde lappen', () => {
      const html = fraktFormatter()(rad());
      expect(html).toContain(`onclick="adminArkVarsleHentetManuelt('WBA12345')"`);
      expect(html).toContain('📧 Send hentet-varsel');
      expect(html).not.toContain('Hentet ikke varslet');
    });
    it('varslet: grønn lapp, ingen knapp', () => {
      const html = fraktFormatter()(rad({ hentetVarslet: true }));
      expect(html).toContain('✔ Hentet varslet');
      expect(html).not.toContain('adminArkVarsleHentetManuelt');
    });
    it('ikke hentet ennå: rød lapp, ingen knapp', () => {
      const html = fraktFormatter()(rad({ _ordreStatus: 'klar_henting' }));
      expect(html).toContain('Hentet ikke varslet');
      expect(html).not.toContain('adminArkVarsleHentetManuelt');
    });
    it('chassis.nr med apostrof bryter ikke onclick', () => {
      const html = fraktFormatter()(rad({ chassisNr: "WB'A1" }));
      expect(html).toContain("adminArkVarsleHentetManuelt('WB\\'A1')");
    });
    it('ikke admin: kolonnen er tom', () => {
      const f = fraktFormatter();
      sandbox._setMe({ id: 2, navn: 'TEST', rolle: 'godkjenner' });
      expect(f(rad())).toBe('');
    });
  });
});
