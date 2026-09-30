import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Dekker sorterOrdre() sin nye henteKlarDato-sortering og bestiltFraktBadgeHTML() (js/
// core.js) - "Bestilt frakt" ble 2026-09-30 fjernet som ordreStatus-verdi og erstattet
// med en uavhengig kort-markering (samme mønster som `prioritert`), som nå også styrer
// sorteringen av ordrelistene ("mest hastverk øverst", bedt om av Henrik).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');

function nyEnvironment() {
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: { addEventListener() {}, getElementById() { return null; } },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox, { filename: 'core.js' });
  // STATUSER er const på toppnivå - vm.runInContext() eksponerer den ikke direkte som
  // egenskap på sandbox-objektet (kun function-deklarasjoner blir synlige slik), se
  // "Node vm-særtrekk" i CLAUDE.md. En liten ekstra kjøring i SAMME context deler
  // toppnivå-scope og kan derfor lese den "usynlige" bindingen.
  vm.runInContext('function _getStatuser(){ return STATUSER; }', sandbox);
  return sandbox;
}

describe('STATUSER - "Bestilt frakt" er ikke lenger en velgbar status', () => {
  it('finnes ikke i STATUSER-lista', () => {
    const env = nyEnvironment();
    expect(env._getStatuser().some(s => s.id === 'bestilt_frakt')).toBe(false);
  });
});

describe('sorterOrdre() - henteKlarDato ("mest hastverk øverst")', () => {
  it('ordre med nærmeste henteKlarDato kommer først', () => {
    const env = nyEnvironment();
    const a = { id: 'a', ordreStatus: 'paabegynt', henteKlarDato: '2026-10-05' };
    const b = { id: 'b', ordreStatus: 'paabegynt', henteKlarDato: '2026-10-01' };
    expect([a, b].sort(env.sorterOrdre)).toEqual([b, a]);
  });

  it('ordre MED henteKlarDato kommer før ordre UTEN, uavhengig av status', () => {
    const env = nyEnvironment();
    const medDato = { id: 'a', ordreStatus: 'ikke_paabegynt', henteKlarDato: '2026-12-01' };
    const utenDato = { id: 'b', ordreStatus: 'hentet', henteKlarDato: '' };
    expect([utenDato, medDato].sort(env.sorterOrdre)).toEqual([medDato, utenDato]);
  });

  it('prioritert vinner fortsatt over henteKlarDato', () => {
    const env = nyEnvironment();
    const prioritert = { id: 'a', ordreStatus: 'paabegynt', prioritert: true, henteKlarDato: '2026-12-31' };
    const hasterMest = { id: 'b', ordreStatus: 'paabegynt', prioritert: false, henteKlarDato: '2026-10-01' };
    expect([hasterMest, prioritert].sort(env.sorterOrdre)).toEqual([prioritert, hasterMest]);
  });

  it('uten noen henteKlarDato: faller tilbake til status- og ankomstdato-sortering som før', () => {
    const env = nyEnvironment();
    const hentet = { id: 'a', ordreStatus: 'hentet', ankomstdato: '2026-01-01' };
    const paabegynt = { id: 'b', ordreStatus: 'paabegynt', ankomstdato: '2026-01-01' };
    expect([paabegynt, hentet].sort(env.sorterOrdre)).toEqual([hentet, paabegynt]);
  });
});

describe('bestiltFraktBadgeHTML() - kort-merket som erstatter "Bestilt frakt"-statusen', () => {
  it('tom streng når bestiltFrakt er false', () => {
    const env = nyEnvironment();
    expect(env.bestiltFraktBadgeHTML({ bestiltFrakt: false }, 'right:12px')).toBe('');
  });

  it('"BESTILT FRAKT" når bestiltFrakt er true og ingen dato er valgt', () => {
    const env = nyEnvironment();
    const html = env.bestiltFraktBadgeHTML({ bestiltFrakt: true, henteKlarDato: '' }, 'right:12px');
    expect(html).toContain('BESTILT FRAKT');
    expect(html).not.toContain('HENTEKLAR');
  });

  it('"HENTEKLAR <dato>" (norsk DD.MM.YYYY-format) når en dato er valgt', () => {
    const env = nyEnvironment();
    const html = env.bestiltFraktBadgeHTML({ bestiltFrakt: true, henteKlarDato: '2026-10-05' }, 'right:12px');
    expect(html).toContain('HENTEKLAR 05.10.2026');
  });
});
