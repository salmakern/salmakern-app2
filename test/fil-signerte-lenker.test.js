import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Signerte fil-lenker (js/core.js, «SIGNERTE FIL-LENKER») og bildecachens nøkkel (sw.js).
// Bøttene i Storage skal bli private: da virker bare signerte lenker, og den lagrede
// (offentlige) adressen er kun filens navn. Hjelperblokken kjøres alene i en vm-context med
// en falsk Supabase-klient - ingen ekte Storage.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rot = path.resolve(__dirname, '..');
const core = readFileSync(path.join(rot, 'js/core.js'), 'utf8');
const start = core.indexOf('const FIL_BOTTER');
const slutt = core.indexOf('function urlBase64ToUint8Array');
const blokk = core.slice(start, slutt);

const BASE = 'https://x.supabase.co/storage/v1/object/public/';
const BILDE = BASE + 'bilder/ord_1/ankomst_0_1.jpg';
const DOK = BASE + 'ordre-dokumenter/ord_1/1_Egenerkl%C3%A6ring-ABC.pdf';

function lagMiljo(opts = {}) {
  const kall = [];
  const bilder = [];
  const vinduer = [];
  const db = {
    storage: { from: (bucket) => ({
      createSignedUrls: vi.fn(async (stier, sek) => {
        kall.push({ bucket, stier, sek });
        if (opts.feiler) return { data: null, error: { message: 'ikke innlogget' } };
        if (opts.kaster) throw new Error('nett');
        return { data: stier.map(s => ({ path: s, signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${encodeURI(s)}?token=t${kall.length}`, error: null })), error: null };
      })
    }) }
  };
  const sandbox = {
    console: { warn: () => {}, log: () => {}, error: () => {} },
    Date, Map, Set, Promise, Array, Object, String, setTimeout, encodeURI, decodeURI,
    db: opts.utenDb ? null : db,
    visToast: vi.fn(),
    fetch: vi.fn(async (u) => ({ ok: true, url: u })),
    document: { querySelectorAll: () => bilder },
    window: null
  };
  sandbox.window = { open: vi.fn((u) => { if (opts.blokkert) return null; const v = { url: u, location: { href: u } }; vinduer.push(v); return v; }) };
  vm.createContext(sandbox);
  vm.runInContext('var location = {};' + blokk + ';function _nullstill(){_filSignert.clear();}function _foreld(u){_filSignert.get(u).til=0;}', sandbox);
  const img = (fil) => { const a = { 'data-fil': fil, src: 'venter' }; const el = { getAttribute: k => a[k], setAttribute: (k, v) => { a[k] = v; }, a }; bilder.push(el); return el; };
  return { s: sandbox, kall, vinduer, img };
}

describe('filDel', () => {
  const { s } = lagMiljo();
  it('kjenner igjen de tre bøttene og dekoder stien', () => {
    expect(s.filDel(BILDE)).toEqual({ bucket: 'bilder', sti: 'ord_1/ankomst_0_1.jpg' });
    expect(s.filDel(DOK)).toEqual({ bucket: 'ordre-dokumenter', sti: 'ord_1/1_Egenerklæring-ABC.pdf' });
    expect(s.filDel(BASE + 'hms-vedlegg/avvik/1_a.jpg').bucket).toBe('hms-vedlegg');
  });
  it('lar alt annet være (base64-bilde, andre adresser, ukjent bøtte, tomt)', () => {
    expect(s.filDel('data:image/jpeg;base64,AAAA')).toBeNull();
    expect(s.filDel('https://fiken.no/kladd/1')).toBeNull();
    expect(s.filDel(BASE + 'annen-botte/x.jpg')).toBeNull();
    expect(s.filDel(null)).toBeNull();
  });
});

describe('filSigner og filBildeAttr', () => {
  let m;
  beforeEach(() => { m = lagMiljo(); });

  it('samler en hel rendering til ÉN forespørsel per bøtte', async () => {
    m.s.filBildeAttr(BILDE); m.s.filBildeAttr(BILDE.replace('_0_', '_1_')); m.s.filLenkeAttr(DOK);
    await m.s.filSigner([]);
    expect(m.kall.length).toBe(2);
    expect(m.kall.find(k => k.bucket === 'bilder').stier).toEqual(['ord_1/ankomst_0_1.jpg', 'ord_1/ankomst_1_1.jpg']);
    expect(m.kall[0].sek).toBe(7200);
  });
  it('gir plassholder først, og bytter bildet i DOM når lenken er signert', async () => {
    const el = m.img(BILDE);
    const attr = m.s.filBildeAttr(BILDE);
    expect(attr).toContain('data:image/gif');
    expect(attr).toContain(`data-fil="${BILDE}"`);
    await m.s.filSigner([]);
    expect(el.a.src).toContain('/object/sign/bilder/ord_1/ankomst_0_1.jpg?token=');
  });
  it('gjenbruker en gyldig signert lenke uten nytt kall, og signerer på nytt når den er for gammel', async () => {
    await m.s.filSigner([BILDE]);
    expect(m.s.filBildeAttr(BILDE)).toContain('/object/sign/');
    await m.s.filSigner([BILDE]);
    expect(m.kall.length).toBe(1);
    m.s._foreld(BILDE);
    expect(m.s.filBildeAttr(BILDE)).toContain('data:image/gif');
    await m.s.filSigner([]);
    expect(m.kall.length).toBe(2);
  });
  it('feiler signeringen, faller bildet tilbake på den lagrede adressen (ingen evig plassholder)', async () => {
    for (const opts of [{ feiler: true }, { kaster: true }, { utenDb: true }]) {
      const f = lagMiljo(opts);
      const el = f.img(BILDE);
      f.s.filBildeAttr(BILDE);
      await f.s.filSigner([]);
      expect(el.a.src).toBe(BILDE);
    }
  });
  it('rører ikke et base64-bilde (reserve når opplasting feilet)', () => {
    expect(m.s.filBildeAttr('data:image/jpeg;base64,AAAA')).toBe('src="data:image/jpeg;base64,AAAA"');
    expect(m.kall.length).toBe(0);
  });
  it('escaper adressen i attributtene', () => {
    const a = m.s.filLenkeAttr(BASE + 'ordre-dokumenter/ord_1/a"b<c.pdf');
    expect(a).not.toContain('a"b');
    expect(a).toContain('a&quot;b&lt;c.pdf');
  });
});

describe('apneFil', () => {
  it('åpner den signerte lenken direkte når den er klar', async () => {
    const m = lagMiljo();
    await m.s.filSigner([DOK]);
    const ev = { preventDefault: vi.fn() };
    m.s.apneFil(ev, DOK);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(m.s.window.open.mock.calls[0][0]).toContain('/object/sign/ordre-dokumenter/');
  });
  it('åpner fanen synkront og sender den videre når lenken er signert', async () => {
    const m = lagMiljo();
    m.s.apneFil({ preventDefault() {} }, DOK);
    expect(m.s.window.open).toHaveBeenCalledWith('', '_blank');
    await m.s.filSigner([]);
    await Promise.resolve();
    expect(m.vinduer[0].location.href).toContain('/object/sign/ordre-dokumenter/');
  });
  it('gir beskjed når fanen blokkeres, og lar en vanlig lenke gå som før', () => {
    const m = lagMiljo({ blokkert: true });
    m.s.apneFil({ preventDefault() {} }, DOK);
    expect(m.s.visToast).toHaveBeenCalled();
    const ev = { preventDefault: vi.fn() };
    m.s.apneFil(ev, 'https://fiken.no/x');
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});

describe('filHent', () => {
  it('henter via signert lenke', async () => {
    const m = lagMiljo();
    await m.s.filHent(DOK);
    expect(m.s.fetch.mock.calls[0][0]).toContain('/object/sign/ordre-dokumenter/');
  });
});

describe('ingen visning bruker den lagrede adressen direkte', () => {
  // En ny <img src="${url}"> eller <a href="${d.url}"> mot Storage virker i dag, men blir et
  // ødelagt bilde/lenke når bøttene er private. Alle slike skal gå via filBildeAttr/filLenkeAttr.
  it('js/*.js har ingen rå src/href med fil-adresser', () => {
    const funn = [];
    for (const f of readdirSync(path.join(rot, 'js')).filter(n => n.endsWith('.js'))) {
      readFileSync(path.join(rot, 'js', f), 'utf8').split(/\r?\n/).forEach((l, i) => {
        if (/<img[^>]*\ssrc="\$\{(?!LOGO|filAttr|esc\(logo)/.test(l) || /href="\$\{[^}]*(\.url|fullmaktUrl|\bu\b)[^}]*\}/.test(l)) funn.push(`${f}:${i + 1}`);
      });
    }
    expect(funn).toEqual([]);
  });
});

describe('sw.js: bildeCacheNokkel', () => {
  const sw = readFileSync(path.join(rot, 'sw.js'), 'utf8');
  const s = {};
  vm.createContext(s);
  vm.runInContext(sw.slice(sw.indexOf('function bildeCacheNokkel'), sw.indexOf("self.addEventListener('install'")), s);
  const P = 'https://x.supabase.co/storage/v1/object/';
  it('samme fil gir samme nøkkel for offentlig og signert adresse, uten token', () => {
    expect(s.bildeCacheNokkel(P + 'sign/bilder/ord_1/a.jpg?token=abc')).toBe(P + 'public/bilder/ord_1/a.jpg');
    expect(s.bildeCacheNokkel(P + 'public/bilder/ord_1/a.jpg')).toBe(P + 'public/bilder/ord_1/a.jpg');
  });
  it('opplasting, sletting og innlogget nedlasting caches ikke', () => {
    expect(s.bildeCacheNokkel(P + 'bilder/ord_1/a.jpg')).toBeNull();
    expect(s.bildeCacheNokkel(P + 'authenticated/bilder/ord_1/a.jpg')).toBeNull();
    expect(s.bildeCacheNokkel(P + 'list/bilder')).toBeNull();
    expect(s.bildeCacheNokkel('https://salmaker.as/js/core.js')).toBeNull();
  });
});
