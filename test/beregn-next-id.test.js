import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// 2026-11-18: S.nextId (core.js, loadFromSupabase) ble regnet ut ved å strippe ALLE ikke-siffer
// fra hver timer-ID og tolke resten som ett tall. En normal timer-ID fra nyTimerId() (timer.js,
// format 't'+Date.now()+'_'+tilfeldig base36-streng) har en understrek OG tilfeldige sifre i
// suffiksen - stripping limer tidsstempelet og suffiks-sifrene sammen til et astronomisk tall.
// Det tallet ble S.nextId og dermed forsøkt brukt som ny ansatt.id (en ekte Postgres
// 'integer'-kolonne) - funnet i produksjon da en ekte sykmelding (ansatt 347) fikk id
// "t17938042281525372" på denne måten, og «+ Ny ansatt» deretter feilet med «value ... is out of
// range for type integer». Disse testene kalibrert til å FEILE på den gamle, strippende koden.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const core = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8').replace(/\r\n/g, '\n');

function miljo() {
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp, Proxy,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: { addEventListener() {}, getElementById() { return null; }, createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; }, body: { appendChild() {} }, head: { appendChild() {} } },
    location: { hostname: 'localhost' }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(core, sandbox, { filename: 'core.js' });
  return sandbox;
}

describe('tallEtterPrefiks', () => {
  it('leser tallet ut av en ren t<tall>-ID (det gamle telleverket)', () => {
    const { tallEtterPrefiks } = miljo();
    expect(tallEtterPrefiks('t', 't1234')).toBe(1234);
  });

  it('gir 0 for en ID med understrek og tilfeldig suffiks (nyTimerId-skjemaet) - ALDRI stripping', () => {
    const { tallEtterPrefiks } = miljo();
    expect(tallEtterPrefiks('t', 't1793804228152_53m71')).toBe(0);
  });

  it('gir 0 for en tadm_<ansattId>_<ms>-ID (admin-utstempling)', () => {
    const { tallEtterPrefiks } = miljo();
    expect(tallEtterPrefiks('t', 'tadm_347_1794809000468')).toBe(0);
  });

  it('gir 0 for feil prefiks', () => {
    const { tallEtterPrefiks } = miljo();
    expect(tallEtterPrefiks('u', 't1234')).toBe(0);
  });
});

describe('beregnNextId', () => {
  it('bunner på 101 uten noen rader', () => {
    const { beregnNextId } = miljo();
    expect(beregnNextId([], [], [])).toBe(101);
  });

  it('bruker høyeste ansatt.id + 1', () => {
    const { beregnNextId } = miljo();
    expect(beregnNextId([{ id: 17 }, { id: 990033 }], [], [])).toBe(990034);
  });

  it('bruker høyeste rene t<tall>-timer-ID + 1 (det gamle telleverket, fortsatt i bruk)', () => {
    const { beregnNextId } = miljo();
    expect(beregnNextId([], [{ id: 't500' }, { id: 't750' }], [])).toBe(751);
  });

  it('bruker høyeste u<tall>-utstyrMal-ID + 1', () => {
    const { beregnNextId } = miljo();
    expect(beregnNextId([], [], [{ id: 'u200' }])).toBe(201);
  });

  it('IGNORERER en nyTimerId()-ID med understrek og tilfeldig suffiks helt (den skal aldri kunne blåse opp nextId)', () => {
    const { beregnNextId } = miljo();
    expect(beregnNextId([{ id: 990033 }], [{ id: 't1793804228152_53m71' }], [])).toBe(990034);
  });

  it('IGNORERER en tadm_<ansattId>_<ms>-ID helt', () => {
    const { beregnNextId } = miljo();
    expect(beregnNextId([{ id: 990033 }], [{ id: 'tadm_347_1794809000468' }], [])).toBe(990034);
  });

  it('REGRESJONSTEST: den ekte, korrupte produksjons-IDen ("t17938042281525372") skal ikke blåse opp nextId', () => {
    const { beregnNextId } = miljo();
    // Denne IDen matcher t<tall> (ingen understrek) og ville - uten taket - blitt tolket som
    // et ekte, høyere telleverk. Taket (NEXTID_TAK) filtrerer den bort uansett.
    const resultat = beregnNextId([{ id: 990033 }], [{ id: 't17938042281525372' }], []);
    expect(resultat).toBe(990034);
    expect(resultat).toBeLessThan(2147483647); // Postgres sin 'integer'-grense
  });

  it('respekterer taket selv for en (hypotetisk) ekte, men urimelig stor ansatt.id', () => {
    const { beregnNextId } = miljo();
    const resultat = beregnNextId([{ id: 99999999999 }], [], []);
    expect(resultat).toBe(101); // den urimelige IDen filtreres bort, bunner på standardverdien
  });
});
