// hent-selgere-fra-portalen (s90-20261105, "appen henter selgere fra portalen", 5.11 -
// IKKE utrullet ennå). Samme grunnteknikk som fiken-fakturer-rabatt.test.js: last rå
// kildetekst, erstatt jsr:-importen med en falsk Supabase-klient, dynamisk import av en
// temp-fil. Dekker: EDGE-AUTH-GATEN (admin slipper gjennom, andre avvises når håndhevet),
// server-kall via delt hemmelighet, portal-henting (feil/uventet svarform), og at RPC-en
// kalles med riktig, omformet payload.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(
  path.resolve(__dirname, '../supabase/functions/hent-selgere-fra-portalen/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const IMPORT_LINJE = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
if (!kilde.includes(IMPORT_LINJE)) {
  throw new Error('hent-selgere-fra-portalen.test.js: fant ikke forventet import-linje å erstatte - oppdater testen');
}

const PORTAL_URL = 'https://forhandler.salmaker.as/api/salmakern/selgere';
// JWT_FORM i funksjonen krever tre punktum-separerte deler på minst 8 tegn hver.
const TOK = { admin: 'eyJhbGciOiJIUzI1NiJ9.admin-token-del-helt-ok-for-test.signaturdel', annen: 'eyJhbGciOiJIUzI1NiJ9.annen-token-helt-ok-for-testform.signaturdel' };

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

function gyldigPortalData(overrides = {}) {
  return {
    ok: true,
    generert: '2026-11-05T10:00:00.000Z',
    forhandlere: [
      { kontakt_id: 'k_test_1', kontakt_navn: 'TEST Forhandler', orgnr: '123456789', selgere: [{ portal_id: 'p_1', navn: 'Ola Nordmann', epost: 'ola@test.no' }] },
    ],
    ...overrides,
  };
}

// Alltid satt med mindre en test selv overstyrer dem (f.eks. for å teste at manglende
// Supabase-tilgang gir 500) - samme minimumsmiljø som fiken-fakturer-rabatt.test.js bruker.
const BASIS_ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key', SUPABASE_ANON_KEY: 'fake-anon-key' };

// env: {EDGE_AUTH_ENFORCE?, HENT_SELGERE_SERVER_SECRET?, SALMAKERN_HENT_SECRET?}, slått
// sammen MED (aldri i stedet for) BASIS_ENV.
// portal: {status, body} eller en funksjon (req)=>Response - svaret fra portalens endepunkt.
// rpcSvar: {data, error} - svaret fra den falske portal_selgere_synk-RPC-en.
async function last({ env = {}, portal = { status: 200, body: gyldigPortalData() }, rpcSvar = { data: { rapport: [] }, error: null } } = {}) {
  const heleEnv = { ...BASIS_ENV, ...env };
  globalThis.Deno = { env: { get: (k) => heleEnv[k] } };
  let handler;
  globalThis.Deno.serve = (fn) => { handler = fn; };

  const fetchKall = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    fetchKall.push({ url: u, headers: init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {} });
    if (u.endsWith('/rest/v1/rpc/current_ansatt')) {
      const token = (new Headers(init.headers).get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (token === TOK.admin) return new Response(JSON.stringify([{ id: 7, rolle: 'admin' }]), { status: 200 });
      if (token === TOK.annen) return new Response(JSON.stringify([{ id: 9, rolle: 'godkjenner' }]), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (u === PORTAL_URL) {
      if (typeof portal === 'function') return portal(init);
      return new Response(portal.body === undefined ? '' : JSON.stringify(portal.body), { status: portal.status });
    }
    throw new Error(`Uventet fetch-kall i testen: ${u}`);
  };

  let rpcKall = null;
  const shimFil = path.resolve(__dirname, `_hent_selgere_fake_supabase_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  const hovedFil = path.resolve(__dirname, `_hent_selgere_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`);
  tmpFiler.push(shimFil, hovedFil);
  writeFileSync(shimFil, 'export function createClient() { return globalThis.__FAKE_SUPABASE_FACTORY__(); }\n');
  globalThis.__FAKE_SUPABASE_FACTORY__ = () => ({
    rpc: async (navn, args) => { rpcKall = { navn, args }; return rpcSvar; },
  });
  const tilpasset = kilde.replace(IMPORT_LINJE, `import { createClient } from './${path.basename(shimFil)}'`);
  writeFileSync(hovedFil, tilpasset);
  await import(/* @vite-ignore */ pathToFileURL(hovedFil).href);

  return {
    fetchKall,
    get rpcKall() { return rpcKall; },
    kall: (headers = {}, method = 'POST') => handler(new Request('https://x.supabase.co/functions/v1/hent-selgere-fra-portalen', { method, headers })),
  };
}

describe('hent-selgere-fra-portalen: innloggingsgate', () => {
  it('OPTIONS gir alltid 200 "ok", uansett miljø eller headere', async () => {
    const { kall } = await last({ env: {} });
    const res = await kall({}, 'OPTIONS');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});

describe('hent-selgere-fra-portalen: ansatt-gate og server-hemmelighet', () => {
  it('myk modus (ingen EDGE_AUTH_ENFORCE): alle slipper gjennom til selve logikken', async () => {
    const { kall } = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) } });
    const res = await kall({ authorization: 'Bearer sb_publishable_ikke_en_jwt' });
    expect(res.status).toBe(200); // går helt til portal-henting (myk modus, gaten slipper gjennom)
  });

  it('håndhevet: admin slipper gjennom, en annen rolle avvises 403, ingen token avvises 401', async () => {
    const env = { EDGE_AUTH_ENFORCE: 'hent-selgere-fra-portalen', SALMAKERN_HENT_SECRET: 'x'.repeat(40) };
    const admin = await last({ env });
    expect((await admin.kall({ authorization: `Bearer ${TOK.admin}` })).status).toBe(200);

    const annen = await last({ env });
    const resAnnen = await annen.kall({ authorization: `Bearer ${TOK.annen}` });
    expect(resAnnen.status).toBe(403);

    const ingen = await last({ env });
    const resIngen = await ingen.kall({});
    expect(resIngen.status).toBe(401);
  });

  it('server-kall med riktig delt hemmelighet (x-server-secret) slipper gjennom håndhevet modus uten ansatt-oppslag', async () => {
    const HEMMELIGHET = 'test-server-hemmelighet-0123456789-abcdefghij';
    const env = { EDGE_AUTH_ENFORCE: '*', HENT_SELGERE_SERVER_SECRET: HEMMELIGHET, SALMAKERN_HENT_SECRET: 'x'.repeat(40) };
    const { kall, fetchKall } = await last({ env });
    const res = await kall({ 'x-server-secret': HEMMELIGHET });
    expect(res.status).toBe(200);
    expect(fetchKall.some((k) => k.url.endsWith('/rpc/current_ansatt'))).toBe(false); // ingen oppslag for et server-kall
  });

  it('feil server-hemmelighet faller tilbake til vanlig ansatt-gate (avvist uten gyldig token)', async () => {
    const env = { EDGE_AUTH_ENFORCE: '*', HENT_SELGERE_SERVER_SECRET: 'x'.repeat(40), SALMAKERN_HENT_SECRET: 'x'.repeat(40) };
    const { kall } = await last({ env });
    const res = await kall({ 'x-server-secret': 'feil-hemmelighet-helt-og-holdent' });
    expect(res.status).toBe(401);
  });
});

describe('hent-selgere-fra-portalen: henting fra portalen og videresending til databasen', () => {
  it('mangler SALMAKERN_HENT_SECRET i miljøet: 500, ingen portal-forespørsel gjort', async () => {
    const { kall, fetchKall } = await last({ env: {} });
    const res = await kall({});
    expect(res.status).toBe(500);
    expect(fetchKall.some((k) => k.url === PORTAL_URL)).toBe(false);
  });

  it('sender riktig hemmelighet i x-salmakern-hent-secret til portalen', async () => {
    const { kall, fetchKall } = await last({ env: { SALMAKERN_HENT_SECRET: 'min-hemmelighet-123' } });
    await kall({});
    const portalKall = fetchKall.find((k) => k.url === PORTAL_URL);
    expect(portalKall.headers['x-salmakern-hent-secret']).toBe('min-hemmelighet-123');
  });

  it('portalen svarer med feilkode: 502', async () => {
    const { kall } = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 503, body: { error: 'nede' } } });
    const res = await kall({});
    expect(res.status).toBe(502);
  });

  it('portalen svarer med uventet/ugyldig form: 502, ingen RPC-kall', async () => {
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: { ok: true, forhandlere: [{ kontakt_id: 123 }] } } });
    const res = await miljo.kall({});
    expect(res.status).toBe(502);
    // rpcKall er en getter - må leses ETTER kall(), aldri destruktureres tidlig (det ville bare tatt en frossen snap-shot av null).
    expect(miljo.rpcKall).toBeNull();
  });

  it('vellykket kjede: RPC-en kalles med riktig omformet payload (kun de tre avtalte feltene per selger)', async () => {
    const data = gyldigPortalData({
      forhandlere: [
        { kontakt_id: 'k_1', kontakt_navn: 'A', orgnr: '111111111', selgere: [{ portal_id: 'p_a', navn: 'A A', epost: 'a@test.no' }] },
        { kontakt_id: 'k_2', kontakt_navn: 'B', orgnr: null, selgere: [] },
      ],
    });
    const rapport = { rapport: [{ forhandler: 'A', opprettet: 1 }], navnMismatch: 0, ukjentKontaktId: 0 };
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data }, rpcSvar: { data: rapport, error: null } });
    const res = await miljo.kall({});
    const svar = await res.json();
    expect(res.status).toBe(200);
    // rpcKall er en getter - må leses ETTER kall(), aldri destruktureres tidlig.
    expect(miljo.rpcKall.navn).toBe('portal_selgere_synk');
    expect(miljo.rpcKall.args.p_forhandlere).toEqual([
      { kontakt_id: 'k_1', kontakt_navn: 'A', selgere: [{ portal_id: 'p_a', navn: 'A A', epost: 'a@test.no' }] },
      { kontakt_id: 'k_2', kontakt_navn: 'B', selgere: [] },
    ]);
    expect(svar).toMatchObject({ ok: true, antallForhandlere: 2, rapport: rapport.rapport });
  });

  it('RPC-feil gir 500 med feilmeldingen', async () => {
    const { kall } = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, rpcSvar: { data: null, error: { message: 'Databasen nede' } } });
    const res = await kall({});
    const svar = await res.json();
    expect(res.status).toBe(500);
    expect(svar.error).toContain('Databasen nede');
  });
});
