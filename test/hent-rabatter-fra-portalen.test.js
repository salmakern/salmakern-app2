// hent-rabatter-fra-portalen (s90-20261105-portal-data-henting, rabatt-prosjektet steg 1,
// "bygg+verifiser henting av portalsatser" - 5.11, Henriks ja: "Ja det er bare å starte").
// IKKE utrullet ennå. Samme grunnteknikk som hent-selgere-fra-portalen.test.js: last rå
// kildetekst, erstatt jsr:-importen med en falsk Supabase-klient, dynamisk import av en
// temp-fil. Dekker: EDGE-AUTH-GATEN (admin slipper gjennom, andre avvises når håndhevet),
// portal-henting (feil/uventet svarform, ugyldige rabattsatser), antall-kryssjekk, og at
// RPC-en kalles med riktig, omformet (flatet ut) payload.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(
  path.resolve(__dirname, '../supabase/functions/hent-rabatter-fra-portalen/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const IMPORT_LINJE = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
if (!kilde.includes(IMPORT_LINJE)) {
  throw new Error('hent-rabatter-fra-portalen.test.js: fant ikke forventet import-linje å erstatte - oppdater testen');
}

const PORTAL_URL = 'https://forhandler.salmaker.as/api/salmakern/rabatter';
// JWT_FORM i funksjonen krever tre punktum-separerte deler på minst 8 tegn hver.
const TOK = { admin: 'eyJhbGciOiJIUzI1NiJ9.admin-token-del-helt-ok-for-test.signaturdel', annen: 'eyJhbGciOiJIUzI1NiJ9.annen-token-helt-ok-for-testform.signaturdel' };

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

function gyldigRabatt(overrides = {}) { return { standard: 10, ekstrautstyr: 5, modulsystem: 0, ...overrides }; }

// antall.forhandlere/med_ugyldig_sats regnes automatisk ut fra den FAKTISKE forhandlere-lista -
// en test som vil teste selve antall-mismatch-sjekken overstyrer antall eksplisitt etterpå.
function gyldigPortalData(overrides = {}) {
  const forhandlere = overrides.forhandlere || [
    { kontakt_id: 'k_test_1', kontakt_navn: 'TEST Forhandler', orgnr: '123456789', portal_forhandler_id: 'pf_1', rabatt: gyldigRabatt() },
  ];
  const medUgyldigSats = forhandlere.filter((f) => f.rabatt.standard === null || f.rabatt.ekstrautstyr === null || f.rabatt.modulsystem === null).length;
  return {
    ok: true,
    versjon: 1,
    generert: '2026-11-05T10:00:00.000Z',
    antall: { forhandlere: forhandlere.length, med_ugyldig_sats: medUgyldigSats },
    forhandlere,
    ...overrides,
  };
}

// Alltid satt med mindre en test selv overstyrer dem - samme minimumsmiljø som
// hent-selgere-fra-portalen.test.js bruker.
const BASIS_ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key', SUPABASE_ANON_KEY: 'fake-anon-key' };

// env: {EDGE_AUTH_ENFORCE?, SALMAKERN_HENT_SECRET?}, slått sammen MED (aldri i stedet for) BASIS_ENV.
// portal: {status, body} eller en funksjon (req)=>Response - svaret fra portalens endepunkt.
// rpcSvar: {data, error} - svaret fra den falske portal_rabatter_synk-RPC-en.
async function last({ env = {}, portal = { status: 200, body: gyldigPortalData() }, rpcSvar = { data: { opprettet: 0, oppdatert: 0, uendret: 0, ugyldigRad: 0, ukjentKontaktId: 0 }, error: null } } = {}) {
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
  const shimFil = path.resolve(__dirname, `_hent_rabatter_fake_supabase_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  const hovedFil = path.resolve(__dirname, `_hent_rabatter_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`);
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
    kall: (headers = {}, method = 'POST') => handler(new Request('https://x.supabase.co/functions/v1/hent-rabatter-fra-portalen', { method, headers })),
  };
}

describe('hent-rabatter-fra-portalen: innloggingsgate', () => {
  it('OPTIONS gir alltid 200 "ok", uansett miljø eller headere', async () => {
    const { kall } = await last({ env: {} });
    const res = await kall({}, 'OPTIONS');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});

describe('hent-rabatter-fra-portalen: ansatt-gate', () => {
  it('myk modus (ingen EDGE_AUTH_ENFORCE): alle slipper gjennom til selve logikken', async () => {
    const { kall } = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) } });
    const res = await kall({ authorization: 'Bearer sb_publishable_ikke_en_jwt' });
    expect(res.status).toBe(200); // går helt til portal-henting (myk modus, gaten slipper gjennom)
  });

  it('håndhevet: admin slipper gjennom, en annen rolle avvises 403, ingen token avvises 401', async () => {
    const env = { EDGE_AUTH_ENFORCE: 'hent-rabatter-fra-portalen', SALMAKERN_HENT_SECRET: 'x'.repeat(40) };
    const admin = await last({ env });
    expect((await admin.kall({ authorization: `Bearer ${TOK.admin}` })).status).toBe(200);

    const annen = await last({ env });
    const resAnnen = await annen.kall({ authorization: `Bearer ${TOK.annen}` });
    expect(resAnnen.status).toBe(403);

    const ingen = await last({ env });
    const resIngen = await ingen.kall({});
    expect(resIngen.status).toBe(401);
  });
});

describe('hent-rabatter-fra-portalen: henting fra portalen og videresending til databasen', () => {
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
    // rpcKall er en getter - må leses ETTER kall(), aldri destruktureres tidlig.
    expect(miljo.rpcKall).toBeNull();
  });

  it('portalens oppgitte antall.forhandlere stemmer ikke med den faktiske listen: 502, ingen RPC-kall', async () => {
    const data = gyldigPortalData();
    data.antall = { forhandlere: 5, med_ugyldig_sats: 0 }; // overstyrt til å avvike fra den faktiske (1) lista
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data } });
    const res = await miljo.kall({});
    const svar = await res.json();
    expect(res.status).toBe(502);
    expect(svar.error).toMatch(/antall/);
    expect(miljo.rpcKall).toBeNull();
  });

  it('portalens oppgitte antall.med_ugyldig_sats stemmer ikke med faktisk antall null-rabatter: 502, ingen RPC-kall', async () => {
    const data = gyldigPortalData({
      forhandlere: [
        { kontakt_id: 'k_1', kontakt_navn: 'A', orgnr: null, portal_forhandler_id: 'pf_1', rabatt: { standard: null, ekstrautstyr: 0, modulsystem: 0 } },
      ],
    });
    data.antall.med_ugyldig_sats = 0; // faktisk er det 1 (standard er null)
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data } });
    const res = await miljo.kall({});
    expect(res.status).toBe(502);
    expect(miljo.rpcKall).toBeNull();
  });

  it('en ugyldig rabattsats (NaN/uendelig/negativ/over 100) er ALDRI gyldig, selv om den ikke er null: 502', async () => {
    for (const ugyldig of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY, '15', '15%']) {
      const data = gyldigPortalData({
        forhandlere: [{ kontakt_id: 'k_1', kontakt_navn: 'A', orgnr: null, portal_forhandler_id: 'pf_1', rabatt: gyldigRabatt({ standard: ugyldig }) }],
      });
      const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data } });
      const res = await miljo.kall({});
      expect(res.status, `sats ${JSON.stringify(ugyldig)} skal avvises`).toBe(502);
      expect(miljo.rpcKall).toBeNull();
    }
  });

  it('null er en gyldig sats (ugyldig/ukjent hos portalen) - 0 og null skal IKKE forveksles', async () => {
    const data = gyldigPortalData({
      forhandlere: [{ kontakt_id: 'k_1', kontakt_navn: 'A', orgnr: null, portal_forhandler_id: 'pf_1', rabatt: { standard: null, ekstrautstyr: 0, modulsystem: null } }],
    });
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data } });
    const res = await miljo.kall({});
    expect(res.status).toBe(200);
    expect(miljo.rpcKall.args.p_forhandlere[0]).toMatchObject({ rabatt_standard: null, rabatt_ekstrautstyr: 0, rabatt_modulsystem: null });
  });

  it('kontakt_navn kan være tom streng (forhandler uten navn registrert) - fortsatt et gyldig svar', async () => {
    const data = gyldigPortalData({
      forhandlere: [{ kontakt_id: 'k_1', kontakt_navn: '', orgnr: null, portal_forhandler_id: 'pf_1', rabatt: gyldigRabatt() }],
    });
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data } });
    const res = await miljo.kall({});
    expect(res.status).toBe(200);
    expect(miljo.rpcKall.args.p_forhandlere[0].kontakt_navn).toBe('');
  });

  it('en NULL-verdi (ikke en tom streng) for kontakt_navn er ugyldig - 502', async () => {
    const data = gyldigPortalData({
      forhandlere: [{ kontakt_id: 'k_1', kontakt_navn: null, orgnr: null, portal_forhandler_id: 'pf_1', rabatt: gyldigRabatt() }],
    });
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data } });
    const res = await miljo.kall({});
    expect(res.status).toBe(502);
    expect(miljo.rpcKall).toBeNull();
  });

  it('en tom streng for kontakt_id eller portal_forhandler_id (nøkler, ikke fritekst) er ugyldig - 502', async () => {
    for (const felt of ['kontakt_id', 'portal_forhandler_id']) {
      const data = gyldigPortalData({
        forhandlere: [{ kontakt_id: 'k_1', kontakt_navn: 'A', orgnr: null, portal_forhandler_id: 'pf_1', rabatt: gyldigRabatt(), [felt]: '' }],
      });
      const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data } });
      const res = await miljo.kall({});
      expect(res.status, `tomt ${felt} skal avvises`).toBe(502);
      expect(miljo.rpcKall).toBeNull();
    }
  });

  it('orgnr kan være null', async () => {
    const data = gyldigPortalData({
      forhandlere: [{ kontakt_id: 'k_1', kontakt_navn: 'A', orgnr: null, portal_forhandler_id: 'pf_1', rabatt: gyldigRabatt() }],
    });
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data } });
    const res = await miljo.kall({});
    expect(res.status).toBe(200);
    expect(miljo.rpcKall.args.p_forhandlere[0].orgnr).toBeNull();
  });

  it('vellykket kjede: RPC-en kalles med riktig, flatet ut payload (kun de avtalte feltene per forhandler)', async () => {
    const data = gyldigPortalData({
      forhandlere: [
        { kontakt_id: 'k_1', kontakt_navn: 'A', orgnr: '111111111', portal_forhandler_id: 'pf_1', rabatt: { standard: 20, ekstrautstyr: 10, modulsystem: 0 } },
        { kontakt_id: 'k_1', kontakt_navn: 'A avd. 2', orgnr: '111111111', portal_forhandler_id: 'pf_2', rabatt: { standard: null, ekstrautstyr: null, modulsystem: null } },
      ],
    });
    const rapport = { opprettet: 2, oppdatert: 0, uendret: 0, ugyldigRad: 0, ukjentKontaktId: 0 };
    const miljo = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, portal: { status: 200, body: data }, rpcSvar: { data: rapport, error: null } });
    const res = await miljo.kall({});
    const svar = await res.json();
    expect(res.status).toBe(200);
    // rpcKall er en getter - må leses ETTER kall(), aldri destruktureres tidlig.
    expect(miljo.rpcKall.navn).toBe('portal_rabatter_synk');
    expect(miljo.rpcKall.args.p_forhandlere).toEqual([
      { portal_forhandler_id: 'pf_1', kontakt_id: 'k_1', kontakt_navn: 'A', orgnr: '111111111', rabatt_standard: 20, rabatt_ekstrautstyr: 10, rabatt_modulsystem: 0 },
      { portal_forhandler_id: 'pf_2', kontakt_id: 'k_1', kontakt_navn: 'A avd. 2', orgnr: '111111111', rabatt_standard: null, rabatt_ekstrautstyr: null, rabatt_modulsystem: null },
    ]);
    // Samme kontakt_id på flere rader (delt Kontakter-kontakt, f.eks. BOS-gruppen) er bevisst lov - se migrasjonsnotatet.
    expect(svar).toMatchObject({ ok: true, antallForhandlere: 2, opprettet: 2 });
  });

  it('RPC-feil gir 500 med feilmeldingen', async () => {
    const { kall } = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(40) }, rpcSvar: { data: null, error: { message: 'Databasen nede' } } });
    const res = await kall({});
    const svar = await res.json();
    expect(res.status).toBe(500);
    expect(svar.error).toContain('Databasen nede');
  });
});
