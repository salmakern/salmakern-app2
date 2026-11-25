// hent-kalkyle-tider-fra-portalen (Henger igjen s09-027, 2026-11-25): henter kalkulerte ombyggingsminutter per kalkylemodell fra portalen
// som FORSLAG til standardtider. 1) logikk.ts (streng validering) lastes direkte. 2) index.ts kjøres mot falsk Deno og falsk fetch (portalen +
// current_ansatt). Alle verdier er syntetiske. Funksjonen lagrer ingenting (ingen createClient/rpc i kildeteksten, vokter under).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { lesKalkyleTider } from '../supabase/functions/hent-kalkyle-tider-fra-portalen/logikk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJON = path.resolve(__dirname, '../supabase/functions/hent-kalkyle-tider-fra-portalen');
const kilde = readFileSync(path.join(FUNKSJON, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const kopi = (x) => JSON.parse(JSON.stringify(x));

const SVAR = {
  ok: true, versjon: 1, generert: '2026-11-25T08:00:00.000Z',
  modeller: [
    { kalkyle_id: 'k1', kalkyle_navn: 'KIA EV9', portal_modell_slug: 'kia-ev9', minutter: 960 },
    { kalkyle_id: 'k2', kalkyle_navn: 'Touran', portal_modell_slug: null, minutter: null },
  ],
};

describe('lesKalkyleTider', () => {
  it('gyldig svar gir modellene uendret', () => {
    expect(lesKalkyleTider(kopi(SVAR))).toEqual({ generert: SVAR.generert, modeller: SVAR.modeller });
  });
  it('tom liste er gyldig (kalkylen har ingen modeller med tall)', () => {
    expect(lesKalkyleTider({ ...kopi(SVAR), modeller: [] })).toEqual({ generert: SVAR.generert, modeller: [] });
  });
  const brudd = [
    ['ikke objekt', () => null],
    ['ok er ikke true', (s) => { s.ok = 1; }],
    ['feil versjon', (s) => { s.versjon = 2; }],
    ['generert er ikke en dato', (s) => { s.generert = 'i går'; }],
    ['modeller mangler', (s) => { delete s.modeller; }],
    ['over 500 modeller', (s) => { s.modeller = Array.from({ length: 501 }, (_, i) => ({ kalkyle_id: 'k' + i, kalkyle_navn: 'M', portal_modell_slug: null, minutter: 1 })); }],
    ['to like kalkyle_id', (s) => { s.modeller[1].kalkyle_id = 'k1'; }],
    ['tom kalkyle_id', (s) => { s.modeller[0].kalkyle_id = ' '; }],
    ['navn for langt', (s) => { s.modeller[0].kalkyle_navn = 'x'.repeat(201); }],
    ['slug med store bokstaver', (s) => { s.modeller[0].portal_modell_slug = 'KIA-EV9'; }],
    ['slug som tall', (s) => { s.modeller[0].portal_modell_slug = 9; }],
    ['minutter som tekst', (s) => { s.modeller[0].minutter = '960'; }],
    ['minutter med desimal', (s) => { s.modeller[0].minutter = 960.5; }],
    ['negative minutter', (s) => { s.modeller[0].minutter = -1; }],
    ['for mange minutter', (s) => { s.modeller[0].minutter = 100001; }],
    ['minutter mangler (undefined er ikke null)', (s) => { delete s.modeller[0].minutter; }],
    ['en rad er ikke et objekt', (s) => { s.modeller.push('tull'); }],
  ];
  it.each(brudd)('avviser hele svaret: %s', (_navn, endre) => {
    const s = kopi(SVAR);
    const ut = endre(s);
    expect(lesKalkyleTider(ut === null ? null : s)).toBe(null);
  });
});

describe('index.ts mot falsk Deno', () => {
  const tmp = [];
  const fetchOrig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = fetchOrig; while (tmp.length) { try { unlinkSync(tmp.pop()); } catch { /* borte */ } } });

  async function last({ env = {}, portal = { status: 200, body: kopi(SVAR) }, rolle = 'admin' } = {}) {
    const fullEnv = { SALMAKERN_HENT_SECRET: 'hent-hemmelighet-test', SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_ANON_KEY: 'anon', ...env };
    const kall = { portal: [], ansatt: 0 };
    let handler = null;
    globalThis.Deno = { env: { get: (k) => fullEnv[k] }, serve: (h) => { handler = h; } };
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/rest/v1/rpc/current_ansatt')) {
        kall.ansatt++;
        return new Response(JSON.stringify(rolle ? [{ id: 1, rolle }] : []), { status: 200 });
      }
      kall.portal.push({ url: String(url), init });
      return new Response(JSON.stringify(portal.body), { status: portal.status });
    };
    const lim = "import { lesKalkyleTider } from './logikk.ts'";
    if (!kilde.includes(lim)) throw new Error('fant ikke importlinjen');
    const kode = kilde.replace(lim, `import { lesKalkyleTider } from ${JSON.stringify(pathToFileURL(path.join(FUNKSJON, 'logikk.ts')).href)}`);
    const fil = path.resolve(__dirname, `_hkt_tmp_${Math.random().toString(36).slice(2)}.ts`);
    tmp.push(fil); writeFileSync(fil, kode);
    const logOrig = console.log; console.log = () => {};
    try { await import(/* @vite-ignore */ pathToFileURL(fil).href); } finally { console.log = logOrig; }
    const kjør = async (method = 'POST') => {
      const lo = console.log; console.log = () => {};
      try { return await handler(new Request('https://x/functions/v1/hent-kalkyle-tider-fra-portalen', { method, headers: { authorization: 'Bearer aaaaaaaaaa.bbbbbbbbbb.cccccccccc' } })); } finally { console.log = lo; }
    };
    return { kjør, kall };
  }

  it('admin: henter med hemmeligheten, uten omdirigering, og sender modellene tilbake', async () => {
    const t = await last();
    const r = await t.kjør();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, generert: SVAR.generert, modeller: SVAR.modeller });
    expect(t.kall.portal[0].url).toBe('https://forhandler.salmaker.as/api/salmakern/kalkyle-timer');
    expect(t.kall.portal[0].init.headers['x-salmakern-hent-secret']).toBe('hent-hemmelighet-test');
    expect(t.kall.portal[0].init.redirect).toBe('error');
  });
  it('ALLTID håndhevet, også uten EDGE_AUTH_ENFORCE: vanlig ansatt får 403, ingen økt 401, og portalen spørres ikke', async () => {
    const a = await last({ rolle: 'ansatt' });
    expect((await a.kjør()).status).toBe(403);
    expect(a.kall.portal).toHaveLength(0);
    const b = await last({ rolle: null });
    expect((await b.kjør()).status).toBe(401);
    expect(b.kall.portal).toHaveLength(0);
  });
  it('med EDGE_AUTH_ENFORCE: samme svar (den delte gaten stopper først)', async () => {
    const t = await last({ rolle: 'ansatt', env: { EDGE_AUTH_ENFORCE: 'hent-kalkyle-tider-fra-portalen' } });
    expect((await t.kjør()).status).toBe(403);
    expect(t.kall.portal).toHaveLength(0);
  });
  it('kan ikke bekrefte innloggingen (current_ansatt svarer 500): 503, portalen spørres ikke', async () => {
    const t = await last();
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/rest/v1/rpc/current_ansatt')) return new Response('{}', { status: 500 });
      t.kall.portal.push({ url: String(url) });
      return new Response('{}', { status: 200 });
    };
    expect((await t.kjør()).status).toBe(503);
    expect(t.kall.portal).toHaveLength(0);
  });
  it('portalen har ikke endepunktet ennå (404): 502 med forklaring', async () => {
    const t = await last({ portal: { status: 404, body: { error: 'ikke funnet' } } });
    const r = await t.kjør();
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/gir ikke ut standardtider ennå/);
  });
  it('ugyldig svar: 502', async () => {
    const s = kopi(SVAR); s.modeller[0].minutter = 'mange';
    const t = await last({ portal: { status: 200, body: s } });
    expect((await t.kjør()).status).toBe(502);
  });
  it('mangler hemmeligheten: 500, portalen spørres ikke', async () => {
    const t = await last({ env: { SALMAKERN_HENT_SECRET: undefined } });
    expect((await t.kjør()).status).toBe(500);
    expect(t.kall.portal).toHaveLength(0);
  });
  it('bare POST', async () => {
    const t = await last();
    expect((await t.kjør('GET')).status).toBe(405);
  });
  it('kildeteksten lagrer ingenting: ingen databaseklient, ingen rpc, ingen skriving', () => {
    expect(kilde).not.toMatch(/createClient|\.rpc\(|\.from\(|SERVICE_ROLE/);
  });
});
