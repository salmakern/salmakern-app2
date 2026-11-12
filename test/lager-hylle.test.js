import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { lastApp } from './helpers/app-harness.js';

// Lager fase 1 (Henrik 2026-11-03): hyller med QR-etikett (25 mm), skanning, bestillinger (også de som allerede er lagt) og mottak.
// Ingen ekte database: en falsk Supabase-klient registrerer kallene. QR-en testes ved å GENERERE den og LESE den tilbake med skanneren appen bruker (jsQR).

const app = lastApp();
const { sandbox, S } = app;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../' + f), 'utf8').replace(/\r\n/g, '\n');

// Samme biblioteker som appen laster (qrcode ved behov, jsQR ved skanning), lastet inn i app-konteksten.
vm.runInContext(les('js/vendor/qrcode.js'), sandbox, { filename: 'qrcode.js' });
vm.runInContext(les('js/vendor/jsQR.js'), sandbox, { filename: 'jsQR.js' });

function lagDb({ rpcSvar = {} } = {}) {
  const kall = [];
  const kjede = (info) => new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') return (res) => Promise.resolve({ data: null, error: null }).then(res);
      return (...args) => { info.kall.push([String(k), args]); return kjede(info); };
    },
  });
  return {
    kall,
    db: {
      from: (tabell) => { const info = { tabell, kall: [] }; kall.push(info); return kjede(info); },
      rpc: (navn, args) => {
        kall.push({ rpc: navn, args });
        const s = rpcSvar[navn];
        return Promise.resolve(typeof s === 'function' ? s(args) : (s || { data: null, error: null }));
      },
    },
  };
}
const rpcKall = (kall, navn) => kall.filter((k) => k.rpc === navn);
const tabellKall = (kall, tabell, metode) => kall.filter((k) => k.tabell === tabell && k.kall.some(([m]) => m === metode)).map((k) => k.kall.find(([m]) => m === metode)[1]);
const el = (id) => sandbox.document.getElementById(id);
const toasts = [];
const varsler = [];

function vare(over = {}) {
  return { id: 'v1', navn: 'Gassdemper', kategori: 'Beslag', modell: 'EV9', tegningsnummer: '', leverandor: '', kostpris: null, antall: 2, enhet: 'stk', minAntall: 5, notat: '', bestilt: false, hylleId: null, rekkefolge: 0, createdAt: '', ...over };
}
function hylle(over = {}) { return { id: 'hy1', kode: 'A1', navn: '', rekkefolge: 0, createdAt: '', ...over }; }
function bestilling(over = {}) {
  return { id: 'lb1', vareId: 'v1', antall: 10, ukjentAntall: false, mottattAntall: 0, leverandor: 'Norengros', bestiltDato: '2026-11-01', forventetDato: null, status: 'apen', bestiltAv: 'Admin', kommentar: '', mottattAt: null, mottattAv: '', createdAt: '', ...over };
}

beforeEach(() => {
  S.lagervarer = []; S.lagerHyller = []; S.lagerBestillinger = []; S.lagerhistorikk = []; S.ordrer = [];
  app.settMe({ id: 1, navn: 'Admin Test', rolle: 'admin' });
  toasts.length = 0; varsler.length = 0;
  sandbox.visToast = (m, t) => { toasts.push([m, t]); };
  sandbox.edgeFetch = (f, init) => { varsler.push({ f, body: JSON.parse(init.body) }); return Promise.resolve({}); };
  sandbox.confirm = () => true;
  const f = lagDb(); app.settDb(f.db);
});

// En testfil som slutter med `me` som admin kan krasje vitest-arbeideren (se CLAUDE.md), så den settes tilbake til vanlig ansatt til slutt.
afterAll(() => app.settMe({ id: 2, navn: 'Ansatt', rolle: 'ansatt' }));

describe('hyllekode og lenke', () => {
  it('godtar korte koder med bokstaver, tall, bindestrek og understrek, og avviser resten', () => {
    for (const ok of ['A1', 'a1', 'HYLLE-12', 'b_3', '7', 'A'.repeat(20)]) expect(sandbox.normaliserHylleKode(ok)).toBe(ok);
    for (const feil of ['', ' ', 'A B', 'A/1', '-A', '_A', 'A'.repeat(21), 'æ1', 'A1;x', null, undefined]) expect(sandbox.normaliserHylleKode(feil)).toBe('');
    expect(sandbox.normaliserHylleKode('  A1  ')).toBe('A1');
  });

  it('lenken er https://salmaker.as/salmakern.html?h=<kode>', () => {
    expect(sandbox.hylleUrl('A1')).toBe('https://salmaker.as/salmakern.html?h=A1');
    expect(sandbox.hylleUrl('A 1')).toBe('https://salmaker.as/salmakern.html?h=');
  });

  it('leser koden ut av en skannet lenke eller en ren kode', () => {
    const k = sandbox.hylleKodeFraTekst;
    expect(k('https://salmaker.as/salmakern.html?h=A1')).toBe('A1');
    expect(k('salmaker.as/salmakern.html?x=1&h=B-2#del')).toBe('B-2');
    expect(k('  C3 ')).toBe('C3');
    expect(k('https://salmaker.as/salmakern.html?h=A%201')).toBe('');
    expect(k('https://eksempel.no/')).toBe('');
    expect(k('')).toBe('');
    expect(k(null)).toBe('');
  });

  it('finnHylle ser bort fra store/små bokstaver', () => {
    S.lagerHyller = [hylle({ kode: 'A1' })];
    expect(sandbox.finnHylle('a1').id).toBe('hy1');
    expect(sandbox.finnHylle('B1')).toBe(null);
    expect(sandbox.finnHylle('')).toBe(null);
  });
});

describe('QR-etikett', () => {
  // Tegner matrisen som piksler (svart/hvit, 4 piksler per modul, 4 moduler stille sone) og leser den med den samme skanneren appen bruker.
  function lesQr(tekst, px = 4, stille = 4) {
    const m = sandbox.qrMatrise(tekst);
    const side = (m.n + 2 * stille) * px;
    const data = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) {
      if (!m.mork(r, c)) continue;
      for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
        const i = (((r + stille) * px + y) * side + (c + stille) * px + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    const r = sandbox.jsQR(data, side, side);
    return r ? r.data : null;
  }

  it('en generert QR leses tilbake til nøyaktig samme lenke, og lenken gir riktig hylle', () => {
    S.lagerHyller = [hylle({ id: 'h1', kode: 'A1' }), hylle({ id: 'h2', kode: 'HYLLE-12' }), hylle({ id: 'h3', kode: 'b_3' }), hylle({ id: 'h4', kode: 'A'.repeat(20) })];
    for (const h of S.lagerHyller) {
      const lest = lesQr(sandbox.hylleUrl(h.kode));
      expect(lest).toBe(sandbox.hylleUrl(h.kode));
      expect(sandbox.finnHylle(sandbox.hylleKodeFraTekst(lest)).id).toBe(h.id);
    }
  });

  it('innholdet på etiketten (1,6 + 19 + 0,4 + 3,4 mm) går opp i 25 mm med luft i bunnen, og lange koder får mindre skrift så de ikke kuttes', () => {
    const css = sandbox.byggEtikettDokument([hylle()], 'etikett');
    expect(css).toContain('padding:1.6mm 2mm 0');
    expect(css).toContain('.qr{width:19mm;height:19mm');
    expect(css).toContain('margin-top:.4mm;height:3.4mm');
    expect(1.6 + 19 + 0.4 + 3.4).toBeLessThanOrEqual(25 - 0.5);
    const mm = sandbox.etikettSkriftMm;
    expect(mm('A1')).toBe(3.2);
    expect(mm('HYLLE-12')).toBe(3.2);
    expect(mm('A'.repeat(20))).toBeLessThan(1.6);
    for (const kode of ['A1', 'HYLLE-12', 'LANG-KODE-12', 'A'.repeat(20)]) expect(kode.length * 0.7 * mm(kode)).toBeLessThanOrEqual(21.05); // bredden på teksten (fet versal) rommer seg på 21 mm
  });

  it('QR-en er liten nok for en 25 mm-etikett: høyst 33 moduler selv med lengste hyllekode (19 mm / 37 moduler = 0,5 mm per modul)', () => {
    expect(sandbox.qrMatrise(sandbox.hylleUrl('A1')).n).toBeLessThanOrEqual(33);
    expect(sandbox.qrMatrise(sandbox.hylleUrl('A'.repeat(20))).n).toBeLessThanOrEqual(33);
  });

  it('en QR med en liten skade (feilretting M) leses fortsatt', () => {
    const url = sandbox.hylleUrl('A1');
    const m = sandbox.qrMatrise(url);
    const px = 6, stille = 4, side = (m.n + 2 * stille) * px;
    const data = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) {
      if (!m.mork(r, c)) continue;
      for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) { const i = (((r + stille) * px + y) * side + (c + stille) * px + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
    }
    // «Sletter» en liten flekk (som en skramme) midt i koden
    const mid = Math.floor(side / 2);
    for (let y = mid - 8; y < mid + 8; y++) for (let x = mid - 8; x < mid + 8; x++) { const i = (y * side + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; }
    expect(sandbox.jsQR(data, side, side).data).toBe(url);
  });

  it('SVG-en er én path med kantene skarpe og hvit bakgrunn', () => {
    const svg = sandbox.qrSvg(sandbox.hylleUrl('A1'));
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('fill="#fff"');
  });

  it('etikettdokumentet er 25 x 25 mm per side, og A4-arket har rutenett; hyllekoden står på etiketten', () => {
    S.lagerHyller = [hylle({ kode: 'A1' }), hylle({ id: 'hy2', kode: 'B2' })];
    const enkelt = sandbox.byggEtikettDokument(S.lagerHyller, 'etikett');
    expect(enkelt).toContain('@page{size:25mm 25mm;margin:0}');
    expect(enkelt).toContain('page-break-after:always');
    expect(enkelt.match(/class="etikett"/g)).toHaveLength(2);
    expect(enkelt).toContain('<div class="kode" style="font-size:3.2mm">A1</div>');
    expect(enkelt).toContain('<div class="kode" style="font-size:3.2mm">B2</div>');
    expect(enkelt).toContain('width:25mm;height:25mm');
    const ark = sandbox.byggEtikettDokument(S.lagerHyller, 'ark');
    expect(ark).toContain('@page{size:A4');
    expect(ark).toContain('class="rutenett"');
  });
});

describe('hyller (opprett, plassér, slett)', () => {
  it('lagreNyHylle lagrer i databasen og lista, og avviser duplikat (uavhengig av store/små bokstaver) og ugyldig kode', async () => {
    const f = lagDb(); app.settDb(f.db);
    el('hylleNyKode').value = 'A1'; el('hylleNyNavn').value = 'Regalrad A';
    await sandbox.lagreNyHylle();
    expect(S.lagerHyller.map((h) => h.kode)).toEqual(['A1']);
    const ins = tabellKall(f.kall, 'lager_hyller', 'insert');
    expect(ins).toHaveLength(1);
    expect(ins[0][0]).toMatchObject({ kode: 'A1', navn: 'Regalrad A', rekkefolge: 0 });

    el('hylleNyKode').value = 'a1'; await sandbox.lagreNyHylle();
    el('hylleNyKode').value = 'A B'; await sandbox.lagreNyHylle();
    expect(S.lagerHyller).toHaveLength(1);
    expect(tabellKall(f.kall, 'lager_hyller', 'insert')).toHaveLength(1);
    expect(toasts.map((t) => t[0]).join('|')).toMatch(/finnes allerede/);
    expect(toasts.map((t) => t[0]).join('|')).toMatch(/Hyllekoden må være/);
  });

  it('bare admin kan opprette og slette hyller', async () => {
    app.settMe({ id: 2, navn: 'Ansatt', rolle: 'ansatt' });
    const f = lagDb(); app.settDb(f.db);
    el('hylleNyKode').value = 'Z9';
    await sandbox.lagreNyHylle();
    S.lagerHyller = [hylle()];
    await sandbox.slettHylle('hy1');
    expect(S.lagerHyller).toHaveLength(1);
    expect(f.kall).toEqual([]);
    app.settMe({ id: 1, navn: 'Admin Test', rolle: 'admin' });
  });

  it('plassering skriver bare endringene, med ÉN oppdatering per retning, og flytter varer fra en annen hylle', async () => {
    S.lagerHyller = [hylle({ id: 'hy1', kode: 'A1' }), hylle({ id: 'hy2', kode: 'B1' })];
    S.lagervarer = [vare({ id: 'a', hylleId: 'hy1' }), vare({ id: 'b', hylleId: null }), vare({ id: 'c', hylleId: 'hy2' }), vare({ id: 'd', hylleId: null })];
    const f = lagDb(); app.settDb(f.db);
    sandbox.apneHyllePlassering('hy1');
    sandbox.vekslePlasseringsvalg('a', false); // a tas av
    sandbox.vekslePlasseringsvalg('b', true);  // b legges på
    sandbox.vekslePlasseringsvalg('c', true);  // c flyttes hit fra B1
    await sandbox.lagreHyllePlassering('hy1');
    const opp = tabellKall(f.kall, 'lagervarer', 'update');
    expect(opp).toHaveLength(2);
    expect(opp.map((a) => a[0])).toEqual(expect.arrayContaining([{ hylle_id: null }, { hylle_id: 'hy1' }]));
    const inn = JSON.stringify(f.kall.filter((k) => k.tabell === 'lagervarer').map((k) => k.kall));
    expect(inn).toContain('["in",["id",["b","c"]]]');
    expect(inn).toContain('["in",["id",["a"]]]');
    expect(S.lagervarer.map((v) => [v.id, v.hylleId])).toEqual([['a', null], ['b', 'hy1'], ['c', 'hy1'], ['d', null]]);
  });

  it('uendret plassering gir ingen databasekall', async () => {
    S.lagerHyller = [hylle()];
    S.lagervarer = [vare({ hylleId: 'hy1' })];
    const f = lagDb(); app.settDb(f.db);
    sandbox.apneHyllePlassering('hy1');
    await sandbox.lagreHyllePlassering('hy1');
    expect(f.kall).toEqual([]);
  });

  it('sletting av hylle lar varene stå (uten hylle), de slettes ikke', async () => {
    S.lagerHyller = [hylle({ id: 'hy1' }), hylle({ id: 'hy2', kode: 'B1' })];
    S.lagervarer = [vare({ id: 'a', hylleId: 'hy1' }), vare({ id: 'b', hylleId: 'hy2' })];
    const f = lagDb(); app.settDb(f.db);
    await sandbox.slettHylle('hy1');
    expect(S.lagerHyller.map((h) => h.id)).toEqual(['hy2']);
    expect(S.lagervarer.map((v) => [v.id, v.hylleId])).toEqual([['a', null], ['b', 'hy2']]);
    expect(tabellKall(f.kall, 'lager_hyller', 'delete')).toHaveLength(1);
    expect(tabellKall(f.kall, 'lagervarer', 'delete')).toHaveLength(0);
  });

  it('Hylle-nedtrekket i vare-skjemaet lister hyllene og velger riktig', () => {
    S.lagerHyller = [hylle({ id: 'hy1', kode: 'B10' }), hylle({ id: 'hy2', kode: 'B2', navn: 'Nederst' })];
    sandbox.fyllHylleValg('hy2');
    const sel = el('nyVareHylle');
    expect(sel.innerHTML).toContain('<option value="">Ikke plassert</option>');
    expect(sel.innerHTML.indexOf('B2')).toBeLessThan(sel.innerHTML.indexOf('B10')); // naturlig sortering
    expect(sel.innerHTML).toContain('B2 · Nederst');
    expect(sel.value).toBe('hy2');
    sandbox.fyllHylleValg('finnes-ikke');
    expect(sel.value).toBe('');
  });
});

describe('skanning', () => {
  beforeEach(() => { S.lagerHyller = [hylle({ id: 'hy1', kode: 'A1' })]; S.lagervarer = [vare({ hylleId: 'hy1' })]; });

  it('en kjent hylle-QR åpner hylla; en ukjent kode og en fremmed QR gir beskjed uten å åpne noe', () => {
    expect(sandbox.behandleSkannet('https://eksempel.no/noe')).toBe(false);
    expect(el('skannStatus').textContent).toMatch(/ikke en QR-kode fra appen/);
    expect(sandbox.behandleSkannet('https://salmaker.as/salmakern.html?h=Q9')).toBe(false);
    expect(el('skannStatus').textContent).toMatch(/Fant ingen hylle med koden Q9/);
    expect(app.kjor('_aktivHylleId')).toBe(null);
    expect(sandbox.behandleSkannet('https://salmaker.as/salmakern.html?h=a1')).toBe(true);
    expect(app.kjor('_aktivHylleId')).toBe('hy1');
  });

  it('hylleside viser varene med antall og minimum, og Ta ut / Fyll på / Tell', () => {
    sandbox.visHylle('hy1');
    const html = el('lagerHylleInnhold').innerHTML;
    expect(html).toContain('Hylle A1');
    expect(html).toContain('Gassdemper');
    expect(html).toContain('minimum 5');
    expect(html).toContain('Under minimum');
    expect(html).toContain("apneHylleUttak('v1')");
    expect(html).toContain("apneHylleFyllPa('v1')");
    expect(html).toContain("apneTellModal('v1')");
    expect(html).not.toContain('Motta bestilling');
  });

  it('en vare med åpen bestilling viser «Bestilt» (ikke «Under minimum») og «Motta bestilling»', () => {
    S.lagervarer = [vare({ hylleId: 'hy1', bestilt: true })];
    S.lagerBestillinger = [bestilling({ forventetDato: '2026-11-10' })];
    sandbox.visHylle('hy1');
    const html = el('lagerHylleInnhold').innerHTML;
    expect(html).toContain('Bestilt · forventet 10.11.2026');
    expect(html).not.toContain('Under minimum');
    expect(html).toContain('Motta bestilling');
  });

  it('en hylle uten varer og en slettet hylle tåles', () => {
    S.lagervarer = [];
    sandbox.visHylle('hy1');
    expect(el('lagerHylleInnhold').innerHTML).toContain('Ingen varer er plassert');
    S.lagerHyller = [];
    sandbox.renderHylleInnhold();
    expect(el('lagerHylleInnhold').innerHTML).toContain('finnes ikke lenger');
  });

  it('åpning via ?h=-lenke venter til innlogget, og tåler ukjent kode', () => {
    app.kjor('pendingHylleKode = "A1"');
    app.settMe(null);
    sandbox.apneHylleFraUrlHvisKlar();
    expect(app.kjor('pendingHylleKode')).toBe('A1'); // ikke innlogget ennå: beholdes
    app.settMe({ id: 1, navn: 'Admin Test', rolle: 'admin' });
    sandbox.apneHylleFraUrlHvisKlar();
    expect(app.kjor('pendingHylleKode')).toBe(null);
    expect(app.kjor('_aktivHylleId')).toBe('hy1');
    app.kjor('pendingHylleKode = "Z99"');
    sandbox.apneHylleFraUrlHvisKlar();
    expect(toasts.map((t) => t[0]).join('|')).toMatch(/Fant ingen hylle med koden Z99/);
  });
});

describe('kamera: aldri la det stå på etter at vinduet er lukket', () => {
  const lagStrom = () => { const spor = { stoppet: false, stop() { this.stoppet = true; } }; return { spor, getTracks: () => [spor] }; };
  afterAll(() => { delete sandbox.navigator.mediaDevices; });

  it('lukkes vinduet mens appen venter på tillatelse til kameraet, stoppes strømmen så snart den kommer', async () => {
    const strom = lagStrom(); let gi;
    sandbox.navigator.mediaDevices = { getUserMedia: () => new Promise((ok) => { gi = ok; }) };
    sandbox.apneSkannModal();
    sandbox.lukkSkannModal();   // brukeren ombestemmer seg før tillatelsen er gitt
    gi(strom);
    await new Promise((r) => setTimeout(r, 20));
    expect(strom.spor.stoppet).toBe(true);
    expect(app.kjor('_skann')).toBe(null);
  });

  it('åpnes vinduet på nytt mens den første forespørselen venter, stoppes den gamle strømmen og den nye brukes', async () => {
    const forste = lagStrom(), andre = lagStrom(); const ventende = [];
    sandbox.navigator.mediaDevices = { getUserMedia: () => new Promise((ok) => ventende.push(ok)) };
    sandbox.apneSkannModal();
    sandbox.apneSkannModal();
    ventende[0](forste);
    await new Promise((r) => setTimeout(r, 20));
    expect(forste.spor.stoppet).toBe(true);
    ventende[1](andre);
    await new Promise((r) => setTimeout(r, 20));
    expect(andre.spor.stoppet).toBe(false);
    expect(app.kjor('_skann').stream).toBe(andre);
    sandbox.lukkSkannModal();
    expect(andre.spor.stoppet).toBe(true);
    expect(app.kjor('_skann')).toBe(null);
  });

  it('nektet kamera gir en beskjed og manuell kode som reserve, og ingenting står på', async () => {
    sandbox.navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error('NotAllowedError')) };
    sandbox.apneSkannModal();
    await new Promise((r) => setTimeout(r, 20));
    expect(el('skannStatus').textContent).toMatch(/Fikk ikke tilgang til kameraet/);
    expect(app.kjor('_skann')).toBe(null);
    sandbox.lukkSkannModal();
  });
});

// iPhone (Henrik 2026-11-12): en hjemskjerm-app får aldri huske kameratillatelsen, så der tas et bilde med iPhonens kamera og QR-en leses fra bildet.
describe('skanning med bilde på iPhone: spør aldri om kameratilgang', () => {
  let ua, plattform, kalt, apnet, lesQr, lastSkr;
  beforeEach(() => {
    ua = sandbox.navigator.userAgent; plattform = sandbox.navigator.platform;
    sandbox.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
    kalt = 0; sandbox.navigator.mediaDevices = { getUserMedia: () => { kalt++; return new Promise(() => {}); } };
    lesQr = sandbox.lesQrFraBilde; lastSkr = sandbox.lastSkript;
    sandbox.lastSkript = () => Promise.resolve();
    apnet = []; sandbox.openOrdre = (id, arkiv) => apnet.push([id, arkiv]);
  });
  afterEach(() => {
    sandbox.navigator.userAgent = ua; sandbox.navigator.platform = plattform; delete sandbox.navigator.mediaDevices;
    sandbox.lesQrFraBilde = lesQr; sandbox.lastSkript = lastSkr;
    sandbox.lukkSkannModal();
  });
  const velgBilde = async (tekst) => {
    sandbox.lesQrFraBilde = () => Promise.resolve(tekst);
    await sandbox.lesSkannBilde({ target: { files: [{ name: 'foto.jpg' }], value: 'x' } });
  };

  it('iPhone og iPad (også iPad som later som den er en Mac) bruker bilde; PC og Android gjør det ikke', () => {
    expect(sandbox.skannMedBilde()).toBe(true);
    sandbox.navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'; sandbox.navigator.platform = 'MacIntel'; sandbox.navigator.maxTouchPoints = 5;
    expect(sandbox.skannMedBilde()).toBe(true);
    sandbox.navigator.maxTouchPoints = 0;
    expect(sandbox.skannMedBilde()).toBe(false);
    sandbox.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14) Chrome/130'; sandbox.navigator.platform = 'Linux armv8l';
    expect(sandbox.skannMedBilde()).toBe(false);
    delete sandbox.navigator.maxTouchPoints;
  });

  it('åpner bildevinduet uten å be om kameraet', async () => {
    sandbox.apneSkannModal();
    await new Promise((r) => setTimeout(r, 20));
    expect(kalt).toBe(0);
    const html = el('lagerSkannModal').innerHTML;
    expect(html).toContain('id="skannBildeInput"');
    expect(html).toContain('capture="environment"');
    expect(html).not.toContain('skannVideo');
    expect(app.kjor('_skann')).toBe(null);
  });

  it('en ordre-lapp i bildet åpner ordren', async () => {
    S.ordrer = [{ id: 'ord_1793088915905', status: 'aktiv', ordretype: 'bil' }];
    sandbox.apneSkannModal();
    await velgBilde('https://salmaker.as/salmakern.html?ordre=ord_1793088915905');
    expect(apnet).toEqual([['ord_1793088915905', false]]);
  });

  it('ingen QR i bildet gir en beskjed, og vinduet står åpent for et nytt forsøk', async () => {
    sandbox.apneSkannModal();
    await velgBilde('');
    expect(el('skannStatus').textContent).toMatch(/Fant ingen QR-kode i bildet/);
    expect(apnet).toEqual([]);
  });

  it('et bilde som ikke lar seg lese gir en beskjed i stedet for å kaste', async () => {
    sandbox.apneSkannModal();
    sandbox.lesQrFraBilde = () => Promise.reject(new Error('bilde'));
    await sandbox.lesSkannBilde({ target: { files: [{}], value: 'x' } });
    expect(el('skannStatus').textContent).toMatch(/Kunne ikke lese bildet/);
  });
});

describe('ta ut, fyll på og tell fra hylle', () => {
  beforeEach(() => {
    S.lagervarer = [vare({ id: 'v1', antall: 8, minAntall: 5 })];
    S.ordrer = [{ id: 'o1', status: 'aktiv', regnr: 'AB12345', chassis: '', kunde: 'Kunde A', ordretype: 'bil' }];
  });

  it('uttak mot en ordre registreres med ordre-id og trekker fra lageret; mer enn det som finnes avvises', () => {
    el('uttakAntall').value = '20'; el('uttakOrdre').value = 'o1'; el('uttakKommentar').value = '';
    sandbox.lagreHylleUttak('v1');
    expect(S.lagervarer[0].antall).toBe(8);
    expect(toasts.map((t) => t[0]).join('|')).toMatch(/bare 8 igjen/);
    el('uttakAntall').value = '3';
    sandbox.lagreHylleUttak('v1');
    expect(S.lagervarer[0].antall).toBe(5);
    expect(S.lagerhistorikk[0]).toMatchObject({ vareId: 'v1', endring: -3, type: 'ut', ordreId: 'o1' });
  });

  it('uttak uten antall eller med 0 gjør ingenting', () => {
    el('uttakAntall').value = ''; sandbox.lagreHylleUttak('v1');
    el('uttakAntall').value = '0'; sandbox.lagreHylleUttak('v1');
    expect(S.lagervarer[0].antall).toBe(8);
    expect(S.lagerhistorikk).toHaveLength(0);
  });

  it('fyll på legger til og logger «inn»', () => {
    el('fyllPaAntall').value = '4'; el('fyllPaKommentar').value = '';
    sandbox.lagreHylleFyllPa('v1');
    expect(S.lagervarer[0].antall).toBe(12);
    expect(S.lagerhistorikk[0]).toMatchObject({ endring: 4, type: 'inn' });
    el('fyllPaAntall').value = '-2'; sandbox.lagreHylleFyllPa('v1');
    expect(S.lagervarer[0].antall).toBe(12);
  });

  it('telling retter lageret til talt antall og logger differansen (opp eller ned); samme antall gjør ingenting', () => {
    el('tellAntall').value = '8'; sandbox.lagreTelling('v1');
    expect(S.lagerhistorikk).toHaveLength(0);
    el('tellAntall').value = '6'; sandbox.lagreTelling('v1');
    expect(S.lagervarer[0].antall).toBe(6);
    expect(S.lagerhistorikk[0]).toMatchObject({ endring: -2, type: 'ut' });
    expect(S.lagerhistorikk[0].kommentar).toMatch(/Telling: talt 6, var 8/);
    el('tellAntall').value = '10'; sandbox.lagreTelling('v1');
    expect(S.lagervarer[0].antall).toBe(10);
    expect(S.lagerhistorikk[0]).toMatchObject({ endring: 4, type: 'inn' });
    el('tellAntall').value = '-1'; sandbox.lagreTelling('v1');
    expect(S.lagervarer[0].antall).toBe(10);
  });

  it('et TOMT telle-felt nuller IKKE lageret (tomt er ikke 0), men et uttrykkelig 0 godtas', () => {
    for (const tom of ['', '   ']) { el('tellAntall').value = tom; sandbox.lagreTelling('v1'); }
    expect(S.lagervarer[0].antall).toBe(8);
    expect(S.lagerhistorikk).toHaveLength(0);
    el('tellAntall').value = '0'; sandbox.lagreTelling('v1');
    expect(S.lagervarer[0].antall).toBe(0);
    expect(S.lagerhistorikk[0]).toMatchObject({ endring: -8, type: 'ut' });
  });

  it('komma som desimaltegn godtas i alle tallfeltene', () => {
    el('uttakAntall').value = '1,5'; el('uttakOrdre').value = ''; sandbox.lagreHylleUttak('v1');
    expect(S.lagervarer[0].antall).toBe(6.5);
    el('fyllPaAntall').value = '0,5'; sandbox.lagreHylleFyllPa('v1');
    expect(S.lagervarer[0].antall).toBe(7);
  });
});

describe('bestillinger', () => {
  beforeEach(() => {
    S.lagervarer = [vare({ id: 'v1', antall: 2, minAntall: 5, leverandor: '' }), vare({ id: 'v2', navn: 'Skrue', antall: 0, minAntall: 10, leverandor: 'Biltema' }), vare({ id: 'v3', navn: 'Ok', antall: 50, minAntall: 5 })];
  });

  it('foreslått antall: det som mangler til minimum, minst 1', () => {
    expect(sandbox.foreslaattBestillingsantall(vare({ antall: 2, minAntall: 5 }))).toBe(3);
    expect(sandbox.foreslaattBestillingsantall(vare({ antall: 0, minAntall: 10 }))).toBe(10);
    expect(sandbox.foreslaattBestillingsantall(vare({ antall: 9, minAntall: 5 }))).toBe(5);
    expect(sandbox.foreslaattBestillingsantall(vare({ antall: 1, minAntall: 0 }))).toBe(1);
    expect(sandbox.foreslaattBestillingsantall(vare({ antall: 0.5, minAntall: 2 }))).toBe(2);
  });

  it('registrerer med kjent antall: ÉN RPC med alle radene, varene merkes bestilt, leverandør lagres på de som mangler den', async () => {
    const f = lagDb(); app.settDb(f.db);
    sandbox.apneRegistrerBestilling({ vareId: 'v1' });
    sandbox.veksleBestillingsvalg('v2', true);
    sandbox.settBestillingsantall('v2', '12');
    el('bestLeverandor').value = 'Norengros'; el('bestBestiltDato').value = '2026-11-03'; el('bestForventetDato').value = '2026-11-10'; el('bestKommentar').value = 'hastebestilling';
    el('bestUkjentAntall').checked = false; el('bestLagreLeverandor').checked = true;
    await sandbox.lagreBestillinger();
    const rpc = rpcKall(f.kall, 'lager_registrer_bestillinger');
    expect(rpc).toHaveLength(1);
    const rader = rpc[0].args.p_bestillinger;
    expect(rader).toHaveLength(2);
    expect(rader[0]).toMatchObject({ vareId: 'v1', antall: 3, ukjentAntall: false, leverandor: 'Norengros', bestiltDato: '2026-11-03', forventetDato: '2026-11-10', kommentar: 'hastebestilling', bestiltAv: 'Admin Test' });
    expect(rader[1]).toMatchObject({ vareId: 'v2', antall: 12 });
    expect(rader.every((r) => /^lb_/.test(r.id))).toBe(true);
    expect(S.lagerBestillinger.map((b) => [b.vareId, b.status, b.antall])).toEqual(expect.arrayContaining([['v1', 'apen', 3], ['v2', 'apen', 12]]));
    expect(S.lagervarer.filter((v) => v.bestilt).map((v) => v.id).sort()).toEqual(['v1', 'v2']);
    // Leverandør lagres bare på varen som manglet den (v1), ikke overskrevet på v2 (Biltema)
    const lev = f.kall.filter((k) => k.tabell === 'lagervarer').map((k) => JSON.stringify(k.kall));
    expect(lev.join('|')).toContain('"leverandor":"Norengros"');
    expect(lev.join('|')).toContain('["in",["id",["v1"]]]');
    expect(S.lagervarer.find((v) => v.id === 'v1').leverandor).toBe('Norengros');
    expect(S.lagervarer.find((v) => v.id === 'v2').leverandor).toBe('Biltema');
  });

  it('«ukjent antall» (det som allerede var bestilt): antall 0 og flagget satt, uten krav om antall', async () => {
    const f = lagDb(); app.settDb(f.db);
    sandbox.apneRegistrerBestilling({ alleUnderMinimum: true });
    el('bestLeverandor').value = ''; el('bestUkjentAntall').checked = true; el('bestLagreLeverandor').checked = false;
    el('bestBestiltDato').value = ''; el('bestForventetDato').value = ''; el('bestKommentar').value = '';
    await sandbox.lagreBestillinger();
    const rader = rpcKall(f.kall, 'lager_registrer_bestillinger')[0].args.p_bestillinger;
    expect(rader.map((r) => r.vareId).sort()).toEqual(['v1', 'v2']); // v3 er over minimum
    for (const r of rader) expect(r).toMatchObject({ antall: 0, ukjentAntall: true });
    expect(rader.find((r) => r.vareId === 'v2').leverandor).toBe('Biltema'); // faller tilbake på varens leverandør
  });

  it('kjent antall uten antall avvises (ingen RPC), og tom utvelging også', async () => {
    const f = lagDb(); app.settDb(f.db);
    sandbox.apneRegistrerBestilling({});
    await sandbox.lagreBestillinger();
    expect(toasts.map((t) => t[0]).join('|')).toMatch(/Velg minst én vare/);
    sandbox.veksleBestillingsvalg('v1', true);
    sandbox.settBestillingsantall('v1', '0');
    el('bestUkjentAntall').checked = false;
    await sandbox.lagreBestillinger();
    expect(toasts.map((t) => t[0]).join('|')).toMatch(/Skriv inn antall/);
    expect(rpcKall(f.kall, 'lager_registrer_bestillinger')).toHaveLength(0);
    expect(S.lagerBestillinger).toHaveLength(0);
  });

  it('feil fra databasen: ingenting legges i lista og varene merkes ikke bestilt', async () => {
    const f = lagDb({ rpcSvar: { lager_registrer_bestillinger: { data: null, error: { message: 'boom' } } } }); app.settDb(f.db);
    sandbox.apneRegistrerBestilling({ vareId: 'v1' });
    el('bestUkjentAntall').checked = false; el('bestLeverandor').value = 'X';
    await sandbox.lagreBestillinger();
    expect(S.lagerBestillinger).toHaveLength(0);
    expect(S.lagervarer.every((v) => !v.bestilt)).toBe(true);
    expect(toasts.map((t) => t[0]).join('|')).toMatch(/Kunne ikke registrere/);
  });

  it('bare admin registrerer og kansellerer; alle kan motta', async () => {
    S.lagerBestillinger = [bestilling()];
    app.settMe({ id: 2, navn: 'Ansatt', rolle: 'ansatt' });
    const f = lagDb({ rpcSvar: { lager_motta_bestilling: { data: { nyttAntall: 12, mangler: 0, forventet: 10, bestilt: false }, error: null } } }); app.settDb(f.db);
    sandbox.apneRegistrerBestilling({ vareId: 'v1' });
    await sandbox.lagreBestillinger();
    await sandbox.kansellerBestilling('lb1');
    expect(f.kall).toEqual([]);
    sandbox.apneMottaModal('lb1');
    el('mottaAntall').value = '10'; el('mottaKommentar').value = '';
    await sandbox.mottaBestilling('lb1');
    expect(rpcKall(f.kall, 'lager_motta_bestilling')).toHaveLength(1);
    app.settMe({ id: 1, navn: 'Admin Test', rolle: 'admin' });
  });

  it('mottak: RPC-en brukes (ikke en lokal regning), lageret og flagget følger svaret, bestillingen lukkes', async () => {
    S.lagerBestillinger = [bestilling({ antall: 10 })];
    S.lagervarer[0].bestilt = true;
    const f = lagDb({ rpcSvar: { lager_motta_bestilling: { data: { vareId: 'v1', nyttAntall: 12, mangler: 0, forventet: 10, bestilt: false }, error: null } } }); app.settDb(f.db);
    sandbox.apneMottaModal('lb1');
    el('mottaAntall').value = '10'; el('mottaKommentar').value = 'Alt kom';
    await sandbox.mottaBestilling('lb1');
    const k = rpcKall(f.kall, 'lager_motta_bestilling');
    expect(k[0].args).toEqual({ p_id: 'lb1', p_antall: 10, p_ansatt: 'Admin Test', p_kommentar: 'Alt kom' });
    expect(S.lagerBestillinger[0]).toMatchObject({ status: 'mottatt', mottattAntall: 10, mottattAv: 'Admin Test' });
    expect(S.lagervarer[0]).toMatchObject({ antall: 12, bestilt: false });
    expect(varsler).toHaveLength(0);
  });

  it('mottak med mangel sender varsel om mangelfull levering med forventet/mottatt/mangler', async () => {
    S.lagerBestillinger = [bestilling({ antall: 10 })];
    const f = lagDb({ rpcSvar: { lager_motta_bestilling: { data: { vareId: 'v1', nyttAntall: 9, mangler: 3, forventet: 10, bestilt: false }, error: null } } }); app.settDb(f.db);
    sandbox.apneMottaModal('lb1');
    el('mottaAntall').value = '7';
    await sandbox.mottaBestilling('lb1');
    expect(varsler).toHaveLength(1);
    expect(varsler[0].f).toBe('send-push');
    expect(varsler[0].body).toMatchObject({ type: 'mangelfull_levering', vareNavn: 'Gassdemper', forventet: 10, mottatt: 7, mangler: 3, enhet: 'stk' });
  });

  it('en kollega mottok den allerede (IKKE_APEN): tydelig beskjed, ingenting endres lokalt', async () => {
    S.lagerBestillinger = [bestilling()];
    const f = lagDb({ rpcSvar: { lager_motta_bestilling: { data: null, error: { message: 'IKKE_APEN' } } } }); app.settDb(f.db);
    sandbox.apneMottaModal('lb1');
    el('mottaAntall').value = '10';
    await sandbox.mottaBestilling('lb1');
    expect(S.lagerBestillinger[0].status).toBe('apen');
    expect(S.lagervarer[0].antall).toBe(2);
    expect(toasts.map((t) => t[0]).join('|')).toMatch(/allerede mottatt eller kansellert/);
  });

  it('ugyldig mottatt antall (tomt, negativt) avvises uten kall', async () => {
    S.lagerBestillinger = [bestilling({ ukjentAntall: true, antall: 0 })];
    const f = lagDb(); app.settDb(f.db);
    sandbox.apneMottaModal('lb1');
    for (const v of ['', '-1', 'abc']) { el('mottaAntall').value = v; await sandbox.mottaBestilling('lb1'); }
    expect(rpcKall(f.kall, 'lager_motta_bestilling')).toHaveLength(0);
    expect(S.lagerBestillinger[0].status).toBe('apen');
  });

  it('kansellering bruker RPC-en og lar lageret være; flagget følger svaret', async () => {
    S.lagerBestillinger = [bestilling()];
    S.lagervarer[0].bestilt = true;
    const f = lagDb({ rpcSvar: { lager_kanseller_bestilling: { data: { vareId: 'v1', bestilt: false }, error: null } } }); app.settDb(f.db);
    await sandbox.kansellerBestilling('lb1');
    expect(rpcKall(f.kall, 'lager_kanseller_bestilling')[0].args).toEqual({ p_id: 'lb1' });
    expect(S.lagerBestillinger[0].status).toBe('kansellert');
    expect(S.lagervarer[0]).toMatchObject({ antall: 2, bestilt: false });
  });

  it('«Fjern bestilt-merking» er sperret mens varen har en åpen bestilling (flagget følger bestillingen)', () => {
    S.lagerBestillinger = [bestilling()];
    S.lagervarer[0].bestilt = true;
    const f = lagDb(); app.settDb(f.db);
    sandbox.settVareBestilt('v1', false);
    expect(S.lagervarer[0].bestilt).toBe(true);
    expect(f.kall).toEqual([]);
    S.lagerBestillinger = [];
    sandbox.settVareBestilt('v1', false);
    expect(S.lagervarer[0].bestilt).toBe(false);
  });

  it('bestillingsvinduet grupperer per leverandør, viser ukjent antall og forventet dato', () => {
    S.lagerBestillinger = [bestilling({ id: 'a', leverandor: 'Norengros', forventetDato: '2026-11-10' }), bestilling({ id: 'b', vareId: 'v2', leverandor: '', ukjentAntall: true, antall: 0 }), bestilling({ id: 'c', status: 'mottatt' })];
    sandbox.apneBestillingerModal();
    const html = el('lagerBestillingerInnhold').innerHTML;
    expect(html).toContain('Norengros');
    expect(html).toContain('Ukjent leverandør');
    expect(html).toContain('Antall ukjent');
    expect(html).toContain('forventet 10.11.2026');
    expect(html.match(/apneMottaModal\(/g)).toHaveLength(2); // den mottatte vises ikke
  });

  it('ingen åpne bestillinger gir en pen tom-melding', () => {
    S.lagerBestillinger = [bestilling({ status: 'kansellert' })];
    sandbox.apneBestillingerModal();
    expect(el('lagerBestillingerInnhold').innerHTML).toContain('Ingen åpne bestillinger');
  });
});

describe('innlasting og Realtime', () => {
  it('dbToLagervare/dbToLagerHylle/dbToLagerBestilling leser de nye kolonnene og tåler tomme/NULL-verdier', () => {
    expect(sandbox.dbToLagervare({ id: 'v', navn: 'x', hylle_id: 'hy1' }).hylleId).toBe('hy1');
    expect(sandbox.dbToLagervare({ id: 'v', navn: 'x', hylle_id: null }).hylleId).toBe(null);
    expect(sandbox.dbToLagerHylle({ id: 'h', kode: 'A1', navn: null, rekkefolge: null })).toMatchObject({ kode: 'A1', navn: '', rekkefolge: 0 });
    expect(sandbox.dbToLagerBestilling({ id: 'b', vare_id: 'v', antall: '10', ukjent_antall: false, mottatt_antall: null, leverandor: null, bestilt_dato: '2026-11-01', forventet_dato: null, status: 'apen' }))
      .toMatchObject({ vareId: 'v', antall: 10, ukjentAntall: false, mottattAntall: 0, leverandor: '', bestiltDato: '2026-11-01', forventetDato: null, status: 'apen' });
    expect(sandbox.dbToLagerBestilling({ id: 'b', vare_id: 'v' })).toMatchObject({ status: 'apen', antall: 0, ukjentAntall: false });
  });

  it('Realtime-handlerne for hyller og bestillinger legger til, endrer og fjerner uten duplikater', () => {
    const handlere = {};
    const kanal = { on(_t, f, cb) { handlere[f.table] = cb; return kanal; }, subscribe() { return kanal; } };
    app.settDb({ channel: () => kanal, removeChannel() {} });
    sandbox.subscribeRealtime();
    expect(typeof handlere.lager_hyller).toBe('function');
    expect(typeof handlere.lager_bestillinger).toBe('function');
    S.lagerHyller = []; S.lagerBestillinger = [];
    handlere.lager_hyller({ eventType: 'INSERT', new: { id: 'h1', kode: 'A1' } });
    handlere.lager_hyller({ eventType: 'INSERT', new: { id: 'h1', kode: 'A1' } }); // eget ekko etter lokal lagring
    expect(S.lagerHyller).toHaveLength(1);
    handlere.lager_hyller({ eventType: 'UPDATE', new: { id: 'h1', kode: 'A1', navn: 'Ny' } });
    expect(S.lagerHyller[0].navn).toBe('Ny');
    handlere.lager_hyller({ eventType: 'DELETE', old: { id: 'h1' } });
    expect(S.lagerHyller).toHaveLength(0);
    handlere.lager_bestillinger({ eventType: 'INSERT', new: { id: 'b1', vare_id: 'v1', antall: 5, status: 'apen' } });
    handlere.lager_bestillinger({ eventType: 'INSERT', new: { id: 'b1', vare_id: 'v1', antall: 5, status: 'apen' } });
    expect(S.lagerBestillinger).toHaveLength(1);
    handlere.lager_bestillinger({ eventType: 'UPDATE', new: { id: 'b1', vare_id: 'v1', antall: 5, status: 'mottatt' } });
    expect(S.lagerBestillinger[0].status).toBe('mottatt');
    handlere.lager_bestillinger({ eventType: 'UPDATE', new: { id: 'b2', vare_id: 'v1', antall: 1, status: 'apen' } }); // ukjent id: legges til i stedet for å forsvinne
    expect(S.lagerBestillinger.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    handlere.lager_bestillinger({ eventType: 'DELETE', old: { id: 'b1' } });
    expect(S.lagerBestillinger.map((b) => b.id)).toEqual(['b2']);
  });
});

describe('oppsett: scripts, tjenestearbeider, databasen', () => {
  it('lager-hylle.js lastes etter lager.js, og QR-bibliotekene finnes (lastes først ved behov)', () => {
    const html = les('salmakern.html');
    expect(html.indexOf('js/lager-hylle.js')).toBeGreaterThan(html.indexOf('js/lager.js'));
    expect(html).not.toMatch(/<script[^>]*vendor\/(qrcode|jsQR)/); // lazy: ikke på hver sidelasting
    expect(les('js/vendor/qrcode.js')).toContain('QR Code Generator');
    expect(les('js/vendor/jsQR.js').length).toBeGreaterThan(100000);
  });

  it('knappene på lager-siden og Hylle-feltet i vare-skjemaet finnes', () => {
    const html = les('salmakern.html');
    for (const f of ['apneSkannModal()', 'apneHyllerModal()', 'apneBestillingerModal()']) expect(html).toContain(`onclick="${f}"`);
    expect(html).toContain('id="nyVareHylle"');
    expect(les('js/lager.js')).toContain('hylle_id:hylleId');
  });

  it('tjenestearbeideren cacher ikke en side med søkestreng (?h=), og faller tilbake på den vanlige kopien uten nett', () => {
    const sw = les('sw.js');
    expect(sw).toContain("e.request.mode === 'navigate' && new URL(url).search");
    expect(sw).toContain('caches.match(e.request, { ignoreSearch: true })');
  });

  it('migrasjonen tar hyllene og bestillingene med i Realtime og lar varene stå når en hylle slettes', () => {
    const sql = les('supabase/migrations/20261103200000_lager_hyller_og_bestillinger.sql');
    expect(sql).toMatch(/add table public\.lager_hyller/);
    expect(sql).toMatch(/add table public\.lager_bestillinger/);
    expect(sql).toMatch(/hylle_id text references public\.lager_hyller\(id\) on delete set null/);
  });
});
