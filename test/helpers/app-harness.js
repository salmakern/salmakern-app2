// Laster HELE appen (alle js/*.js i salmakern.html sin rekkefølge) i én isolert vm-context med en forenklet DOM, slik at
// visningsfunksjonene kan kjøres mot en ordre uten at en nettleser trengs. Brukes av test/ordre-uventet-radform.test.js.
// DOM-en er bevisst enkel: getElementById gir et stubbet element som tar imot innerHTML/textContent/value og svelger alle
// metodekall. Alle feil (kast og console.error) fra en visning er derfor dataavhengige, ikke DOM-avhengige - det er
// forutsetningen testen bygger på (kalibrert ved at en ordre med bare kolonne-defaults må gå grønt, og at koden fra før
// 2026-11-02 kaster på den samme raden).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsDir = path.resolve(__dirname, '../../js');
// Samme rekkefølge som <script>-taggene i salmakern.html.
export const APP_FILER = [
  'core.js', 'oversikt-kalender.js', 'ordre-detalj.js', 'ordre-diverse.js', 'timer.js', 'arkiv-mer.js',
  'ansatte-utstyr.js', 'eksport-varsler.js', 'flate.js', 'lager.js', 'admin-ark.js', 'vegvesen-dokumenter.js', 'hms.js', 'leveranse.js',
];

function lagStub(elementer, id) {
  if (elementer.has(id)) return elementer.get(id);
  const lager = { id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [], checked: false, files: [], options: [] };
  const el = new Proxy(lager, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (k === 'querySelector' || k === 'closest') return () => null;
      if (k === 'querySelectorAll') return () => [];
      if (typeof k === 'symbol') return undefined;
      return () => undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  elementer.set(id, el);
  return el;
}

export function lastApp(rotmappe = path.resolve(__dirname, '../..')) {
  const elementer = new Map();
  const consoleFeil = [];
  const sandbox = {
    console: { log() {}, warn() {}, info() {}, error: (...a) => consoleFeil.push(a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 240)) },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp, Proxy, Intl, Error, TypeError,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, structuredClone,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'vitest', onLine: true },
    location: { hostname: 'localhost', href: 'http://localhost/', search: '', hash: '' },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    fetch: undefined, requestAnimationFrame() {}, alert() {}, confirm() { return true; }, prompt() { return null; },
    scrollTo() {}, scrollBy() {}, scrollY: 0, scrollX: 0, innerWidth: 1280, innerHeight: 800,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.document = {
    addEventListener() {}, getElementById: (id) => lagStub(elementer, id), querySelector: (s) => lagStub(elementer, 'q:' + s),
    // Flere kallere indekserer rett inn (querySelectorAll('.tab')[1]), så lista må ha nok stubbede elementer.
    querySelectorAll: () => { const l = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => lagStub(elementer, 'qa:' + i)); l.forEach = (f) => Array.prototype.forEach.call(l, f); return l; },
    createElement: () => lagStub(elementer, 'ny'), body: lagStub(elementer, 'body'), head: lagStub(elementer, 'head'),
    documentElement: lagStub(elementer, 'html'), activeElement: lagStub(elementer, 'aktiv'), hidden: false, visibilityState: 'visible',
  };
  vm.createContext(sandbox);
  const lasteFeil = [];
  for (const f of APP_FILER) {
    try { vm.runInContext(readFileSync(path.join(rotmappe, 'js', f), 'utf8'), sandbox, { filename: f, timeout: 5000 }); }
    catch (e) { lasteFeil.push(f + ': ' + e.message); }
  }
  // let/const på toppnivå er ikke synlige på sandbox-objektet (se CLAUDE.md, «Node vm-særtrekk»): hjelpere i samme context.
  vm.runInContext('function __hentS(){return S;} function __settMe(m){me=m;} function __settAktivOrdre(id){activeOrdreId=id;} function __settDb(x){db=x;} function __settTimerStart(v){timerStart=v;} function __hentTimerStart(){return timerStart;}', sandbox);
  const kjor = (kode) => vm.runInContext(kode, sandbox, { timeout: 5000 });
  return { sandbox, kjor, consoleFeil, lasteFeil, S: sandbox.__hentS(), settMe: sandbox.__settMe, settAktivOrdre: sandbox.__settAktivOrdre, settDb: sandbox.__settDb, settTimerStart: sandbox.__settTimerStart, hentTimerStart: sandbox.__hentTimerStart };
}
