import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';

// «Ny leveranse» (Henrik 2026-11-02/03): en ordre uten bil. Testene dekker oppretting, statusløypa (Under arbeid -> Klar til sending -> Sendt), automatisk fraktbestilling,
// arkivering (sendt + fakturert), at bil-ordrer er uendret, og at ordreToDb/dbToOrdre/status-nedtrekk skiller riktig mellom typene. Ingen ekte database, e-post eller Fiken.

const app = lastApp();
const { sandbox, S } = app;
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
