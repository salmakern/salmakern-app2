import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// save() sender nå én lagring om gangen per ordre (2026-11-03). Før dette ble to tette save() på samme ordre sendt som to SAMTIDIGE forespørsler som kunne lande i feil rekkefølge:
// den eldste sto da igjen i databasen mens skjermen viste den nyeste. Målt mot den ekte databasen: 2 av 12 par med 0 ms mellomrom endte med den gamle verdien.
// Testene bruker en falsk db der testen selv avgjør når hver forespørsel er ferdig, så rekkefølgen kan kontrolleres nøyaktig.

const app = lastApp();
const { sandbox, S } = app;

function styrtDb() {
  const ventende = []; const payloads = [];
  const db = { from: () => ({ upsert: (payload) => { payloads.push(payload); return new Promise((ok, feil) => ventende.push({ ok, feil })); } }) };
  return { db, ventende, payloads };
}
const OK = { error: null }, FEIL = { error: { message: 'nettfeil' } };
const tikk = () => new Promise((ok) => setTimeout(ok, 0));
const nyOrdre = (id, notater = '') => sandbox.dbToOrdre({ id, status: 'aktiv', ordre_status: 'ikke_paabegynt', regnr: 'AB12345', kunde: 'TEST', notater });

beforeEach(() => {
  S.ordrer = [nyOrdre('o1'), nyOrdre('o2')];
  app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' });
  sandbox.visToast = () => {};
});
afterAll(() => { app.settDb(null); });

describe('save(): én lagring om gangen per ordre', () => {
  it('en enkelt lagring sendes umiddelbart og gir null ved suksess', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    const p = sandbox.save('o1');
    expect(payloads).toHaveLength(1);
    ventende[0].ok(OK);
    expect(await p).toBe(null);
  });

  it('to tette lagringer sendes IKKE samtidig: den andre venter til den første er ferdig, og bærer den nyeste tilstanden', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    S.ordrer[0].notater = 'A';
    const p1 = sandbox.save('o1');
    S.ordrer[0].notater = 'B';
    const p2 = sandbox.save('o1');
    await tikk();
    expect(payloads).toHaveLength(1);                       // bare den første er sendt
    expect(payloads[0].notater).toBe('A');
    ventende[0].ok(OK); await tikk();
    expect(payloads).toHaveLength(2);                       // oppfølgeren starter først nå
    expect(payloads[1].notater).toBe('B');
    ventende[1].ok(OK);
    expect(await p1).toBe(null); expect(await p2).toBe(null);
  });

  it('selv om den første forespørselen er TREG (ferdig lenge etter), kan den eldste verdien aldri stå igjen sist', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    S.ordrer[0].notater = 'gammel'; sandbox.save('o1');
    S.ordrer[0].notater = 'ny'; const p2 = sandbox.save('o1');
    await tikk(); await tikk();
    expect(payloads.map((p) => p.notater)).toEqual(['gammel']);    // venter fortsatt på den første
    ventende[0].ok(OK); await tikk();
    ventende[1].ok(OK); await p2;
    expect(payloads.map((p) => p.notater)).toEqual(['gammel', 'ny']);  // rekkefølgen til databasen er alltid eldst -> nyest
  });

  it('flere lagringer mens én pågår slås sammen til ÉN oppfølger med sist lokale tilstand (ikke én forespørsel per kall)', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    S.ordrer[0].notater = '1'; const p1 = sandbox.save('o1');
    S.ordrer[0].notater = '2'; const p2 = sandbox.save('o1');
    S.ordrer[0].notater = '3'; const p3 = sandbox.save('o1');
    S.ordrer[0].notater = '4'; const p4 = sandbox.save('o1');
    expect(p2).toBe(p3); expect(p3).toBe(p4);                // samme oppfølger
    ventende[0].ok(OK); await tikk();
    expect(payloads.map((p) => p.notater)).toEqual(['1', '4']);
    ventende[1].ok(OK);
    await Promise.all([p1, p2, p3, p4]);
    expect(ventende).toHaveLength(2);
  });

  it('en lagring etter at køen er tom sendes straks igjen (køen henger ikke igjen)', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    const p1 = sandbox.save('o1'); ventende[0].ok(OK); await p1; await tikk();
    sandbox.save('o1');
    expect(payloads).toHaveLength(2);                        // sendt umiddelbart, ikke satt i kø
    ventende[1].ok(OK);
  });

  it('oppfølgeren leser ordren fra S.ordrer når den SENDES: byttes objektet ut underveis (Realtime), brukes det nye', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    sandbox.save('o1'); const p2 = sandbox.save('o1');
    S.ordrer[0] = nyOrdre('o1', 'ERSTATTET');                   // nytt objekt med samme id
    ventende[0].ok(OK); await tikk();
    expect(payloads.map((p) => p.notater)).toEqual(['', 'ERSTATTET']);
    ventende[1].ok(OK); await p2;
  });

  it('ulike ordrer blokkerer ikke hverandre', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    sandbox.save('o1'); sandbox.save('o2');
    expect(payloads.map((p) => p.id)).toEqual(['o1', 'o2']);   // begge i gang samtidig
    ventende[0].ok(OK); ventende[1].ok(OK); await tikk();
  });

  it('feiler den første lagringen, sendes oppfølgeren likevel (den bærer jo den nyeste tilstanden), og feilen havner i offline-køen', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    S.ordrer[0].notater = 'A'; const p1 = sandbox.save('o1');
    S.ordrer[0].notater = 'B'; const p2 = sandbox.save('o1');
    ventende[0].ok(FEIL); await tikk();
    expect(payloads.map((p) => p.notater)).toEqual(['A', 'B']);
    expect(await p1).toBe('nettfeil');
    ventende[1].ok(OK);
    expect(await p2).toBe(null);
    expect(app.kjor("offlineKo.has('o1')")).toBe(false);     // oppfølgeren lyktes, så ordren er ikke lenger i køen
  });

  it('kaster forespørselen (nettverksfeil), frigjøres køen og oppfølgeren sendes', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    S.ordrer[0].notater = 'A'; const p1 = sandbox.save('o1').catch((e) => e.message);
    S.ordrer[0].notater = 'B'; const p2 = sandbox.save('o1');
    ventende[0].feil(new Error('brudd')); await tikk();
    expect(payloads.map((p) => p.notater)).toEqual(['A', 'B']);
    ventende[1].ok(OK);
    expect(await p1).toBe('brudd'); expect(await p2).toBe(null);
    const { db: db2, ventende: v2, payloads: p3 } = styrtDb(); app.settDb(db2);
    sandbox.save('o1'); expect(p3).toHaveLength(1); v2[0].ok(OK);      // køen er ledig igjen
  });

  it('ingen db, ingen id eller ukjent ordre: ingenting sendes og svaret er null', async () => {
    const { db, payloads } = styrtDb(); app.settDb(null);
    expect(await sandbox.save('o1')).toBe(null);
    app.settDb(db);
    expect(await sandbox.save('')).toBe(null);
    expect(await sandbox.save('finnes-ikke')).toBe(null);
    expect(payloads).toHaveLength(0);
  });

  it('en ordre som slettes mens oppfølgeren venter, gir ingen ny forespørsel og ingen feil', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    sandbox.save('o1'); const p2 = sandbox.save('o1');
    S.ordrer = S.ordrer.filter((o) => o.id !== 'o1');
    ventende[0].ok(OK);
    expect(await p2).toBe(null);
    expect(payloads).toHaveLength(1);
  });

  it('en forespørsel som henger stopper ikke senere lagringer for alltid: oppfølgeren starter etter 30 s', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    const timere = []; const ekte = sandbox.setTimeout; sandbox.setTimeout = (f, ms) => { timere.push({ f, ms }); return 0; };
    try {
      S.ordrer[0].notater = 'A'; sandbox.save('o1');
      S.ordrer[0].notater = 'B'; const p2 = sandbox.save('o1');
      await tikk();
      expect(payloads).toHaveLength(1);                         // den første henger (ventende[0] avgjøres aldri)
      const frist = timere.find((x) => x.ms === 30000);
      expect(frist).toBeTruthy();
      frist.f(); await tikk();
      expect(payloads.map((p) => p.notater)).toEqual(['A', 'B']);
      ventende[0].ok(OK); await tikk();                         // den hengende kommer til slutt MENS oppfølgeren fortsatt pågår: den frigjør ikke oppfølgerens plass
      sandbox.save('o1');
      expect(payloads).toHaveLength(2);                         // en ny lagring venter fortsatt (sendes ikke samtidig med oppfølgeren)
      ventende[1].ok(OK);
      expect(await p2).toBe(null); await tikk();
      expect(payloads).toHaveLength(3);                         // først nå sendes den
      ventende[2].ok(OK);
    } finally { sandbox.setTimeout = ekte; }
  });

  it('innholdet i lagringen er som før: status, endringer og de atomiske feltene sendes aldri med', async () => {
    const { db, ventende, payloads } = styrtDb(); app.settDb(db);
    sandbox.save('o1'); ventende[0].ok(OK); await tikk();
    for (const k of ['status', 'ordre_status', 'godkjent', 'godkjenner_navn', 'endringer', 'ansatte_signert', 'ordre_timer_sessions', 'klargjoring_timer_sessions', 'fiken_linjer', 'vekter', 'fiken_kladd_url']) expect(k in payloads[0]).toBe(false);
    expect(payloads[0].id).toBe('o1');
  });

  it('Realtime-ekkoet for ordren ignoreres (markeringen settes for HVER save, også oppfølgeren)', async () => {
    const { db, ventende } = styrtDb(); app.settDb(db);
    app.kjor("ignorerRealtimeFor.delete('o1')");
    sandbox.save('o1'); sandbox.save('o1');
    expect(app.kjor("ignorerRealtimeFor.has('o1')")).toBe(true);
    ventende[0].ok(OK); await tikk(); ventende[1].ok(OK);
  });
});
