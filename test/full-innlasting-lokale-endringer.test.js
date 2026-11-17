import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { lastApp } from './helpers/app-harness.js';

// 2026-11-17 (Sentry JAVASCRIPT-K, «dokumenter forsvinner, men er tilbake etter F5»): 16.11 ble fire Vegvesen-dokumenter lagret
// mens sanntidsforbindelsen falt ut og utløste en full innlasting. Innlastingen leste ordren da bare 2 av 4 var lagret, og
// loadFromSupabase() la det gamle bildet over det nye (hele S.ordrer byttes ut). Nå beholdes det lokale objektet for en ordre
// som er endret på enheten etter at innlastingen startet, eller inntil 10 s før.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const dok = (n) => Array.from({ length: n }, (_, i) => ({ navn: 'dok-' + i + '.pdf', url: 'https://x/' + i }));
const rad = (id, kunde, antallDok) => ({ id, kunde, dokumenter: dok(antallDok), status: 'aktiv', ordre_status: 'ombygging' });

// Falsk Supabase: enhver kjede (.select().order().range() ...) gir { data, error:null }. Ordre-spørringen venter på `slipp()`,
// så testen selv avgjør hva som skjer lokalt mens innlastingen pågår, og hva databasen «leste».
function falskDb(ordreRader) {
  let slipp;
  const port = new Promise((ok) => { slipp = ok; });
  const kjede = (tabell) => {
    const svar = () => {
      if (tabell === 'ordrer') return port.then(() => ({ data: ordreRader(), error: null }));
      if (tabell === 'innstillinger') return Promise.resolve({ data: null, error: { message: 'ikke med i testen' } });
      return Promise.resolve({ data: [], error: null });
    };
    const p = new Proxy(function () {}, {
      get(_, k) {
        if (k === 'then') return (a, b) => svar().then(a, b);
        return () => p;
      },
    });
    return p;
  };
  return { db: { from: (t) => kjede(t), rpc: () => kjede('rpc') }, slipp: () => slipp() };
}

function oppsett() {
  const app = lastApp();
  expect(app.lasteFeil).toEqual([]);
  app.settMe({ id: 1, navn: 'TEST - ansatt', rolle: 'ansatt' });
  app.S.ordrer = [app.sandbox.dbToOrdre(rad('ord_1', 'TEST - kunde A', 2)), app.sandbox.dbToOrdre(rad('ord_2', 'TEST - kunde B', 1))];
  const lokal = app.S.ordrer[0];
  const f = falskDb(() => [rad('ord_1', 'TEST - kunde A', 2), rad('ord_2', 'TEST - kunde B (endret av kollega)', 3)]);
  app.settDb(f.db);
  return { app, lokal, slipp: f.slipp };
}
const finn = (app, id) => app.S.ordrer.find((o) => o.id === id);

describe('full innlasting overskriver ikke en ordre som nettopp er endret lokalt', () => {
  it('hendelsen 16.11: dokumenter lagres MENS innlastingen pågår, og databasen ble lest med bare 2 av 4', async () => {
    const { app, lokal, slipp } = oppsett();
    const last = app.sandbox.loadFromSupabase();
    lokal.dokumenter = dok(4);                       // det oppdater_ordre_dokument svarte
    app.sandbox.merkLokalOrdreEndring('ord_1');
    slipp();
    await last;
    expect(finn(app, 'ord_1')).toBe(lokal);          // samme objekt: den åpne ordren er ikke byttet ut
    expect(finn(app, 'ord_1').dokumenter).toHaveLength(4);
    // Ordren som IKKE er endret lokalt, får databasens ferske tilstand som før.
    expect(finn(app, 'ord_2').kunde).toBe('TEST - kunde B (endret av kollega)');
    expect(finn(app, 'ord_2').dokumenter).toHaveLength(3);
    expect(app.kjor('dokLoggListe.map(e => e.type)')).toContain('full_innlasting_beholdt_lokal');
  });

  it('kalibrering: uten lokal endring erstattes ordren av databasens tilstand', async () => {
    const { app, lokal, slipp } = oppsett();
    lokal.dokumenter = dok(4);                       // endret, men IKKE merket
    const last = app.sandbox.loadFromSupabase();
    slipp();
    await last;
    expect(finn(app, 'ord_1')).not.toBe(lokal);
    expect(finn(app, 'ord_1').dokumenter).toHaveLength(2);
  });

  it('en endring rett FØR innlastingen startet (skrivingen kan være underveis) beholdes også', async () => {
    const { app, lokal, slipp } = oppsett();
    lokal.dokumenter = dok(4);
    app.kjor("ordreLokaltEndretAt['ord_1'] = Date.now() - 8000");
    const last = app.sandbox.loadFromSupabase();
    slipp();
    await last;
    expect(finn(app, 'ord_1')).toBe(lokal);
  });

  it('en GAMMEL lokal endring (over 10 s før innlastingen) beskytter ikke: databasen gjelder', async () => {
    const { app, lokal, slipp } = oppsett();
    lokal.dokumenter = dok(4);
    app.kjor("ordreLokaltEndretAt['ord_1'] = Date.now() - 11000");
    const last = app.sandbox.loadFromSupabase();
    slipp();
    await last;
    expect(finn(app, 'ord_1')).not.toBe(lokal);
    expect(finn(app, 'ord_1').dokumenter).toHaveLength(2);
  });

  it('alt som markerer et eget Realtime-ekko (save() og de målrettede skrivingene) merker også ordren som lokalt endret', async () => {
    const { app, lokal, slipp } = oppsett();
    const last = app.sandbox.loadFromSupabase();
    lokal.kunde = 'TEST - kunde A (rettet lokalt)';
    app.kjor("ignorerRealtimeFor.add('ord_1')");
    expect(app.kjor("ignorerRealtimeFor.has('ord_1')")).toBe(true);
    slipp();
    await last;
    expect(finn(app, 'ord_1')).toBe(lokal);
    expect(finn(app, 'ord_1').kunde).toBe('TEST - kunde A (rettet lokalt)');
  });

  it('kildekode-vakter: dokumentskrivingene merker ordren, og save() går via ignorerRealtimeFor.add', () => {
    const vegvesen = les('js/vegvesen-dokumenter.js');
    expect(vegvesen).toContain("merkLokalOrdreEndring(ordreId);\n  dokLogg('dok_lagre'");
    expect(vegvesen).toContain("merkLokalOrdreEndring(id);\n    dokLogg('dok_lagre'");
    expect(les('js/ordre-diverse.js')).toContain("merkLokalOrdreEndring(m.id);\n    dokLogg('dok_slett'");
    expect(les('js/core.js')).toMatch(/function save\(ordreId\) \{[\s\S]{0,400}ignorerRealtimeFor\.add\(ordreId\);/);
  });
});

describe('Sentry er av på utviklingsmaskinen (localhost)', () => {
  function lastCore(hostname) {
    const skript = [];
    const sandbox = {
      console: { log() {}, error() {}, warn() {}, info() {} },
      Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp, Proxy,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      window: { addEventListener() {}, location: { hostname } },
      navigator: { onLine: true },
      document: {
        addEventListener() {}, getElementById() { return null; }, visibilityState: 'visible',
        createElement() { return { style: {} }; },
        body: { appendChild() {} }, head: { appendChild(el) { skript.push(el.src); } },
      },
      location: { hostname },
      setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: undefined,
    };
    vm.createContext(sandbox);
    vm.runInContext(les('js/core.js'), sandbox, { filename: 'core.js' });
    return skript.filter((s) => /sentry/.test(s || ''));
  }
  it('localhost og 127.0.0.1: Sentry-skriptet lastes ikke', () => {
    expect(lastCore('localhost')).toEqual([]);
    expect(lastCore('127.0.0.1')).toEqual([]);
  });
  it('salmaker.as: Sentry-skriptet lastes som før', () => {
    expect(lastCore('salmaker.as')).toHaveLength(1);
  });
});
