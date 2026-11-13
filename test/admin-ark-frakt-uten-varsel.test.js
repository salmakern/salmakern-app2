import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// «Bestill frakt»: mulighet til å IKKE sende e-post/kopi til kontaktpersonen (Henrik
// 2026-11-13: «når man bestiller frakt så må det være mulig å gjøre sånn at det ikke blir
// sendt mail til kontakt person, at man bare kan merkere den», presisert «men det må være
// mulig å velge» - altså en avkrysning i dialogen, IKKE en permanent oppførselsendring).
// Avklart med Henrik: for et EKTE fraktselskap sendes bestillingen til fraktselskapet som
// før, bare UTEN kontaktpersonen på kopi. For «Hente selv» finnes ingen annen mottaker i
// det hele tatt, så avkrysningen betyr da «ingen e-post, bare merk klar for henting».
//
// Samtidig retter dette en reell blokkering: kontaktEpost var FØR påkrevd for å i det hele
// tatt ÅPNE dialogen (også for et ekte fraktselskap, der kontaktpersonen bare er på kopi) -
// manglet den, kunne man ikke bestille frakt i det hele tatt. Nå kreves den bare når man
// FAKTISK skal sende noe til kontaktpersonen.

const app = lastApp();
const { sandbox, S } = app;
const EKTE = { closeModal: sandbox.closeModal, renderAll: sandbox.renderAll, visToast: sandbox.visToast, edgeFetch: sandbox.edgeFetch };
afterEach(() => { Object.assign(sandbox, EKTE); });

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
    db: { from: (tabell) => { const info = { tabell, kall: [] }; kall.push(info); return kjede(info); } },
  };
}

function edgeFake(svar = () => ({ status: 200, tekst: '{"ok":true}' })) {
  const kall = [];
  sandbox.edgeFetch = async (fn, init) => {
    kall.push({ fn, body: init?.body ? JSON.parse(init.body) : null });
    const s = svar(fn, kall[kall.length - 1].body);
    return { ok: s.status >= 200 && s.status < 300, status: s.status, text: async () => s.tekst, json: async () => JSON.parse(s.tekst) };
  };
  return kall;
}

const KONTAKTER_MED_EPOST = [
  { type: 'Fraktselskap', navn: 'TEST Frakt', epost: 'frakt@selskap.test' },
  { type: 'Forhandler', navn: 'TEST Kunde AS', epost: 'k@t.test', kontaktpersoner: [{ navn: 'TEST Kontakt', epost: 'kontakt@t.test' }] },
];
const KONTAKTER_UTEN_EPOST_PAA_KONTAKT = [
  { type: 'Fraktselskap', navn: 'TEST Frakt', epost: 'frakt@selskap.test' },
  { type: 'Forhandler', navn: 'TEST Kunde AS', kontaktpersoner: [{ navn: 'TEST Kontakt' }] }, // ingen epost noe sted
];

function nyBilOrdre(chassisNr = 'TESTWXYZ0000000A1') {
  return sandbox.dbToOrdre({ id: 'ord_TESTFRAKT1', status: 'aktiv', ordre_status: 'klar_henting', chassis: chassisNr, kunde: 'TEST Kunde AS', eier: 'TEST Kontakt' });
}

beforeEach(() => {
  S.ordrer = [nyBilOrdre()];
  S.kontakter = structuredClone(KONTAKTER_MED_EPOST);
  S.adminArk = [{ id: 'ark_TESTFRAKT1', chassisNr: 'TESTWXYZ0000000A1', aar: new Date().getFullYear(), arkivert: false, fraktselskap: 'TEST Frakt', kontaktperson: '', forhandler: '', bestiltFrakt: false, _db: true }];
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  app.settAktivOrdre(null);
  const { db } = lagDb();
  app.settDb(db);
});

async function aapneOgSend(chassisNr, { ikkeVarsleKontakt = false, dato } = {}) {
  await sandbox.adminArkFraktBestill(chassisNr);
  sandbox.document.getElementById('kfh_ikkeVarsleKontakt').checked = ikkeVarsleKontakt;
  if (dato !== undefined) sandbox.document.getElementById('kfh_dato').value = dato;
  await sandbox.adminArkSendFraktBestilling();
}

describe('Bestill frakt (ekte fraktselskap): avkrysning "ikke send kopi til kontaktperson"', () => {
  it('uten avkrysning (standard): sender bestilling til fraktselskapet MED kontaktpersonen på kopi - uendret oppførsel', async () => {
    const kall = edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: false });
    expect(kall).toHaveLength(1);
    expect(kall[0].fn).toBe('send-frakt-epost');
    expect(kall[0].body.type).toBe('bestilling');
    expect(kall[0].body.fraktselskapEpost).toBe('frakt@selskap.test');
    expect(kall[0].body.kontaktpersonEpost).toBe('kontakt@t.test');
  });

  it('MED avkrysning: sender fortsatt til fraktselskapet, men UTEN kontaktpersonen på kopi', async () => {
    const kall = edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: true });
    expect(kall).toHaveLength(1);
    expect(kall[0].body.type).toBe('bestilling');
    expect(kall[0].body.fraktselskapEpost).toBe('frakt@selskap.test'); // selve bestillingen går fortsatt ut
    expect(kall[0].body.kontaktpersonEpost).toBeUndefined(); // men ingen kopi
  });

  it('kontaktpersonen mangler e-post i Kontakter OG avkrysningen er AV: blokkeres med en tydelig feil, ingen e-post sendt', async () => {
    S.kontakter = structuredClone(KONTAKTER_UTEN_EPOST_PAA_KONTAKT);
    const kall = edgeFake();
    const toasts = [];
    sandbox.visToast = (m) => toasts.push(m);
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: false });
    expect(kall).toHaveLength(0);
    expect(toasts.some((t) => /ikke varsle kontaktpersonen/.test(t))).toBe(true);
  });

  it('kontaktpersonen mangler e-post i Kontakter, men avkrysningen er PÅ: sender likevel til fraktselskapet (dette var tidligere umulig)', async () => {
    S.kontakter = structuredClone(KONTAKTER_UTEN_EPOST_PAA_KONTAKT);
    const kall = edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: true });
    expect(kall).toHaveLength(1);
    expect(kall[0].body.fraktselskapEpost).toBe('frakt@selskap.test');
    expect(kall[0].body.kontaktpersonEpost).toBeUndefined();
  });

  it('markerer Bestilt frakt på ordren i begge tilfeller (med og uten avkrysning)', async () => {
    edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: true, dato: '2026-12-01' });
    expect(S.ordrer[0].bestiltFrakt).toBe(true);
    expect(S.ordrer[0].henteKlarDato).toBe('2026-12-01');
  });

  it('logglinjen nevner at kontaktpersonen ikke ble varslet, kun når avkrysningen faktisk ble brukt', async () => {
    edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: true });
    const siste = S.ordrer[0].endringer.at(-1);
    expect(siste.txt).toMatch(/ikke varslet kontaktperson/);
  });

  it('uten avkrysning: logglinjen er uendret (ingen nevnelse av kontaktperson-varsling)', async () => {
    edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: false });
    const siste = S.ordrer[0].endringer.at(-1);
    expect(siste.txt).not.toMatch(/ikke varslet kontaktperson/);
  });
});

describe('Bestill frakt (Hente selv): avkrysning betyr "ingen e-post, bare merk"', () => {
  beforeEach(() => {
    S.adminArk[0].fraktselskap = 'Hente selv';
  });

  it('uten avkrysning (standard): sender «klar for henting»-varsel til kontaktpersonen - uendret oppførsel', async () => {
    const kall = edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: false });
    expect(kall).toHaveLength(1);
    expect(kall[0].body.type).toBe('klar_for_henting');
    expect(kall[0].body.kontaktpersonEpost).toBe('kontakt@t.test');
  });

  it('MED avkrysning: ingen e-post sendes i det hele tatt, men ordren merkes likevel klar for henting', async () => {
    const kall = edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: true });
    expect(kall).toHaveLength(0);
    expect(S.ordrer[0].bestiltFrakt).toBe(true);
  });

  it('kontaktpersonen mangler e-post OG avkrysningen er PÅ: fungerer likevel (ingen e-post trengs)', async () => {
    S.kontakter = structuredClone(KONTAKTER_UTEN_EPOST_PAA_KONTAKT);
    const kall = edgeFake();
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: true });
    expect(kall).toHaveLength(0);
    expect(S.ordrer[0].bestiltFrakt).toBe(true);
  });

  it('krever fortsatt en dato, uansett avkrysning (uendret regel for Hente selv)', async () => {
    const kall = edgeFake();
    const toasts = [];
    sandbox.visToast = (m) => toasts.push(m);
    await aapneOgSend('TESTWXYZ0000000A1', { ikkeVarsleKontakt: true, dato: '' });
    expect(kall).toHaveLength(0);
    expect(toasts).toContain('Velg en dato');
    expect(S.ordrer[0].bestiltFrakt).toBeFalsy();
  });
});
