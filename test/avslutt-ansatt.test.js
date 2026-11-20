import { describe, it, expect, beforeEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// Sikkerhetsgjennomgang: den gamle «Deaktiver»-knappen (toggleAnsatt) satt kun aktiv=false - ingen
// bekreftelse, feil kun i konsollen, og PIN/push/stempling/ordreklokke ble stående ubrukt. Denne
// testen vokter de tre nye funksjonene i js/ansatte-utstyr.js: settAnsattInaktiv (rask, midlertidig,
// rører ikke PIN), reaktiverAnsattMedNyPin (krever alltid en ny 6-sifret PIN) og avsluttAnsatt (full
// tilgangssperring i ett atomisk databasekall, avslutt_ansatt() - se migrasjon
// 20261120100000_avslutt_ansatt.sql).

const app = lastApp();
const { sandbox, S } = app;

function lagFakeDb({ rpcSvar = {}, updateSvar = { data: [{ id: 1 }], error: null } } = {}) {
  const kall = [];
  const db = {
    from(tabell) {
      const q = { tabell, filtre: [] };
      const b = {
        update(r) { q.update = r; return b; },
        eq(k, v) { q.filtre.push(['eq', k, v]); return b; },
        then(res, rej) { kall.push(q); return Promise.resolve(updateSvar).then(res, rej); },
      };
      return b;
    },
    rpc(navn, args) {
      kall.push({ rpc: navn, args });
      const svar = rpcSvar[navn];
      if (svar instanceof Error) return Promise.reject(svar);
      return Promise.resolve(svar !== undefined ? svar : { data: null, error: null });
    },
  };
  return { db, kall };
}

function oppsett(ansatte, { rolle = 'admin', meId = 1 } = {}) {
  S.ansatte = ansatte;
  app.settMe({ id: meId, navn: 'TEST - Admin', rolle });
  sandbox.renderMer = () => {};
  sandbox.renderStempletInnNa = () => {};
  sandbox.renderPaaJobbNa = () => {};
}

let toasts;
beforeEach(() => {
  toasts = [];
  sandbox.visToast = (melding, type) => toasts.push({ melding, type });
  sandbox.confirm = () => true;
  sandbox.prompt = () => null;
  sandbox.alert = (m) => toasts.push({ melding: m, type: 'alert' });
});

describe('settAnsattInaktiv (rask, midlertidig - rører ikke PIN/push/klokke)', () => {
  it('avbrytes uten endring hvis admin ikke bekrefter', () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true };
    oppsett([a]);
    sandbox.confirm = () => false;
    const { db } = lagFakeDb();
    app.settDb(db);
    sandbox.settAnsattInaktiv(5);
    expect(a.aktiv).toBe(true);
  });

  it('setter aktiv=false optimistisk og lagrer i databasen', () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true };
    oppsett([a]);
    const { db, kall } = lagFakeDb();
    app.settDb(db);
    sandbox.settAnsattInaktiv(5);
    expect(a.aktiv).toBe(false);
    const upd = kall.find((k) => k.tabell === 'ansatte');
    expect(upd.update).toEqual({ aktiv: false });
    expect(upd.filtre).toEqual([['eq', 'id', 5]]);
  });

  it('ruller tilbake lokalt og varsler hvis lagringen feiler', async () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true };
    oppsett([a]);
    const { db } = lagFakeDb({ updateSvar: { data: null, error: { message: 'nettverksfeil' } } });
    app.settDb(db);
    sandbox.settAnsattInaktiv(5);
    await new Promise((r) => setTimeout(r, 0));
    expect(a.aktiv).toBe(true);
    expect(toasts.some((t) => t.melding.includes('nettverksfeil'))).toBe(true);
  });
});

describe('reaktiverAnsattMedNyPin (krever alltid en ny 6-sifret PIN)', () => {
  it('gjør ingenting hvis admin avbryter PIN-dialogen', () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: false };
    oppsett([a]);
    sandbox.prompt = () => null;
    const { db, kall } = lagFakeDb();
    app.settDb(db);
    sandbox.reaktiverAnsattMedNyPin(5);
    expect(a.aktiv).toBe(false);
    expect(kall.length).toBe(0);
  });

  it('avviser en PIN som ikke er nøyaktig 6 siffer, uten noe databasekall', () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: false };
    oppsett([a]);
    sandbox.prompt = () => '1234';
    const { db, kall } = lagFakeDb();
    app.settDb(db);
    sandbox.reaktiverAnsattMedNyPin(5);
    expect(kall.length).toBe(0);
    expect(toasts.some((t) => t.type === 'alert' && t.melding.includes('6 siffer'))).toBe(true);
  });

  it('PIN_I_BRUK: varsler og aktiverer IKKE', async () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: false };
    oppsett([a]);
    sandbox.prompt = () => '654321';
    const { db } = lagFakeDb({ rpcSvar: { admin_reaktiver_ansatt: { data: 'PIN_I_BRUK', error: null } } });
    app.settDb(db);
    sandbox.reaktiverAnsattMedNyPin(5);
    await new Promise((r) => setTimeout(r, 0));
    expect(a.aktiv).toBe(false);
    expect(toasts.some((t) => t.type === 'alert' && t.melding.includes('allerede i bruk'))).toBe(true);
  });

  it('en gyldig, ledig PIN aktiverer ansatten', async () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: false };
    oppsett([a]);
    sandbox.prompt = () => '654321';
    const { db, kall } = lagFakeDb({ rpcSvar: { admin_reaktiver_ansatt: { data: 'ok', error: null } } });
    app.settDb(db);
    sandbox.reaktiverAnsattMedNyPin(5);
    await new Promise((r) => setTimeout(r, 0));
    expect(a.aktiv).toBe(true);
    expect(kall[0]).toEqual({ rpc: 'admin_reaktiver_ansatt', args: { p_ansatt_id: 5, p_ny_pin: '654321' } });
    expect(toasts.some((t) => t.type === 'ok')).toBe(true);
  });

  it('feilmeldinger fra serveren vises forståelig (KUN_ADMIN, ANSATT_FINNES_IKKE, FOR_MANGE_FORSOK)', async () => {
    for (const [kode, treff] of [['KUN_ADMIN', 'Kun admin'], ['ANSATT_FINNES_IKKE', 'Fant ikke'], ['FOR_MANGE_FORSOK', 'For mange forsøk']]) {
      toasts = [];
      const a = { id: 5, navn: 'TEST - Ansatt', aktiv: false };
      oppsett([a]);
      sandbox.prompt = () => '654321';
      const { db } = lagFakeDb({ rpcSvar: { admin_reaktiver_ansatt: { data: null, error: { message: kode } } } });
      app.settDb(db);
      sandbox.reaktiverAnsattMedNyPin(5);
      await new Promise((r) => setTimeout(r, 0));
      expect(a.aktiv).toBe(false);
      expect(toasts.some((t) => t.melding.includes(treff))).toBe(true);
    }
  });
});

describe('avsluttAnsatt (full tilgangssperring i ett atomisk kall)', () => {
  it('kan ikke avslutte seg selv - ingen databasekall', () => {
    const a = { id: 1, navn: 'TEST - Admin', aktiv: true };
    oppsett([a], { meId: 1 });
    const { db, kall } = lagFakeDb();
    app.settDb(db);
    sandbox.avsluttAnsatt(1);
    expect(kall.length).toBe(0);
    expect(a.aktiv).toBe(true);
    expect(toasts.some((t) => t.type === 'alert' && t.melding.includes('ikke avslutte deg selv'))).toBe(true);
  });

  it('bare admin kan kalle den (vanlig ansatt: ingen effekt, ingen databasekall)', () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true };
    oppsett([a], { rolle: 'ansatt', meId: 1 });
    const { db, kall } = lagFakeDb();
    app.settDb(db);
    sandbox.avsluttAnsatt(5);
    expect(kall.length).toBe(0);
    expect(a.aktiv).toBe(true);
  });

  it('avbrytes uten endring hvis admin ikke bekrefter', async () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true };
    oppsett([a]);
    sandbox.confirm = () => false;
    const { db, kall } = lagFakeDb();
    app.settDb(db);
    await sandbox.avsluttAnsatt(5);
    expect(kall.length).toBe(0);
    expect(a.aktiv).toBe(true);
  });

  it('full gjennomgang: kaller avslutt_ansatt med riktig id, setter aktiv=false og stempletInnSiden=null lokalt, varsler med detaljer', async () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true, stempletInnSiden: new Date().toISOString() };
    oppsett([a]);
    const { db, kall } = lagFakeDb({
      rpcSvar: { avslutt_ansatt: { data: { ok: true, navn: 'TEST - Ansatt', timeRegistrert: true, ordreklokkerStoppet: 2 }, error: null } },
    });
    app.settDb(db);
    await sandbox.avsluttAnsatt(5);
    expect(kall[0]).toEqual({ rpc: 'avslutt_ansatt', args: { p_ansatt_id: 5 } });
    expect(a.aktiv).toBe(false);
    expect(a.stempletInnSiden).toBeNull();
    const toast = toasts.find((t) => t.type === 'ok');
    expect(toast.melding).toContain('siste arbeidsøkt registrert');
    expect(toast.melding).toContain('2 ordreklokke(r) stoppet');
  });

  it('en ren inaktivering (ingen tid/klokker) gir en enkel bekreftelse uten detaljer', async () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true };
    oppsett([a]);
    const { db } = lagFakeDb({ rpcSvar: { avslutt_ansatt: { data: { ok: true, navn: 'TEST - Ansatt', timeRegistrert: false, ordreklokkerStoppet: 0 }, error: null } } });
    app.settDb(db);
    await sandbox.avsluttAnsatt(5);
    expect(a.aktiv).toBe(false);
    const toast = toasts.find((t) => t.type === 'ok');
    expect(toast.melding).toBe('TEST - Ansatt er avsluttet');
  });

  it('feilmeldinger fra serveren vises forståelig og endrer ingenting lokalt', async () => {
    for (const [kode, treff] of [['KUN_ADMIN', 'Kun admin'], ['ANSATT_FINNES_IKKE', 'Fant ikke'], ['KAN_IKKE_AVSLUTTE_SEG_SELV', 'ikke avslutte deg selv']]) {
      toasts = [];
      const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true };
      oppsett([a]);
      const { db } = lagFakeDb({ rpcSvar: { avslutt_ansatt: { data: null, error: { message: kode } } } });
      app.settDb(db);
      await sandbox.avsluttAnsatt(5);
      expect(a.aktiv).toBe(true);
      expect(toasts.some((t) => t.melding.includes(treff))).toBe(true);
    }
  });

  it('en kastet feil (nettverk nede) fanges og varsles, endrer ingenting lokalt', async () => {
    const a = { id: 5, navn: 'TEST - Ansatt', aktiv: true };
    oppsett([a]);
    const { db } = lagFakeDb({ rpcSvar: { avslutt_ansatt: new Error('nettverk nede') } });
    app.settDb(db);
    await sandbox.avsluttAnsatt(5);
    expect(a.aktiv).toBe(true);
    expect(toasts.some((t) => t.melding.includes('nettverk nede'))).toBe(true);
  });
});
