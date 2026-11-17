// hent-produkter-fra-portalen (trinn 2 av «Én produktliste»): henter GET /api/salmakern/produktnumre fra portalen inn i portal_produkter.
// 1) logikk.ts (streng validering) lastes direkte. 2) index.ts kjøres mot falsk Deno, falsk fetch (portalen + current_ansatt) og en falsk
// klient som bare har rpc. Alle verdier er syntetiske. SQL-delen: supabase/tester/portal_produkter_TEST_body.sql.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { lesProduktliste } from '../supabase/functions/hent-produkter-fra-portalen/logikk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJON = path.resolve(__dirname, '../supabase/functions/hent-produkter-fra-portalen');
const kilde = readFileSync(path.join(FUNKSJON, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const kopi = (x) => JSON.parse(JSON.stringify(x));

const LISTE = {
  ok: true, versjon: 1, generert: '2026-11-17T12:00:00.000Z',
  antall: { modeller: 2, varianter: 3, tillegg: 1, uten_fiken_nummer: 1, modeller_uten_slug: 0 },
  modeller: [
    { slug: 'kia-ev9', navn: 'KIA EV9', portal_modell_id: 'm1', varianter: [
      { portal_id: 'v1', navn: 'Standard ombygging', prisgruppe: 'standard', app_rolle: 'ombygging', produktnummer: '500', fiken_nummer: '500', nummer_status: 'ok',
        tillegg: [{ portal_id: 't1', navn: 'Tillegg for 180 graders stoler', type: 'tillegg', produktnummer: '502', fiken_nummer: '502', nummer_status: 'ok' }] },
      { portal_id: 'v2', navn: 'Ombygging til personbil', prisgruppe: 'standard', app_rolle: 'personbil', produktnummer: '524', fiken_nummer: '524', nummer_status: 'ok', tillegg: [] },
    ] },
    { slug: 'mercedes-eqv', navn: 'EQV', portal_modell_id: 'm2', varianter: [
      { portal_id: 'v3', navn: 'Standard', prisgruppe: 'standard', app_rolle: null, produktnummer: '1600-1601', fiken_nummer: null, nummer_status: 'intervall', tillegg: [] },
    ] },
  ],
};

describe('lesProduktliste', () => {
  it('gyldig liste gir rader for varianter og tillegg, med rolle og forelder', () => {
    const r = lesProduktliste(kopi(LISTE));
    expect(r.roller).toBe(2);
    expect(r.rader.map((x) => x.portal_id)).toEqual(['v1', 't1', 'v2', 'v3']);
    expect(r.rader[1]).toMatchObject({ type: 'tillegg', variant_portal_id: 'v1', app_rolle: null, modell_slug: 'kia-ev9' });
    expect(r.rader[0]).toMatchObject({ app_rolle: 'ombygging', fiken_nummer: '500', nummer_status: 'ok' });
    expect(r.rader[3]).toMatchObject({ fiken_nummer: null, nummer_status: 'intervall' });
  });
  it('velges_nar følger med; mangler feltet blir det tom liste; feil form avvises', () => {
    const l = kopi(LISTE); l.modeller[0].varianter[0].tillegg[0].velges_nar = ['4-seter bak 180', 'Tillegg for 180 graders stoler'];
    const r = lesProduktliste(l);
    expect(r.rader[1].velges_nar).toEqual(['4-seter bak 180', 'Tillegg for 180 graders stoler']);
    expect(r.rader[0].velges_nar).toEqual([]);
    for (const feil of ['tekst', [''], [1], Array(21).fill('x'), ['x'.repeat(101)]]) {
      const m = kopi(LISTE); m.modeller[0].varianter[0].velges_nar = feil;
      expect(lesProduktliste(m), JSON.stringify(feil).slice(0, 30)).toBeNull();
    }
  });
  it('varianter uten app_rolle-felt (eldre portal) er lov og gir null', () => {
    const l = kopi(LISTE); delete l.modeller[0].varianter[0].app_rolle;
    expect(lesProduktliste(l).rader[0].app_rolle).toBeNull();
  });
  const brudd = {
    'ok ikke sann': (l) => { l.ok = false; },
    'feil versjon': (l) => { l.versjon = 2; },
    'antall varianter stemmer ikke': (l) => { l.antall.varianter = 4; },
    'antall tillegg stemmer ikke': (l) => { l.antall.tillegg = 0; },
    'fiken_nummer på intervall': (l) => { l.modeller[1].varianter[0].fiken_nummer = '1600'; },
    'ok uten fiken_nummer': (l) => { l.modeller[0].varianter[0].fiken_nummer = null; },
    'nummer med ledende null': (l) => { l.modeller[0].varianter[0].fiken_nummer = '0500'; },
    'ukjent rolle': (l) => { l.modeller[0].varianter[0].app_rolle = 'annet'; },
    'to ombygginger på samme modell': (l) => { l.modeller[0].varianter[1].app_rolle = 'ombygging'; },
    'samme portal-id to ganger': (l) => { l.modeller[0].varianter[1].portal_id = 'v1'; },
    'tillegg med ukjent type': (l) => { l.modeller[0].varianter[0].tillegg[0].type = 'annet'; },
    'modell uten slug': (l) => { l.modeller[0].slug = ''; },
    'ukjent nummer_status': (l) => { l.modeller[0].varianter[0].nummer_status = 'kanskje'; },
  };
  for (const [navn, fn] of Object.entries(brudd)) {
    it(`avviser hele svaret: ${navn}`, () => { const l = kopi(LISTE); fn(l); expect(lesProduktliste(l)).toBeNull(); });
  }
  it('avviser en tom liste og ikke-objekter', () => {
    expect(lesProduktliste({ ...kopi(LISTE), modeller: [], antall: { modeller: 0, varianter: 0, tillegg: 0 } })).toBeNull();
    expect(lesProduktliste(null)).toBeNull();
    expect(lesProduktliste([])).toBeNull();
  });
});

describe('index.ts mot falsk Deno', () => {
  const tmp = [];
  const fetchOrig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = fetchOrig; while (tmp.length) { try { unlinkSync(tmp.pop()); } catch { /* borte */ } } });

  async function last({ env = {}, portal = { status: 200, body: kopi(LISTE) }, rolle = 'admin', rpc = { data: { modeller: 2, rader: 4, roller: 2, endredeRoller: [], fjernedeRoller: [] }, error: null } } = {}) {
    const fullEnv = { SALMAKERN_HENT_SECRET: 'hent-hemmelighet-test', SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'tjeneste', SUPABASE_ANON_KEY: 'anon', EDGE_AUTH_ENFORCE: 'hent-produkter-fra-portalen', ...env };
    const kall = { portal: [], rpc: [] };
    let handler = null;
    globalThis.Deno = { env: { get: (k) => fullEnv[k] }, serve: (h) => { handler = h; } };
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/rest/v1/rpc/current_ansatt')) {
        return new Response(JSON.stringify(rolle ? [{ id: 1, rolle }] : []), { status: 200 });
      }
      kall.portal.push({ url: String(url), init });
      return new Response(JSON.stringify(portal.body), { status: portal.status });
    };
    globalThis.__fakeCreateClient = () => ({ rpc: (navn, args) => { kall.rpc.push({ navn, args }); return Promise.resolve(rpc); } });
    const imp = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
    const lim = "import { lesProduktliste } from './logikk.ts'";
    if (!kilde.includes(imp) || !kilde.includes(lim)) throw new Error('fant ikke importlinjene');
    const kode = kilde.replace(imp, 'const createClient = globalThis.__fakeCreateClient').replace(lim, `import { lesProduktliste } from ${JSON.stringify(pathToFileURL(path.join(FUNKSJON, 'logikk.ts')).href)}`);
    const fil = path.resolve(__dirname, `_hpp_tmp_${Math.random().toString(36).slice(2)}.ts`);
    tmp.push(fil); writeFileSync(fil, kode);
    const logOrig = console.log; console.log = () => {};
    try { await import(/* @vite-ignore */ pathToFileURL(fil).href); } finally { console.log = logOrig; }
    const kjør = async (method = 'POST') => {
      const lo = console.log; console.log = () => {};
      try { return await handler(new Request('https://x/functions/v1/hent-produkter-fra-portalen', { method, headers: { authorization: 'Bearer aaaaaaaaaa.bbbbbbbbbb.cccccccccc' } })); } finally { console.log = lo; }
    };
    return { kjør, kall };
  }

  it('admin: henter med hemmeligheten, uten omdirigering, og synker radene', async () => {
    const t = await last();
    const r = await t.kjør();
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
    expect(t.kall.portal[0].url).toBe('https://forhandler.salmaker.as/api/salmakern/produktnumre');
    expect(t.kall.portal[0].init.headers['x-salmakern-hent-secret']).toBe('hent-hemmelighet-test');
    expect(t.kall.portal[0].init.redirect).toBe('error');
    expect(t.kall.rpc[0].navn).toBe('portal_produkter_synk');
    expect(t.kall.rpc[0].args.p).toHaveLength(4);
  });
  it('ikke admin (håndhevet): 403, portalen spørres ikke', async () => {
    const t = await last({ rolle: 'ansatt' });
    expect((await t.kjør()).status).toBe(403);
    expect(t.kall.portal).toHaveLength(0);
  });
  it('ingen ansatt-økt (håndhevet): 401', async () => {
    const t = await last({ rolle: null });
    expect((await t.kjør()).status).toBe(401);
  });
  it('ugyldig svar fra portalen: 502 og ingen lagring', async () => {
    const l = kopi(LISTE); l.antall.varianter = 99;
    const t = await last({ portal: { status: 200, body: l } });
    expect((await t.kjør()).status).toBe(502);
    expect(t.kall.rpc).toHaveLength(0);
  });
  it('portalen svarer 401: 502 og ingen lagring', async () => {
    const t = await last({ portal: { status: 401, body: { ok: false } } });
    expect((await t.kjør()).status).toBe(502);
    expect(t.kall.rpc).toHaveLength(0);
  });
  it('DOBBEL_ROLLE fra databasen gir 409 med forklaring', async () => {
    const t = await last({ rpc: { data: null, error: { message: 'DOBBEL_ROLLE' } } });
    const r = await t.kjør();
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/samme «Brukes i Salmaker'n som»/);
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
});
