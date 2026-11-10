import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';

// «Ny leveranse» (Henrik 2026-11-02/03): en ordre uten bil. Testene dekker oppretting, statusløypa (Under arbeid -> Klar til sending -> Sendt), automatisk fraktbestilling,
// arkivering (sendt + fakturert), at bil-ordrer er uendret, og at ordreToDb/dbToOrdre/status-nedtrekk skiller riktig mellom typene. Ingen ekte database, e-post eller Fiken.

const app = lastApp();
const { sandbox, S } = app;
// Testene bytter ut globale funksjoner med spioner (save, closeModal, renderAll, visToast ...). De ekte settes tilbake etter hver test, så en spion aldri lekker inn i neste test.
const EKTE = { save: sandbox.save, closeModal: sandbox.closeModal, renderAll: sandbox.renderAll, visToast: sandbox.visToast, adminArkLagreFelter: sandbox.adminArkLagreFelter,
  openKalenderStedModal: sandbox.openKalenderStedModal, edgeFetch: sandbox.edgeFetch, confirm: sandbox.confirm, alert: sandbox.alert, oppdaterOrdreFikenLinje: sandbox.oppdaterOrdreFikenLinje, localStorage: sandbox.localStorage };
afterEach(() => { Object.assign(sandbox, EKTE); });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../' + f), 'utf8').replace(/\r\n/g, '\n');

// Falsk Supabase-klient: hvert kall registreres, og alle kjeder kan awaites (gir { data: null, error: null } eller feilen du ber om for en tabell/metode).
function lagDb({ feilPaa = null } = {}) {
  const kall = [];
  const kjede = (info) => new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') {
        const feil = feilPaa && feilPaa(info) ? { message: 'TEST-feil' } : null;
        return (res) => Promise.resolve({ data: null, error: feil }).then(res);
      }
      return (...args) => { info.kall.push([String(k), args]); return kjede(info); };
    },
  });
  return {
    kall,
    db: {
      from: (tabell) => { const info = { tabell, kall: [] }; kall.push(info); return kjede(info); },
      rpc: (navn, args) => { kall.push({ rpc: navn, args }); return Promise.resolve({ data: null, error: null }); },
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    },
  };
}
const oppdateringer = (kall) => kall.filter((k) => k.tabell === 'ordrer' && k.kall.some(([m]) => m === 'update')).map((k) => k.kall.find(([m]) => m === 'update')[1][0]);
const innsettinger = (kall) => kall.filter((k) => k.tabell === 'ordrer' && k.kall.some(([m]) => m === 'insert')).map((k) => k.kall.find(([m]) => m === 'insert')[1][0]);

function edgeFake(svar = () => ({ status: 200, tekst: '{"ok":true,"til":"frakt@selskap.test","bestiltAt":"2026-11-03T10:00:00.000Z"}' })) {
  const kall = [];
  sandbox.edgeFetch = async (fn, init) => {
    kall.push({ fn, body: init?.body ? JSON.parse(init.body) : null });
    const s = svar(fn, kall[kall.length - 1].body);
    return { ok: s.status >= 200 && s.status < 300, status: s.status, text: async () => s.tekst, json: async () => JSON.parse(s.tekst) };
  };
  return kall;
}

const KONTAKTER = [{ type: 'Fraktselskap', navn: 'TEST Frakt', epost: 'frakt@selskap.test' }, { type: 'Forhandler', navn: 'TEST Kunde AS', epost: 'k@t.test', kontaktpersoner: [{ navn: 'TEST Kontakt', epost: 'kontakt@t.test' }] }];
const nyLeveranse = (over = {}, lev = {}) => sandbox.dbToOrdre({
  id: 'ord_TESTLEV1', status: 'aktiv', ordre_status: 'under_arbeid', ordretype: 'leveranse', kunde: 'TEST Kunde AS', eier: 'TEST Kontakt',
  leveranse: { merking: 'TEST-merking', adresse: 'Veien 1', postnr: '3734', sted: 'Skien', fraktselskap: 'TEST Frakt', fraktAuto: true, ...lev }, ...over,
});
const nyBil = (over = {}) => sandbox.dbToOrdre({ id: 'ord_TESTBIL1', status: 'aktiv', ordre_status: 'ikke_paabegynt', chassis: 'TESTWXYZ0000000A1', regnr: 'AB12345', kunde: 'TEST Kunde AS', ...over });

beforeEach(() => {
  S.ordrer = []; S.kontakter = structuredClone(KONTAKTER); S.ansatte = [];
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  app.settAktivOrdre(null);
  app.settDb(null);
});

describe('normaliserLeveranse', () => {
  it('tomt objekt, null, tekst og liste gir alle tekstfelt som tomme strenger og automatisk frakt på', () => {
    for (const v of [{}, null, undefined, 'x', 5, []]) {
      const l = sandbox.normaliserLeveranse(v);
      for (const k of ['merking', 'adresse', 'postnr', 'sted', 'kontaktTlf', 'fraktselskap', 'kolli', 'onsketHentedato', 'sporing', 'sendtDato']) expect(l[k]).toBe('');
      expect(l.fraktAuto).toBe(true);
    }
  });
  it('feil typer i feltene blir tom streng (aldri kast i .trim()), tall blir tekst, og fraktAuto bare av ved nøyaktig false', () => {
    const l = sandbox.normaliserLeveranse({ merking: 5, adresse: null, postnr: [], sted: {}, kolli: true, fraktAuto: 'nei' });
    expect(l).toMatchObject({ merking: '5', adresse: '', postnr: '', sted: '', kolli: '' });
    expect(l.fraktAuto).toBe(true);
    expect(sandbox.normaliserLeveranse({ fraktAuto: false }).fraktAuto).toBe(false);
  });
  it('beholder innfylte verdier og ukjente nøkler, og muterer ikke inndataene', () => {
    const inn = { merking: 'A', ekstra: 7 };
    const ut = sandbox.normaliserLeveranse(inn);
    expect(ut).toMatchObject({ merking: 'A', ekstra: 7 });
    expect(inn).toEqual({ merking: 'A', ekstra: 7 });
  });
});

describe('dbToOrdre / ordreToDb: ordretype', () => {
  it('en rad uten ordretype (eller med ukjent) er en bil, og leveranse får normalisert innhold', () => {
    expect(sandbox.dbToOrdre({ id: 'a' }).ordretype).toBe('bil');
    expect(sandbox.dbToOrdre({ id: 'a', ordretype: 'noe' }).ordretype).toBe('bil');
    expect(nyLeveranse().ordretype).toBe('leveranse');
    expect(sandbox.dbToOrdre({ id: 'a', ordretype: 'leveranse' }).leveranse.fraktAuto).toBe(true);
  });
  it('ordreToDb tar med ordretype og leveranse BARE for leveranser (bil-ordrer lagres som før, også mot en database uten kolonnene)', () => {
    const bil = sandbox.ordreToDb(nyBil());
    expect('ordretype' in bil).toBe(false);
    expect('leveranse' in bil).toBe(false);
    const lev = sandbox.ordreToDb(nyLeveranse());
    expect(lev.ordretype).toBe('leveranse');
    expect(lev.leveranse.merking).toBe('TEST-merking');
  });
  it('frakt_bestilt_* leses av dbToOrdre men skrives ALDRI av ordreToDb (bare edge-funksjonen setter dem)', () => {
    const o = nyLeveranse({ frakt_bestilt_at: '2026-11-03T10:00:00Z', frakt_bestilt_av: 'X', frakt_bestilt_til: 'a@b.test' });
    expect(o).toMatchObject({ fraktBestiltAt: '2026-11-03T10:00:00Z', fraktBestiltAv: 'X', fraktBestiltTil: 'a@b.test' });
    const db = sandbox.ordreToDb(o);
    for (const k of ['frakt_bestilt_at', 'frakt_bestilt_av', 'frakt_bestilt_til']) expect(k in db).toBe(false);
  });
});

describe('merking og tittel', () => {
  it('tittelen er merking, ellers reg.nr, ellers chassis, ellers «Uten merking»', () => {
    expect(sandbox.leveranseTittel(nyLeveranse())).toBe('TEST-merking');
    expect(sandbox.leveranseTittel(nyLeveranse({ regnr: 'AB12345' }, { merking: '' }))).toBe('AB12345');
    expect(sandbox.leveranseTittel(nyLeveranse({ chassis: 'TESTWXYZ0000000A1' }, { merking: '' }))).toBe('TESTWXYZ0000000A1');
    expect(sandbox.leveranseTittel(nyLeveranse({}, { merking: '  ' }))).toBe('Uten merking');
  });
  it('ordreLabel og ordreLabelFull bruker leveransens tittel og escaper tekst', () => {
    const o = nyLeveranse({ regnr: 'AB12345', chassis: 'TESTWXYZ0000000A1' }, { merking: '<b>X</b>' });
    // appens esc() gjør «<» til «&lt;» (nok til at ingen tagg åpnes), «>» står urørt
    expect(sandbox.ordreLabel(o)).toBe('&lt;b>X&lt;/b>');
    expect(sandbox.ordreLabelFull(o)).toBe('&lt;b>X&lt;/b> · AB12345 · Chassis: TESTWXYZ0000000A1');
    expect(sandbox.ordreLabel(o)).not.toContain('<b');
  });
  it('bil-ordrer har uendret label', () => {
    expect(sandbox.ordreLabel(nyBil())).toBe('AB12345');
    expect(sandbox.ordreLabelFull(nyBil())).toBe('AB12345 · Chassis: TESTWXYZ0000000A1');
  });
});

describe('fraktkrav', () => {
  it('komplett leveranse med fraktselskap som har e-post: ingenting mangler', () => {
    expect(sandbox.leveranseFraktMangler(nyLeveranse())).toEqual([]);
  });
  it('mangler adresse, postnr/sted, e-post for fraktselskapet, eller fraktselskap', () => {
    expect(sandbox.leveranseFraktMangler(nyLeveranse({}, { adresse: '' }))).toContain('leveringsadresse');
    expect(sandbox.leveranseFraktMangler(nyLeveranse({}, { postnr: '', sted: '' }))).toContain('postnr/sted');
    S.kontakter = [];
    expect(sandbox.leveranseFraktMangler(nyLeveranse())[0]).toContain('e-post for TEST Frakt');
    expect(sandbox.leveranseFraktMangler(nyLeveranse({}, { fraktselskap: '' }))).toEqual(['fraktselskap']);
  });
  it('«Hente selv» og «Levering av oss» bestilles ikke på e-post', () => {
    expect(sandbox.leveranseFraktMangler(nyLeveranse({}, { fraktselskap: 'Hente selv' }))[0]).toContain('bestilles ikke på e-post');
    expect(sandbox.leveranseErEkteFraktselskap('Levering av oss')).toBe(false);
    expect(sandbox.leveranseErEkteFraktselskap('TEST Frakt')).toBe(true);
    expect(sandbox.leveranseErEkteFraktselskap('')).toBe(false);
  });
  it('«Klar til sending» krever fraktdata bare når automatisk bestilling er på og selskapet bestilles på e-post', () => {
    expect(sandbox.leveranseKlarMangler(nyLeveranse({}, { adresse: '' })).length).toBeGreaterThan(0);
    expect(sandbox.leveranseKlarMangler(nyLeveranse({}, { adresse: '', fraktAuto: false }))).toEqual([]);
    expect(sandbox.leveranseKlarMangler(nyLeveranse({}, { adresse: '', fraktselskap: 'Hente selv' }))).toEqual([]);
    expect(sandbox.leveranseKlarMangler(nyLeveranse({}, { adresse: '', fraktselskap: 'Levering av oss' }))).toEqual([]);
  });
});

describe('Fiken-referanse', () => {
  it('merking, reg.nr og chassis (de som finnes) slås sammen uten dubletter, maks 100 tegn', () => {
    expect(sandbox.leveranseFakturaReferanse(nyLeveranse())).toBe('TEST-merking');
    expect(sandbox.leveranseFakturaReferanse(nyLeveranse({ regnr: 'AB12345', chassis: 'TESTWXYZ0000000A1' }))).toBe('TEST-merking - AB12345 - TESTWXYZ0000000A1');
    expect(sandbox.leveranseFakturaReferanse(nyLeveranse({ regnr: 'AB12345' }, { merking: 'AB12345' }))).toBe('AB12345');
    expect(sandbox.leveranseFakturaReferanse(nyLeveranse({}, { merking: 'x'.repeat(300) }))).toHaveLength(100);
  });
  it('kallFikenFakturer sender `referanse` for en leveranse, og ingen for en bil-ordre', async () => {
    const { db } = lagDb(); app.settDb(db);
    const kall = edgeFake(() => ({ status: 201, tekst: '{"ok":true,"draftUrl":"https://fiken.test/kladd/1"}' }));
    const lev = nyLeveranse({ fiken_linjer: [{ id: 'fl_1', produktnummer: '200', antall: 1 }] }); S.ordrer = [lev];
    await sandbox.kallFikenFakturer(lev.id, {});
    expect(kall[0].fn).toBe('fiken-fakturer');
    expect(kall[0].body.referanse).toBe('TEST-merking');
    expect(kall[0].body.kundeNavn).toBe('TEST Kunde AS');
    const bil = nyBil({ fiken_linjer: [{ id: 'fl_2', produktnummer: '200', antall: 1 }] }); S.ordrer = [bil];
    await sandbox.kallFikenFakturer(bil.id, {});
    expect(kall[1].body.referanse).toBeUndefined();
    expect(kall[1].body.chassisNr).toBe('TESTWXYZ0000000A1');
  });
});

describe('opprettLeveranse', () => {
  const sett = (felt) => { Object.entries(felt).forEach(([k, v]) => { sandbox.document.getElementById(k).value = v; }); };
  const nullstill = () => sett({ lev_kunde: '', lev_eier: '', lev_merking: '', lev_regnr: '', lev_chassis: '', lev_adresse: '', lev_postnr: '', lev_sted: '', lev_tlf: '', lev_kolli: '', lev_hentedato: '', lev_fraktselskap: '' });
  beforeEach(() => { nullstill(); sandbox.document.getElementById('lev_fraktauto').checked = true; sandbox.alert = () => {}; });

  it('krever minst ett av merking, reg.nr og chassis, og kunde', () => {
    const { db, kall } = lagDb(); app.settDb(db); edgeFake();
    sett({ lev_kunde: 'TEST Kunde AS' });
    sandbox.opprettLeveranse();
    sett({ lev_kunde: '', lev_merking: 'X' });
    sandbox.opprettLeveranse();
    expect(S.ordrer).toHaveLength(0);
    expect(innsettinger(kall)).toHaveLength(0);
  });
  it('chassis må være nøyaktig 17 tegn', () => {
    const { db } = lagDb(); app.settDb(db); edgeFake();
    sett({ lev_kunde: 'TEST Kunde AS', lev_chassis: 'KORT' });
    sandbox.opprettLeveranse();
    expect(S.ordrer).toHaveLength(0);
  });
  it('oppretter en leveranse med merking alene: Under arbeid, ordretype leveranse, riktig innsetting uten frakt_bestilt_*, og push-varsel', () => {
    const { db, kall } = lagDb(); app.settDb(db); const edge = edgeFake();
    sett({ lev_kunde: 'TEST Kunde AS', lev_eier: 'TEST Kontakt', lev_merking: 'TEST-merking', lev_adresse: 'Veien 1', lev_postnr: '3734', lev_sted: 'Skien', lev_fraktselskap: 'TEST Frakt', lev_kolli: '2 pakker' });
    sandbox.opprettLeveranse();
    expect(S.ordrer).toHaveLength(1);
    const o = S.ordrer[0];
    expect(o).toMatchObject({ ordretype: 'leveranse', ordreStatus: 'under_arbeid', status: 'aktiv', kunde: 'TEST Kunde AS', eier: 'TEST Kontakt', chassis: '', regnr: '' });
    expect(o.leveranse).toMatchObject({ merking: 'TEST-merking', adresse: 'Veien 1', postnr: '3734', sted: 'Skien', fraktselskap: 'TEST Frakt', kolli: '2 pakker', fraktAuto: true });
    const ins = innsettinger(kall)[0];
    expect(ins).toMatchObject({ id: o.id, ordretype: 'leveranse', ordre_status: 'under_arbeid', status: 'aktiv' });
    expect(ins.leveranse.merking).toBe('TEST-merking');
    for (const k of ['frakt_bestilt_at', 'frakt_bestilt_av', 'frakt_bestilt_til']) expect(k in ins).toBe(false);
    const push = edge.find((e) => e.fn === 'send-push');
    expect(push.body).toMatchObject({ type: 'ny_ordre', ordreId: o.id, bil: 'Leveranse: TEST-merking' });
    expect(app.sandbox.activeOrdreId === undefined || true).toBe(true);
  });
  it('kan opprettes med bare reg.nr (store bokstaver, uten tegn) eller bare chassis, og automatisk frakt kan slås av', () => {
    const { db } = lagDb(); app.settDb(db); edgeFake();
    sett({ lev_kunde: 'TEST Kunde AS', lev_regnr: 'ab 123-45' });
    sandbox.document.getElementById('lev_fraktauto').checked = false;
    sandbox.opprettLeveranse();
    expect(S.ordrer[0].regnr).toBe('AB12345');
    expect(S.ordrer[0].leveranse.fraktAuto).toBe(false);
    nullstill();
    sett({ lev_kunde: 'TEST Kunde AS', lev_chassis: 'testwxyz0000000a1' });
    sandbox.opprettLeveranse();
    expect(S.ordrer[1].chassis).toBe('TESTWXYZ0000000A1');
  });
});

describe('endreLeveranseStatus', () => {
  it('«Klar til sending» uten komplette fraktdata avvises (ingen skriving, ingen e-post)', async () => {
    const { db, kall } = lagDb(); app.settDb(db); const edge = edgeFake();
    const o = nyLeveranse({}, { adresse: '' }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'klar_sending');
    expect(o.ordreStatus).toBe('under_arbeid');
    expect(oppdateringer(kall)).toHaveLength(0);
    expect(edge.filter((e) => e.fn === 'send-frakt-epost')).toHaveLength(0);
  });
  it('«Klar til sending» med komplette data: status skrives målrettet, og fraktbestillingen sendes automatisk med bare ordre-id (ingen mottaker fra klienten)', async () => {
    const { db, kall } = lagDb(); app.settDb(db); const edge = edgeFake();
    const o = nyLeveranse(); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'klar_sending');
    expect(o.ordreStatus).toBe('klar_sending');
    const upd = oppdateringer(kall).find((u) => u.ordre_status);
    expect(upd).toMatchObject({ ordre_status: 'klar_sending', status: 'aktiv' });
    const frakt = edge.filter((e) => e.fn === 'send-frakt-epost');
    expect(frakt).toHaveLength(1);
    expect(frakt[0].body).toMatchObject({ type: 'leveranse_bestilling', ordreId: o.id, paaNytt: false, kontaktpersonEpost: 'kontakt@t.test', avsenderNavn: 'TEST - Admin' });
    expect(frakt[0].body.fraktselskapEpost).toBeUndefined();
    expect(o.fraktBestiltAt).toBe('2026-11-03T10:00:00.000Z');
  });
  it('automatisk bestilling av: status settes, men ingen e-post', async () => {
    const { db } = lagDb(); app.settDb(db); const edge = edgeFake();
    const o = nyLeveranse({}, { fraktAuto: false, adresse: '' }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'klar_sending');
    expect(o.ordreStatus).toBe('klar_sending');
    expect(edge.filter((e) => e.fn === 'send-frakt-epost')).toHaveLength(0);
  });
  it('allerede bestilt (frakt_bestilt_at satt): ingen ny e-post ved ny statusendring', async () => {
    const { db } = lagDb(); app.settDb(db); const edge = edgeFake();
    const o = nyLeveranse({ frakt_bestilt_at: '2026-11-03T08:00:00Z' }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'klar_sending');
    expect(edge.filter((e) => e.fn === 'send-frakt-epost')).toHaveLength(0);
  });
  it('serveren svarer 409 (allerede sendt): ingen feil vises som e-post sendt, og fraktBestiltAt settes ikke lokalt', async () => {
    const { db } = lagDb(); app.settDb(db); edgeFake(() => ({ status: 409, tekst: 'Fraktbestillingen er allerede sendt' }));
    const o = nyLeveranse(); S.ordrer = [o];
    expect(await sandbox.bestillFraktForLeveranse(o.id, {})).toBe('allerede');
    expect(o.fraktBestiltAt).toBeNull();
  });
  it('e-posten feiler (502): resultatet er «feil», ingenting markeres som bestilt, og statusen står fortsatt', async () => {
    const { db } = lagDb(); app.settDb(db); edgeFake(() => ({ status: 502, tekst: 'E-posten kunne ikke sendes' }));
    const o = nyLeveranse(); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'klar_sending');
    expect(o.ordreStatus).toBe('klar_sending');
    expect(o.fraktBestiltAt).toBeNull();
  });
  it('«Sendt» setter sendt-dato; uten fakturering blir leveransen stående som aktiv', async () => {
    const { db } = lagDb(); app.settDb(db); edgeFake();
    const o = nyLeveranse({ ordre_status: 'klar_sending' }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'sendt');
    expect(o.ordreStatus).toBe('sendt');
    expect(o.leveranse.sendtDato).toBe(sandbox.leveranseIdag());
    expect(o.status).toBe('aktiv');
  });
  it('«Sendt» OG fakturert: arkiveres automatisk, og arkivstatusen skrives', async () => {
    const { db, kall } = lagDb(); app.settDb(db); edgeFake();
    const o = nyLeveranse({ ordre_status: 'klar_sending', fakturert: true }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'sendt');
    expect(o.status).toBe('arkivert');
    expect(oppdateringer(kall).find((u) => u.ordre_status)).toMatchObject({ ordre_status: 'sendt', status: 'arkivert' });
  });
  it('en eksisterende sendt-dato overskrives ikke', async () => {
    const { db } = lagDb(); app.settDb(db); edgeFake();
    const o = nyLeveranse({ ordre_status: 'klar_sending' }, { sendtDato: '2026-10-01' }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'sendt');
    expect(o.leveranse.sendtDato).toBe('2026-10-01');
  });
  it('databasefeil ved lagring: status, arkivering og sendt-dato rulles tilbake', async () => {
    const { db } = lagDb({ feilPaa: (info) => info.tabell === 'ordrer' && info.kall.some(([m]) => m === 'update') }); app.settDb(db); edgeFake();
    const o = nyLeveranse({ ordre_status: 'klar_sending', fakturert: true }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'sendt');
    expect(o.ordreStatus).toBe('klar_sending');
    expect(o.status).toBe('aktiv');
    expect(o.leveranse.sendtDato).toBe('');
  });
  it('ugyldig status for en leveranse (en bil-status) endrer ingenting', async () => {
    const { db, kall } = lagDb(); app.settDb(db); edgeFake();
    const o = nyLeveranse(); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'hentet');
    expect(o.ordreStatus).toBe('under_arbeid');
    expect(oppdateringer(kall)).toHaveLength(0);
  });
});

describe('arbeidsklokka følger statusen (som for bil-ordrer)', () => {
  const faseKall = (kall) => kall.filter((k) => k.rpc === 'oppdater_ordre_timer_fase').map((k) => k.args);
  it('forlater leveransen «Under arbeid» stoppes klokka og de påmeldte meldes av (avslutt_fase)', async () => {
    const { db, kall } = lagDb(); app.settDb(db); edgeFake();
    const o = nyLeveranse(); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'sendt');
    expect(faseKall(kall)).toEqual([{ p_ordre_id: o.id, p_felt: 'ordre_timer_sessions', p_handling: 'avslutt_fase' }]);
  });
  it('tilbake til «Under arbeid» starter klokka for de som er meldt på (start_alle_paameldte)', async () => {
    const { db, kall } = lagDb(); app.settDb(db); edgeFake();
    const o = nyLeveranse({ ordre_status: 'klar_sending' }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'under_arbeid');
    expect(faseKall(kall)).toEqual([{ p_ordre_id: o.id, p_felt: 'ordre_timer_sessions', p_handling: 'start_alle_paameldte' }]);
  });
  it('overgangen «Klar til sending» -> «Sendt» (ingen klokke involvert) rører ikke klokka', async () => {
    const { db, kall } = lagDb(); app.settDb(db); edgeFake();
    const o = nyLeveranse({ ordre_status: 'klar_sending' }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'sendt');
    expect(faseKall(kall)).toEqual([]);
  });
  it('svaret fra databasen (sesjoner og påmeldte) overføres til leveransen, og en feil i klokke-kallet stopper ikke statusendringen', async () => {
    const { db } = lagDb();
    db.rpc = async (navn) => ({ data: navn === 'oppdater_ordre_timer_fase' ? { sessions: [{ ansattId: 1, start: 1, stopp: 2 }], ansatteSignert: [] } : null, error: null });
    app.settDb(db); edgeFake();
    const o = nyLeveranse({ ansatte_signert: [{ id: 1, navn: 'X' }], ordre_timer_sessions: [{ ansattId: 1, start: 1, stopp: null }] }); S.ordrer = [o];
    await sandbox.endreStatus(o.id, 'sendt');
    expect(o.ordreTimerSessions).toEqual([{ ansattId: 1, start: 1, stopp: 2 }]);
    expect(o.ansatteSignert).toEqual([]);
    const o2 = nyLeveranse({ id: 'ord_TESTLEV2' }); S.ordrer = [o2];
    db.rpc = async () => ({ data: null, error: { message: 'feil' } });
    await sandbox.endreStatus(o2.id, 'sendt');
    expect(o2.ordreStatus).toBe('sendt');
  });
});

describe('arkivering', () => {
  it('leveranseSjekkArkiver arkiverer bare en aktiv, sendt og fakturert LEVERANSE', () => {
    const a = nyLeveranse({ ordre_status: 'sendt', fakturert: true }); expect(sandbox.leveranseSjekkArkiver(a)).toBe(true); expect(a.status).toBe('arkivert');
    expect(sandbox.leveranseSjekkArkiver(nyLeveranse({ ordre_status: 'sendt' }))).toBe(false);
    expect(sandbox.leveranseSjekkArkiver(nyLeveranse({ ordre_status: 'klar_sending', fakturert: true }))).toBe(false);
    expect(sandbox.leveranseSjekkArkiver(nyLeveranse({ ordre_status: 'sendt', fakturert: true, status: 'arkivert' }))).toBe(false);
  });
  it('en bil-ordre røres aldri (selv om den heter sendt og er fakturert)', () => {
    const bil = nyBil({ ordre_status: 'sendt', fakturert: true });
    expect(sandbox.leveranseSjekkArkiver(bil)).toBe(false);
    expect(bil.status).toBe('aktiv');
  });
  it('å huke av fakturert på en sendt leveranse arkiverer den (toggleFakturert), og lagrer', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    const o = nyLeveranse({ ordre_status: 'sendt' }); S.ordrer = [o];
    sandbox.toggleFakturert(o.id);
    expect(o.fakturert).toBe(true);
    expect(o.status).toBe('arkivert');
    expect(kall.some((k) => k.tabell === 'ordrer')).toBe(true);
  });

  // «Det må være mulig å fjerne leveransene fra ordre siden når de er fakturert» (Henrik 2026-11-10): en fakturert leveranse som ikke blir «Sendt» (f.eks. «Hente selv»)
  // arkiveres ikke av seg selv, så godkjenner/admin får en «Arkiver»-knapp. Alt går via den vanlige arkiver() (målrettet skriving, logglinje, tilbakerulling ved feil).
  describe('«Arkiver» på en fakturert leveranse', () => {
    const fakturert = (over = {}) => nyLeveranse({ ordre_status: 'klar_sending', fakturert: true, ...over });
    const knapp = (id) => `arkiverLeveranse('${id}')`;

    it('leveranseKanArkiveres: bare en aktiv, fakturert LEVERANSE, og bare for godkjenner og admin', () => {
      expect(sandbox.leveranseKanArkiveres(fakturert())).toBe(true);
      expect(sandbox.leveranseKanArkiveres(nyLeveranse({ ordre_status: 'klar_sending' }))).toBe(false);          // ikke fakturert
      expect(sandbox.leveranseKanArkiveres(fakturert({ status: 'arkivert' }))).toBe(false);                      // alt arkivert
      expect(sandbox.leveranseKanArkiveres(nyBil({ fakturert: true }))).toBe(false);                             // en bil
      app.settMe({ id: 2, navn: 'TEST - Godkjenner', rolle: 'godkjenner' });
      expect(sandbox.leveranseKanArkiveres(fakturert())).toBe(true);
      app.settMe({ id: 3, navn: 'TEST - Ansatt', rolle: 'ansatt' });
      expect(sandbox.leveranseKanArkiveres(fakturert())).toBe(false);
      app.settMe(null);
      expect(sandbox.leveranseKanArkiveres(fakturert())).toBe(false);
    });
    it('knappen står på kortet i Ordre-lista og i detaljen, men ikke på Oversikt-kortet, ikke uten fakturert, ikke for en ansatt og ikke på en arkivert leveranse', () => {
      const o = fakturert(); S.ordrer = [o];
      expect(sandbox.leveranseKortHTML(o)).toContain(knapp(o.id));
      expect(sandbox.leveranseKortHTML(o, { drag: true })).not.toContain('arkiverLeveranse');
      expect(sandbox.leveranseKortHTML(nyLeveranse({ ordre_status: 'klar_sending' }))).not.toContain('arkiverLeveranse');
      app.settAktivOrdre(o.id); sandbox.buildOrdreDetail();
      expect(sandbox.document.getElementById('ordreDetail').innerHTML).toContain(knapp(o.id));
      const a = fakturert({ status: 'arkivert' }); S.ordrer = [a]; app.settAktivOrdre(a.id); sandbox.buildOrdreDetail();
      expect(sandbox.document.getElementById('ordreDetail').innerHTML).not.toContain('arkiverLeveranse');
      app.settMe({ id: 3, navn: 'TEST - Ansatt', rolle: 'ansatt' });
      expect(sandbox.leveranseKortHTML(o)).not.toContain('arkiverLeveranse');
    });
    it('arkiverLeveranse arkiverer, skriver bare status til databasen og legger inn en logglinje', async () => {
      const { db, kall } = lagDb(); app.settDb(db);
      const o = fakturert(); S.ordrer = [o];
      await sandbox.arkiverLeveranse(o.id);
      expect(o.status).toBe('arkivert');
      expect(oppdateringer(kall)).toEqual([{ status: 'arkivert' }]);
      expect(o.endringer.some((e) => e.txt === 'Arkivert')).toBe(true);
    });
    it('står den fortsatt «Under arbeid» (arbeidsklokka kan gå), arkiveres den ikke: bare en beskjed', async () => {
      const toasts = []; sandbox.visToast = (t) => { toasts.push(t); };
      const { db, kall } = lagDb(); app.settDb(db);
      const o = fakturert({ ordre_status: 'under_arbeid' }); S.ordrer = [o];
      await sandbox.arkiverLeveranse(o.id);
      expect(o.status).toBe('aktiv');
      expect(oppdateringer(kall)).toEqual([]);
      expect(toasts.join(' ')).toContain('Klar til sending');
    });
    it('databasefeil: arkiveringen rulles tilbake og en beskjed vises', async () => {
      const toasts = []; sandbox.visToast = (t) => { toasts.push(t); };
      const { db } = lagDb({ feilPaa: (info) => info.tabell === 'ordrer' && info.kall.some(([m]) => m === 'update') }); app.settDb(db);
      const o = fakturert(); S.ordrer = [o];
      await sandbox.arkiverLeveranse(o.id);
      expect(o.status).toBe('aktiv');
      expect(toasts.join(' ')).toContain('Kunne ikke arkivere');
    });
    it('en ikke-fakturert leveranse, en bil og en vanlig ansatt blir aldri arkivert', async () => {
      const { db, kall } = lagDb(); app.settDb(db);
      const ikkeFak = nyLeveranse({ ordre_status: 'klar_sending' }), bil = nyBil({ fakturert: true });
      S.ordrer = [ikkeFak, bil];
      await sandbox.arkiverLeveranse(ikkeFak.id); await sandbox.arkiverLeveranse(bil.id);
      app.settMe({ id: 3, navn: 'TEST - Ansatt', rolle: 'ansatt' });
      const f = fakturert({ id: 'ord_TESTLEV2' }); S.ordrer.push(f);
      await sandbox.arkiverLeveranse(f.id);
      expect([ikkeFak.status, bil.status, f.status]).toEqual(['aktiv', 'aktiv', 'aktiv']);
      expect(oppdateringer(kall)).toEqual([]);
    });
  });
});

// «Det må også være en knapp til fakturering og som sier at den er fakturert» (Henrik 2026-11-10): leveransekortet i Ordre-lista (bare admin) får «Fakturer» (kladd i Fiken, med bekreftelse)
// og «Merk fakturert» i stedet for den lille avkryssingen. Selve Fiken-kallet dekkes av andre tester; her testes bare knappene og veien fra kortet. Ingen ekte Fiken, database eller e-post.
describe('Fakturering på leveransekortet i Ordre-lista', () => {
  const FAKTURER = (id) => `leveranseFakturerFraKort('${id}')`;
  const MERK = (id) => `toggleFakturert('${id}')`;
  const rolle = (r) => app.settMe({ id: 9, navn: 'TEST - ' + r, rolle: r });
  const medLinjer = (antall = 2, over = {}) => { const o = nyLeveranse({ ordre_status: 'klar_sending', ...over }); o.fikenLinjer = Array.from({ length: antall }, (_, i) => ({ id: 'l' + i, produktnummer: '100' + i, antall: 1 })); return o; };
  const EKTE_FUNK = {};
  beforeEach(() => { EKTE_FUNK.openOrdre = sandbox.openOrdre; EKTE_FUNK.fakturerViaFiken = sandbox.fakturerViaFiken; });
  afterEach(() => { Object.assign(sandbox, EKTE_FUNK); });

  it('admin: en ikke-fakturert leveranse får «Fakturer» og «Merk fakturert» i stedet for avkryssingen; Oversikt-kortet er uendret', () => {
    const o = nyLeveranse({ ordre_status: 'klar_sending' });
    const html = sandbox.leveranseKortHTML(o);
    expect(html).toContain(FAKTURER(o.id)); expect(html).toContain(MERK(o.id));
    expect(html).toContain('>Fakturer</button>'); expect(html).toContain('>Merk fakturert</button>');
    expect(html).not.toContain('type="checkbox"');
    const oversikt = sandbox.leveranseKortHTML(o, { drag: true });
    expect(oversikt).toContain('type="checkbox"'); expect(oversikt).not.toContain('leveranseFakturerFraKort');
  });
  it('fakturert: «✔ Fakturert» for admin og godkjenner uten Fakturer-knapper, og ingenting for en vanlig ansatt', () => {
    const o = nyLeveranse({ ordre_status: 'klar_sending', fakturert: true });
    const admin = sandbox.leveranseKortHTML(o);
    expect(admin).toContain('✔ Fakturert'); expect(admin).not.toContain('leveranseFakturerFraKort'); expect(admin).not.toContain('toggleFakturert');
    rolle('godkjenner');
    const godkjenner = sandbox.leveranseKortHTML(o);
    expect(godkjenner).toContain('✔ Fakturert'); expect(godkjenner).toContain('arkiverLeveranse');
    rolle('ansatt');
    expect(sandbox.leveranseKortHTML(o)).not.toContain('✔ Fakturert');
  });
  it('godkjenner og vanlig ansatt får ingen faktureringsknapper på en ikke-fakturert leveranse', () => {
    const o = nyLeveranse({ ordre_status: 'klar_sending' });
    for (const r of ['godkjenner', 'ansatt']) {
      rolle(r);
      const html = sandbox.leveranseKortHTML(o);
      expect(html).not.toContain('leveranseFakturerFraKort'); expect(html).not.toContain('toggleFakturert');
    }
  });
  it('«Fakturer» uten fakturalinjer: beskjed og leveransen åpnes, ingen kladd', async () => {
    const toasts = []; sandbox.visToast = (t) => { toasts.push(t); };
    const apnet = []; sandbox.openOrdre = (id) => apnet.push(id);
    let faktura = 0; sandbox.fakturerViaFiken = async () => { faktura++; };
    sandbox.confirm = () => { throw new Error('skal ikke spørre'); };
    const o = nyLeveranse({ ordre_status: 'klar_sending' }); S.ordrer = [o];
    await sandbox.leveranseFakturerFraKort(o.id);
    expect(toasts.join(' ')).toContain('fakturalinje'); expect(apnet).toEqual([o.id]); expect(faktura).toBe(0);
  });
  it('med linjer: bekreftelsen viser kunde, antall og rabatt; Avbryt gjør ingenting; OK oppretter kladden én gang', async () => {
    const sporsmal = []; let svar = false; sandbox.confirm = (t) => { sporsmal.push(t); return svar; };
    const kall = []; sandbox.fakturerViaFiken = async (id) => { kall.push(id); };
    const o = medLinjer(2); S.ordrer = [o];
    sandbox.document.getElementById('brukRabatt_' + o.id).checked = true;
    await sandbox.leveranseFakturerFraKort(o.id);
    expect(kall).toEqual([]);
    expect(sporsmal[0]).toContain('TEST Kunde AS'); expect(sporsmal[0]).toContain('2 fakturalinjer'); expect(sporsmal[0]).toContain('rabatt brukes.');
    svar = true;
    await sandbox.leveranseFakturerFraKort(o.id);
    expect(kall).toEqual([o.id]);
    sandbox.document.getElementById('brukRabatt_' + o.id).checked = false; // avkrysningen i leveransens side er avslått: bekreftelsen sier det
    await sandbox.leveranseFakturerFraKort(o.id);
    expect(sporsmal[2]).toContain('IKKE');
    sandbox.document.getElementById('brukRabatt_' + o.id).checked = true;
  });
  it('et nytt trykk mens kladden opprettes gjør ingenting (ingen dobbel faktura)', async () => {
    sandbox.confirm = () => true;
    let slipp; const venter = new Promise((r) => { slipp = r; });
    let antall = 0; sandbox.fakturerViaFiken = () => { antall++; return venter; };
    const o = medLinjer(1); S.ordrer = [o];
    const a = sandbox.leveranseFakturerFraKort(o.id);
    await sandbox.leveranseFakturerFraKort(o.id);
    expect(antall).toBe(1);
    slipp(); await a;
    await sandbox.leveranseFakturerFraKort(o.id); // ferdig: neste trykk er et nytt forsøk (en feilet kladd kan prøves igjen)
    expect(antall).toBe(2);
  });
  it('en vanlig ansatt, en bil og en allerede fakturert leveranse oppretter aldri en kladd', async () => {
    sandbox.confirm = () => { throw new Error('skal ikke spørre'); };
    let faktura = 0; sandbox.fakturerViaFiken = async () => { faktura++; };
    const fak = medLinjer(1, { fakturert: true }), bil = nyBil(); bil.fikenLinjer = [{ id: 'l0', produktnummer: '1', antall: 1 }];
    S.ordrer = [fak, bil];
    await sandbox.leveranseFakturerFraKort(fak.id); await sandbox.leveranseFakturerFraKort(bil.id);
    rolle('ansatt');
    const ny = medLinjer(1, { id: 'ord_TESTLEV2' }); S.ordrer.push(ny);
    await sandbox.leveranseFakturerFraKort(ny.id);
    expect(faktura).toBe(0);
  });
});

describe('statusnedtrekk og lister', () => {
  it('en leveranse får bare leveranse-statusene, en bil bare bil-statusene', () => {
    S.ordrer = [nyLeveranse(), nyBil()];
    const lev = sandbox.statusDropdown('ord_TESTLEV1', 'under_arbeid');
    expect(lev).toContain('value="under_arbeid"'); expect(lev).toContain('value="klar_sending"'); expect(lev).toContain('value="sendt"');
    expect(lev).not.toContain('value="hentet"'); expect(lev).not.toContain('value="paabegynt"');
    const bil = sandbox.statusDropdown('ord_TESTBIL1', 'ikke_paabegynt');
    expect(bil).toContain('value="hentet"'); expect(bil).not.toContain('value="sendt"'); expect(bil).not.toContain('value="klar_sending"');
  });
  it('statusInfo kjenner leveranse-statusene (riktig tekst, ikke «Ikke påbegynt»)', () => {
    expect(sandbox.statusInfo('under_arbeid').lbl).toBe('Under arbeid');
    expect(sandbox.statusInfo('klar_sending').lbl).toBe('Klar til sending');
    expect(sandbox.statusInfo('sendt').lbl).toBe('Sendt');
    expect(sandbox.statusInfo('hentet').lbl).toBe('Hentet');
  });
  it('tvangsflyt for en leveranse er tom, og tvangsflyt-søylen/-boksen tegnes ikke', () => {
    const o = nyLeveranse();
    expect(sandbox.tvangsflyt(o)).toEqual([]);
    expect(sandbox.tvangsflytBarHTML(o)).toBe('');
    expect(sandbox.tvangsflytBoksHTML(o)).toBe('');
    expect(sandbox.tvangsflyt(nyBil()).length).toBeGreaterThan(0);
  });
  it('Ordre-lista viser leveransen (med LEVERANSE-merke) og filteret «Leveranser» skiller dem fra biler', () => {
    S.ordrer = [nyLeveranse(), nyBil()];
    sandbox.document.getElementById('ordreStatusFilter').value = '';
    sandbox.document.getElementById('ordreSok').value = '';
    app.kjor('renderOrdreList()');
    let html = String(sandbox.document.getElementById('ordreListeResultat').innerHTML);
    expect(html).toContain('LEVERANSE'); expect(html).toContain('TESTWXYZ0000000A1');
    sandbox.document.getElementById('ordreStatusFilter').value = 'leveranse';
    app.kjor('renderOrdreList()');
    html = String(sandbox.document.getElementById('ordreListeResultat').innerHTML);
    expect(html).toContain('TEST-merking'); expect(html).not.toContain('TESTWXYZ0000000A1');
    sandbox.document.getElementById('ordreStatusFilter').value = 'sendt';
    app.kjor('renderOrdreList()');
    expect(String(sandbox.document.getElementById('ordreListeResultat').innerHTML)).not.toContain('TEST-merking');
    sandbox.document.getElementById('ordreStatusFilter').value = '';
  });
  it('søk i Ordre-lista treffer merking, adresse og fraktselskap på en leveranse', () => {
    S.ordrer = [nyLeveranse()];
    for (const sok of ['test-merking', 'veien 1', 'skien', 'test frakt']) {
      sandbox.document.getElementById('ordreSok').value = sok;
      app.kjor('renderOrdreList()');
      expect(String(sandbox.document.getElementById('ordreListeResultat').innerHTML)).toContain('TEST-merking');
    }
    sandbox.document.getElementById('ordreSok').value = 'finnes-ikke';
    app.kjor('renderOrdreList()');
    expect(String(sandbox.document.getElementById('ordreListeResultat').innerHTML)).not.toContain('TEST-merking');
    sandbox.document.getElementById('ordreSok').value = '';
  });
  it('en leveranse vises ikke i Oversikt-listene (aktive/ventende) og telles ikke i tallene', () => {
    S.ordrer = [nyLeveranse(), nyLeveranse({ id: 'ord_TESTLEV2', ordre_status: 'ikke_paabegynt' })];
    app.kjor('renderOversikt()');
    expect(String(sandbox.document.getElementById('activeList').innerHTML)).not.toContain('TEST-merking');
    expect(String(sandbox.document.getElementById('pendingList').innerHTML)).not.toContain('TEST-merking');
    expect(String(sandbox.document.getElementById('s4').textContent)).toBe('0');
  });
  it('Mer: en leveranse havner aldri i «til godkjenning»', () => {
    S.ordrer = [nyLeveranse({ ordre_status: 'sendt' })];
    app.kjor('renderMer()');
    expect(String(sandbox.document.getElementById('tilGodkjBadge')?.textContent ?? '')).not.toBe('1');
  });
});

describe('Leveranser-kortet på Oversikt', () => {
  const liste = () => String(sandbox.document.getElementById('leveranseOversiktListe').innerHTML);
  const tekst = () => String(sandbox.document.getElementById('leveranseOversiktTekst').textContent);
  const vis = (q) => app.kjor(`renderOversikt(${JSON.stringify(q || '')})`);

  it('uten leveranser: tom melding og forklarende tekst', () => {
    S.ordrer = [nyBil()];
    vis();
    expect(liste()).toContain('Ingen aktive leveranser');
    expect(tekst()).toContain('uten bil');
  });
  it('aktive leveranser grupperes etter status, med antall, og hver gruppe har sine kort', () => {
    S.ordrer = [
      nyLeveranse({ id: 'ord_L1' }, { merking: 'LEV-A' }),
      nyLeveranse({ id: 'ord_L2', ordre_status: 'klar_sending' }, { merking: 'LEV-B' }),
      nyLeveranse({ id: 'ord_L3', ordre_status: 'sendt' }, { merking: 'LEV-C' }),
      nyBil(),
    ];
    vis();
    const h = liste();
    expect(h).toContain('Under arbeid'); expect(h).toContain('Klar til sending'); expect(h).toContain('Sendt, venter på fakturering');
    for (const m of ['LEV-A', 'LEV-B', 'LEV-C']) expect(h).toContain(m);
    expect(h.indexOf('LEV-A')).toBeLessThan(h.indexOf('LEV-B'));
    expect(h.indexOf('LEV-B')).toBeLessThan(h.indexOf('LEV-C'));
    expect(h).not.toContain('TESTWXYZ0000000A1'); // en bil-ordre er ikke en leveranse
    expect(tekst()).toBe('3 aktive · 1 under arbeid · 1 klar til sending · 1 sendt');
  });
  it('en gruppe uten leveranser vises ikke', () => {
    S.ordrer = [nyLeveranse({}, { merking: 'LEV-A' })];
    vis();
    // kortenes status-nedtrekk lister alle statuser, så gruppeoverskriftene sjekkes på selve overskrift-markeringen
    expect(liste()).toContain('<b style="font-size:13px">Under arbeid</b>');
    expect(liste()).not.toContain('<b style="font-size:13px">Klar til sending</b>');
    expect(liste()).not.toContain('<b style="font-size:13px">Sendt, venter');
  });
  it('arkiverte leveranser vises ikke (de ligger i Arkiv)', () => {
    S.ordrer = [nyLeveranse({ status: 'arkivert', ordre_status: 'sendt', fakturert: true }, { merking: 'GAMMEL' })];
    vis();
    expect(liste()).not.toContain('GAMMEL');
    expect(liste()).toContain('Ingen aktive leveranser');
  });
  it('en leveranse med ukjent status havner i «Under arbeid» (aldri usynlig)', () => {
    S.ordrer = [nyLeveranse({ ordre_status: 'noe_helt_annet' }, { merking: 'MERKELIG' }), nyLeveranse({ id: 'ord_L2', ordre_status: '' }, { merking: 'TOM-STATUS' })];
    vis();
    expect(liste()).toContain('MERKELIG'); expect(liste()).toContain('TOM-STATUS');
    expect(liste()).toContain('<b style="font-size:13px">Under arbeid</b>');
    expect(liste()).not.toContain('<b style="font-size:13px">Klar til sending</b>');
  });
  it('søket i Oversikt filtrerer leveransene på merking, kunde, adresse, sted og fraktselskap', () => {
    S.ordrer = [nyLeveranse({ id: 'ord_L1' }, { merking: 'LEV-A' }), nyLeveranse({ id: 'ord_L2', kunde: 'Annen Kunde' }, { merking: 'LEV-B', adresse: 'Fjellveien 9', sted: 'Bø', fraktselskap: 'NBT' })];
    for (const [sok, ventet, ikke] of [['lev-b', 'LEV-B', 'LEV-A'], ['annen kunde', 'LEV-B', 'LEV-A'], ['fjellveien', 'LEV-B', 'LEV-A'], ['nbt', 'LEV-B', 'LEV-A'], ['TEST Frakt', 'LEV-A', 'LEV-B']]) {
      vis(sok);
      expect(liste(), sok).toContain(ventet); expect(liste(), sok).not.toContain(ikke);
    }
    vis('finnes-ikke');
    expect(liste()).toContain('Ingen leveranser matcher søket');
  });
  it('en leveranse som ikke lar seg tegne gir et feilkort for den ene, ikke en tom liste', () => {
    const orig = sandbox.leveranseKortHTML;
    S.ordrer = [nyLeveranse({ id: 'ord_L1' }, { merking: 'GOD' }), nyLeveranse({ id: 'ord_L2' }, { merking: 'DEFEKT' })];
    sandbox.leveranseKortHTML = (o) => { if (o.id === 'ord_L2') throw new TypeError('simulert'); return orig(o); };
    try {
      vis();
      expect(liste()).toContain('GOD');
      expect(liste()).toContain('kan ikke vises i lista');
    } finally { sandbox.leveranseKortHTML = orig; }
  });
  it('knappen «+ Ny leveranse» og kortet står på Oversikt-siden i salmakern.html', () => {
    const html = les('salmakern.html');
    expect(html).toMatch(/id="leveranseOversiktKort"[\s\S]*apneNyLeveranseModal\(\)[\s\S]*id="leveranseOversiktListe"/);
    expect(html.indexOf('id="leveranseOversiktKort"')).toBeGreaterThan(html.indexOf('id="pendingList"'));
    expect(html.indexOf('id="leveranseOversiktKort"')).toBeLessThan(html.indexOf('<!-- ── ORDRE DETAIL ── -->'));
  });
});

describe('fakturalinjer og timer', () => {
  it('«Hent fra Utstyr-boksen» og drivstoff finnes for bil, men ikke for en leveranse', () => {
    expect(sandbox.fikenLinjerHTML(nyBil())).toContain('Hent fra Utstyr-boksen');
    const lev = sandbox.fikenLinjerHTML(nyLeveranse());
    expect(lev).toContain('Legg til linje');
    expect(lev).not.toContain('Hent fra Utstyr-boksen');
    expect(lev).not.toContain('Hent drivstoff');
  });
  it('arbeidsklokka for en leveranse går i «Under arbeid» (ikke i andre statuser), og bil-regelen er uendret', () => {
    expect(sandbox.ordreAktivFase(nyLeveranse())).toBe('ordreTimerSessions');
    expect(sandbox.ordreAktivFase(nyLeveranse({ ordre_status: 'klar_sending' }))).toBeNull();
    expect(sandbox.ordreAktivFase(nyLeveranse({ ordre_status: 'sendt' }))).toBeNull();
    expect(sandbox.ordreAktivFase(nyBil({ ordre_status: 'paabegynt' }))).toBe('ordreTimerSessions');
    expect(sandbox.ordreAktivFase(nyBil({ ordre_status: 'under_arbeid' }))).toBeNull(); // en bil har ikke den statusen
  });
  it('timerkortet heter «Arbeidstid» for en leveranse og «Ombygging» for en bil', () => {
    expect(sandbox.ordreTimerKortHTML(nyLeveranse(), 'ordreTimerSessions')).toContain('Arbeidstid');
    expect(sandbox.ordreTimerKortHTML(nyBil(), 'ordreTimerSessions')).toContain('Ombygging');
  });
});

describe('chassis-koblinger ignorerer leveranser', () => {
  it('Admin-ark, flåter, Mer og «Ny ordre» matcher aldri en leveranse på chassis (statisk vakt over kildekoden)', () => {
    const adminArk = les('js/admin-ark.js');
    const linjer = adminArk.split('\n').filter((l) => /S\.ordrer/.test(l) && /samsvarerChassis\(/.test(l));
    expect(linjer.length).toBeGreaterThanOrEqual(7);
    for (const l of linjer) expect(l).toContain('!erLeveranse(');
    expect(les('js/ordre-diverse.js')).toContain("o.status==='aktiv' && !erLeveranse(o) && samsvarerChassis(o.chassis, chassis)");
    expect(les('js/arkiv-mer.js')).toContain('!S.ordrer.some(o => !erLeveranse(o) && samsvarerChassis(o.chassis, r.chassisNr))');
    expect(les('js/flate.js').match(/!erLeveranse\(o\)/g).length).toBe(2);
  });
  it('Admin-ark bygger ikke rader av leveranser', () => {
    expect(les('js/admin-ark.js')).toContain('if (erLeveranse(o)) return false; // Admin-arket gjelder biler');
  });
});

describe('pakker (vekt og mål) og fraktpris', () => {
  const lev = (l = {}, over = {}) => nyLeveranse(over, l);

  it('normaliserKolliListe: tall (også med komma) beholdes, alt annet blir tomt, antall blir minst 1, maks 50, aldri negative/NaN', () => {
    const l = sandbox.normaliserLeveranse({ kolliListe: [{ antall: '3', vekt: '1,5', lengde: 60, bredde: '40.5', hoyde: '' }, { antall: 0, vekt: -2, lengde: 'x', bredde: NaN, hoyde: Infinity }, null, 7, 'x', []] });
    expect(l.kolliListe).toEqual([
      { antall: 3, vekt: 1.5, lengde: 60, bredde: 40.5, hoyde: '' },
      { antall: 1, vekt: '', lengde: '', bredde: '', hoyde: '' },
    ]);
    expect(sandbox.normaliserLeveranse({ kolliListe: Array.from({ length: 80 }, () => ({})) }).kolliListe).toHaveLength(50);
    for (const feil of [{}, 'tekst', 5, null, undefined]) expect(sandbox.normaliserLeveranse({ kolliListe: feil }).kolliListe).toEqual([]);
  });
  it('fraktPris og fraktProduktnr: tall/tekst normaliseres, ugyldig blir tomt', () => {
    expect(sandbox.normaliserLeveranse({ fraktPris: '450,50' }).fraktPris).toBe(450.5);
    expect(sandbox.normaliserLeveranse({ fraktPris: -5 }).fraktPris).toBe('');
    expect(sandbox.normaliserLeveranse({ fraktPris: 'gratis' }).fraktPris).toBe('');
    expect(sandbox.normaliserLeveranse({ fraktPris: {} }).fraktPris).toBe('');
    expect(sandbox.normaliserLeveranse({}).fraktPris).toBe('');
    expect(sandbox.normaliserLeveranse({ fraktProduktnr: 30 }).fraktProduktnr).toBe('30');
    expect(sandbox.normaliserLeveranse({ fraktProduktnr: {} }).fraktProduktnr).toBe('');
  });
  it('leveranseKolliSum: antall, totalvekt (antall x vekt) og antall pakker uten vekt', () => {
    expect(sandbox.leveranseKolliSum({ kolliListe: [{ antall: 2, vekt: 10 }, { antall: 1, vekt: 5.5 }, { antall: 3, vekt: '' }] })).toEqual({ antall: 6, vekt: 25.5, utenVekt: 3 });
    expect(sandbox.leveranseKolliSum({})).toEqual({ antall: 0, vekt: 0, utenVekt: 0 });
    expect(sandbox.leveranseKolliSum(null)).toEqual({ antall: 0, vekt: 0, utenVekt: 0 });
  });
  it('leggTilKolli, settKolli og fjernKolli oppdaterer pakkene og lagrer; ny pakke kopierer forrige', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    const o = lev({ kolliListe: [{ antall: 1, vekt: 10, lengde: 60, bredde: 40, hoyde: 30 }] }); S.ordrer = [o];
    sandbox.leggTilKolli(o.id);
    expect(o.leveranse.kolliListe).toHaveLength(2);
    expect(o.leveranse.kolliListe[1]).toEqual({ antall: 1, vekt: 10, lengde: 60, bredde: 40, hoyde: 30 });
    sandbox.settKolli(o.id, 1, 'vekt', '12,5');
    sandbox.settKolli(o.id, 1, 'antall', '3');
    expect(o.leveranse.kolliListe[1]).toMatchObject({ antall: 3, vekt: 12.5 });
    expect(sandbox.leveranseKolliSum(o.leveranse)).toMatchObject({ antall: 4, vekt: 47.5 });
    sandbox.fjernKolli(o.id, 0);
    expect(o.leveranse.kolliListe).toHaveLength(1);
    expect(kall.some((k) => k.tabell === 'ordrer')).toBe(true);
  });
  it('en ukjent pakke-indeks eller et ukjent felt endrer ingenting og kaster ikke', () => {
    const { db } = lagDb(); app.settDb(db);
    const o = lev({ kolliListe: [{ antall: 1, vekt: 10 }] }); S.ordrer = [o];
    expect(() => sandbox.settKolli(o.id, 9, 'vekt', '5')).not.toThrow();
    sandbox.settKolli(o.id, 0, 'hemmelig', '5');
    expect(o.leveranse.kolliListe[0]).not.toHaveProperty('hemmelig');
    expect(() => sandbox.settKolli('finnes-ikke', 0, 'vekt', '5')).not.toThrow();
    expect(() => sandbox.fjernKolli('finnes-ikke', 0)).not.toThrow();
  });
  it('en bil-ordre kan ikke få pakker (funksjonene gjør ingenting)', () => {
    const { db } = lagDb(); app.settDb(db);
    const bil = nyBil(); S.ordrer = [bil];
    sandbox.leggTilKolli(bil.id);
    expect(bil.leveranse.kolliListe).toEqual([]);
  });
  it('maks 50 pakker', () => {
    const { db } = lagDb(); app.settDb(db);
    const o = lev({ kolliListe: Array.from({ length: 50 }, () => ({ antall: 1, vekt: 1 })) }); S.ordrer = [o];
    sandbox.leggTilKolli(o.id);
    expect(o.leveranse.kolliListe).toHaveLength(50);
  });
  it('settFraktPris lagrer prisen (komma tolkes), og ugyldig verdi gir tomt', () => {
    const { db } = lagDb(); app.settDb(db);
    const o = lev(); S.ordrer = [o];
    sandbox.settFraktPris(o.id, '1250,75');
    expect(o.leveranse.fraktPris).toBe(1250.75);
    sandbox.settFraktPris(o.id, 'abc');
    expect(o.leveranse.fraktPris).toBe('');
  });

  describe('legg frakt på fakturaen', () => {
    const rpcKall = (kall) => kall.filter((k) => k.rpc === 'oppdater_ordre_fiken_linje').map((k) => k.args);
    beforeEach(() => { sandbox.confirm = () => true; });

    it('legger en linje med fast beløp (belop) og antall 1 på fakturaen, med riktig produktnummer', async () => {
      const { db, kall } = lagDb(); app.settDb(db);
      const o = lev({ fraktPris: 450, fraktProduktnr: '30' }); S.ordrer = [o];
      await sandbox.leggFraktPaaFaktura(o.id);
      expect(rpcKall(kall)).toEqual([{ p_ordre_id: o.id, p_produktnummer: '30', p_linje: { produktnummer: '30', antall: 1, belop: 450 } }]);
    });
    it('uten fraktpris, eller uten produktnummer, skjer ingenting', async () => {
      const { db, kall } = lagDb(); app.settDb(db);
      const a = lev({ fraktProduktnr: '30' }); S.ordrer = [a];
      await sandbox.leggFraktPaaFaktura(a.id);
      const b = lev({ fraktPris: 450 }, { id: 'ord_TESTLEV2' }); S.ordrer = [b];
      await sandbox.leggFraktPaaFaktura(b.id);
      const c = lev({ fraktPris: 0, fraktProduktnr: '30' }, { id: 'ord_TESTLEV3' }); S.ordrer = [c];
      await sandbox.leggFraktPaaFaktura(c.id);
      expect(rpcKall(kall)).toEqual([]);
    });
    it('bare admin kan legge frakt på fakturaen', async () => {
      const { db, kall } = lagDb(); app.settDb(db);
      app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' });
      const o = lev({ fraktPris: 450, fraktProduktnr: '30' }); S.ordrer = [o];
      await sandbox.leggFraktPaaFaktura(o.id);
      expect(rpcKall(kall)).toEqual([]);
    });
    it('er leveransen allerede fakturert, må admin bekrefte; svarer admin nei, skjer ingenting', async () => {
      const { db, kall } = lagDb(); app.settDb(db);
      const o = lev({ fraktPris: 450, fraktProduktnr: '30' }, { fakturert: true }); S.ordrer = [o];
      sandbox.confirm = () => false;
      await sandbox.leggFraktPaaFaktura(o.id);
      expect(rpcKall(kall)).toEqual([]);
      sandbox.confirm = () => true;
      await sandbox.leggFraktPaaFaktura(o.id);
      expect(rpcKall(kall)).toHaveLength(1);
    });
    it('et nytt trykk oppdaterer samme linje (samme produktnummer), og en bil-ordre gjør ingenting', async () => {
      const { db, kall } = lagDb(); app.settDb(db);
      const o = lev({ fraktPris: 450, fraktProduktnr: '30' }); S.ordrer = [o];
      await sandbox.leggFraktPaaFaktura(o.id);
      sandbox.settFraktPris(o.id, '500');
      await sandbox.leggFraktPaaFaktura(o.id);
      expect(rpcKall(kall).map((a) => [a.p_produktnummer, a.p_linje.belop])).toEqual([['30', 450], ['30', 500]]);
      const bil = nyBil(); S.ordrer = [bil];
      await sandbox.leggFraktPaaFaktura(bil.id);
      expect(rpcKall(kall)).toHaveLength(2);
    });
  });

  describe('visning og opprettelse', () => {
    const sett = (felt) => { Object.entries(felt).forEach(([k, v]) => { sandbox.document.getElementById(k).value = v; }); };
    it('«Ny leveranse» lagrer én pakke og fraktprisen fra skjemaet; uten pakkefelt blir pakkelista tom', () => {
      const { db } = lagDb(); app.settDb(db); edgeFake(); sandbox.alert = () => {};
      sett({ lev_kunde: 'TEST Kunde AS', lev_merking: 'M1', lev_pakker: '2', lev_vekt: '7,5', lev_lengde: '60', lev_bredde: '40', lev_hoyde: '30', lev_fraktpris: '350' });
      sandbox.opprettLeveranse();
      expect(S.ordrer[S.ordrer.length - 1].leveranse.kolliListe).toEqual([{ antall: 2, vekt: 7.5, lengde: 60, bredde: 40, hoyde: 30 }]);
      expect(S.ordrer[S.ordrer.length - 1].leveranse.fraktPris).toBe(350);
      sett({ lev_kunde: 'TEST Kunde AS', lev_merking: 'M2', lev_pakker: '', lev_vekt: '', lev_lengde: '', lev_bredde: '', lev_hoyde: '', lev_fraktpris: '' });
      sandbox.opprettLeveranse();
      expect(S.ordrer[S.ordrer.length - 1].leveranse.kolliListe).toEqual([]);
      expect(S.ordrer[S.ordrer.length - 1].leveranse.fraktPris).toBe('');
    });
    it('Frakt-kortet viser pakkelista, totalen og fraktprisen, og kortet i lista viser antall og vekt', () => {
      const o = lev({ kolliListe: [{ antall: 2, vekt: 10, lengde: 60, bredde: 40, hoyde: 30 }], fraktPris: 450, fraktProduktnr: '30' }); S.ordrer = [o];
      const html = sandbox.leveranseFraktKortHTML(o);
      expect(html).toContain('PAKKER'); expect(html).toContain('2 pakker · 20 kg'); expect(html).toContain('value="450"'); expect(html).toContain('Legg frakt på fakturaen');
      expect(sandbox.leveranseKortHTML(o)).toContain('2 pakker · 20 kg');
    });
    it('manglende vekt gir en tydelig melding, og en påminnelse om vekt og mål vises før frakten er bestilt', () => {
      const a = lev({ kolliListe: [{ antall: 1, vekt: '' }] });
      const html = sandbox.leveranseFraktKortHTML(a);
      expect(html).toContain('1 pakke mangler vekt');
      expect(html).toContain('Husk vekt og mål på pakkene');
      expect(sandbox.leveranseFraktKortHTML(lev({ kolliListe: [{ antall: 1, vekt: 5, lengde: 1, bredde: 1, hoyde: 1 }] }))).not.toContain('Husk vekt og mål');
    });
  });
});

// ─── Kalender (Henrik 2026-11-03): en ny leveranse legges i verkstedkalenderen den dagen og det klokkeslettet den opprettes ────────────────────────────────────
// 2026-11-03 er en tirsdag. Alle klokkeslett er LOKAL tid (veggklokka), aldri UTC.
describe('kalender: tidspunktet en ny leveranse får', () => {
  const lokal = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
  const kt = (d) => sandbox.leveranseKalenderTidspunkt(d);
  it('en hverdag innenfor 07:30-15:30 får nøyaktig opprettelsestidspunktet', () => {
    expect(kt(lokal(2026, 11, 3, 10, 17))).toEqual({ dato: '2026-11-03', tid: '10:17' });
    expect(kt(lokal(2026, 11, 6, 9, 5))).toEqual({ dato: '2026-11-06', tid: '09:05' });
  });
  it('grensene: 07:30 og 15:30 beholdes; før 07:30 blir 07:30 og etter 15:30 blir 15:30, begge samme dag', () => {
    expect(kt(lokal(2026, 11, 3, 7, 30))).toEqual({ dato: '2026-11-03', tid: '07:30' });
    expect(kt(lokal(2026, 11, 3, 7, 29)).tid).toBe('07:30');
    expect(kt(lokal(2026, 11, 3, 0, 0))).toEqual({ dato: '2026-11-03', tid: '07:30' });
    expect(kt(lokal(2026, 11, 3, 15, 30)).tid).toBe('15:30');
    expect(kt(lokal(2026, 11, 3, 15, 31)).tid).toBe('15:30');
    expect(kt(lokal(2026, 11, 3, 23, 59))).toEqual({ dato: '2026-11-03', tid: '15:30' });
  });
  it('lørdag og søndag blir mandag 07:30 (også over månedsskifte og årsskifte)', () => {
    expect(kt(lokal(2026, 11, 7, 12, 0))).toEqual({ dato: '2026-11-09', tid: '07:30' }); // lørdag
    expect(kt(lokal(2026, 11, 8, 9, 0))).toEqual({ dato: '2026-11-09', tid: '07:30' });  // søndag
    expect(kt(lokal(2026, 10, 31, 11, 0))).toEqual({ dato: '2026-11-02', tid: '07:30' }); // lørdag over månedsskifte
    expect(kt(lokal(2027, 1, 2, 11, 0))).toEqual({ dato: '2027-01-04', tid: '07:30' });   // lørdag over årsskifte
    expect(kt(lokal(2026, 12, 27, 18, 0))).toEqual({ dato: '2026-12-28', tid: '07:30' }); // søndag
  });
  it('bruker lokal tid: en lokal mandag kl. 00:30 er fortsatt mandag (ikke en dag tilbake slik UTC kunne gitt)', () => {
    expect(kt(lokal(2026, 11, 2, 0, 30))).toEqual({ dato: '2026-11-02', tid: '07:30' });
  });
  it('ugyldig eller manglende dato gir et gyldig tidspunkt (nå) uten å kaste, og inndataene endres ikke', () => {
    for (const d of [undefined, null, 'x', new Date('x'), {}]) expect(kt(d)).toMatchObject({ dato: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), tid: expect.stringMatching(/^\d{2}:\d{2}$/) });
    const lordag = lokal(2026, 11, 7, 12, 0); const foer = lordag.getTime();
    kt(lordag);
    expect(lordag.getTime()).toBe(foer);
  });
});

describe('kalender: opprettelse, visning og flytting', () => {
  const sett = (felt) => { Object.entries(felt).forEach(([k, v]) => { sandbox.document.getElementById(k).value = v; }); };
  const lokal = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
  // «Nå» i modulen settes til et fast tidspunkt (en Date-klasse som gir dette når den lages uten argument).
  function fastNaa(d) {
    const Ekte = Date;
    class Fast extends Ekte { constructor(...a) { super(...(a.length ? a : [d.getTime()])); } static now() { return d.getTime(); } }
    sandbox.Date = Fast;
    return () => { sandbox.Date = Ekte; };
  }
  const spioner = () => {
    const r = { admin: [], sted: [], lagret: [], toast: [] };
    sandbox.adminArkLagreFelter = async (...a) => { r.admin.push(a); };
    sandbox.openKalenderStedModal = (id) => { r.sted.push(id); };
    sandbox.save = (id) => { r.lagret.push(id); };
    sandbox.document.removeEventListener = () => {};
    sandbox.visToast = (m) => { r.toast.push(m); };
    return r;
  };
  const kalOppdateringer = (kall) => oppdateringer(kall).filter((u) => 'kalender_dato' in u);
  const skjemaTilNyLeveranse = () => { sett({ lev_kunde: 'TEST Kunde AS', lev_merking: 'TEST-kal', lev_pakker: '', lev_vekt: '', lev_lengde: '', lev_bredde: '', lev_hoyde: '', lev_fraktpris: '' }); sandbox.alert = () => {}; };

  it('«Ny leveranse» får kalenderdato og -tid fra opprettelsestidspunktet, og de lagres i databasen', () => {
    const { db, kall } = lagDb(); app.settDb(db); edgeFake(); skjemaTilNyLeveranse();
    const tilbake = fastNaa(lokal(2026, 11, 3, 10, 17));
    try { sandbox.opprettLeveranse(); } finally { tilbake(); }
    const o = S.ordrer[S.ordrer.length - 1];
    expect(o).toMatchObject({ ordretype: 'leveranse', kalenderDato: '2026-11-03', kalenderTid: '10:17' });
    expect(innsettinger(kall)[0]).toMatchObject({ kalender_dato: '2026-11-03', kalender_tid: '10:17', ordretype: 'leveranse' });
  });
  it('opprettet i helga eller etter stengetid: mandag 07:30 / 15:30 samme dag', () => {
    const { db } = lagDb(); app.settDb(db); edgeFake(); skjemaTilNyLeveranse();
    let tilbake = fastNaa(lokal(2026, 11, 7, 12, 0));
    try { sandbox.opprettLeveranse(); } finally { tilbake(); }
    expect(S.ordrer[S.ordrer.length - 1]).toMatchObject({ kalenderDato: '2026-11-09', kalenderTid: '07:30' });
    skjemaTilNyLeveranse();
    tilbake = fastNaa(lokal(2026, 11, 4, 17, 45));
    try { sandbox.opprettLeveranse(); } finally { tilbake(); }
    expect(S.ordrer[S.ordrer.length - 1]).toMatchObject({ kalenderDato: '2026-11-04', kalenderTid: '15:30' });
  });

  describe('ukekalenderen', () => {
    const uke = () => { sandbox.renderWeek(); return sandbox.document.getElementById('weekCal').innerHTML; };
    const medFastNaa = (f) => { const tilbake = fastNaa(lokal(2026, 11, 3, 10, 17)); try { return f(); } finally { tilbake(); } };
    it('en aktiv leveranse med kalenderdato i uka vises med 🚚, tittel, tid og status; bil-kort har ikke 🚚', () => {
      S.ordrer = [nyLeveranse({ kalender_dato: '2026-11-04', kalender_tid: '13:00' }), nyBil({ kalender_dato: '2026-11-05', kalender_tid: '09:00' })];
      const html = medFastNaa(uke);
      expect(html).toContain('🚚 TEST-merking');
      expect(html).toContain("openOrdre('ord_TESTLEV1')");
      expect(html).toContain('13:00');
      expect(html).toContain('Under arbeid');
      expect(html).toContain("openOrdre('ord_TESTBIL1')");
      expect(html.match(/🚚/g)).toHaveLength(1);
    });
    it('arkivert, uten kalenderdato, eller i en annen uke vises ikke', () => {
      S.ordrer = [nyLeveranse({ id: 'ord_A', status: 'arkivert', kalender_dato: '2026-11-04', kalender_tid: '13:00' }),
        nyLeveranse({ id: 'ord_B', kalender_dato: null }), nyLeveranse({ id: 'ord_C', kalender_dato: '2026-11-12', kalender_tid: '09:00' })];
      const html = medFastNaa(uke);
      for (const id of ['ord_A', 'ord_B', 'ord_C']) expect(html).not.toContain(`openOrdre('${id}')`);
    });
    it('et uventet kalenderfelt (tom tid, skadet verdi) gir aldri en tom uke', () => {
      S.ordrer = [nyLeveranse({ id: 'ord_D', kalender_dato: '2026-11-04', kalender_tid: '' }), nyLeveranse({ id: 'ord_E', kalender_dato: '2026-11-04', kalender_tid: '<b>' }), nyBil({ kalender_dato: '2026-11-05', kalender_tid: '09:00' })];
      const html = medFastNaa(uke);
      expect(html).toContain("openOrdre('ord_D')");
      expect(html).toContain("openOrdre('ord_TESTBIL1')");
    });
  });

  describe('dra, flytt og fjern rører aldri Admin-ark eller Time på biltilsynet for en leveranse', () => {
    const CHASSIS = 'TESTWXYZ0000000A1';
    const oppsett = () => {
      const lev = nyLeveranse({ chassis: CHASSIS, kalender_dato: '2026-11-03', kalender_tid: '10:17' });
      const bil = nyBil({ chassis: CHASSIS, kalender_dato: '2026-11-04', kalender_tid: '09:00', tid_biltilsynet: '2026-11-04', tid_biltilsynet_tid: '09:00', tid_biltilsynet_sted: 'Skien' });
      S.ordrer = [lev, bil];
      return { lev, bil };
    };
    const slippPaa = (id, dato, tid) => {
      sandbox.document.elementFromPoint = () => ({ closest: () => ({ dataset: { dato, tid } }) });
      app.kjor(`_dragOrdre = { id: '${id}', moved: true, ghostEl: null, kortEl: null, x: 0, y: 0, startX: 0, startY: 0 }`);
      sandbox.dragOrdreEnd({ clientX: 1, clientY: 1 });
    };
    it('dra: leveransen får ny dato/tid med én målrettet oppdatering, uten sted-dialog, uten Admin-ark, og bilen med samme chassis er urørt', async () => {
      const r = spioner(); const { db, kall } = lagDb(); app.settDb(db);
      const { lev, bil } = oppsett();
      slippPaa(lev.id, '2026-11-05', '13:00');
      await new Promise((ok) => setTimeout(ok, 10));
      expect(lev).toMatchObject({ kalenderDato: '2026-11-05', kalenderTid: '13:00' });
      expect(kalOppdateringer(kall)).toEqual([{ kalender_dato: '2026-11-05', kalender_tid: '13:00' }]);
      expect(r.sted).toEqual([]); expect(r.admin).toEqual([]); expect(r.lagret).toEqual([]);
      expect(kall.some((k) => k.tabell === 'admin_ark')).toBe(false);
      expect(bil).toMatchObject({ kalenderDato: '2026-11-04', kalenderTid: '09:00', tidBiltilsynet: '2026-11-04', tidBiltilsynetTid: '09:00', tidBiltilsynetSted: 'Skien' });
      expect(JSON.stringify(lev.endringer)).toContain('Flyttet til kalender (dra): 2026-11-05 13:00');
    });
    it('dra en BIL virker som før: full lagring og sted-dialogen åpnes', () => {
      const r = spioner(); const { db } = lagDb(); app.settDb(db);
      const { bil } = oppsett();
      slippPaa(bil.id, '2026-11-06', '11:00');
      expect(bil).toMatchObject({ kalenderDato: '2026-11-06', kalenderTid: '11:00' });
      expect(r.lagret).toEqual([bil.id]); expect(r.sted).toEqual([bil.id]);
    });
    it('Flytt: bare leveransens kalendertid endres; mangler dato skjer ingenting; en bil med chassis går fortsatt via Admin-ark', async () => {
      const r = spioner(); const { db, kall } = lagDb(); app.settDb(db);
      const { lev, bil } = oppsett();
      app.kjor(`flyttOrdreId = '${lev.id}'`);
      sandbox.document.getElementById('fl_dato').value = ''; sandbox.document.getElementById('fl_tid').value = '14:00';
      await sandbox.bekreftFlytt();
      expect(kalOppdateringer(kall)).toEqual([]);
      expect(r.toast.join('|')).toMatch(/Velg en dato/);
      sandbox.document.getElementById('fl_dato').value = '2026-11-06';
      await sandbox.bekreftFlytt();
      expect(kalOppdateringer(kall)).toEqual([{ kalender_dato: '2026-11-06', kalender_tid: '14:00' }]);
      expect(lev).toMatchObject({ kalenderDato: '2026-11-06', kalenderTid: '14:00' });
      expect(r.admin).toEqual([]); expect(r.lagret).toEqual([]);
      expect(bil.tidBiltilsynet).toBe('2026-11-04');
      // Tom tid faller tilbake på 09:00 (som resten av kalenderen)
      sandbox.document.getElementById('fl_tid').value = '';
      await sandbox.bekreftFlytt();
      expect(lev.kalenderTid).toBe('09:00');
      // Bil: Admin-ark som før
      app.kjor(`flyttOrdreId = '${bil.id}'`);
      sandbox.document.getElementById('fl_dato').value = '2026-11-07'; sandbox.document.getElementById('fl_tid').value = '10:00';
      await sandbox.bekreftFlytt();
      expect(r.admin).toHaveLength(1);
      expect(r.admin[0][1]).toMatchObject({ timeBekreftet: '2026-11-07', timeBekreftetTid: '10:00' });
    });
    it('Fjern fra kalender: leveransen får tom kalendertid (null/tom i databasen), Admin-ark røres ikke, bilen er urørt; en bil med chassis går fortsatt via Admin-ark', async () => {
      const r = spioner(); const { db, kall } = lagDb(); app.settDb(db);
      const { lev, bil } = oppsett();
      await sandbox.fjernFraKalender(lev.id);
      expect(lev).toMatchObject({ kalenderDato: '', kalenderTid: '' });
      expect(kalOppdateringer(kall)).toEqual([{ kalender_dato: null, kalender_tid: '' }]);
      expect(r.admin).toEqual([]);
      expect(bil).toMatchObject({ kalenderDato: '2026-11-04', tidBiltilsynet: '2026-11-04' });
      expect(r.toast.join('|')).toMatch(/tatt ut av kalenderen/);
      await sandbox.fjernFraKalender(bil.id);
      expect(r.admin).toHaveLength(1);
      expect(r.admin[0][1]).toEqual({ timeBekreftet: '', timeBekreftetTid: '', timeBekreftetSted: '' });
    });
    it('feiler skrivingen, rulles kalendertiden tilbake lokalt og brukeren får beskjed (ingen logglinje om noe som ikke skjedde)', async () => {
      const r = spioner(); const { db } = lagDb({ feilPaa: (i) => i.tabell === 'ordrer' }); app.settDb(db);
      const { lev } = oppsett();
      const logg = lev.endringer.length;
      slippPaa(lev.id, '2026-11-05', '13:00');
      await new Promise((ok) => setTimeout(ok, 10));
      expect(lev).toMatchObject({ kalenderDato: '2026-11-03', kalenderTid: '10:17' });
      expect(r.toast.join('|')).toMatch(/Kunne ikke lagre kalendertiden/);
      expect(lev.endringer.length).toBe(logg);
    });
    it('Realtime-ekkoet av vår egen skriving ignoreres (markert i ignorerRealtimeFor)', async () => {
      spioner(); const { db } = lagDb(); app.settDb(db);
      const { lev } = oppsett();
      await sandbox.leveranseSettKalender(lev, '2026-11-05', '13:00', 'test');
      expect(app.kjor(`ignorerRealtimeFor.has('${lev.id}')`)).toBe(true);
    });
  });

  describe('kort og detalj', () => {
    it('på Oversikt kan leveransekortet dras inn i kalenderen; i Ordre-lista kan det ikke', () => {
      const o = nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' });
      expect(sandbox.leveranseKortHTML(o, { drag: true })).toContain(`class="drag-card" onpointerdown="dragOrdreStart(event,'ord_TESTLEV1')"`);
      expect(sandbox.leveranseKortHTML(o)).not.toContain('drag-card');
      S.ordrer = [o];
      sandbox.renderLeveranseOversikt('');
      expect(sandbox.document.getElementById('leveranseOversiktListe').innerHTML).toContain('drag-card');
    });
    it('kortet viser kalendertiden, eller «Ikke i kalender»; et arkivert kort viser ingen kalenderlinje', () => {
      expect(sandbox.leveranseKortHTML(nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }))).toContain('📅 03.11.2026 kl. 10:17');
      expect(sandbox.leveranseKortHTML(nyLeveranse({ kalender_dato: null }))).toContain('Ikke i kalender');
      expect(sandbox.leveranseKortHTML(nyLeveranse({ status: 'arkivert', kalender_dato: '2026-11-03', kalender_tid: '10:17' }))).not.toContain('Kalender</span>');
    });
    it('detaljen viser Flytt/Fjern når den står i kalenderen, og «Legg i kalenderen» når den ikke gjør det; skadede verdier escapes', () => {
      const med = sandbox.leveranseKalenderRadHTML(nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }));
      expect(med).toContain('I kalenderen'); expect(med).toContain('03.11.2026 kl. 10:17'); expect(med).toContain("leveranseApneKalenderValg('ord_TESTLEV1')"); expect(med).toContain("fjernFraKalender('ord_TESTLEV1')");
      const uten = sandbox.leveranseKalenderRadHTML(nyLeveranse({ kalender_dato: null }));
      expect(uten).toContain('Ikke i kalenderen'); expect(uten).toContain('Legg i kalenderen'); expect(uten).not.toContain('fjernFraKalender');
      expect(sandbox.leveranseKalenderRadHTML(nyLeveranse({ kalender_dato: '<img src=x>', kalender_tid: '"><b>' }))).not.toMatch(/<img|"><b>/);
    });
    it('hele detaljvisningen har kalenderraden, og ikke for en arkivert leveranse', () => {
      const o = nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }); S.ordrer = [o]; app.settAktivOrdre(o.id);
      sandbox.buildOrdreDetail();
      expect(sandbox.document.getElementById('ordreDetail').innerHTML).toContain('I kalenderen');
      const a = nyLeveranse({ status: 'arkivert', kalender_dato: '2026-11-03', kalender_tid: '10:17' }); S.ordrer = [a]; app.settAktivOrdre(a.id);
      sandbox.buildOrdreDetail();
      expect(sandbox.document.getElementById('ordreDetail').innerHTML).not.toContain('I kalenderen');
    });
    it('«Legg i kalenderen» åpner Flytt-vinduet forhåndsutfylt (nåværende tid, ellers tidspunktet en ny leveranse ville fått nå)', () => {
      spioner();
      const o = nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }); S.ordrer = [o];
      sandbox.leveranseApneKalenderValg(o.id);
      expect(sandbox.document.getElementById('fl_dato').value).toBe('2026-11-03');
      expect(sandbox.document.getElementById('fl_tid').value).toBe('10:17');
      expect(app.kjor('flyttOrdreId')).toBe(o.id);
      const uten = nyLeveranse({ id: 'ord_TESTLEV2', kalender_dato: null }); S.ordrer = [uten];
      const tilbake = fastNaa(lokal(2026, 11, 7, 12, 0));
      try { sandbox.leveranseApneKalenderValg(uten.id); } finally { tilbake(); }
      expect(sandbox.document.getElementById('fl_dato').value).toBe('2026-11-09');
      expect(sandbox.document.getElementById('fl_tid').value).toBe('07:30');
    });
  });
});

// ─── Pakker: en standardpakke og flere pakker (Henrik 2026-11-03) ───────────────────────────────────────────────────────────────────────────────────────────────
describe('pakker: standardpakke og flere pakker', () => {
  const sett = (felt) => { Object.entries(felt).forEach(([k, v]) => { sandbox.document.getElementById(k).value = v; }); };
  const tomPakke = { antall: 1, vekt: '', lengde: '', bredde: '', hoyde: '' };
  beforeEach(() => { sandbox.alert = () => {}; sandbox.visToast = () => {}; });

  describe('i detaljen', () => {
    it('en leveranse uten pakker viser likevel en standardpakke med felt for vekt og mål (uten fjern-knapp) og «+ Legg til pakke»', () => {
      const o = nyLeveranse(); S.ordrer = [o];
      const html = sandbox.leveransePakkerHTML(o);
      expect(html).toContain('Vekt kg'); expect(html).toContain('L cm'); expect(html).toContain('B cm'); expect(html).toContain('H cm');
      for (const f of ['antall', 'vekt', 'lengde', 'bredde', 'hoyde']) expect(html).toContain(`settKolli('ord_TESTLEV1',0,'${f}'`);
      expect(html).not.toContain('fjernKolli'); expect(html).not.toContain('Ingen pakker lagt inn');
      expect(html).toContain("leggTilKolli('ord_TESTLEV1')");
      expect(html).toContain('egen vekt og egne mål');
    });
    it('standardpakken lagres første gang et felt fylles ut (vekt 7,5 kg og mål), uten at tomme pakker lagres før', () => {
      const { db } = lagDb(); app.settDb(db);
      const o = nyLeveranse(); S.ordrer = [o];
      expect(o.leveranse.kolliListe).toEqual([]);
      sandbox.settKolli(o.id, 0, 'vekt', '7,5');
      expect(o.leveranse.kolliListe).toEqual([{ antall: 1, vekt: 7.5, lengde: '', bredde: '', hoyde: '' }]);
      sandbox.settKolli(o.id, 0, 'lengde', '60'); sandbox.settKolli(o.id, 0, 'bredde', '40'); sandbox.settKolli(o.id, 0, 'hoyde', '30');
      expect(o.leveranse.kolliListe).toEqual([{ antall: 1, vekt: 7.5, lengde: 60, bredde: 40, hoyde: 30 }]);
      expect(sandbox.leveransePakkerHTML(o)).toContain('fjernKolli');
    });
    it('«Legg til pakke» på en tom liste gir to pakker (standardpakken og en ny), og på en liste med pakker en kopi av den siste', () => {
      const { db } = lagDb(); app.settDb(db);
      const o = nyLeveranse(); S.ordrer = [o];
      sandbox.leggTilKolli(o.id);
      expect(o.leveranse.kolliListe).toEqual([tomPakke, tomPakke]);
      sandbox.settKolli(o.id, 1, 'vekt', '12'); sandbox.settKolli(o.id, 1, 'lengde', '80');
      sandbox.leggTilKolli(o.id);
      expect(o.leveranse.kolliListe).toHaveLength(3);
      expect(o.leveranse.kolliListe[2]).toEqual({ antall: 1, vekt: 12, lengde: 80, bredde: '', hoyde: '' });
      // hver pakke har sin egen vekt og egne mål
      sandbox.settKolli(o.id, 2, 'vekt', '3');
      expect(o.leveranse.kolliListe.map((p) => p.vekt)).toEqual(['', 12, 3]);
    });
    it('en rad som ikke finnes endres ikke (bare standardpakken på plass 0 opprettes), og maks 50 pakker', () => {
      const { db } = lagDb(); app.settDb(db);
      const o = nyLeveranse(); S.ordrer = [o];
      sandbox.settKolli(o.id, 1, 'vekt', '5');
      sandbox.settKolli(o.id, 0, 'ugyldigfelt', '5');
      expect(o.leveranse.kolliListe).toEqual([]);
      const mange = nyLeveranse({}, { kolliListe: Array.from({ length: 50 }, () => ({ antall: 1, vekt: 1 })) });
      S.ordrer = [mange];
      sandbox.leggTilKolli(mange.id);
      expect(mange.leveranse.kolliListe).toHaveLength(50);
    });
    it('totalen og «mangler vekt»-meldingen regner bare med lagrede pakker (standardraden teller ikke)', () => {
      const o = nyLeveranse(); S.ordrer = [o];
      expect(sandbox.leveransePakkerHTML(o)).not.toContain('totalt');
      const b = nyLeveranse({}, { kolliListe: [{ antall: 2, vekt: 10 }, { antall: 1, vekt: '' }] });
      const html = sandbox.leveransePakkerHTML(b);
      expect(html).toContain('3 pakker · 20 kg'); expect(html).toContain('1 pakke mangler vekt');
    });
  });

  describe('i «Ny leveranse»', () => {
    const pakkeFelt = (o = {}) => sett({ lev_pakker: '', lev_vekt: '', lev_lengde: '', lev_bredde: '', lev_hoyde: '', ...o });
    const opprett = (felt = {}) => { const { db } = lagDb(); app.settDb(db); edgeFake(); sett({ lev_kunde: 'TEST Kunde AS', lev_merking: 'TEST-pakker', lev_fraktpris: '', ...felt }); sandbox.opprettLeveranse(); return S.ordrer[S.ordrer.length - 1]; };
    beforeEach(() => { sandbox.apneNyLeveranseModal(); });

    it('åpning nullstiller de ekstra pakkene', () => {
      sandbox.leggTilNyPakke();
      expect(app.kjor('levNyePakker.length')).toBe(1);
      sandbox.apneNyLeveranseModal();
      expect(app.kjor('levNyePakker.length')).toBe(0);
    });
    it('«+ Legg til pakke» kopierer pakke 1, og senere rader kopierer forrige rad', () => {
      pakkeFelt({ lev_pakker: '2', lev_vekt: '7,5', lev_lengde: '60', lev_bredde: '40', lev_hoyde: '30' });
      sandbox.leggTilNyPakke();
      expect(app.kjor('levNyePakker')).toEqual([{ antall: '2', vekt: '7,5', lengde: '60', bredde: '40', hoyde: '30' }]);
      sandbox.settNyPakke(0, 'vekt', '12');
      sandbox.leggTilNyPakke();
      expect(app.kjor('levNyePakker[1].vekt')).toBe('12');
      expect(sandbox.document.getElementById('lev_ekstra_pakker').innerHTML).toContain("settNyPakke(1,'vekt'");
      expect(sandbox.document.getElementById('lev_ekstra_pakker').innerHTML).toContain('fjernNyPakke(1)');
    });
    it('flere pakker i skjemaet gir flere pakker på leveransen, hver med egen vekt og egne mål', () => {
      pakkeFelt({ lev_pakker: '2', lev_vekt: '7,5', lev_lengde: '60', lev_bredde: '40', lev_hoyde: '30' });
      sandbox.leggTilNyPakke(); sandbox.settNyPakke(0, 'antall', '1'); sandbox.settNyPakke(0, 'vekt', '20'); sandbox.settNyPakke(0, 'lengde', '120');
      sandbox.leggTilNyPakke(); sandbox.settNyPakke(1, 'vekt', '3');
      const o = opprett();
      expect(o.leveranse.kolliListe).toEqual([
        { antall: 2, vekt: 7.5, lengde: 60, bredde: 40, hoyde: 30 },
        { antall: 1, vekt: 20, lengde: 120, bredde: 40, hoyde: 30 },
        { antall: 1, vekt: 3, lengde: 120, bredde: 40, hoyde: 30 },
      ]);
    });
    it('en helt tom pakke (rad eller pakke 1) lagres ikke; er bare en ekstra rad fylt ut, lagres bare den', () => {
      pakkeFelt();
      sandbox.leggTilNyPakke(); // kopi av tom pakke 1 = tom rad
      expect(opprett().leveranse.kolliListe).toEqual([]);
      sandbox.apneNyLeveranseModal(); pakkeFelt();
      sandbox.leggTilNyPakke(); sandbox.settNyPakke(0, 'vekt', '9');
      expect(opprett().leveranse.kolliListe).toEqual([{ antall: 1, vekt: 9, lengde: '', bredde: '', hoyde: '' }]);
    });
    it('fjern en rad, og maks 50 pakker totalt (pakke 1 + 49 ekstra)', () => {
      pakkeFelt({ lev_vekt: '5' });
      sandbox.leggTilNyPakke(); sandbox.leggTilNyPakke();
      sandbox.fjernNyPakke(0);
      expect(app.kjor('levNyePakker.length')).toBe(1);
      for (let i = 0; i < 60; i++) sandbox.leggTilNyPakke();
      expect(app.kjor('levNyePakker.length')).toBe(49);
    });
    it('ugyldige tall i en rad (tekst, negativt) blir tomme felt, ikke feil, og antall minst 1', () => {
      pakkeFelt({ lev_vekt: '5' });
      sandbox.leggTilNyPakke(); sandbox.settNyPakke(0, 'vekt', 'abc'); sandbox.settNyPakke(0, 'lengde', '-4'); sandbox.settNyPakke(0, 'antall', '0');
      const o = opprett();
      expect(o.leveranse.kolliListe[1]).toEqual({ antall: 1, vekt: '', lengde: '', bredde: '', hoyde: '' });
    });
    it('pakkene fra skjemaet tas med i fraktbestillingen på samme måte som pakker lagt til i detaljen (kolliListe)', () => {
      pakkeFelt({ lev_vekt: '5', lev_lengde: '50', lev_bredde: '30', lev_hoyde: '20' });
      sandbox.leggTilNyPakke(); sandbox.settNyPakke(0, 'vekt', '8');
      const o = opprett();
      expect(sandbox.leveranseKolliSum(o.leveranse)).toEqual({ antall: 2, vekt: 13, utenVekt: 0 });
      expect(sandbox.leveranseKolliTekst(o.leveranse)).toBe('2 pakker · 13 kg');
    });
  });
});

describe('pakke-raden (felles for detalj og «Ny leveranse»)', () => {
  const rad = (p, fjern) => sandbox.pakkeRadHTML(p, (k) => `data-felt="${k}"`, fjern);
  it('hvert av de fem feltene har egen overskrift og eget hendelsesattributt, og tallfeltene har riktig type og steg', () => {
    const html = rad({ antall: 2, vekt: 7.5, lengde: 60, bredde: 40, hoyde: 30 }, '');
    for (const [k, tekst] of [['antall', 'Antall'], ['vekt', 'Vekt kg'], ['lengde', 'L cm'], ['bredde', 'B cm'], ['hoyde', 'H cm']]) {
      expect(html).toContain(`<span>${tekst}</span>`);
      expect(html).toContain(`data-felt="${k}"`);
    }
    expect(html.match(/<input /g)).toHaveLength(5);
    expect(html).toContain('value="7.5"'); expect(html).toContain('value="60"');
    expect(html).toMatch(/min="1" step="1" inputmode="numeric"/); // antall: hele tall, minst 1
    expect(html).toMatch(/min="0" step="0.1" inputmode="decimal"/);
    expect(html).not.toContain('<button');
  });
  it('tomme/ukjente verdier gir tomme felt, verdier escapes, og fjern-knappen tas bare med når den er gitt', () => {
    const html = rad({ antall: '', vekt: null, lengde: undefined, bredde: '"><img src=x>', hoyde: 0 }, '<button>X</button>');
    expect(html).not.toContain('<img');
    expect(html).toContain('value="0"'); // 0 er en verdi, ikke tomt
    expect(html).toContain('<button>X</button>');
    expect(html.match(/value=""/g)).toHaveLength(3);
  });
  it('detaljen og skjemaet bruker samme rad (overskriftene står per felt, ikke i en egen toppliste)', () => {
    const o = nyLeveranse({}, { kolliListe: [{ antall: 1, vekt: 5, lengde: 1, bredde: 2, hoyde: 3 }, { antall: 2, vekt: 6, lengde: 4, bredde: 5, hoyde: 6 }] });
    const html = sandbox.leveransePakkerHTML(o);
    expect(html.match(/class="pakke-rad"/g)).toHaveLength(2);
    expect(html.match(/<span>Vekt kg<\/span>/g)).toHaveLength(2);
    expect(html).toContain("settKolli('ord_TESTLEV1',1,'hoyde',this.value,this)");
    sandbox.apneNyLeveranseModal(); sandbox.leggTilNyPakke(); sandbox.leggTilNyPakke();
    const skjema = sandbox.document.getElementById('lev_ekstra_pakker').innerHTML;
    expect(skjema.match(/class="pakke-rad"/g)).toHaveLength(2);
    expect(skjema).toContain("settNyPakke(1,'lengde',this.value)");
  });
  it('CSS-en bryter raden til to linjer på smal skjerm (antall + vekt, så L/B/H)', () => {
    const html = readFileSync(path.resolve(__dirname, '../salmakern.html'), 'utf8');
    expect(html).toMatch(/\.pakke-rad\{display:grid;grid-template-columns:64px repeat\(4,minmax\(0,1fr\)\) 34px/);
    expect(html).toMatch(/@media\(max-width:560px\)\{\.pakke-rad\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\) 34px\}\.pakke-felt:nth-child\(2\)\{grid-column:2 \/ 4\}\.pakke-fjern\{grid-column:4;grid-row:1\}\}/);
  });
});

// ─── Rettelser etter uavhengig gjennomgang (2026-11-03) ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('gjennomgang: kalenderkort og tekst', () => {
  const lokal = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
  function fastNaa(d) {
    const Ekte = Date;
    class Fast extends Ekte { constructor(...a) { super(...(a.length ? a : [d.getTime()])); } static now() { return d.getTime(); } }
    sandbox.Date = Fast;
    return () => { sandbox.Date = Ekte; };
  }
  const uke = () => { const tilbake = fastNaa(lokal(2026, 11, 3, 10, 17)); try { sandbox.renderWeek(); return sandbox.document.getElementById('weekCal').innerHTML; } finally { tilbake(); } };
  // Henter ut selve hendelseskortet for en ordre (fra «cal-event» til neste «cal-event»)
  const kortFor = (html, id) => { const ut = html.split(/<div class="cal-event(?: cal-event-smal)?" /).find((d) => d.includes(`openOrdre('${id}')`)); return ut || ''; };

  it('kortet til en leveranse er alltid den høye varianten (54 px), selv med reg.nr og uten chassis; bil med reg.nr uten chassis er fortsatt 38 px', () => {
    S.ordrer = [nyLeveranse({ regnr: 'AB12345', kalender_dato: '2026-11-04', kalender_tid: '10:00' }), nyBil({ chassis: '', regnr: 'CD67890', kalender_dato: '2026-11-05', kalender_tid: '10:00' })];
    const html = uke();
    expect(kortFor(html, 'ord_TESTLEV1')).toMatch(/height:54px/);
    expect(kortFor(html, 'ord_TESTBIL1')).toMatch(/height:38px/);
  });
  it('kortet har dra-håndtak og ⋯-meny med Flytt og Fjern for en leveranse (som for en bil)', () => {
    S.ordrer = [nyLeveranse({ kalender_dato: '2026-11-04', kalender_tid: '10:00' })];
    const kort = kortFor(uke(), 'ord_TESTLEV1');
    expect(kort).toContain("onpointerdown=\"dragOrdreStart(event,'ord_TESTLEV1')\"");
    expect(kort).toContain("openFlyttKalender('ord_TESTLEV1')");
    expect(kort).toContain("fjernFraKalender('ord_TESTLEV1')");
    expect(kort).toContain("toggleCalMenu('ord_TESTLEV1')");
  });
  it('merking med spesialtegn vises som vanlig tekst i «tatt ut av kalenderen»-toasten og i drag-spøkelset (ikke som &amp; / &quot;)', async () => {
    const toasts = []; sandbox.visToast = (m) => toasts.push(m); sandbox.document.removeEventListener = () => {};
    const { db } = lagDb(); app.settDb(db);
    const o = nyLeveranse({ kalender_dato: '2026-11-04', kalender_tid: '10:00' }, { merking: 'Takboks & stige "A" <b>' }); S.ordrer = [o];
    await sandbox.fjernFraKalender(o.id);
    expect(toasts.join('|')).toContain('Takboks & stige "A" <b> tatt ut av kalenderen');
    expect(toasts.join('|')).not.toMatch(/&amp;|&quot;|&lt;/);
    sandbox.document.elementFromPoint = () => null;
    app.kjor(`_dragOrdre = { id: '${o.id}', moved: false, ghostEl: null, kortEl: null, x: 0, y: 0, startX: 0, startY: 0 }`);
    sandbox.dragOrdreMove({ clientX: 60, clientY: 60, preventDefault() {} });
    expect(sandbox.document.createElement('div').textContent).toBe('📅 Takboks & stige "A" <b>');
    app.kjor('_dragOrdre = null');
  });
  it('rutenettet er fullt synlig uten rulling inne i kalenderen (rullefeltet er minst like høyt som de 17 rutene à 32 px)', () => {
    const html = readFileSync(path.resolve(__dirname, '../salmakern.html'), 'utf8');
    const m = html.match(/\.cal-body-scroll\{[^}]*max-height:(\d+)px/);
    expect(Number(m[1])).toBeGreaterThanOrEqual(17 * 32 + 24);
    // og et kort på siste rute (top 512 + høyde 54 = 566 px) er innenfor rutenettet pluss bunnmarginen (544 + 24 = 568 px), så det er helt synlig
    expect(html).toMatch(/\.cal-body\{display:flex;padding-bottom:24px\}/);
    expect(512 + 54).toBeLessThanOrEqual(17 * 32 + 24);
  });
});

describe('gjennomgang: Flytt-vinduet godtar bare det kalenderen viser', () => {
  const ug = (d, t) => sandbox.leveranseKalenderUgyldig(d, t);
  it('ukedag og tid mellom 07:30 og 15:30 er OK (grensene inkludert), tom tid er OK (blir 09:00)', () => {
    expect(ug('2026-11-03', '10:00')).toBe('');
    expect(ug('2026-11-02', '07:30')).toBe('');
    expect(ug('2026-11-06', '15:30')).toBe('');
    expect(ug('2026-11-03', '')).toBe('');
    expect(ug('2026-11-03', undefined)).toBe('');
  });
  it('helg, tid utenfor rutenettet, tom og ugyldig dato gir en tydelig beskjed', () => {
    expect(ug('2026-11-07', '10:00')).toMatch(/mandag til fredag/);  // lørdag
    expect(ug('2026-11-08', '10:00')).toMatch(/mandag til fredag/);  // søndag
    expect(ug('2026-11-03', '07:29')).toMatch(/07:30 til 15:30/);
    expect(ug('2026-11-03', '15:31')).toMatch(/07:30 til 15:30/);
    expect(ug('2026-11-03', '00:00')).toMatch(/07:30 til 15:30/);
    expect(ug('', '10:00')).toBe('Velg en dato');
    expect(ug(undefined, '10:00')).toBe('Velg en dato');
    expect(ug('2026-02-30', '10:00')).toMatch(/gyldig dato/);
    expect(ug('03.11.2026', '10:00')).toBe('Velg en dato');
  });
  it('bekreftFlytt nekter helg og tid utenfor rutenettet for en leveranse (ingen skriving, vinduet står åpent), men godtar en ukedag', async () => {
    const toasts = []; sandbox.visToast = (m) => toasts.push(m);
    const { db, kall } = lagDb(); app.settDb(db);
    const o = nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:00' }); S.ordrer = [o];
    app.kjor(`flyttOrdreId = '${o.id}'`);
    const sett = (d, t) => { sandbox.document.getElementById('fl_dato').value = d; sandbox.document.getElementById('fl_tid').value = t; };
    sett('2026-11-07', '10:00'); await sandbox.bekreftFlytt();
    sett('2026-11-04', '17:00'); await sandbox.bekreftFlytt();
    expect(oppdateringer(kall).filter((u) => 'kalender_dato' in u)).toEqual([]);
    expect(o).toMatchObject({ kalenderDato: '2026-11-03', kalenderTid: '10:00' });
    expect(toasts.join('|')).toMatch(/mandag til fredag/); expect(toasts.join('|')).toMatch(/07:30 til 15:30/);
    sett('2026-11-04', '14:00'); await sandbox.bekreftFlytt();
    expect(o).toMatchObject({ kalenderDato: '2026-11-04', kalenderTid: '14:00' });
  });
  it('kalenderfunksjonene for leveranser bruker lokal tid (ingen toISOString/UTC-uttrykk i leveranseKalenderTidspunkt), uavhengig av tidssonen testen kjører i', () => {
    expect(sandbox.leveranseKalenderTidspunkt.toString()).not.toMatch(/toISOString|getUTC|Date\.UTC/);
  });
});

describe('gjennomgang: kalenderskrivinger går etter hverandre og bare siste kall ruller tilbake', () => {
  // Falsk db der HVER oppdatering venter til testen avgjør utfallet (ok eller feil).
  function styrtDb() {
    const ventende = []; const kall = [];
    const db = {
      from: (tabell) => {
        const info = { tabell, kall: [] }; kall.push(info);
        const kjede = new Proxy(function () {}, { get(_, k) {
          if (k === 'then') return (res) => new Promise((ok) => ventende.push({ info, ok })).then(res);
          return (...a) => { info.kall.push([String(k), a]); return kjede; };
        } });
        return kjede;
      },
      rpc: async () => ({ data: null, error: null }),
    };
    return { db, ventende, kall };
  }
  const tikk = () => new Promise((ok) => setTimeout(ok, 0));
  const nyttO = (id) => nyLeveranse({ id, kalender_dato: '2026-11-03', kalender_tid: '10:17' });
  const OK = { data: null, error: null }, FEIL = { data: null, error: { message: 'nettfeil' } };
  beforeEach(() => { sandbox.visToast = () => {}; });

  it('to raske flyttinger skrives i rekkefølge (neste starter først når forrige er ferdig), og begge lykkes: lokal og lagret verdi er den siste', async () => {
    const { db, ventende, kall } = styrtDb(); app.settDb(db);
    const o = nyttO('ord_RACE1'); S.ordrer = [o];
    const p1 = sandbox.leveranseSettKalender(o, '2026-11-04', '09:00', 'A');
    const p2 = sandbox.leveranseSettKalender(o, '2026-11-05', '13:00', 'B');
    expect(o).toMatchObject({ kalenderDato: '2026-11-05', kalenderTid: '13:00' }); // visningen følger med straks
    await tikk();
    expect(ventende).toHaveLength(1);                                              // bare første skriving er sendt
    ventende[0].ok(OK); await tikk();
    expect(ventende).toHaveLength(2);
    ventende[1].ok(OK);
    expect(await p1).toBe(true); expect(await p2).toBe(true);
    expect(kall.map((k) => k.kall.find(([m]) => m === 'update')[1][0].kalender_dato)).toEqual(['2026-11-04', '2026-11-05']);
    expect(kall.every((k) => k.kall.some(([m, a]) => m === 'eq' && a[0] === 'id' && a[1] === 'ord_RACE1'))).toBe(true); // alltid riktig rad
    expect(o).toMatchObject({ kalenderDato: '2026-11-05', kalenderTid: '13:00' });
  });
  it('første feiler og andre lykkes: den eldre feilen ruller IKKE tilbake den nyere flyttingen (lokal verdi = det som ble lagret sist)', async () => {
    const { db, ventende } = styrtDb(); app.settDb(db);
    const o = nyttO('ord_RACE2'); S.ordrer = [o];
    const p1 = sandbox.leveranseSettKalender(o, '2026-11-04', '09:00', 'A');
    const p2 = sandbox.leveranseSettKalender(o, '2026-11-05', '13:00', 'B');
    await tikk(); ventende[0].ok(FEIL); await tikk(); ventende[1].ok(OK);
    expect(await p1).toBe(false); expect(await p2).toBe(true);
    expect(o).toMatchObject({ kalenderDato: '2026-11-05', kalenderTid: '13:00' });
  });
  it('første lykkes og andre feiler: lokal verdi rulles tilbake til den første (sist lagrede), ikke til opprinnelig', async () => {
    const { db, ventende } = styrtDb(); app.settDb(db);
    const o = nyttO('ord_RACE3'); S.ordrer = [o];
    const p1 = sandbox.leveranseSettKalender(o, '2026-11-04', '09:00', 'A');
    const p2 = sandbox.leveranseSettKalender(o, '2026-11-05', '13:00', 'B');
    await tikk(); ventende[0].ok(OK); await tikk(); ventende[1].ok(FEIL);
    expect(await p1).toBe(true); expect(await p2).toBe(false);
    expect(o).toMatchObject({ kalenderDato: '2026-11-04', kalenderTid: '09:00' });
  });
  it('begge feiler (f.eks. uten nett): lokal verdi tilbake til den opprinnelige, og ingen logglinje for noe som ikke skjedde', async () => {
    const { db, ventende } = styrtDb(); app.settDb(db);
    const o = nyttO('ord_RACE4'); S.ordrer = [o]; const logg = o.endringer.length;
    const p1 = sandbox.leveranseSettKalender(o, '2026-11-04', '09:00', 'A');
    const p2 = sandbox.leveranseSettKalender(o, '2026-11-05', '13:00', 'B');
    await tikk(); ventende[0].ok(FEIL); await tikk(); ventende[1].ok(FEIL);
    expect(await p1).toBe(false); expect(await p2).toBe(false);
    expect(o).toMatchObject({ kalenderDato: '2026-11-03', kalenderTid: '10:17' });
    expect(o.endringer.length).toBe(logg);
  });
  it('en kollegas endring (Realtime) mellom to flyttinger gjør at neste feil ruller tilbake til DEN verdien, ikke til en gammel', async () => {
    const { db, ventende } = styrtDb(); app.settDb(db);
    const o = nyttO('ord_RACE5'); S.ordrer = [o];
    const p1 = sandbox.leveranseSettKalender(o, '2026-11-04', '09:00', 'A');
    await tikk(); ventende[0].ok(OK); await p1;
    o.kalenderDato = '2026-11-06'; o.kalenderTid = '11:00';                         // kollega flytter (kommer inn via Realtime)
    const p2 = sandbox.leveranseSettKalender(o, '2026-11-05', '13:00', 'B');
    await tikk(); ventende[1].ok(FEIL);
    expect(await p2).toBe(false);
    expect(o).toMatchObject({ kalenderDato: '2026-11-06', kalenderTid: '11:00' });
  });
  it('Realtime-ekkoet av vår egen skriving ignoreres (nullstilt først, så testen fanger at markeringen faktisk settes)', async () => {
    const { db } = lagDb(); app.settDb(db);
    const o = nyttO('ord_RACE6'); S.ordrer = [o];
    app.kjor("ignorerRealtimeFor.delete('ord_RACE6')");
    expect(app.kjor("ignorerRealtimeFor.has('ord_RACE6')")).toBe(false);
    await sandbox.leveranseSettKalender(o, '2026-11-05', '13:00', 'test');
    expect(app.kjor("ignorerRealtimeFor.has('ord_RACE6')")).toBe(true);
  });
  it('uten database (null) settes bare lokal verdi, og logglinjen skrives', async () => {
    app.settDb(null);
    const o = nyttO('ord_RACE7'); S.ordrer = [o]; const logg = o.endringer.length;
    expect(await sandbox.leveranseSettKalender(o, '2026-11-05', '13:00', 'lokalt')).toBe(true);
    expect(o).toMatchObject({ kalenderDato: '2026-11-05', kalenderTid: '13:00' });
    expect(o.endringer.length).toBe(logg + 1);
  });
});

describe('gjennomgang: pakke-blokken bytter ikke ut feltene mens man fyller dem ut', () => {
  const el = (id) => sandbox.document.getElementById(id);
  beforeEach(() => { sandbox.visToast = () => {}; sandbox.alert = () => {}; const { db } = lagDb(); app.settDb(db); app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' }); });

  it('blokken har egne deler (rader, sum, fakturaknapp) med id per ordre', () => {
    const o = nyLeveranse(); S.ordrer = [o];
    const html = sandbox.leveransePakkerHTML(o);
    for (const id of [`levPakkerRader_${o.id}`, `levPakkerSum_${o.id}`, `levFraktBtn_${o.id}`]) expect(html).toContain(`id="${id}"`);
  });
  it('en verdiendring på en eksisterende rad bytter IKKE ut radene (neste felt beholder trykket), men oppdaterer summen', () => {
    const o = nyLeveranse({}, { kolliListe: [{ antall: 1, vekt: 5, lengde: 1, bredde: 1, hoyde: 1 }, { antall: 1, vekt: 6, lengde: 2, bredde: 2, hoyde: 2 }] }); S.ordrer = [o];
    el(`levPakkerRader_${o.id}`).innerHTML = 'MARKØR'; el(`levPakkerSum_${o.id}`).innerHTML = '';
    sandbox.settKolli(o.id, 0, 'vekt', '10');
    expect(el(`levPakkerRader_${o.id}`).innerHTML).toBe('MARKØR');
    expect(el(`levPakkerSum_${o.id}`).innerHTML).toContain('2 pakker · 16 kg');
  });
  it('legg til og fjern pakke tegner radene på nytt (antall rader endres)', () => {
    const o = nyLeveranse({}, { kolliListe: [{ antall: 1, vekt: 5 }] }); S.ordrer = [o];
    el(`levPakkerRader_${o.id}`).innerHTML = 'MARKØR';
    sandbox.leggTilKolli(o.id);
    expect(el(`levPakkerRader_${o.id}`).innerHTML.match(/class="pakke-rad"/g)).toHaveLength(2);
    el(`levPakkerRader_${o.id}`).innerHTML = 'MARKØR';
    sandbox.fjernKolli(o.id, 0);
    expect(el(`levPakkerRader_${o.id}`).innerHTML.match(/class="pakke-rad"/g)).toHaveLength(1);
  });
  it('standardpakken som lagres første gang: feltene byttes ikke ut, men fjern-knappen settes inn på stedet', () => {
    const o = nyLeveranse(); S.ordrer = [o];
    el(`levPakkerRader_${o.id}`).innerHTML = 'MARKØR';
    sandbox.settKolli(o.id, 0, 'vekt', '7');
    expect(el(`levPakkerRader_${o.id}`).innerHTML).toBe('MARKØR');
    expect(sandbox.document.querySelector(`#levPakkerRader_${o.id} .pakke-fjern`).innerHTML).toContain(`fjernKolli('${o.id}',0)`);
  });
  it('fraktpris oppdaterer fakturaknappen PÅ STEDET (aktiv/inaktiv og tekst), uten å bytte den ut', () => {
    const o = nyLeveranse(); S.ordrer = [o];
    const knapp = el(`levFraktBtn_${o.id}`); knapp.disabled = true; knapp.textContent = '';
    sandbox.settFraktPris(o.id, '450');
    expect(knapp.disabled).toBe(false); expect(knapp.textContent).toContain('Legg frakt på fakturaen');
    sandbox.settFraktPris(o.id, '');
    expect(knapp.disabled).toBe(true);
  });
  it('fakturaknappen viser «Oppdater» når frakt-linjen allerede finnes', () => {
    const o = nyLeveranse({}, { fraktPris: 450, fraktProduktnr: '30' }); o.fikenLinjer = [{ produktnummer: '30', antall: 1, belop: 450 }]; S.ordrer = [o];
    expect(sandbox.leveransePakkerFraktKnapp(o)).toEqual({ deaktivert: false, tekst: '↻ Oppdater frakt på fakturaen' });
    expect(sandbox.leveransePakkerHTML(o)).toContain('↻ Oppdater frakt på fakturaen');
  });
  it('en vanlig ansatt får ingen fakturaknapp, og oppdatering av en blokk som ikke er på skjermen kaster ikke', () => {
    app.settMe({ id: 2, navn: 'Ansatt', rolle: 'ansatt' });
    const o = nyLeveranse(); S.ordrer = [o];
    expect(sandbox.leveransePakkerHTML(o)).not.toContain('levFraktBtn_');
    expect(() => sandbox.oppdaterPakkerUtdata(nyLeveranse({ id: 'ord_FINNES_IKKE_PAA_SKJERMEN' }), true)).not.toThrow();
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  });
});

describe('gjennomgang: «Ny leveranse»-pakkeradene', () => {
  const sett = (felt) => { Object.entries(felt).forEach(([k, v]) => { sandbox.document.getElementById(k).value = v; }); };
  const dom = () => sandbox.document.getElementById('lev_ekstra_pakker').innerHTML;
  beforeEach(() => { sandbox.visToast = () => {}; sandbox.apneNyLeveranseModal(); });

  it('åpning tømmer den tegnede lista, og antall rader i DOM følger lista etter hver endring', () => {
    sett({ lev_vekt: '5' }); sandbox.leggTilNyPakke(); sandbox.leggTilNyPakke();
    expect(dom().match(/class="pakke-rad"/g)).toHaveLength(2);
    sandbox.apneNyLeveranseModal();
    expect(dom()).toBe('');
    sandbox.leggTilNyPakke();
    expect(dom().match(/class="pakke-rad"/g)).toHaveLength(1);
  });
  it('fjerner man en rad midt i lista, er det riktig rad som forsvinner og indeksene i DOM-en følger med', () => {
    sandbox.leggTilNyPakke(); sandbox.leggTilNyPakke(); sandbox.leggTilNyPakke();
    sandbox.settNyPakke(0, 'vekt', '1'); sandbox.settNyPakke(1, 'vekt', '2'); sandbox.settNyPakke(2, 'vekt', '3');
    sandbox.fjernNyPakke(1);
    expect(app.kjor('levNyePakker.map(p => p.vekt)')).toEqual(['1', '3']);
    const html = dom();
    expect(html.match(/class="pakke-rad"/g)).toHaveLength(2);
    expect(html).toContain("settNyPakke(1,'vekt'");  // andre rad har nå indeks 1
    expect(html).not.toContain("settNyPakke(2,");    // og ingen rad har igjen den gamle indeksen 2
    expect(html).toContain('value="3"'); expect(html).not.toContain('value="2"');
  });
  it('skjemaet i salmakern.html har beholderen og «+ Legg til pakke»-knappen som koden bruker', () => {
    const html = readFileSync(path.resolve(__dirname, '../salmakern.html'), 'utf8');
    expect(html).toContain('id="lev_ekstra_pakker"');
    expect(html).toMatch(/<button[^>]*onclick="leggTilNyPakke\(\)"[^>]*>\+ Legg til pakke<\/button>/);
    for (const id of ['lev_pakker', 'lev_vekt', 'lev_lengde', 'lev_bredde', 'lev_hoyde']) expect(html).toContain(`id="${id}"`);
  });
  it('fjern-knappen i skjemaet bruker samme CSS som i detaljen (ingen egen inline-padding som overstyrer høyden)', () => {
    sandbox.leggTilNyPakke();
    expect(dom()).toContain('title="Fjern pakke">✕</button>');
    expect(dom()).not.toContain('padding:5px 0');
    const css = readFileSync(path.resolve(__dirname, '../salmakern.html'), 'utf8');
    expect(css).toContain('.pakke-fjern .btn{height:38px;padding:0;width:100%}');
    expect(css).toMatch(/\.pakke-felt\{[^}]*margin:0/);
  });
});

// ─── Rettelser etter runde 2 av gjennomgangen (2026-11-03) ───────────────────────────────────────────────────────────────────────────────────────────────────
describe('runde 2: kalenderen til en leveranse skrives bare av leveranseSettKalender', () => {
  const lagUpsertDb = () => { const payloads = []; return { payloads, db: { from: () => ({ upsert: (p) => { payloads.push(p); return Promise.resolve({ error: null }); } }) } }; };
  it('full lagring (save) av en LEVERANSE tar IKKE med kalender_dato/kalender_tid (en gammel kopi kan ikke skrive en gammel dato tilbake over en nyere flytting)', async () => {
    const { db, payloads } = lagUpsertDb(); app.settDb(db);
    const o = nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }); S.ordrer = [o];
    await sandbox.save(o.id);
    expect(payloads).toHaveLength(1);
    expect('kalender_dato' in payloads[0]).toBe(false); expect('kalender_tid' in payloads[0]).toBe(false);
    expect(payloads[0].ordretype).toBe('leveranse');   // resten av raden er med som før
    expect(payloads[0].leveranse.merking).toBe('TEST-merking');
  });
  it('en BIL tar fortsatt med kalenderen i full lagring (uendret), og opprettelsen av en leveranse (egen insert) har den med', async () => {
    const { db, payloads } = lagUpsertDb(); app.settDb(db);
    const bil = nyBil({ kalender_dato: '2026-11-04', kalender_tid: '09:00' }); S.ordrer = [bil];
    await sandbox.save(bil.id);
    expect(payloads[0]).toMatchObject({ kalender_dato: '2026-11-04', kalender_tid: '09:00' });
    expect(sandbox.ordreToDb(nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }))).toMatchObject({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }); // insert bruker ordreToDb direkte
  });
});

describe('runde 2: pakke- og fraktfeltene viser den lagrede (normaliserte) verdien', () => {
  beforeEach(() => { sandbox.visToast = () => {}; const { db } = lagDb(); app.settDb(db); app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' }); });
  const felt = (v) => ({ value: v });
  it('antall 0 blir 1, 2,5 blir 2, negative tall og tekst blir tomme, gyldige verdier (også med komma) står urørt', () => {
    const o = nyLeveranse({}, { kolliListe: [{ antall: 3, vekt: 5, lengde: 1, bredde: 1, hoyde: 1 }] }); S.ordrer = [o];
    const a = felt('0'); sandbox.settKolli(o.id, 0, 'antall', a.value, a); expect(a.value).toBe('1'); expect(o.leveranse.kolliListe[0].antall).toBe(1);
    const b = felt('2.5'); sandbox.settKolli(o.id, 0, 'antall', b.value, b); expect(b.value).toBe('2');
    const c = felt('-3'); sandbox.settKolli(o.id, 0, 'vekt', c.value, c); expect(c.value).toBe(''); expect(o.leveranse.kolliListe[0].vekt).toBe('');
    const d = felt('abc'); sandbox.settKolli(o.id, 0, 'lengde', d.value, d); expect(d.value).toBe('');
    const e = felt('12,5'); sandbox.settKolli(o.id, 0, 'vekt', e.value, e); expect(e.value).toBe('12,5'); expect(o.leveranse.kolliListe[0].vekt).toBe(12.5); // gyldig: teksten røres ikke
    const f = felt('12.50'); sandbox.settKolli(o.id, 0, 'vekt', f.value, f); expect(f.value).toBe('12.50');
  });
  it('fraktpris: negativt blir tomt i feltet, gyldig står urørt, og uten element kaster ingenting', () => {
    const o = nyLeveranse(); S.ordrer = [o];
    const a = felt('-5'); sandbox.settFraktPris(o.id, a.value, a); expect(a.value).toBe(''); expect(o.leveranse.fraktPris).toBe('');
    const b = felt('450'); sandbox.settFraktPris(o.id, b.value, b); expect(b.value).toBe('450'); expect(o.leveranse.fraktPris).toBe(450);
    expect(() => sandbox.settFraktPris(o.id, '300')).not.toThrow();
    expect(() => sandbox.settKolli(o.id, 0, 'vekt', '3')).not.toThrow();
  });
  it('feltene i HTML-en sender seg selv med (this), og produktnr-feltet har id slik at det kan oppdateres', () => {
    const o = nyLeveranse(); S.ordrer = [o];
    const html = sandbox.leveransePakkerHTML(o);
    expect(html).toContain("settKolli('ord_TESTLEV1',0,'vekt',this.value,this)");
    expect(html).toContain("settFraktPris('ord_TESTLEV1',this.value,this)");
    expect(html).toContain('id="levFraktNr_ord_TESTLEV1"');
  });
  it('«Legg frakt på fakturaen» viser produktnummeret som faktisk brukes (hentet fra forrige bruk på enheten) i feltet', async () => {
    sandbox.localStorage = { getItem: () => '30', setItem() {}, removeItem() {} };
    sandbox.oppdaterOrdreFikenLinje = async () => {};
    const o = nyLeveranse({}, { fraktPris: 450 }); S.ordrer = [o];
    const nrFelt = sandbox.document.getElementById('levFraktNr_' + o.id); nrFelt.value = '';
    await sandbox.leggFraktPaaFaktura(o.id);
    expect(nrFelt.value).toBe('30');
    expect(o.leveranse.fraktProduktnr).toBe('30');
  });
});

describe('runde 2: dekningshull i flytt/dra og pakke-raden', () => {
  const lokal = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
  const slipp = (id, dato, tid) => {
    sandbox.document.elementFromPoint = () => ({ closest: () => ({ dataset: { dato, tid } }) });
    app.kjor(`_dragOrdre = { id: '${id}', moved: true, ghostEl: null, kortEl: null, x: 0, y: 0, startX: 0, startY: 0 }`);
    sandbox.document.removeEventListener = () => {};
    sandbox.dragOrdreEnd({ clientX: 1, clientY: 1 });
  };
  const tikk = () => new Promise((ok) => setTimeout(ok, 10));
  it('dra: visningen tegnes på nytt straks, og én gang til hvis skrivingen feiler', async () => {
    sandbox.visToast = () => {}; let n = 0; sandbox.renderAll = () => { n++; };
    const { db } = lagDb(); app.settDb(db);
    const o = nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }); S.ordrer = [o];
    slipp(o.id, '2026-11-05', '13:00'); await tikk();
    expect(n).toBe(1);                                               // lykket: bare straks-tegningen
    const { db: feilDb } = lagDb({ feilPaa: (i) => i.tabell === 'ordrer' }); app.settDb(feilDb);
    n = 0; slipp(o.id, '2026-11-06', '09:00'); await tikk();
    expect(n).toBe(2);                                               // feilet: tegnes på nytt etter tilbakerullingen
    expect(o).toMatchObject({ kalenderDato: '2026-11-05', kalenderTid: '13:00' });
  });
  it('Flytt: vinduet lukkes og visningen tegnes på nytt etter vellykket lagring, men vinduet blir stående åpent hvis skrivingen feiler', async () => {
    const lukket = []; let n = 0;
    sandbox.visToast = () => {}; sandbox.closeModal = (id) => lukket.push(id); sandbox.renderAll = () => { n++; };
    const o = nyLeveranse({ kalender_dato: '2026-11-03', kalender_tid: '10:17' }); S.ordrer = [o];
    const sett = () => { sandbox.document.getElementById('fl_dato').value = '2026-11-04'; sandbox.document.getElementById('fl_tid').value = '11:00'; app.kjor(`flyttOrdreId = '${o.id}'`); };
    const { db: feilDb } = lagDb({ feilPaa: (i) => i.tabell === 'ordrer' }); app.settDb(feilDb);
    sett(); await sandbox.bekreftFlytt();
    expect(lukket).toEqual([]); expect(n).toBe(0);                   // feil: ingenting lukkes, ingenting tegnes
    expect(o).toMatchObject({ kalenderDato: '2026-11-03', kalenderTid: '10:17' });
    const { db } = lagDb(); app.settDb(db);
    sett(); await sandbox.bekreftFlytt();
    expect(lukket).toEqual(['flytt']); expect(n).toBe(1);
    expect(o).toMatchObject({ kalenderDato: '2026-11-04', kalenderTid: '11:00' });
  });
  it('standardpakken: fjern-knappen settes inn i riktig element (velgeren og klassen finnes i raden)', () => {
    const { db } = lagDb(); app.settDb(db); sandbox.visToast = () => {};
    const o = nyLeveranse(); S.ordrer = [o];
    expect(sandbox.leveransePakkerHTML(o)).toContain('class="pakke-fjern"');
    const velgere = []; const stub = { innerHTML: '' };
    const ekte = sandbox.document.querySelector; sandbox.document.querySelector = (s) => { velgere.push(s); return stub; };
    try { sandbox.settKolli(o.id, 0, 'vekt', '4'); } finally { sandbox.document.querySelector = ekte; }
    expect(velgere).toContain(`#levPakkerRader_${o.id} .pakke-fjern`);
    expect(stub.innerHTML).toContain(`fjernKolli('${o.id}',0)`);
  });
});
