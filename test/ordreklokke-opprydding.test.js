import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// «A: reparer dagens» (2026-11-04), etter at Ismails Ombygging-klokke gikk en hel natt (18 t 32 min): Ombygging-klokka kan bare gå for en ansatt som er stemplet inn, åpne klokker stoppes av
// seg selv når ansatten ikke lenger er stemplet inn (databasen, cron) og etter 14 t, admin kan stoppe en klokke og velge klokkeslettet, og økter over 10 t merkes «Glemt?».
// Databasesiden er testet i supabase/tester/ordreklokke_opprydding_TEST_body.sql; her testes klienten mot en falsk db der testen styrer svarene.

const app = lastApp();
const { sandbox, S } = app;

function lagDb(svar = {}) {
  const kall = [];
  const db = { rpc(navn, args) { kall.push({ navn, args }); const f = svar[navn]; return Promise.resolve(f ? f(args) : { data: null, error: null }); } };
  return { db, kall };
}
const ikkeStemplet = () => ({ data: null, error: { message: 'IKKE_STEMPLET_INN' } });
const nyOrdre = (id = 'ord_T1', status = 'paabegynt') => { const o = sandbox.dbToOrdre({ id, status: 'aktiv', ordre_status: status, regnr: 'AB12345', kunde: 'TEST' }); o.ansatteSignert = []; o.ordreTimerSessions = []; o.klargjoringTimerSessions = []; return o; };
const T = 3600000;
let toasts, lukket;

beforeEach(() => {
  toasts = []; lukket = [];
  sandbox.visToast = (t) => { toasts.push(t); };
  sandbox.closeModal = (id) => { lukket.push(id); };
  sandbox.confirm = () => true;
  S.ansatte = [{ id: 2, navn: 'TEST - Ansatt', aktiv: true, kanForeLonn: true, stempletInnSiden: null }, { id: 3, navn: 'TEST - Kollega', aktiv: true, kanForeLonn: true, stempletInnSiden: new Date().toISOString() }];
  S.ordrer = [nyOrdre()];
  app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt', kanForeLonn: true, stempletInnSiden: null });
  app.settTimerStart(null);
  app.settDb(null);
});
// Testene bytter ut globale funksjoner med spioner; de ekte settes tilbake etter hver test, så en spion aldri lekker inn i neste test.
const EKTE = { doLagreManuellTimer: sandbox.doLagreManuellTimer, doStartTimer: sandbox.doStartTimer, openTimerPIN: sandbox.openTimerPIN, avbrytAktivEgenmelding: sandbox.avbrytAktivEgenmelding, setTimeout: sandbox.setTimeout, visToast: sandbox.visToast, closeModal: sandbox.closeModal, renderAll: sandbox.renderAll, buildOrdreDetail: sandbox.buildOrdreDetail };
afterEach(() => { app.settTimerStart(null); Object.assign(sandbox, EKTE); });
afterAll(() => { app.settDb(null); app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' }); });

describe('startOrdreTimerForAnsatt: svar fra databasen', () => {
  it('lykkes: true, og økta kommer fra svaret', async () => {
    const o = S.ordrer[0];
    const { db } = lagDb({ oppdater_ordre_timer_sesjon: () => ({ data: { sessions: [{ start: 5, stopp: null, ansattId: 2, ansatt: 'A' }] }, error: null }) }); app.settDb(db);
    expect(await sandbox.startOrdreTimerForAnsatt(o, 'ordreTimerSessions', 2, 'A')).toBe(true);
    expect(o.ordreTimerSessions).toEqual([{ start: 5, stopp: null, ansattId: 2, ansatt: 'A' }]);
  });
  it('IKKE_STEMPLET_INN fra serveren: «ikke_stemplet», ingen økt og ingen feillogg (forventet utfall)', async () => {
    const o = S.ordrer[0];
    const { db } = lagDb({ oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    const feilFør = app.consoleFeil.length;
    expect(await sandbox.startOrdreTimerForAnsatt(o, 'ordreTimerSessions', 2, 'A')).toBe('ikke_stemplet');
    expect(o.ordreTimerSessions).toEqual([]);
    expect(app.consoleFeil.length).toBe(feilFør);
  });
  it('annen feil: false (og logges)', async () => {
    const o = S.ordrer[0];
    const { db } = lagDb({ oppdater_ordre_timer_sesjon: () => ({ data: null, error: { message: 'ORDRE_FINNES_IKKE' } }) }); app.settDb(db);
    expect(await sandbox.startOrdreTimerForAnsatt(o, 'ordreTimerSessions', 2, 'A')).toBe(false);
  });
  it('uten database (offline/test): lokal økt og true', async () => {
    const o = S.ordrer[0];
    expect(await sandbox.startOrdreTimerForAnsatt(o, 'ordreTimerSessions', 2, 'A')).toBe(true);
    expect(o.ordreTimerSessions).toHaveLength(1);
  });
});

describe('meldPaa: databasen avgjør om klokka starter (kun for en ansatt som er stemplet inn)', () => {
  const startOk = () => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null });
  it('databasen sier IKKE_STEMPLET_INN: påmeldingen står, men det kommer ingen klokke, og ansatten får beskjed', async () => {
    const { db, kall } = lagDb({ oppdater_ordre_ansatt_signert: (a) => ({ data: [a.p_ansatt], error: null }), oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    await sandbox.meldPaa('ord_T1');
    expect(S.ordrer[0].ansatteSignert.map((a) => a.id)).toEqual([2]);
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);   // serveren spørres alltid (appen forhåndsblokkerer ikke)
    expect(toasts.join(' ')).toContain('ikke stemplet inn');
    expect(S.ordrer[0].ordreTimerSessions).toEqual([]);
  });
  it('stemplet inn: klokka startes og ingen beskjed vises', async () => {
    const { db, kall } = lagDb({ oppdater_ordre_ansatt_signert: (a) => ({ data: [a.p_ansatt], error: null }), oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.meldPaa('ord_T1');
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);
    expect(S.ordrer[0].ordreTimerSessions).toHaveLength(1);
    expect(toasts).toEqual([]);
  });
  it('den lokale kopien sier «ikke stemplet inn» (utdatert, f.eks. stemplet inn på en annen enhet), men databasen sier ja: klokka starter likevel', async () => {
    S.ansatte = [{ id: 2, navn: 'TEST - Ansatt', aktiv: true, kanForeLonn: true, stempletInnSiden: null }];
    app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt', kanForeLonn: true, stempletInnSiden: null });
    const { db } = lagDb({ oppdater_ordre_ansatt_signert: (a) => ({ data: [a.p_ansatt], error: null }), oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.meldPaa('ord_T1');
    expect(S.ordrer[0].ordreTimerSessions).toHaveLength(1);
    expect(toasts).toEqual([]);
  });
  it('ordre uten aktiv fase (f.eks. «Ikke påbegynt»): ingen klokke og ingen beskjed om stempling', async () => {
    S.ordrer = [nyOrdre('ord_T1', 'ikke_paabegynt')];
    const { db, kall } = lagDb({ oppdater_ordre_ansatt_signert: (a) => ({ data: [a.p_ansatt], error: null }) }); app.settDb(db);
    await sandbox.meldPaa('ord_T1');
    expect(kall.some((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toBe(false);
    expect(toasts).toEqual([]);
  });
});

describe('startOrdreTimer (manuell knapp): økta vises først når databasen har startet den', () => {
  const startOk = () => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null });
  it('Ombygging, databasen sier ikke stemplet inn: ingen økt (heller ikke midlertidig), ingen logglinje, beskjed', async () => {
    const { db, kall } = lagDb({ oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    const p = sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    const mensVenter = S.ordrer[0].ordreTimerSessions.length;      // økta skal aldri stå i lista mens vi venter på databasen
    await p;
    expect(mensVenter).toBe(0);
    expect(S.ordrer[0].ordreTimerSessions).toEqual([]);
    expect(kall.map((k) => k.navn)).toEqual(['oppdater_ordre_timer_sesjon']);
    expect(toasts.join(' ')).toContain('ikke stemplet inn');
  });
  it('Ombygging, stemplet inn: starter og logger (etter at databasen sa ja)', async () => {
    const { db, kall } = lagDb({ oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    expect(S.ordrer[0].ordreTimerSessions).toHaveLength(1);
    expect(kall.map((k) => k.navn)).toEqual(['oppdater_ordre_timer_sesjon', 'legg_til_ordre_endring']);
    expect(toasts).toEqual([]);
  });
  it('den lokale kopien sier «ikke stemplet inn», men databasen sier ja: klokka starter', async () => {
    S.ansatte = [{ id: 2, navn: 'TEST - Ansatt', aktiv: true, kanForeLonn: true, stempletInnSiden: null }];
    const { db } = lagDb({ oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    expect(S.ordrer[0].ordreTimerSessions).toHaveLength(1);
  });
  it('annen feil fra databasen: ingen økt, ingen logglinje, og en beskjed om å prøve igjen', async () => {
    const { db, kall } = lagDb({ oppdater_ordre_timer_sesjon: () => ({ data: null, error: { message: 'ORDRE_FINNES_IKKE' } }) }); app.settDb(db);
    await sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    expect(S.ordrer[0].ordreTimerSessions).toEqual([]);
    expect(kall.some((k) => k.navn === 'legg_til_ordre_endring')).toBe(false);
    expect(toasts.join(' ')).toContain('Prøv igjen');
  });
  it('objektet byttes ut (Realtime) mens vi venter: den nye ordren får økta', async () => {
    let slipp;
    const db = { rpc: (navn) => new Promise((ok) => { if (navn === 'oppdater_ordre_timer_sesjon') slipp = () => ok(startOk()); else ok({ data: null, error: null }); }) }; app.settDb(db);
    const p = sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    S.ordrer[0] = nyOrdre();
    slipp(); await p;
    expect(S.ordrer[0].ordreTimerSessions).toHaveLength(1);
  });
  it('Klargjøring er rent manuell og krever ikke stempling (uendret)', async () => {
    const { db, kall } = lagDb({ oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.startOrdreTimer('ord_T1', 'klargjoringTimerSessions');
    expect(S.ordrer[0].klargjoringTimerSessions).toHaveLength(1);
    expect(kall.some((k) => k.navn === 'oppdater_ordre_timer_sesjon' && k.args.p_felt === 'klargjoring_timer_sessions')).toBe(true);
    expect(toasts).toEqual([]);
  });
  it('har jeg allerede en åpen økt, gjøres ingenting (ingen kall)', async () => {
    S.ordrer[0].ordreTimerSessions = [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }];
    const { db, kall } = lagDb(); app.settDb(db);
    await sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    expect(kall).toEqual([]);
  });
  it('uten database (offline/test): lokal økt som før', async () => {
    await sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    expect(S.ordrer[0].ordreTimerSessions).toHaveLength(1);
  });
});

describe('stoppMineOrdreKlokkerVedUtstempling: stopp i databasen', () => {
  it('ett kall som stopper ALLE mine åpne klokker, og lokal kopi får øktene fra svaret', async () => {
    S.ordrer = [nyOrdre('ord_A'), nyOrdre('ord_B')];
    S.ordrer[0].ordreTimerSessions = [{ start: 1, stopp: null, ansattId: 2, ansatt: 'A' }];
    const { db, kall } = lagDb({ stopp_ordreklokker_for_ansatt: () => ({ data: { antall: 1, ordrer: [{ id: 'ord_A', sessions: [{ start: 1, stopp: 99, ansattId: 2, ansatt: 'A' }] }] }, error: null }) }); app.settDb(db);
    await sandbox.stoppMineOrdreKlokkerVedUtstempling();
    expect(kall).toEqual([{ navn: 'stopp_ordreklokker_for_ansatt', args: { p_ansatt_id: 2 } }]);   // ingen p_stopp_ms: stopper «nå»
    expect(S.ordrer[0].ordreTimerSessions[0].stopp).toBe(99);
  });
  it('svikter databasefunksjonen: reserve = den gamle veien, én økt om gangen', async () => {
    S.ordrer[0].ordreTimerSessions = [{ start: 1, stopp: null, ansattId: 2, ansatt: 'A' }];
    const { db, kall } = lagDb({
      stopp_ordreklokker_for_ansatt: () => ({ data: null, error: { message: 'function does not exist' } }),
      oppdater_ordre_timer_sesjon: () => ({ data: { sessions: [{ start: 1, stopp: 50, ansattId: 2, ansatt: 'A' }] }, error: null }),
    }); app.settDb(db);
    await sandbox.stoppMineOrdreKlokkerVedUtstempling();
    expect(kall.map((k) => k.navn)).toEqual(['stopp_ordreklokker_for_ansatt', 'oppdater_ordre_timer_sesjon']);
    expect(S.ordrer[0].ordreTimerSessions[0].stopp).toBe(50);
  });
  it('ingen åpne klokker: ett kall, ingenting å oppdatere (ingen feil)', async () => {
    const { db, kall } = lagDb({ stopp_ordreklokker_for_ansatt: () => ({ data: { antall: 0, ordrer: [] }, error: null }) }); app.settDb(db);
    await sandbox.stoppMineOrdreKlokkerVedUtstempling();
    expect(kall).toHaveLength(1);
  });
});

describe('innstempling: stemplingen skrives FØR klokkene gjenopptas', () => {
  it('settStempletInnSiden gir et løfte som er ferdig først når databasen har svart (true), og false ved feil', async () => {
    let svar;
    const db = { from: () => ({ update: () => ({ eq: () => new Promise((ok) => { svar = ok; }) }) }) }; app.settDb(db);
    let ferdig = false; const p = sandbox.settStempletInnSiden('2026-11-04T07:00:00.000Z').then((v) => { ferdig = v; });
    await Promise.resolve(); expect(ferdig).toBe(false);
    svar({ error: null }); await p; expect(ferdig).toBe(true);
    const db2 = { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: { message: 'nett' } }) }) }) }; app.settDb(db2);
    expect(await sandbox.settStempletInnSiden('x')).toBe(false);
    const db3 = { from: () => ({ update: () => ({ eq: () => Promise.reject(new Error('brudd')) }) }) }; app.settDb(db3);
    expect(await sandbox.settStempletInnSiden('x')).toBe(false);
  });
  it('doStartTimer: gjenopptakelsen kjører først ETTER at stemplingen er skrevet', async () => {
    const hendelser = [];
    let skriv;
    const db = {
      from: () => ({ update: () => ({ eq: () => { hendelser.push('stempling sendt'); return new Promise((ok) => { skriv = () => { hendelser.push('stempling lagret'); ok({ error: null }); }; }); } }) }),
      rpc: (navn) => { hendelser.push('rpc ' + navn); return Promise.resolve({ data: { sessions: [] }, error: null }); },
    }; app.settDb(db);
    S.ordrer = [nyOrdre()]; S.ordrer[0].ansatteSignert = [{ id: 2 }];
    sandbox.avbrytAktivEgenmelding = () => {};
    sandbox.doStartTimer('test');
    await new Promise((ok) => setImmediate(ok));
    expect(hendelser).toEqual(['stempling sendt']);                 // ingen klokke gjenopptatt før stemplingen er lagret
    skriv(); await new Promise((ok) => setImmediate(ok)); await new Promise((ok) => setImmediate(ok));
    expect(hendelser).toEqual(['stempling sendt', 'stempling lagret', 'rpc oppdater_ordre_timer_sesjon']);
  });
});

describe('ordreTimerKortHTML: «Glemt?», admin-stopp og stoppmerker', () => {
  const lagKort = (sesjoner, rolle = 'ansatt', felt = 'ordreTimerSessions') => {
    app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle, kanForeLonn: true });
    const o = nyOrdre(); o[felt] = sesjoner;
    return sandbox.ordreTimerKortHTML(o, felt);
  };
  it('åpen økt under 10 t: ingen «Glemt?»; over 10 t: «Glemt?» (både i «Kjører nå» og på raden)', () => {
    expect(lagKort([{ start: Date.now() - 9 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }])).not.toContain('Glemt?');
    const html = lagKort([{ start: Date.now() - 11 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }]);
    expect((html.match(/Glemt\?/g) || []).length).toBe(2);
  });
  it('en STOPPET økt som varte over 10 t får ikke «Glemt?» (den er jo stoppet)', () => {
    expect(lagKort([{ start: Date.now() - 20 * T, stopp: Date.now() - 5 * T, ansattId: 5, ansatt: 'Ismail' }])).not.toContain('Glemt?');
  });
  it('admin ser «Stopp…» på en åpen Ombygging-økt (også en annen ansatts), vanlig ansatt gjør ikke', () => {
    const s = [{ start: Date.now() - 2 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }];
    expect(lagKort(s, 'admin')).toContain("apneStoppOktModal('ord_T1',5)");
    expect(lagKort(s, 'ansatt')).not.toContain('apneStoppOktModal');
  });
  it('ingen «Stopp…» på en stoppet økt, og ikke på Klargjøring (databasefunksjonen stopper bare Ombygging)', () => {
    expect(lagKort([{ start: 1, stopp: 2, ansattId: 5, ansatt: 'Ismail' }], 'admin')).not.toContain('apneStoppOktModal');
    expect(lagKort([{ start: Date.now() - 2 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }], 'admin', 'klargjoringTimerSessions')).not.toContain('apneStoppOktModal');
  });
  it('systemstoppede økter forklarer hvorfor (ikke stemplet inn / over 14 t / stoppet av administrator)', () => {
    const base = { start: Date.now() - 20 * T, stopp: Date.now() - 10 * T, ansattId: 5, ansatt: 'Ismail' };
    expect(lagKort([{ ...base, autoStopp: 'ikke_stemplet_inn' }])).toContain('stoppet automatisk (ikke stemplet inn)');
    expect(lagKort([{ ...base, autoStopp: 'glemt' }])).toContain('stoppet automatisk (gikk i over 14 t)');
    expect(lagKort([{ ...base, stoppetAvAdmin: true }])).toContain('stoppet av administrator');
    expect(lagKort([{ ...base }])).not.toContain('stoppet automatisk');
  });
  it('navn escapes (ingen HTML fra databasen slipper gjennom)', () => {
    expect(lagKort([{ start: 1, stopp: 2, ansattId: 5, ansatt: '<img src=x onerror=alert(1)>' }])).not.toContain('<img src=x');
  });
});

describe('stopp-vinduet: valg av klokkeslett', () => {
  const lokal = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime();
  it('standardStoppOkt: startet i dag = nå; startet en tidligere dag = 15:00 samme dag; etter 15:00 = starttidspunktet (aldri før start)', () => {
    const naa = lokal(2026, 11, 4, 12, 30);
    expect(sandbox.standardStoppOkt(lokal(2026, 11, 4, 8, 0), naa)).toBe('2026-11-04T12:30');
    expect(sandbox.standardStoppOkt(lokal(2026, 11, 3, 13, 56), naa)).toBe('2026-11-03T15:00');
    expect(sandbox.standardStoppOkt(lokal(2026, 11, 3, 16, 30), naa)).toBe('2026-11-03T16:30');
  });
  it('beregnStoppOkt: gyldig, før start, frem i tid, tom og ugyldig', () => {
    const start = lokal(2026, 11, 3, 13, 56), naa = lokal(2026, 11, 4, 9, 0);
    expect(sandbox.beregnStoppOkt(start, '2026-11-03T15:00', naa)).toEqual({ stoppMs: lokal(2026, 11, 3, 15, 0), ms: 64 * 60000 });
    expect(sandbox.beregnStoppOkt(start, '2026-11-03T13:56', naa).ms).toBe(0);                   // lik start er lov (null varighet)
    expect(sandbox.beregnStoppOkt(start, '2026-11-03T13:00', naa).feil).toMatch(/etter at klokka startet/);
    expect(sandbox.beregnStoppOkt(start, '2026-11-04T09:30', naa).feil).toMatch(/frem i tid/);
    expect(sandbox.beregnStoppOkt(start, '2026-11-04T09:00', naa).feil).toBeUndefined();        // nå er lov
    for (const v of ['', null, 'abc', '2026-13-45T99:99']) expect(sandbox.beregnStoppOkt(start, v, naa).feil).toBeTruthy();
  });
});

describe('stopp-vinduet: admin stopper en klokke (apneStoppOktModal / bekreftStoppOkt)', () => {
  let o;
  beforeEach(() => {
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin', kanForeLonn: true });
    o = nyOrdre(); o.ordreTimerSessions = [{ start: Date.now() - 20 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }]; S.ordrer = [o];
    // stub-elementene deles mellom testene (ett Map for hele filen): nullstill det testene leser, så resultatet ikke avhenger av rekkefølgen
    sandbox.document.getElementById('stoppOktNavn').textContent = ''; sandbox.document.getElementById('stoppOktInfo').textContent = '';
    sandbox.document.getElementById('stoppOktTid').value = ''; sandbox.document.getElementById('stoppOktBekreft').disabled = false;
  });
  const setTid = (v) => { sandbox.document.getElementById('stoppOktTid').value = v; };

  it('bare admin kan åpne vinduet', () => {
    app.settMe({ id: 2, navn: 'X', rolle: 'ansatt' });
    sandbox.apneStoppOktModal('ord_T1', 5);
    expect(sandbox.document.getElementById('stoppOktNavn').textContent).not.toBe('Ismail');
  });
  it('åpner med navn og standardtid, og bekreft stopper klokka i databasen med det valgte klokkeslettet', async () => {
    // Faste tidspunkter (en tirsdag midt i oktober, ingen sommertidsovergang): lokal formatering og tilbakelesing gir da alltid samme minutt
    const start = new Date(2026, 9, 20, 8, 0, 0).getTime(); o.ordreTimerSessions[0].start = start;
    const valgt = new Date(2026, 9, 20, 10, 0, 0).getTime();
    const { db, kall } = lagDb({ stopp_ordreklokker_for_ansatt: (a) => ({ data: { antall: 1, ordrer: [{ id: 'ord_T1', sessions: [{ start, stopp: a.p_stopp_ms, ansattId: 5, ansatt: 'Ismail', stoppetAvAdmin: true }] }] }, error: null }) }); app.settDb(db);
    sandbox.apneStoppOktModal('ord_T1', 5);
    expect(sandbox.document.getElementById('stoppOktNavn').textContent).toBe('Ismail');
    expect(sandbox.document.getElementById('stoppOktTid').value).toBe('2026-10-20T15:00');   // standard: 15:00 samme dag for en økt fra en tidligere dag
    setTid('2026-10-20T10:00');
    sandbox.oppdaterStoppOktOppsummering();
    await sandbox.bekreftStoppOkt();
    expect(kall).toHaveLength(1);
    expect(kall[0].args).toEqual({ p_ansatt_id: 5, p_ordre_id: 'ord_T1', p_stopp_ms: valgt });
    expect(o.ordreTimerSessions[0].stopp).toBe(valgt);
    expect(lukket).toContain('stoppOkt');
    expect(toasts.join(' ')).toContain('Ismail');
  });
  it('et klokkeslett før start sender INGENTING til databasen', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.apneStoppOktModal('ord_T1', 5);
    setTid('2020-01-01T10:00');
    sandbox.oppdaterStoppOktOppsummering();
    await sandbox.bekreftStoppOkt();
    expect(kall).toEqual([]);
    expect(o.ordreTimerSessions[0].stopp).toBe(null);
    expect(lukket).not.toContain('stoppOkt');
  });
  it('databasen avviser: økta røres ikke, vinduet blir stående åpent og admin får en forståelig beskjed', async () => {
    const { db } = lagDb({ stopp_ordreklokker_for_ansatt: () => ({ data: null, error: { message: 'STOPP_I_FREMTIDEN' } }) }); app.settDb(db);
    sandbox.apneStoppOktModal('ord_T1', 5);
    await sandbox.bekreftStoppOkt();
    expect(o.ordreTimerSessions[0].stopp).toBe(null);
    expect(lukket).not.toContain('stoppOkt');
    expect(toasts.join(' ')).toContain('frem i tid');
  });
  it('klokka er allerede stoppet (av cron eller en annen admin): ingen kall, beskjed', async () => {
    o.ordreTimerSessions[0].stopp = Date.now() - T;
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.apneStoppOktModal('ord_T1', 5);
    expect(toasts.join(' ')).toContain('allerede stoppet');
    await sandbox.bekreftStoppOkt();
    expect(kall).toEqual([]);
  });
});

describe('Oversikt: «Ordreklokker som har gått lenge» (admin)', () => {
  const kort = () => sandbox.document.getElementById('langeKlokkerKort');
  const liste = () => sandbox.document.getElementById('langeKlokkerListe');
  it('admin ser kortet med navn og Stopp-knapp når en klokke har gått over 10 t', () => {
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
    S.ordrer = [nyOrdre()]; S.ordrer[0].ordreTimerSessions = [{ start: Date.now() - 18 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }];
    sandbox.renderLangeOrdreklokker();
    expect(kort().style.display).toBe('block');
    expect(liste().innerHTML).toContain('Ismail');
    expect(liste().innerHTML).toContain("apneStoppOktModal('ord_T1',5)");
  });
  it('skjult når ingen klokke har gått over 10 t, når den er stoppet, eller for en vanlig ansatt', () => {
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
    S.ordrer = [nyOrdre()];
    S.ordrer[0].ordreTimerSessions = [{ start: Date.now() - 5 * T, stopp: null, ansattId: 5, ansatt: 'A' }];
    sandbox.renderLangeOrdreklokker(); expect(kort().style.display).toBe('none');
    S.ordrer[0].ordreTimerSessions = [{ start: Date.now() - 18 * T, stopp: Date.now() - 6 * T, ansattId: 5, ansatt: 'A' }];
    sandbox.renderLangeOrdreklokker(); expect(kort().style.display).toBe('none');
    S.ordrer[0].ordreTimerSessions = [{ start: Date.now() - 18 * T, stopp: null, ansattId: 5, ansatt: 'A' }];
    app.settMe({ id: 2, navn: 'X', rolle: 'ansatt' });
    sandbox.renderLangeOrdreklokker(); expect(kort().style.display).toBe('none');
  });
  it('rare verdier i klokkelista (null, tall, tekst, ikke-liste) blanker aldri Oversikt: hoppes over, og de gyldige vises', () => {
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
    const a = nyOrdre('ord_A'); a.ordreTimerSessions = [null, 5, 'x', { start: Date.now() - 18 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }];
    const b = nyOrdre('ord_B'); b.ordreTimerSessions = 'ikke en liste';
    const c = nyOrdre('ord_C'); c.ordreTimerSessions = null;
    S.ordrer = [a, b, c];
    expect(() => sandbox.renderLangeOrdreklokker()).not.toThrow();
    expect(kort().style.display).toBe('block');
    expect(liste().innerHTML).toContain('Ismail');
  });
  it('navn og ordrelabel escapes', () => {
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
    S.ordrer = [nyOrdre()]; S.ordrer[0].ordreTimerSessions = [{ start: Date.now() - 18 * T, stopp: null, ansattId: 5, ansatt: '<b onmouseover=x>' }];
    sandbox.renderLangeOrdreklokker();
    expect(liste().innerHTML).not.toContain('<b onmouseover');
  });
});

describe('statusbytte: beskjed når påmeldte ikke er stemplet inn', () => {
  // Falsk db der alle tabellkall svarer ok og rpc-ene styres av testen (samme idé som i leveranse.test.js).
  function dbMedFase(faseSvar) {
    const kall = [];
    const kjede = () => new Proxy(function () {}, { get(_, k) { if (k === 'then') return (res) => Promise.resolve({ data: null, error: null }).then(res); return () => kjede(); } });
    const db = { from: () => kjede(), rpc: (navn, args) => { kall.push({ navn, args }); return Promise.resolve(navn === 'oppdater_ordre_timer_fase' ? faseSvar(args) : { data: null, error: null }); }, storage: { from: () => ({ remove: async () => ({ error: null }) }) } };
    return { db, kall };
  }
  beforeEach(() => { app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' }); app.settAktivOrdre(null); sandbox.renderAll = () => {}; });

  it('bil: «Påbegynt» med en påmeldt som ikke er stemplet inn gir beskjed med navnet', async () => {
    const { db, kall } = dbMedFase(() => ({ data: { sessions: [], ikkeStemplet: ['Ismail'] }, error: null })); app.settDb(db);
    const o = nyOrdre('ord_B1', 'ikke_paabegynt'); o.ansatteSignert = [{ id: 5, navn: 'Ismail' }]; o.bilderAnkomst = ['bilde']; S.ordrer = [o];
    await sandbox.endreStatus('ord_B1', 'paabegynt');
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_fase').map((k) => k.args.p_handling)).toEqual(['start_alle_paameldte']);
    expect(toasts.join(' ')).toContain('Ismail');
    expect(toasts.join(' ')).toContain('ikke stemplet inn');
  });
  it('bil: alle er stemplet inn (tom liste): ingen beskjed', async () => {
    const { db } = dbMedFase(() => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 5, ansatt: 'Ismail' }], ikkeStemplet: [] }, error: null })); app.settDb(db);
    const o = nyOrdre('ord_B1', 'ikke_paabegynt'); o.ansatteSignert = [{ id: 5, navn: 'Ismail' }]; o.bilderAnkomst = ['bilde']; S.ordrer = [o];
    await sandbox.endreStatus('ord_B1', 'paabegynt');
    expect(o.ordreTimerSessions).toHaveLength(1);
    expect(toasts.join(' ')).not.toContain('ikke stemplet inn');
  });
  it('bil: svar fra en database som ennå ikke har migrasjonen (uten ikkeStemplet-feltet) gir ingen beskjed og ingen feil', async () => {
    const { db } = dbMedFase(() => ({ data: { sessions: [] }, error: null })); app.settDb(db);
    const o = nyOrdre('ord_B1', 'ikke_paabegynt'); o.bilderAnkomst = ['bilde']; S.ordrer = [o];
    await sandbox.endreStatus('ord_B1', 'paabegynt');
    expect(toasts.join(' ')).not.toContain('ikke stemplet inn');
  });
  it('leveranse: «Under arbeid» med en påmeldt som ikke er stemplet inn gir beskjed med navnet', async () => {
    const { db, kall } = dbMedFase(() => ({ data: { sessions: [], ikkeStemplet: ['Ismail'] }, error: null })); app.settDb(db);
    const o = sandbox.dbToOrdre({ id: 'ord_L1', status: 'aktiv', ordre_status: 'klar_sending', ordretype: 'leveranse', kunde: 'TEST', leveranse: { merking: 'TEST-merking', adresse: 'Veien 1', postnr: '3734', sted: 'Skien', fraktAuto: false } });
    o.ansatteSignert = [{ id: 5, navn: 'Ismail' }]; S.ordrer = [o];
    await sandbox.endreStatus('ord_L1', 'under_arbeid');
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_fase').map((k) => k.args.p_handling)).toEqual(['start_alle_paameldte']);
    expect(toasts.join(' ')).toContain('Ismail');
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rettelser etter bred gjennomgang (2026-11-04): reparasjon av manglende innstempling, tydelige meldinger, tidsgrense, dobbelttrykk, m.m.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function lagTabellDb(svar, rpcSvar = {}) {
  const kall = [];
  const db = {
    from(tabell) {
      const q = { tabell, filtre: [] };
      const b = new Proxy({}, { get(_, k) {
        if (k === 'then') return (res, rej) => { kall.push(q); return Promise.resolve(svar(q)).then(res, rej); };
        return (...a) => { if (k === 'update') q.update = a[0]; else if (k === 'insert') q.insert = a[0]; else if (k === 'select') { if (!q.update && !q.insert) q.select = a[0]; } else if (k === 'single') q.single = true; else q.filtre.push([k, ...a]); return b; };
      } });
      return b;
    },
    rpc(navn, args) { kall.push({ navn, args }); const f = rpcSvar[navn]; return Promise.resolve(f ? f(args) : { data: null, error: null }); },
  };
  return { db, kall };
}
const ISO_INN = new Date(Date.now() - 2 * 3600000).toISOString();   // relativ til nå: stemplingen er 2 t gammel, godt under 16 t-grensen

describe('reparerManglendeStempling: skriv innstemplingen på nytt når den aldri kom frem (men aldri gjenopplive en admin-utstempling)', () => {
  const lag = ({ stempling = null, foringer = [], feilPaaStempling = false } = {}) => lagTabellDb((q) => {
    if (q.tabell === 'ansatte' && q.select) return feilPaaStempling ? { data: null, error: { message: 'nett' } } : { data: { stemplet_inn_siden: stempling }, error: null };
    if (q.tabell === 'timer_entries' && q.select) return { data: foringer, error: null };
    if (q.tabell === 'ansatte' && q.update) return { data: null, error: null };
    return { data: null, error: null };
  });
  const innNa = () => Date.parse(ISO_INN);
  it('ingen lokal klokke: ingenting å reparere (false, ingen kall)', async () => {
    const { db, kall } = lag(); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall).toEqual([]);
  });
  it('databasen har allerede stemplingen: true uten å skrive noe', async () => {
    app.settTimerStart(innNa());
    const { db, kall } = lag({ stempling: ISO_INN }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(true);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('databasen er tom og ingen føring er ført siden klokka startet: stemplingen skrives på nytt fra klokka (true)', async () => {
    app.settTimerStart(innNa());
    const { db, kall } = lag({ stempling: null, foringer: [] }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(true);
    const upd = kall.find((k) => k.update);
    expect(upd.update).toEqual({ stemplet_inn_siden: new Date(innNa()).toISOString() });
    const les = kall.find((k) => k.tabell === 'timer_entries');
    expect(les.filtre).toContainEqual(['eq', 'type', 'normal']);
    expect(les.filtre.find((f) => f[0] === 'gte' && f[1] === 'created_at')[2]).toBe(new Date(innNa()).toISOString());
  });
  it('databasen er tom MEN en føring er ført siden klokka startet (admin har stemplet ut): gjenopplives ALDRI', async () => {
    app.settTimerStart(innNa());
    const { db, kall } = lag({ stempling: null, foringer: [{ id: 'tadm_x' }] }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('feil ved lesing av stemplingen: false og ingen skriving', async () => {
    app.settTimerStart(innNa());
    const { db, kall } = lag({ feilPaaStempling: true }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('en ny klokke startet mens vi sjekket: ingen skriving', async () => {
    app.settTimerStart(innNa());
    const { db, kall } = lagTabellDb((q) => {
      if (q.tabell === 'timer_entries') { app.settTimerStart(innNa() + 5000); return { data: [], error: null }; }
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: null }, error: null };
      return { data: null, error: null };
    }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
});

describe('startOrdreTimerForAnsatt: reparerer manglende innstempling og prøver ÉN gang til', () => {
  const startOk = () => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null });
  const tabeller = (q) => {
    if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: null }, error: null };
    if (q.tabell === 'timer_entries' && q.select) return { data: [], error: null };
    return { data: null, error: null };
  };
  it('klokka går lokalt, databasen mangler stemplingen: stemplingen skrives, og starten lykkes ved andre forsøk', async () => {
    app.settTimerStart(Date.parse(ISO_INN));
    let n = 0;
    const { db, kall } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: () => (++n === 1 ? ikkeStemplet() : startOk()) }); app.settDb(db);
    expect(await sandbox.startOrdreTimerForAnsatt(S.ordrer[0], 'ordreTimerSessions', 2, 'TEST - Ansatt')).toBe(true);
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(2);
    expect(kall.some((k) => k.update && k.update.stemplet_inn_siden)).toBe(true);
    expect(S.ordrer[0].ordreTimerSessions).toHaveLength(1);
  });
  it('avvises også etter reparasjonen: «ikke_stemplet» etter høyst to forsøk (ingen løkke)', async () => {
    app.settTimerStart(Date.parse(ISO_INN));
    const { db, kall } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    expect(await sandbox.startOrdreTimerForAnsatt(S.ordrer[0], 'ordreTimerSessions', 2, 'TEST - Ansatt')).toBe('ikke_stemplet');
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(2);
  });
  it('ingen lokal klokke: ingen reparasjon og ingen nytt forsøk', async () => {
    const { db, kall } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    expect(await sandbox.startOrdreTimerForAnsatt(S.ordrer[0], 'ordreTimerSessions', 2, 'TEST - Ansatt')).toBe('ikke_stemplet');
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('for en ANNEN ansatt repareres aldri noe (bare min egen klokke)', async () => {
    app.settTimerStart(Date.parse(ISO_INN));
    const { db, kall } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    expect(await sandbox.startOrdreTimerForAnsatt(S.ordrer[0], 'ordreTimerSessions', 77, 'Annen')).toBe('ikke_stemplet');
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);
  });
});

describe('innstempling: stemplingen kom ikke frem', () => {
  const startOkSvar = () => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null });
  it('doStartTimer: skrivingen feiler -> beskjed og ingen gjenopptakelse nå; det planlagte nye forsøket (5 s) leser stemplingen på nytt, og lykkes det, gjenopptas klokkene', async () => {
    const timere = []; const ekte = sandbox.setTimeout; sandbox.setTimeout = (f, ms) => { timere.push({ f, ms }); return 0; };
    try {
      let skrivinger = 0;
      const { db, kall } = lagTabellDb((q) => {
        if (q.tabell === 'ansatte' && q.update) return ++skrivinger === 1 ? { data: null, error: { message: 'nett' } } : { data: null, error: null };
        if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: null }, error: null };
        if (q.tabell === 'timer_entries' && q.select) return { data: [], error: null };
        return { data: null, error: null };
      }, { oppdater_ordre_timer_sesjon: startOkSvar }); app.settDb(db);
      S.ordrer = [nyOrdre()]; S.ordrer[0].ansatteSignert = [{ id: 2 }];
      sandbox.avbrytAktivEgenmelding = () => {};
      sandbox.doStartTimer('test');
      for (let i = 0; i < 4; i++) await new Promise((ok) => setImmediate(ok));
      expect(toasts.join(' ')).toContain('ikke lagret på nettet');
      expect(kall.some((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toBe(false);          // ingen gjenopptakelse mens stemplingen mangler
      expect(kall.some((k) => k.tabell === 'ansatte' && k.select)).toBe(false);                 // og ingen reparasjon FØR tidtakeren går
      for (const x of timere.filter((x) => x.ms === 5000)) x.f();                                // kjør alle 5 s-tidtakere (også den som rydder Realtime-ignoreringen)
      for (let i = 0; i < 8; i++) await new Promise((ok) => setImmediate(ok));
      expect(kall.some((k) => k.tabell === 'ansatte' && k.select)).toBe(true);                  // reparasjonen leste stemplingen
      expect(skrivinger).toBe(2);                                                                 // og skrev den på nytt
      expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);    // og klokka ble gjenopptatt etterpå
      expect(S.ordrer[0].ordreTimerSessions).toHaveLength(1);
    } finally { sandbox.setTimeout = ekte; }
  });
  it('sjekkAdminUtstempling: tom stempling og ingen føring = innstemplingen kom aldri frem: stemplingen skrives på nytt (klokka beholdes)', async () => {
    const start = Date.parse(ISO_INN); app.settTimerStart(start);
    const { db, kall } = lagTabellDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: null }, error: null };
      if (q.tabell === 'timer_entries') return { data: [], error: null };
      return { data: null, error: null };
    }); app.settDb(db);
    expect(await sandbox.sjekkAdminUtstempling()).toBe(false);
    expect(app.hentTimerStart()).toBe(start);
    expect(kall.find((k) => k.update).update).toEqual({ stemplet_inn_siden: new Date(start).toISOString() });
  });
  it('sjekkAdminUtstempling: feil ved lesing av føringer = ingen skriving', async () => {
    app.settTimerStart(Date.parse(ISO_INN));
    const { db, kall } = lagTabellDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: null }, error: null };
      if (q.tabell === 'timer_entries') return { data: null, error: { message: 'nett' } };
      return { data: null, error: null };
    }); app.settDb(db);
    expect(await sandbox.sjekkAdminUtstempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
});

describe('manuell timeføring: PIN-modus og tilstand (kappløp funnet i gjennomgang)', () => {
  const sett = (fra, til) => { sandbox.document.getElementById('mFra').value = fra; sandbox.document.getElementById('mTil').value = til; sandbox.document.getElementById('mDato').value = '2026-11-02'; };
  afterEach(() => { app.kjor("timerPINMode = 'gps'; _manuellTimerLagrer = false; timerType = 'normal';"); });
  it('bekreftTimerPIN nullstiller modusen SYNKRONT: en ny PIN-runde mens føringen lagres starter ikke klokka', () => {
    const kall = []; sandbox.doLagreManuellTimer = () => { kall.push('manuell'); return new Promise(() => {}); }; sandbox.doStartTimer = () => { kall.push('start'); };
    S.dagensPIN = '1234'; sandbox.document.getElementById('timerPINInput').value = '1234';
    app.kjor("timerPINMode = 'manuell'");
    sandbox.bekreftTimerPIN();
    expect(kall).toEqual(['manuell']);
    expect(app.kjor('timerPINMode')).toBe('gps');                   // nullstilt FØR det asynkrone kallet er ferdig
    sandbox.bekreftTimerPIN();                                        // andre runde (f.eks. dobbelt Lagre-trykk)
    expect(kall).toEqual(['manuell', 'start']);                       // er en vanlig PIN-start, ikke en ny føring
  });
  it('lagreTimer avviser et nytt Lagre-trykk mens en føring lagres (ingen ny PIN-runde), med beskjed', () => {
    let pin = 0; sandbox.openTimerPIN = () => { pin++; };
    app.kjor("timerType = 'manuell'; _manuellTimerLagrer = true;"); sett('08:00', '12:00');
    sandbox.lagreTimer();
    expect(pin).toBe(0);
    expect(toasts.join(' ')).toContain('Lagrer allerede');
  });
  it('doLagreManuellTimer med tomme felt (ny PIN-runde etter at føringen er lagret og feltene tømt) lagrer ingenting', async () => {
    const { db, kall } = lagTabellDb(() => ({ data: [], error: null })); app.settDb(db);
    app.settMe({ id: 7, navn: 'TEST - Ansatt', rolle: 'ansatt' }); S.timer = [];
    sett('', '');
    await sandbox.doLagreManuellTimer();
    expect(kall.some((k) => k.insert)).toBe(false);
    expect(S.timer).toEqual([]);
    expect(toasts.join(' ')).toContain('Fyll inn');
  });
});

describe('finnOverlappendeTimeforinger: tidsgrense', () => {
  it('et kall som henger gir tom liste etter 4 s (føringen holdes aldri fanget), og feltet er ikke låst etterpå', async () => {
    const timere = []; const ekte = sandbox.setTimeout; sandbox.setTimeout = (f, ms) => { timere.push({ f, ms }); return 0; };
    try {
      const { db } = lagTabellDb(() => new Promise(() => {})); app.settDb(db);
      const p = sandbox.finnOverlappendeTimeforinger(5, '2026-11-02', '08:00', '12:00');
      await Promise.resolve();
      const frist = timere.find((x) => x.ms === 4000);
      expect(frist).toBeTruthy();
      frist.f();
      expect(await p).toEqual([]);
    } finally { sandbox.setTimeout = ekte; }
  });
  it('svarer databasen raskt, brukes svaret (tidsgrensen slår ikke inn)', async () => {
    const { db } = lagTabellDb(() => ({ data: [{ id: 'x', type: 'normal', start: '07:00', stopp: '15:00' }], error: null })); app.settDb(db);
    expect(await sandbox.finnOverlappendeTimeforinger(5, '2026-11-02', '08:00', '12:00')).toEqual([{ id: 'x', start: '07:00', stopp: '15:00' }]);
  });
});

describe('meldinger, dobbelttrykk og «Glemt?» (gjennomgang 2026-11-04)', () => {
  it('manuell start uten stempling gir en melding som ber om å stemple inn og trykke Start igjen (ikke et løfte om automatisk start)', async () => {
    const { db } = lagDb({ oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    await sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    expect(toasts.join(' ')).toContain('Start min klokke');
    expect(toasts.join(' ')).not.toContain('den starter av seg selv');
  });
  it('påmelding uten stempling lover derimot automatisk start (det stemmer: gjenopptas ved innstempling)', async () => {
    const { db } = lagDb({ oppdater_ordre_ansatt_signert: (a) => ({ data: [a.p_ansatt], error: null }), oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    await sandbox.meldPaa('ord_T1');
    expect(toasts.join(' ')).toContain('starter av seg selv');
  });
  it('dobbeltrykk på Start gir ÉN start og ÉN logglinje', async () => {
    let slipp;
    const kall = [];
    const db = { rpc: (navn, args) => new Promise((ok) => { kall.push(navn); if (navn === 'oppdater_ordre_timer_sesjon') slipp = () => ok({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null }); else ok({ data: null, error: null }); }) }; app.settDb(db);
    const p1 = sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    const p2 = sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    slipp(); await Promise.all([p1, p2]);
    expect(kall.filter((n) => n === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);
    expect(kall.filter((n) => n === 'legg_til_ordre_endring')).toHaveLength(1);
    // vernet slippes etterpå: en ny start (etter stopp) er mulig igjen
    S.ordrer[0].ordreTimerSessions = [];
    const p3 = sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions'); slipp(); await p3;
    expect(kall.filter((n) => n === 'oppdater_ordre_timer_sesjon')).toHaveLength(2);
  });
  it('«Glemt?» vises bare på Ombygging-kortet, aldri på Klargjøring (som er rent manuell)', () => {
    app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' });
    const o = nyOrdre(); o.klargjoringTimerSessions = [{ start: Date.now() - 12 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }];
    o.ordreTimerSessions = [{ start: Date.now() - 12 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }];
    expect(sandbox.ordreTimerKortHTML(o, 'klargjoringTimerSessions')).not.toContain('Glemt?');
    expect(sandbox.ordreTimerKortHTML(o, 'ordreTimerSessions')).toContain('Glemt?');
  });
  it('beregnStoppOkt: starttidspunkt med sekunder (databasen setter ms) avvises ikke når admin velger samme minutt', () => {
    const start = new Date(2026, 10, 3, 16, 30, 45).getTime(), naa = new Date(2026, 10, 4, 9, 0).getTime();
    const r = sandbox.beregnStoppOkt(start, '2026-11-03T16:30', naa);
    expect(r.feil).toBeUndefined();
    expect(r.stoppMs).toBe(start);                 // aldri før selve starten
    expect(r.ms).toBe(0);
    expect(sandbox.beregnStoppOkt(start, '2026-11-03T16:29', naa).feil).toMatch(/etter at klokka startet/);
    expect(sandbox.beregnStoppOkt(start, '2026-11-03T16:31', naa).ms).toBe(new Date(2026, 10, 3, 16, 31).getTime() - start);
  });
  it('standardStoppOkt for en økt som startet etter 15:00 med sekunder gir en verdi som beregnStoppOkt godtar', () => {
    const start = new Date(2026, 10, 3, 16, 20, 30).getTime(), naa = new Date(2026, 10, 4, 9, 0).getTime();
    expect(sandbox.beregnStoppOkt(start, sandbox.standardStoppOkt(start, naa), naa).feil).toBeUndefined();
  });
});

describe('bekreftStoppOkt: klokka var allerede stoppet', () => {
  it('databasen svarer antall 0: ferske økter hentes, vinduet lukkes og admin får vite at tidspunktet ikke ble brukt (ikke «stoppet»)', async () => {
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin', kanForeLonn: true });
    const o = nyOrdre(); o.ordreTimerSessions = [{ start: Date.now() - 20 * T, stopp: null, ansattId: 5, ansatt: 'Ismail' }]; S.ordrer = [o];
    const fersk = [{ start: o.ordreTimerSessions[0].start, stopp: Date.now() - 5 * T, ansattId: 5, ansatt: 'Ismail', autoStopp: 'glemt' }];
    const { db } = lagTabellDb((q) => (q.tabell === 'ordrer' && q.select ? { data: { ordre_timer_sessions: fersk }, error: null } : { data: null, error: null }),
      { stopp_ordreklokker_for_ansatt: () => ({ data: { antall: 0, ordrer: [] }, error: null }) }); app.settDb(db);
    sandbox.apneStoppOktModal('ord_T1', 5);
    await sandbox.bekreftStoppOkt();
    expect(o.ordreTimerSessions).toEqual(fersk);
    expect(lukket).toContain('stoppOkt');
    expect(toasts.join(' ')).toContain('allerede stoppet');
    expect(toasts.join(' ')).not.toContain('er stoppet (');
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rettelser fra runde 2 av den brede gjennomgangen (2026-11-04)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('startkallet til databasen har riktige argumenter (feil argument = feil ansatt, feil klokke eller en stopp i stedet for en start)', () => {
  const startOk = () => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null });
  const forventet = { p_ordre_id: 'ord_T1', p_felt: 'ordre_timer_sessions', p_handling: 'start', p_ansatt_id: 2, p_ansatt: 'TEST - Ansatt' };
  it('manuell start', async () => {
    const { db, kall } = lagDb({ oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    expect(kall.find((k) => k.navn === 'oppdater_ordre_timer_sesjon').args).toEqual(forventet);
  });
  it('påmelding', async () => {
    const { db, kall } = lagDb({ oppdater_ordre_ansatt_signert: (a) => ({ data: [a.p_ansatt], error: null }), oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.meldPaa('ord_T1');
    expect(kall.find((k) => k.navn === 'oppdater_ordre_timer_sesjon').args).toEqual(forventet);
  });
  it('gjenopptakelse ved innstempling', async () => {
    S.ordrer[0].ansatteSignert = [{ id: 2 }];
    const { db, kall } = lagDb({ oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.gjenopptaMineOrdreKlokkerVedInnstempling();
    expect(kall.find((k) => k.navn === 'oppdater_ordre_timer_sesjon').args).toEqual(forventet);
  });
});

describe('reparerManglendeStempling: alder og lesefeil (aldri gjenopplive en admin-utstempling)', () => {
  const lag = ({ stempling = null, foringer = [], feilPaaForinger = false } = {}) => lagTabellDb((q) => {
    if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: stempling }, error: null };
    if (q.tabell === 'timer_entries' && q.select) return feilPaaForinger ? { data: null, error: { message: 'nett' } } : { data: foringer, error: null };
    return { data: null, error: null };
  });
  it('FEIL ved lesing av timeføringene (dårlig dekning akkurat da): INGEN skriving (en admin-utstempling kunne ellers gjenoppstå)', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000);
    const { db, kall } = lag({ feilPaaForinger: true }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('databasen har en stempling som er over 16 t gammel (glemt utstempling): kan ikke repareres her (false), og ingenting skrives', async () => {
    app.settTimerStart(Date.now() - 20 * 3600000);
    const { db, kall } = lag({ stempling: new Date(Date.now() - 20 * 3600000).toISOString() }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('databasen har en fersk stempling: true', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000);
    const { db } = lag({ stempling: new Date(Date.now() - 2 * 3600000).toISOString() }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(true);
  });
  it('tom stempling, men den lokale klokka er over 16 t gammel: å skrive den på nytt hjelper ikke (databasen teller den ikke), så ingenting skrives', async () => {
    app.settTimerStart(Date.now() - 20 * 3600000);
    const { db, kall } = lag({ stempling: null }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
});

describe('meldPaa: påmelding på en ny bil melder meg av gamle ordrer jeg fortsatt er meldt på i en tidtatt fase (uten åpen klokke)', () => {
  const signert = (a) => ({ data: a.p_ansatt ? [a.p_ansatt] : [], error: null });
  it('A står i Påbegynt med meg påmeldt, men uten åpen klokke (stoppet av utstempling): å melde meg på B melder meg av A', async () => {
    const a = nyOrdre('ord_A'); a.ansatteSignert = [{ id: 2, navn: 'TEST - Ansatt' }];
    const b = nyOrdre('ord_B'); S.ordrer = [a, b];
    const { db, kall } = lagDb({ oppdater_ordre_ansatt_signert: signert, oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    await sandbox.meldPaa('ord_B');
    const signaler = kall.filter((k) => k.navn === 'oppdater_ordre_ansatt_signert').map((k) => [k.args.p_ordre_id, k.args.p_ansatt === null]);
    expect(signaler).toContainEqual(['ord_A', true]);    // meldt AV A
    expect(signaler).toContainEqual(['ord_B', false]);   // meldt PÅ B
    expect(a.ansatteSignert.map((x) => x.id)).toEqual([]);
    expect(b.ansatteSignert.map((x) => x.id)).toEqual([2]);
  });
  it('en ordre som ikke står i en tidtatt fase (f.eks. Ikke påbegynt) berøres ikke', async () => {
    const a = nyOrdre('ord_A', 'ikke_paabegynt'); a.ansatteSignert = [{ id: 2, navn: 'TEST - Ansatt' }];
    const b = nyOrdre('ord_B'); S.ordrer = [a, b];
    const { db } = lagDb({ oppdater_ordre_ansatt_signert: signert, oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    await sandbox.meldPaa('ord_B');
    expect(a.ansatteSignert.map((x) => x.id)).toEqual([2]);
  });
  it('en ordre jeg IKKE er meldt på berøres ikke', async () => {
    const a = nyOrdre('ord_A'); const b = nyOrdre('ord_B'); S.ordrer = [a, b];
    const { db, kall } = lagDb({ oppdater_ordre_ansatt_signert: signert, oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    await sandbox.meldPaa('ord_B');
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_ansatt_signert' && k.args.p_ordre_id === 'ord_A')).toEqual([]);
  });
});

describe('meldinger ved avvist start: tydelig når den lokale klokka er gammel', () => {
  it('klokka på Timer-siden har gått i over 16 t: beskjeden sier at det er den som må ryddes (stemple ut og inn), både ved påmelding og manuell start', async () => {
    app.settTimerStart(Date.now() - 20 * 3600000);
    const { db } = lagDb({ oppdater_ordre_ansatt_signert: (a) => ({ data: [a.p_ansatt], error: null }), oppdater_ordre_timer_sesjon: ikkeStemplet }); app.settDb(db);
    await sandbox.meldPaa('ord_T1');
    await sandbox.startOrdreTimer('ord_T1', 'ordreTimerSessions');
    expect(toasts).toHaveLength(2);
    for (const m of toasts) { expect(m).toContain('over 16 timer'); expect(m).toContain('Stemple ut og inn'); }
  });
  it('ellers: de vanlige meldingene (påmelding lover automatisk start, manuell ber om å stemple inn og trykke Start)', () => {
    expect(sandbox.ikkeStempletBeskjed(false)).toContain('starter av seg selv');
    expect(sandbox.ikkeStempletBeskjed(true)).toContain('Start min klokke');
    app.settTimerStart(Date.now() - 3 * 3600000);
    expect(sandbox.ikkeStempletBeskjed(false)).toContain('starter av seg selv');
  });
});

describe('selvhelIkkeStemplet: databasen sa at JEG ikke er stemplet inn, men min lokale klokke går', () => {
  const tabeller = (q) => {
    if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: null }, error: null };
    if (q.tabell === 'timer_entries' && q.select) return { data: [], error: null };
    return { data: null, error: null };
  };
  const startOk = () => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null });
  it('reparerbar: stemplingen skrives, klokkene gjenopptas, og navnet mitt er ikke lenger blant «ikke stemplet»', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000); S.ordrer[0].ansatteSignert = [{ id: 2 }];
    const { db, kall } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    expect(await sandbox.selvhelIkkeStemplet(['TEST - Ansatt', 'Ismail'])).toEqual(['Ismail']);
    expect(kall.some((k) => k.update && k.update.stemplet_inn_siden)).toBe(true);
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);
  });
  it('uten lokal klokke: listen er uendret og ingenting røres', async () => {
    const { db, kall } = lagTabellDb(tabeller); app.settDb(db);
    expect(await sandbox.selvhelIkkeStemplet(['TEST - Ansatt', 'Ismail'])).toEqual(['TEST - Ansatt', 'Ismail']);
    expect(kall).toEqual([]);
  });
  it('ikke reparerbar (en admin-utstempling: føring er ført): listen er uendret og stemplingen gjenopplives ikke', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000);
    const { db, kall } = lagTabellDb((q) => (q.tabell === 'timer_entries' ? { data: [{ id: 'tadm_x' }], error: null } : tabeller(q))); app.settDb(db);
    expect(await sandbox.selvhelIkkeStemplet(['TEST - Ansatt'])).toEqual(['TEST - Ansatt']);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('jeg står ikke i listen (bare andre): ingen reparasjon', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000);
    const { db, kall } = lagTabellDb(tabeller); app.settDb(db);
    expect(await sandbox.selvhelIkkeStemplet(['Ismail'])).toEqual(['Ismail']);
    expect(kall).toEqual([]);
  });
  it('ingen liste/ugyldig: tom liste, aldri kast', async () => {
    expect(await sandbox.selvhelIkkeStemplet(undefined)).toEqual([]);
    expect(await sandbox.selvhelIkkeStemplet(null)).toEqual([]);
  });
  it('statusbytte til Påbegynt: ligger jeg selv i ikkeStemplet og er reparerbar, vises INGEN «ikke stemplet inn»-melding som motsier klokka på skjermen', async () => {
    app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' });
    app.settTimerStart(Date.now() - 2 * 3600000); app.settAktivOrdre(null); sandbox.renderAll = () => {};
    const o = nyOrdre('ord_B1', 'ikke_paabegynt'); o.ansatteSignert = [{ id: 2, navn: 'TEST - Ansatt' }]; o.bilderAnkomst = ['bilde']; S.ordrer = [o];
    const { db } = lagTabellDb(tabeller, { oppdater_ordre_timer_fase: () => ({ data: { sessions: [], ikkeStemplet: ['TEST - Ansatt'] }, error: null }), oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.endreStatus('ord_B1', 'paabegynt');
    expect(toasts.join(' ')).not.toContain('ikke stemplet inn');
    expect(o.ordreTimerSessions).toHaveLength(1);
  });
});

describe('sjekkAdminUtstempling: reparasjon ved oppstart og gjenopptak av klokkene', () => {
  const tabeller = (q) => {
    if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: null }, error: null };
    if (q.tabell === 'timer_entries' && q.select) return { data: [], error: null };
    return { data: null, error: null };
  };
  const startOk = () => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null });
  afterEach(() => { app.kjor('_gjenopptaNaarDataErLastet = false'); });
  it('ordrene er lastet: stemplingen repareres og klokkene på ordrene jeg er meldt på startes straks', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000); S.ordrer[0].ansatteSignert = [{ id: 2 }];
    const { db, kall } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    expect(await sandbox.sjekkAdminUtstempling()).toBe(false);
    expect(kall.some((k) => k.update && k.update.stemplet_inn_siden)).toBe(true);
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);
  });
  it('ved oppstart (ordrene er ennå ikke lastet): ingen klokker nå, men et merke; gjenopptaMineEtterInnlasting starter dem når dataene er lastet, og bare ÉN gang', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000); S.ordrer = [];
    const { db, kall } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.sjekkAdminUtstempling();
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(0);
    expect(app.kjor('_gjenopptaNaarDataErLastet')).toBe(true);
    S.ordrer = [nyOrdre()]; S.ordrer[0].ansatteSignert = [{ id: 2 }];
    await sandbox.gjenopptaMineEtterInnlasting();
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);
    expect(app.kjor('_gjenopptaNaarDataErLastet')).toBe(false);
    S.ordrer[0].ordreTimerSessions = [];
    await sandbox.gjenopptaMineEtterInnlasting();                                   // merket er brukt: ingen ny gjenopptakelse
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_timer_sesjon')).toHaveLength(1);
  });
  it('uten merke gjør gjenopptaMineEtterInnlasting ingenting (en ansatt som stoppet klokka selv skal ikke få den startet igjen ved innlogging)', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000); S.ordrer[0].ansatteSignert = [{ id: 2 }];
    const { db, kall } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    await sandbox.gjenopptaMineEtterInnlasting();
    expect(kall).toEqual([]);
  });
  it('en ny klokke startet mens vi leste føringene: INGEN skriving (vakten timerStart === start)', async () => {
    const start = Date.now() - 2 * 3600000; app.settTimerStart(start);
    const { db, kall } = lagTabellDb((q) => {
      if (q.tabell === 'timer_entries' && q.select) { app.settTimerStart(start + 5000); return { data: [], error: null }; }
      return tabeller(q);
    }); app.settDb(db);
    await sandbox.sjekkAdminUtstempling();
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('lokal klokke over 16 t gammel: stemplingen skrives ikke på nytt (databasen ville ikke telt den)', async () => {
    app.settTimerStart(Date.now() - 20 * 3600000);
    const { db, kall } = lagTabellDb(tabeller); app.settDb(db);
    await sandbox.sjekkAdminUtstempling();
    expect(kall.some((k) => k.update)).toBe(false);
  });
});

describe('PIN-vinduet: modusen settes ved hver åpning', () => {
  it('openTimerPIN uten modus = start (gps), med «manuell» = manuell føring', () => {
    app.kjor("timerPINMode = 'manuell'");
    sandbox.openTimerPIN('GPS ikke tilgjengelig');
    expect(app.kjor('timerPINMode')).toBe('gps');
    sandbox.openTimerPIN('bekreft føring', 'manuell');
    expect(app.kjor('timerPINMode')).toBe('manuell');
  });
  it('et AVBRUTT manuelt PIN-vindu gjør ikke neste PIN-start til en lagring av den avbrutte føringen', () => {
    const kall = []; sandbox.doLagreManuellTimer = () => { kall.push('manuell'); }; sandbox.doStartTimer = () => { kall.push('start'); };
    sandbox.openTimerPIN('bekreft føring', 'manuell');          // lagreTimer åpner vinduet i manuell modus, og brukeren trykker Avbryt (modusen ryddes ikke)
    sandbox.openTimerPIN('GPS ikke tilgjengelig');              // senere: Start -> GPS feiler -> PIN-vindu for start
    S.dagensPIN = '1234'; sandbox.document.getElementById('timerPINInput').value = '1234';
    sandbox.bekreftTimerPIN();
    expect(kall).toEqual(['start']);
  });
});

describe('stoppOrdreKlokkerForAnsatt: hva reserve-veien faktisk fikk til', () => {
  const apen = () => { S.ordrer[0].ordreTimerSessions = [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }]; };
  it('reserve-veien stopper klokka: «reserve»', async () => {
    apen();
    const { db } = lagDb({ stopp_ordreklokker_for_ansatt: () => ({ data: null, error: { message: 'nett' } }), oppdater_ordre_timer_sesjon: () => ({ data: { sessions: [{ start: 1, stopp: 9, ansattId: 2 }] }, error: null }) }); app.settDb(db);
    expect(await sandbox.stoppOrdreKlokkerForAnsatt(2, 'TEST - Ansatt', 5)).toBe('reserve');
  });
  it('heller ikke reserve-veien lyktes (nettfeil): «feilet» (klokka står fortsatt åpen)', async () => {
    apen();
    const { db } = lagDb({ stopp_ordreklokker_for_ansatt: () => ({ data: null, error: { message: 'nett' } }), oppdater_ordre_timer_sesjon: () => ({ data: null, error: { message: 'nett' } }) }); app.settDb(db);
    expect(await sandbox.stoppOrdreKlokkerForAnsatt(2, 'TEST - Ansatt', 5)).toBe('feilet');
    expect(S.ordrer[0].ordreTimerSessions[0].stopp).toBe(null);
  });
  it('ingen åpne klokker og stopp-funksjonen svikter: ingenting å si fra om (undefined)', async () => {
    const { db } = lagDb({ stopp_ordreklokker_for_ansatt: () => ({ data: null, error: { message: 'nett' } }) }); app.settDb(db);
    expect(await sandbox.stoppOrdreKlokkerForAnsatt(2, 'TEST - Ansatt')).toBeUndefined();
  });
  it('stopp-funksjonen lykkes: ingen reserve-merknad (undefined)', async () => {
    apen();
    const { db } = lagDb({ stopp_ordreklokker_for_ansatt: () => ({ data: { antall: 1, ordrer: [{ id: 'ord_T1', sessions: [{ start: 1, stopp: 9, ansattId: 2 }] }] }, error: null }) }); app.settDb(db);
    expect(await sandbox.stoppOrdreKlokkerForAnsatt(2, 'TEST - Ansatt', 5)).toBeUndefined();
  });
});

describe('finnOverlappendeTimeforinger: en kastet feil hindrer aldri en føring', () => {
  it('db.from kaster (f.eks. blokkert lagring/nettverk): tom liste', async () => {
    app.settDb({ from() { throw new Error('boom'); } });
    expect(await sandbox.finnOverlappendeTimeforinger(5, '2026-11-02', '08:00', '12:00')).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rettelser fra runde 3 (etterkontroll 2026-11-09)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('reparerManglendeStempling: en GAMMEL databasestempling (glemt utstempling i går) og en ung lokal klokke', () => {
  const lag = ({ stempling, foringer = [] }) => lagTabellDb((q) => {
    if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: stempling }, error: null };
    if (q.tabell === 'timer_entries' && q.select) return { data: foringer, error: null };
    return { data: null, error: null };
  });
  const gammel = () => new Date(Date.now() - 20 * 3600000).toISOString();
  it('i går glemt utstempling, i dag en ny klokke hvis innstemplingsskriving mislyktes: den gamle stemplingen overskrives med den lokale klokka', async () => {
    const start = Date.now() - 1 * 3600000; app.settTimerStart(start);
    const { db, kall } = lag({ stempling: gammel() }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(true);
    expect(kall.find((k) => k.update).update).toEqual({ stemplet_inn_siden: new Date(start).toISOString() });
  });
  it('men er en føring ført siden klokka startet (utstemplet), gjenopplives ingenting', async () => {
    app.settTimerStart(Date.now() - 1 * 3600000);
    const { db, kall } = lag({ stempling: gammel(), foringer: [{ id: 'x' }] }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('en stempling som ikke er over 16 t gammel (selv «frem i tid») regnes som fersk: true, og ingenting skrives', async () => {
    app.settTimerStart(Date.now() - 3 * 3600000);
    const { db, kall } = lag({ stempling: new Date(Date.now() - 1 * 3600000 + 17 * 3600000).toISOString() }); app.settDb(db);   // «fremtidig» stempling: lokal start er før den
    expect(await sandbox.reparerManglendeStempling()).toBe(true);        // en stempling som ikke er over 16 t gammel er fersk (true), og ingenting skrives
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('ugyldig stempling (ikke en dato): ingen skriving, false', async () => {
    app.settTimerStart(Date.now() - 1 * 3600000);
    const { db, kall } = lag({ stempling: 'ikke-en-dato' }); app.settDb(db);
    expect(await sandbox.reparerManglendeStempling()).toBe(false);
    expect(kall.some((k) => k.update)).toBe(false);
  });
  it('kjeden: startkallet avvises mot en gammel stempling, repareres, og lykkes ved andre forsøk', async () => {
    app.settTimerStart(Date.now() - 1 * 3600000);
    let n = 0;
    const { db, kall } = lagTabellDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: gammel() }, error: null };
      if (q.tabell === 'timer_entries' && q.select) return { data: [], error: null };
      return { data: null, error: null };
    }, { oppdater_ordre_timer_sesjon: () => (++n === 1 ? ikkeStemplet() : { data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null }) }); app.settDb(db);
    expect(await sandbox.startOrdreTimerForAnsatt(S.ordrer[0], 'ordreTimerSessions', 2, 'TEST - Ansatt')).toBe(true);
    expect(kall.some((k) => k.update && k.update.stemplet_inn_siden)).toBe(true);
  });
});

describe('meldPaa: avmeldingen fra gamle ordrer gjelder bare når den NYE ordren selv tidtas', () => {
  const signert = (a) => ({ data: a.p_ansatt ? [a.p_ansatt] : [], error: null });
  it('ny bil som IKKE står i tidtatt fase (Ikke påbegynt): jeg beholder påmeldingen på bilen jeg faktisk jobber på', async () => {
    const a = nyOrdre('ord_A'); a.ansatteSignert = [{ id: 2, navn: 'TEST - Ansatt' }];
    const b = nyOrdre('ord_B', 'ikke_paabegynt'); S.ordrer = [a, b];
    const { db, kall } = lagDb({ oppdater_ordre_ansatt_signert: signert }); app.settDb(db);
    await sandbox.meldPaa('ord_B');
    expect(a.ansatteSignert.map((x) => x.id)).toEqual([2]);
    expect(b.ansatteSignert.map((x) => x.id)).toEqual([2]);
    expect(kall.filter((k) => k.navn === 'oppdater_ordre_ansatt_signert' && k.args.p_ordre_id === 'ord_A')).toEqual([]);
  });
  it('en gammel ordre med ÅPEN klokke meldes fortsatt av, uavhengig av fasen på den nye (uendret oppførsel: aldri to klokker samtidig)', async () => {
    const a = nyOrdre('ord_A'); a.ansatteSignert = [{ id: 2, navn: 'TEST - Ansatt' }]; a.ordreTimerSessions = [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }];
    const b = nyOrdre('ord_B', 'ikke_paabegynt'); S.ordrer = [a, b];
    const { db } = lagDb({ oppdater_ordre_ansatt_signert: signert, oppdater_ordre_timer_sesjon: () => ({ data: { sessions: [{ start: 1, stopp: 9, ansattId: 2 }] }, error: null }) }); app.settDb(db);
    await sandbox.meldPaa('ord_B');
    expect(a.ansatteSignert.map((x) => x.id)).toEqual([]);
  });
});

describe('gjenopptaMineOrdreKlokkerVedInnstempling: gir beskjed om alt lyktes, og selvhelIkkeStemplet bruker det', () => {
  const tabeller = (q) => {
    if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: null }, error: null };
    if (q.tabell === 'timer_entries' && q.select) return { data: [], error: null };
    return { data: null, error: null };
  };
  const startOk = () => ({ data: { sessions: [{ start: 1, stopp: null, ansattId: 2, ansatt: 'TEST - Ansatt' }] }, error: null });
  it('returverdi: true når alle starter, true når ingenting skal startes, false når en start avvises eller feiler', async () => {
    S.ordrer[0].ansatteSignert = [{ id: 2 }];
    let { db } = lagDb({ oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    expect(await sandbox.gjenopptaMineOrdreKlokkerVedInnstempling()).toBe(true);
    expect(await sandbox.gjenopptaMineOrdreKlokkerVedInnstempling()).toBe(true);            // nå har jeg en åpen økt: ingenting å starte
    S.ordrer[0].ordreTimerSessions = [];
    ({ db } = lagDb({ oppdater_ordre_timer_sesjon: ikkeStemplet })); app.settDb(db);
    expect(await sandbox.gjenopptaMineOrdreKlokkerVedInnstempling()).toBe(false);
    ({ db } = lagDb({ oppdater_ordre_timer_sesjon: () => ({ data: null, error: { message: 'Failed to fetch' } }) })); app.settDb(db);
    expect(await sandbox.gjenopptaMineOrdreKlokkerVedInnstempling()).toBe(false);
  });
  it('uten db eller innlogget: true (ingenting å gjøre)', async () => {
    expect(await sandbox.gjenopptaMineOrdreKlokkerVedInnstempling()).toBe(true);
  });
  it('stemplingen repareres, men starten av klokka feiler (nettfeil): jeg ER FORTSATT i beskjedlisten (jeg får beskjeden)', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000); S.ordrer[0].ansatteSignert = [{ id: 2 }];
    const { db } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: () => ({ data: null, error: { message: 'Failed to fetch' } }) }); app.settDb(db);
    expect(await sandbox.selvhelIkkeStemplet(['TEST - Ansatt', 'Ismail'])).toEqual(['TEST - Ansatt', 'Ismail']);
    expect(S.ordrer[0].ordreTimerSessions).toEqual([]);
  });
  it('og lykkes starten, er jeg ute av lista (uendret)', async () => {
    app.settTimerStart(Date.now() - 2 * 3600000); S.ordrer[0].ansatteSignert = [{ id: 2 }];
    const { db } = lagTabellDb(tabeller, { oppdater_ordre_timer_sesjon: startOk }); app.settDb(db);
    expect(await sandbox.selvhelIkkeStemplet(['TEST - Ansatt', 'Ismail'])).toEqual(['Ismail']);
  });
});

describe('gjenopptaMineEtterInnlasting: min egen stemplingstilstand i S.ansatte synkes etter reparasjon ved oppstart', () => {
  afterEach(() => { app.kjor('_gjenopptaNaarDataErLastet = false'); });
  it('stemplingen ble skrevet ved oppstart (me.stempletInnSiden), men innlastingen leste raden før skrivingen: raden i S.ansatte får stemplingen (så en senere admin-utstempling oppdages)', async () => {
    const iso = new Date(Date.now() - 2 * 3600000).toISOString();
    app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt', kanForeLonn: true, stempletInnSiden: iso });
    S.ansatte = [{ id: 2, navn: 'TEST - Ansatt', aktiv: true, stempletInnSiden: null }, { id: 3, navn: 'Kollega', aktiv: true, stempletInnSiden: null }];
    await sandbox.gjenopptaMineEtterInnlasting();
    expect(S.ansatte[0].stempletInnSiden).toBe(iso);
    expect(S.ansatte[1].stempletInnSiden).toBeNull();            // bare min egen rad
  });
  it('en verdi som allerede står i raden overskrives ikke', async () => {
    const nyere = new Date(Date.now() - 1 * 3600000).toISOString();
    app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt', kanForeLonn: true, stempletInnSiden: new Date(Date.now() - 2 * 3600000).toISOString() });
    S.ansatte = [{ id: 2, navn: 'TEST - Ansatt', aktiv: true, stempletInnSiden: nyere }];
    await sandbox.gjenopptaMineEtterInnlasting();
    expect(S.ansatte[0].stempletInnSiden).toBe(nyere);
  });
  it('har denne økta ikke skrevet noen stempling (me.stempletInnSiden mangler), røres raden ikke', async () => {
    app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt', kanForeLonn: true });
    S.ansatte = [{ id: 2, navn: 'TEST - Ansatt', aktiv: true, stempletInnSiden: null }];
    await sandbox.gjenopptaMineEtterInnlasting();
    expect(S.ansatte[0].stempletInnSiden).toBeNull();
  });
  it('ingen innlogget eller ingen rad: aldri kast', async () => {
    app.settMe(null); S.ansatte = [];
    await expect(sandbox.gjenopptaMineEtterInnlasting()).resolves.toBeUndefined();
    app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt', stempletInnSiden: 'x' });
    await expect(sandbox.gjenopptaMineEtterInnlasting()).resolves.toBeUndefined();
  });
});
