import { describe, it, expect, beforeEach } from 'vitest';
import { loadScript } from './helpers/load-script.js';

// Dekker koblingen mellom den daglige lønnsklokka og Ombygging-klokka (bedt om av Henrik
// 2026-10-26 etter en reell produksjonsbug: en ansatt stemplet ut på vanlig Timer, men
// Ombygging-klokka på ordren han var meldt på fortsatt stod og gikk synlig). Stubber
// ordreAktivFase/ansattHarApenOrdreSesjon/start-/stoppOrdreTimerForAnsatt (hører egentlig
// til ordre-diverse.js) for å isolert verifisere SELEKSJONEN - hvilke ordre som faktisk
// blir stoppet/gjenopptatt - uten å trekke inn hele den filens øvrige avhengigheter.

function nyEnvironment() {
  const stoppKall = [];
  const startKall = [];
  const sandbox = {
    me: { id: 42, navn: 'Test Testesen' },
    db: {}, // kun truthy-sjekket (if (!me || !db) return;) - selve kallene er stubbet under
    S: { ordrer: [] },
    ansattHarApenOrdreSesjon(o, felt, ansattId) {
      return (o[felt]||[]).some(s => s.ansattId === ansattId && !s.stopp);
    },
    // Ekte ordreAktivFase()-logikk (kopiert, ikke stubbet) - kun 'paabegynt' gir en aktiv
    // fase siden Klargjøring bevisst IKKE er automatisert (se ordre-diverse.js, samme dato).
    ordreAktivFase(o) { return o.ordreStatus === 'paabegynt' ? 'ordreTimerSessions' : null; },
    async stoppOrdreTimerForAnsatt(o, felt, ansattId) { stoppKall.push({ ordreId: o.id, felt, ansattId }); },
    async startOrdreTimerForAnsatt(o, felt, ansattId) { startKall.push({ ordreId: o.id, felt, ansattId }); }
  };
  const env = loadScript('timer.js', sandbox);
  return { env, stoppKall, startKall, sandbox };
}

describe('stoppMineOrdreKlokkerVedUtstempling() - stopper MIN Ombygging-klokke ved utstempling', () => {
  let env, stoppKall, sandbox;
  beforeEach(() => { ({ env, stoppKall, sandbox } = nyEnvironment()); });

  it('stopper en åpen Ombygging-økt for meg selv', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'paabegynt', ordreTimerSessions: [{ ansattId: 42, start: 1, stopp: null }] }];
    await env.stoppMineOrdreKlokkerVedUtstempling();
    expect(stoppKall).toEqual([{ ordreId: 'ord_1', felt: 'ordreTimerSessions', ansattId: 42 }]);
  });

  it('rører IKKE en åpen økt som tilhører en ANNEN ansatt', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'paabegynt', ordreTimerSessions: [{ ansattId: 99, start: 1, stopp: null }] }];
    await env.stoppMineOrdreKlokkerVedUtstempling();
    expect(stoppKall).toEqual([]);
  });

  it('rører IKKE en allerede stoppet økt', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'ikke_veid', ordreTimerSessions: [{ ansattId: 42, start: 1, stopp: 2 }] }];
    await env.stoppMineOrdreKlokkerVedUtstempling();
    expect(stoppKall).toEqual([]);
  });

  it('stopper flere åpne ordre samtidig (glemt å melde av en gammel bil)', async () => {
    sandbox.S.ordrer = [
      { id: 'ord_1', ordreStatus: 'paabegynt', ordreTimerSessions: [{ ansattId: 42, start: 1, stopp: null }] },
      { id: 'ord_2', ordreStatus: 'paabegynt', ordreTimerSessions: [{ ansattId: 42, start: 1, stopp: null }] }
    ];
    await env.stoppMineOrdreKlokkerVedUtstempling();
    expect(stoppKall.map(k=>k.ordreId).sort()).toEqual(['ord_1', 'ord_2']);
  });

  it('rører ALDRI Klargjøring (ren manuell klokke, ingen kobling til lønnsklokka)', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'vist_biltilsyn', klargjoringTimerSessions: [{ ansattId: 42, start: 1, stopp: null }] }];
    await env.stoppMineOrdreKlokkerVedUtstempling();
    expect(stoppKall).toEqual([]);
  });

  it('gjør ingenting uten innlogget ansatt', async () => {
    // loadScript() kopierer ekstraGlobals inn i sitt EGET sandbox-objekt (env) - å
    // nullstille "me" må derfor skje på env, ikke på det opprinnelige sandbox-argumentet
    // (som fortsatt peker på det gamle objektet etter en toppnivå-reassignment).
    env.me = null;
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'paabegynt', ordreTimerSessions: [{ ansattId: 42, start: 1, stopp: null }] }];
    await env.stoppMineOrdreKlokkerVedUtstempling();
    expect(stoppKall).toEqual([]);
  });
});

describe('gjenopptaMineOrdreKlokkerVedInnstempling() - gjenopptar automatisk ved innstempling', () => {
  let env, startKall, sandbox;
  beforeEach(() => { ({ env, startKall, sandbox } = nyEnvironment()); });

  it('starter Ombygging-klokka for en ordre jeg er meldt på som står i "Påbegynt"', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'paabegynt', ansatteSignert: [{ id: 42 }], ordreTimerSessions: [] }];
    await env.gjenopptaMineOrdreKlokkerVedInnstempling();
    expect(startKall).toEqual([{ ordreId: 'ord_1', felt: 'ordreTimerSessions', ansattId: 42 }]);
  });

  it('starter IKKE hvis jeg ikke er meldt på ordren', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'paabegynt', ansatteSignert: [], ordreTimerSessions: [] }];
    await env.gjenopptaMineOrdreKlokkerVedInnstempling();
    expect(startKall).toEqual([]);
  });

  it('starter IKKE hvis ordren ikke står i en aktiv fase (f.eks. "Ikke veid")', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'ikke_veid', ansatteSignert: [{ id: 42 }], ordreTimerSessions: [] }];
    await env.gjenopptaMineOrdreKlokkerVedInnstempling();
    expect(startKall).toEqual([]);
  });

  it('starter IKKE på nytt hvis jeg allerede har en åpen økt (unngår duplikat)', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'paabegynt', ansatteSignert: [{ id: 42 }], ordreTimerSessions: [{ ansattId: 42, start: 1, stopp: null }] }];
    await env.gjenopptaMineOrdreKlokkerVedInnstempling();
    expect(startKall).toEqual([]);
  });

  it('starter ALDRI Klargjøring automatisk, selv om jeg er meldt på og status er "Vist på biltilsynet"', async () => {
    sandbox.S.ordrer = [{ id: 'ord_1', ordreStatus: 'vist_biltilsyn', ansatteSignert: [{ id: 42 }], klargjoringTimerSessions: [] }];
    await env.gjenopptaMineOrdreKlokkerVedInnstempling();
    expect(startKall).toEqual([]);
  });
});
