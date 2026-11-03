import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// 2026-11-02: den første NYE ordren etter 30.10 fikk `vekter` = {} fra kolonnens default (save() skriver ikke vekter siden
// s09-005), og dbToOrdre beholdt det tomme objektet. tvangsflyt() leste o.vekter.totalvekt.a og kastet, og Ordre-siden
// ble tom for ALLE brukere («67 ordrer», ingen kort). Testene under holder både roten (dbToOrdre normaliserer vekter) og
// nettet under (ett ødelagt ordrekort kan aldri blanke lista).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../js/' + f), 'utf8').replace(/\r\n/g, '\n');
const coreKode = les('core.js');

function nyttMiljo() {
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp, Proxy,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: {
      addEventListener() {}, getElementById() { return null; },
      createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; },
      body: { appendChild() {} }, head: { appendChild() {} },
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  return sandbox;
}

const TOM = { a: '', e: '', v: '' };
const FELT = ['totalvekt', 'vogntog', 'foraksel', 'bakaksel'];

describe('normaliserVekter', () => {
  it('tomt objekt (kolonnens default for en ny ordre) gir alle fire vektfelt med a/e/v', () => {
    const v = nyttMiljo().normaliserVekter({});
    FELT.forEach((k) => expect(v[k]).toEqual(TOM));
  });

  it('null, undefined, tekst og liste gir også full struktur', () => {
    const m = nyttMiljo();
    [null, undefined, '', 'x', 5, []].forEach((x) => {
      const v = m.normaliserVekter(x);
      FELT.forEach((k) => expect(v[k]).toEqual(TOM));
    });
  });

  it('beholder innfylte verdier og fyller bare det som mangler', () => {
    const v = nyttMiljo().normaliserVekter({
      totalvekt: { a: '3500', e: '3490', v: '3510' },
      vogntog: { a: '7000' },
      foraksel: null,
    });
    expect(v.totalvekt).toEqual({ a: '3500', e: '3490', v: '3510' });
    expect(v.vogntog).toEqual({ a: '7000', e: '', v: '' });
    expect(v.foraksel).toEqual(TOM);
    expect(v.bakaksel).toEqual(TOM);
  });

  it('beholder ukjente nøkler (f.eks. en framtidig vekt) uendret', () => {
    const v = nyttMiljo().normaliserVekter({ totalvekt: TOM, tilhenger: { a: '750' } });
    expect(v.tilhenger).toEqual({ a: '750' });
  });

  it('muterer ikke inndataene (databaseraden er delt)', () => {
    const inn = { vogntog: { a: '1' } };
    nyttMiljo().normaliserVekter(inn);
    expect(inn).toEqual({ vogntog: { a: '1' } });
  });
});

describe('dbToOrdre og vekter', () => {
  it('en ordre med vekter = {} gir en ordre der o.vekter.totalvekt.a kan leses (det tvangsflyt() gjør)', () => {
    const o = nyttMiljo().dbToOrdre({ id: 'ord_1', vekter: {} });
    expect(() => o.vekter.totalvekt.a).not.toThrow();
    expect(o.vekter.totalvekt.a).toBe('');
  });

  it('manglende vekter-kolonne (select uten den) gir også full struktur', () => {
    const o = nyttMiljo().dbToOrdre({ id: 'ord_1' });
    FELT.forEach((k) => expect(o.vekter[k]).toEqual(TOM));
  });

  it('ekte vekter fra databasen kommer uendret gjennom', () => {
    const o = nyttMiljo().dbToOrdre({ id: 'ord_1', vekter: { totalvekt: { a: '3500', e: '', v: '' }, vogntog: TOM, foraksel: TOM, bakaksel: TOM } });
    expect(o.vekter.totalvekt.a).toBe('3500');
  });

  it('Realtime-hendelse for en ordre med vekter = {} gir også full struktur', () => {
    const m = nyttMiljo();
    const gammel = m.dbToOrdre({ id: 'ord_1', vekter: {} });
    const ny = m.dbToOrdreFraRealtime(gammel, { id: 'ord_1', vekter: {} });
    expect(ny.vekter.totalvekt).toEqual(TOM);
  });
});

describe('renderOrdreList: ett ødelagt ordrekort skal ikke blanke lista', () => {
  const kode = les('oversikt-kalender.js');
  const start = kode.indexOf('function renderOrdreList');
  const slutt = kode.indexOf('function ordreKortFeilHTML');

  it('vakt: kortet bygges i try/catch som gir et feilkort for den ene ordren', () => {
    expect(start).toBeGreaterThan(-1);
    expect(slutt).toBeGreaterThan(start);
    const lista = kode.slice(start, slutt);
    expect(lista).toMatch(/alle\.map\(o=>\{\s*try \{/);
    expect(lista).toMatch(/catch \(e\) \{ return ordreKortFeilHTML\(o, e\); \}/);
  });

  it('ordreKortFeilHTML gir et kort med ordre-id og logger, og kaster aldri selv om ordren er null', () => {
    const loggede = [];
    const sandbox = {
      console: { error: (...a) => loggede.push(a) },
      Set, String, window: {},
      esc: (s) => String(s).replace(/</g, '&lt;'),
    };
    vm.createContext(sandbox);
    vm.runInContext(kode.slice(slutt, kode.indexOf('\n}\n', slutt) + 3).replace(/^const ordreKortFeilMeldt[^\n]*\n/m, ''), sandbox);
    vm.runInContext('const ordreKortFeilMeldt = new Set();', sandbox);
    const html = vm.runInContext('ordreKortFeilHTML({id:"ord_9", chassis:"AB<C"}, new Error("x"))', sandbox);
    expect(html).toContain('Ordren kan ikke vises i lista');
    expect(html).toContain('AB&lt;C');
    expect(loggede.length).toBe(1);
    expect(() => vm.runInContext('ordreKortFeilHTML(null, null)', sandbox)).not.toThrow();
  });
});

// Revisjon 2026-11-02 (samme feilklasse): bilder_ankomst/levering har default '[]', og `[].every(Boolean)` er sant, så en ordre
// opprettet utenom appen så ut som «6 bilder ankomst» var oppfylt uten ett bilde.
describe('normaliserBilder', () => {
  it('tom liste, {}, null og feil type gir faste, tomme plasser', () => {
    const m = nyttMiljo();
    for (const x of [[], {}, null, undefined, 'x', 5]) {
      expect(m.normaliserBilder(x, 6)).toEqual([null, null, null, null, null, null]);
      expect(m.normaliserBilder(x, 3)).toEqual([null, null, null]);
    }
  });
  it('beholder innfylte bilder på riktig plass, og ekstra bilder ut over antallet røres ikke', () => {
    const m = nyttMiljo();
    expect(m.normaliserBilder(['a', null, 'c'], 6)).toEqual(['a', null, 'c', null, null, null]);
    expect(m.normaliserBilder(['1', '2', '3', '4'], 3)).toEqual(['1', '2', '3', '4']);
  });
  it('tomme strenger og andre falske verdier blir null (en tom plass er alltid null)', () => {
    expect(nyttMiljo().normaliserBilder(['', 0, 'x'], 3)).toEqual([null, null, 'x']);
  });
  it('en ordre med bilder_ankomst = [] har IKKE «6 bilder ankomst» oppfylt', () => {
    const o = nyttMiljo().dbToOrdre({ id: 'ord_1', bilder_ankomst: [], bilder_levering: [] });
    expect(o.bilderAnkomst.every(Boolean)).toBe(false);
    expect(o.bilderLevering.every(Boolean)).toBe(false);
    expect(o.bilderAnkomst).toHaveLength(6);
  });
  it('seks bilder gir fortsatt oppfylt', () => {
    const seks = ['1', '2', '3', '4', '5', '6'];
    const o = nyttMiljo().dbToOrdre({ id: 'ord_1', bilder_ankomst: seks });
    expect(o.bilderAnkomst.every(Boolean)).toBe(true);
  });
});
