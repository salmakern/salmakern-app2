// Edge-funksjonen portal-forhandler-salg (supabase/functions/portal-forhandler-salg): gir Forhandlerportalens Kalkyle «lønnsomhet per forhandler» et
// SKRIVEBESKYTTET, aggregert øyeblikksbilde av faktisk fakturerte bil-ordre. Portalen henter; appen skriver aldri til portalen og funksjonen skriver
// aldri noe. Samme testteknikk som test/portal-import-fakta.test.js:
//  1) logikk.ts (ren validering/avgrensning) lastes direkte.
//  2) index.ts kjøres mot falsk Deno og en falsk supabase-klient som BARE har rpc (alt annet kaster): kildefilen kopieres til en midlertidig .ts-modul
//     med jsr:-importen byttet ut, så HELE håndtereren testes: hemmelighet, grenser, svaravgrensning, feil, logging.
// Postgres-funksjonen bak (portal_forhandler_salg) har sin egen test: supabase/tester/portal_forhandler_salg_TEST_body.sql (rullet tilbake).
// Alle verdier her er SYNTETISKE (k_test_a osv.): ingen ekte forhandler-id-er eller beløp.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseForesporsel, mapSalg, mapFeil, VERSJON, MAKS_BODY_BYTES, IDER_MAKS, GRUPPER_MAKS, ID_FORM } from '../supabase/functions/portal-forhandler-salg/logikk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJON = path.resolve(__dirname, '../supabase/functions/portal-forhandler-salg');
const kilde = readFileSync(path.join(FUNKSJON, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const kopi = (x) => JSON.parse(JSON.stringify(x));

const GYLDIG_GRUPPE = { forhandler_kontakt_id: 'k_test_a', merke: 'KIA', modell: 'EV9', portal_modell_slug: 'kia-ev9', antall_ordre: 3, fakturert_belop_eks_mva: 154500.5 };
const SQL_SVAR = { versjon: 1, generert: '2026-11-16T10:00:00.000Z', grupper: [GYLDIG_GRUPPE, { ...GYLDIG_GRUPPE, forhandler_kontakt_id: 'k_test_b', portal_modell_slug: null, modell: 'Defender 110', antall_ordre: 1, fakturert_belop_eks_mva: 0 }] };

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// parseForesporsel
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('parseForesporsel', () => {
  it('konstantene er kontraktens', () => {
    expect(VERSJON).toBe(1);
    expect(IDER_MAKS).toBe(500);
    expect(GRUPPER_MAKS).toBe(2000);
    expect(MAKS_BODY_BYTES).toBe(65536);
    expect(ID_FORM.source).toBe('^[A-Za-z0-9_.-]{1,64}$');
  });

  it('gyldig forespørsel med forhandler_kontakt_ider: bare det feltet videre; versjon og ukjente felt kastes', () => {
    const r = parseForesporsel({ versjon: 1, forhandler_kontakt_ider: ['k_test_a', 'k_test_b'], ekstra: 'x' });
    expect(r).toEqual({ ok: true, foresporsel: { forhandlerKontaktIder: ['k_test_a', 'k_test_b'] } });
    expect(Object.keys(r.foresporsel)).toEqual(['forhandlerKontaktIder']);
  });

  it('forhandler_kontakt_ider mangler eller er null: null (= alle forhandlere)', () => {
    expect(parseForesporsel({ versjon: 1 })).toEqual({ ok: true, foresporsel: { forhandlerKontaktIder: null } });
    expect(parseForesporsel({ versjon: 1, forhandler_kontakt_ider: null })).toEqual({ ok: true, foresporsel: { forhandlerKontaktIder: null } });
  });

  it('tom liste er gyldig (gir tom liste tilbake, ikke null)', () => {
    expect(parseForesporsel({ versjon: 1, forhandler_kontakt_ider: [] })).toEqual({ ok: true, foresporsel: { forhandlerKontaktIder: [] } });
  });

  it('dubletter fjernes og rekkefølgen til første forekomst bevares', () => {
    expect(parseForesporsel({ versjon: 1, forhandler_kontakt_ider: ['b', 'a', 'b', 'c', 'a'] }).foresporsel.forhandlerKontaktIder).toEqual(['b', 'a', 'c']);
  });

  it('en «__proto__»-nøkkel fra JSON.parse forurenser ingenting', () => {
    const r = parseForesporsel(JSON.parse('{"versjon":1,"forhandler_kontakt_ider":["a"],"__proto__":{"forhandler_kontakt_ider":["x"]}}'));
    expect(r).toEqual({ ok: true, foresporsel: { forhandlerKontaktIder: ['a'] } });
    expect({}.forhandler_kontakt_ider).toBeUndefined();
  });

  it('versjon er PÅKREVD og må være tallet 1', () => {
    for (const v of [undefined, 0, 2, '1', null, 1.5, true, [1]]) {
      expect(parseForesporsel({ versjon: v })).toEqual({ ok: false, felt: 'versjon' });
    }
  });

  it('body må være et objekt, ikke array/null/primitiv', () => {
    for (const raw of [null, undefined, [], 'x', 1, true]) {
      expect(parseForesporsel(raw)).toEqual({ ok: false, felt: 'body' });
    }
  });

  it('forhandler_kontakt_ider: ikke en liste, over 500, eller et element som ikke matcher mønsteret', () => {
    expect(parseForesporsel({ versjon: 1, forhandler_kontakt_ider: 'k_a' })).toEqual({ ok: false, felt: 'forhandler_kontakt_ider' });
    expect(parseForesporsel({ versjon: 1, forhandler_kontakt_ider: Array.from({ length: 501 }, (_, i) => `k${i}`) })).toEqual({ ok: false, felt: 'forhandler_kontakt_ider' });
    expect(parseForesporsel({ versjon: 1, forhandler_kontakt_ider: ['k_a', 123] })).toEqual({ ok: false, felt: 'forhandler_kontakt_ider' });
    expect(parseForesporsel({ versjon: 1, forhandler_kontakt_ider: ['k a'] })).toEqual({ ok: false, felt: 'forhandler_kontakt_ider' });
    expect(parseForesporsel({ versjon: 1, forhandler_kontakt_ider: ['x'.repeat(65)] })).toEqual({ ok: false, felt: 'forhandler_kontakt_ider' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// mapSalg
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('mapSalg', () => {
  it('gyldig svar mappes med ok:true, feltrekkefølgen i hver gruppe er fast', () => {
    const r = mapSalg(kopi(SQL_SVAR));
    expect(r).toEqual({ ok: true, ...SQL_SVAR });
    expect(Object.keys(r.grupper[0])).toEqual(['forhandler_kontakt_id', 'merke', 'modell', 'portal_modell_slug', 'antall_ordre', 'fakturert_belop_eks_mva']);
  });

  it('tom gruppeliste er gyldig', () => {
    expect(mapSalg({ versjon: 1, generert: SQL_SVAR.generert, grupper: [] })).toEqual({ ok: true, versjon: 1, generert: SQL_SVAR.generert, grupper: [] });
  });

  it('ekstra felt på toppnivå eller i en gruppe kastes, ikke videresendes', () => {
    const med = kopi(SQL_SVAR);
    med.uventet = 'x';
    med.grupper[0].uventet = 'y';
    const r = mapSalg(med);
    expect(Object.keys(r)).toEqual(['ok', 'versjon', 'generert', 'grupper']);
    expect(Object.keys(r.grupper[0])).not.toContain('uventet');
  });

  it('portal_modell_slug kan være null, men ikke mangle eller være feil type', () => {
    const med = kopi(SQL_SVAR);
    med.grupper[0].portal_modell_slug = null;
    expect(mapSalg(med).grupper[0].portal_modell_slug).toBeNull();
    const utenFelt = kopi(SQL_SVAR);
    delete utenFelt.grupper[0].portal_modell_slug;
    expect(mapSalg(utenFelt)).toBeNull();
    const feilType = kopi(SQL_SVAR);
    feilType.grupper[0].portal_modell_slug = 123;
    expect(mapSalg(feilType)).toBeNull();
  });

  it('antall_ordre må være et heltall ≥ 1', () => {
    for (const v of [0, -1, 1.5, '3', null]) {
      const med = kopi(SQL_SVAR);
      med.grupper[0].antall_ordre = v;
      expect(mapSalg(med), JSON.stringify(v)).toBeNull();
    }
  });

  it('fakturert_belop_eks_mva må være et endelig tall (0 er gyldig, NaN/Infinity/tekst er ikke)', () => {
    const nullBelop = kopi(SQL_SVAR);
    nullBelop.grupper[0].fakturert_belop_eks_mva = 0;
    expect(mapSalg(nullBelop).grupper[0].fakturert_belop_eks_mva).toBe(0);
    for (const v of [NaN, Infinity, -Infinity, '100', null]) {
      const med = kopi(SQL_SVAR);
      med.grupper[0].fakturert_belop_eks_mva = v;
      expect(mapSalg(med), String(v)).toBeNull();
    }
  });

  it('for mange grupper (over GRUPPER_MAKS) avvises', () => {
    const med = { versjon: 1, generert: SQL_SVAR.generert, grupper: Array.from({ length: GRUPPER_MAKS + 1 }, (_, i) => ({ ...GYLDIG_GRUPPE, forhandler_kontakt_id: `k${i}` })) };
    expect(mapSalg(med)).toBeNull();
  });

  it('feil versjon, manglende generert-tidspunkt, eller grupper som ikke er en liste gir null', () => {
    expect(mapSalg({ ...kopi(SQL_SVAR), versjon: 2 })).toBeNull();
    expect(mapSalg({ ...kopi(SQL_SVAR), generert: 'ikke-en-dato' })).toBeNull();
    expect(mapSalg({ ...kopi(SQL_SVAR), grupper: 'x' })).toBeNull();
  });

  it('merke/modell/forhandler_kontakt_id av feil type eller tom id gir null', () => {
    const tomId = kopi(SQL_SVAR); tomId.grupper[0].forhandler_kontakt_id = '';
    expect(mapSalg(tomId)).toBeNull();
    const feilMerke = kopi(SQL_SVAR); feilMerke.grupper[0].merke = 123;
    expect(mapSalg(feilMerke)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// mapFeil
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('mapFeil', () => {
  it('UGYLDIG_INPUT gir 400 med felt forhandler_kontakt_ider', () => {
    expect(mapFeil({ message: 'UGYLDIG_INPUT: forhandler_kontakt_ider' })).toEqual({ status: 400, kode: 'ugyldig_input', felt: 'forhandler_kontakt_ider' });
  });
  it('alt annet (også tekst som bare ligner) er 502 intern_feil uten detaljer', () => {
    for (const feil of [{ message: 'noe helt annet' }, { message: 'nesten UGYLDIG_INPUT men ikke helt' }, null, undefined, 'streng', {}]) {
      expect(mapFeil(feil)).toEqual({ status: 502, kode: 'intern_feil' });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// index.ts: håndtereren kjørt mot falsk Deno og en falsk klient som bare har rpc
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('index.ts: oppførsel', () => {
  const HEMMELIGHET = 'test-hent-hemmelighet-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const TJENESTE_NOKKEL = 'tjeneste-nokkel-test-bbbbbbbbbbbbbbbbbbbbbbbb';
  const tmpFiler = [];
  const fetchOrig = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = fetchOrig;
    while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } }
  });

  async function last({ env = {}, rpc = { data: kopi(SQL_SVAR), error: null }, rpcKaster = null } = {}) {
    const fullEnv = { SALMAKERN_HENT_SECRET: HEMMELIGHET, SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: TJENESTE_NOKKEL, ...env };
    const rpcKall = [];
    const klientKall = [];
    const fetchKall = [];
    const logger = [];
    const logOrig = console.log;
    let handler = null;
    globalThis.Deno = { env: { get: (k) => fullEnv[k] }, serve: (h) => { handler = h; } };
    globalThis.fetch = (...a) => { fetchKall.push(a); throw new Error('fetch skal aldri kalles i portal-forhandler-salg'); };
    globalThis.__fakeCreateClientSalg = (url, nokkel, opts) => {
      klientKall.push({ url, nokkel, opts });
      const klient = {
        rpc: (navn, args) => {
          rpcKall.push({ navn, args });
          return { abortSignal: (signal) => { rpcKall[rpcKall.length - 1].signal = !!signal; if (rpcKaster) return Promise.reject(rpcKaster); return Promise.resolve(rpc); } };
        },
      };
      return new Proxy(klient, { get: (t, k) => { if (k in t) return t[k]; throw new Error('Uventet bruk av databaseklienten: ' + String(k)); } });
    };
    console.log = (...a) => { logger.push(a.join(' ')); };
    const importLinje = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
    const logikkLinje = "import { MAKS_BODY_BYTES, mapFeil, mapSalg, parseForesporsel } from './logikk.ts'";
    if (!kilde.includes(importLinje) || !kilde.includes(logikkLinje)) throw new Error('portal-forhandler-salg.test.js: fant ikke importlinjene i index.ts - oppdater testen');
    const kode = kilde
      .replace(importLinje, 'const createClient = globalThis.__fakeCreateClientSalg')
      .replace(logikkLinje, `import { MAKS_BODY_BYTES, mapFeil, mapSalg, parseForesporsel } from ${JSON.stringify(pathToFileURL(path.join(FUNKSJON, 'logikk.ts')).href)}`);
    const fil = path.resolve(__dirname, `_pfs_tmp_${Math.random().toString(36).slice(2)}.ts`);
    tmpFiler.push(fil);
    writeFileSync(fil, kode);
    try {
      await import(/* @vite-ignore */ pathToFileURL(fil).href);
    } finally {
      console.log = logOrig;
    }
    const kall = async (init = {}) => {
      const logOrig2 = console.log;
      console.log = (...a) => { logger.push(a.join(' ')); };
      try {
        const { body, headers = {}, method = 'POST' } = init;
        const harBody = !['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(method) && body !== undefined;
        return await handler(new Request('https://test.supabase.invalid/functions/v1/portal-forhandler-salg', {
          method, headers: { 'content-type': 'application/json', ...headers }, body: harBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        }));
      } finally {
        console.log = logOrig2;
      }
    };
    return { kall, rpcKall, klientKall, fetchKall, logger };
  }
  const medNokkel = { 'x-salmakern-hent-secret': HEMMELIGHET };
  const GYLDIG = { versjon: 1 };

  it('andre metoder enn POST: 405, ingen database, ingen CORS', async () => {
    const { kall, rpcKall, klientKall } = await last();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const res = await kall({ method, headers: medNokkel, body: GYLDIG });
      expect(res.status, method).toBe(405);
      expect(await res.json()).toEqual({ kode: 'metode_ikke_tillatt' });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(rpcKall).toHaveLength(0);
    expect(klientKall).toHaveLength(0);
  });

  it('ingen hemmelighet i miljøet: 500, aldri åpen', async () => {
    const { kall, rpcKall } = await last({ env: { SALMAKERN_HENT_SECRET: undefined } });
    for (const headers of [medNokkel, {}, { 'x-salmakern-hent-secret': '' }]) {
      const res = await kall({ headers, body: GYLDIG });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ kode: 'ikke_konfigurert' });
    }
    expect(rpcKall).toHaveLength(0);
  });

  it('manglende eller feil header: 401, andre hemmelighets-headere åpner ingenting', async () => {
    const { kall, rpcKall } = await last();
    for (const headers of [{}, { 'x-salmakern-hent-secret': 'feil' }, { 'x-sync-secret': HEMMELIGHET }, { authorization: `Bearer ${HEMMELIGHET}` }]) {
      const res = await kall({ headers, body: GYLDIG });
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(await res.json()).toEqual({ kode: 'uautorisert' });
    }
    expect(rpcKall).toHaveLength(0);
  });

  it('ugyldig JSON-body: 400 ugyldig_input/body', async () => {
    const { kall } = await last();
    const res = await kall({ headers: medNokkel, body: '{ugyldig' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'body' });
  });

  it('for stor body (Content-Length): 413, uten å lese resten', async () => {
    const { kall } = await last();
    const res = await kall({ headers: { ...medNokkel, 'content-length': String(70000) }, body: JSON.stringify({ versjon: 1 }) });
    expect(res.status).toBe(413);
  });

  it('gyldig kall: 200, rpc kalt med riktig navn og argumenter, abortSignal satt, ok:true-svaret er korrekt avgrenset', async () => {
    const { kall, rpcKall } = await last();
    const res = await kall({ headers: medNokkel, body: { versjon: 1, forhandler_kontakt_ider: ['k_test_a'] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...SQL_SVAR });
    expect(rpcKall).toEqual([{ navn: 'portal_forhandler_salg', args: { p_forhandler_kontakt_ider: ['k_test_a'] }, signal: true }]);
  });

  it('manglende forhandler_kontakt_ider: rpc kalles med null (alle forhandlere)', async () => {
    const { kall, rpcKall } = await last();
    await kall({ headers: medNokkel, body: { versjon: 1 } });
    expect(rpcKall[0].args).toEqual({ p_forhandler_kontakt_ider: null });
  });

  it('rpc gir UGYLDIG_INPUT-feil: 400 med felt, aldri databasetekst i svaret', async () => {
    const { kall } = await last({ rpc: { data: null, error: { message: 'UGYLDIG_INPUT: forhandler_kontakt_ider (hemmelig detalj som aldri skal ut)', code: '22023' } } });
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j).toEqual({ kode: 'ugyldig_input', felt: 'forhandler_kontakt_ider' });
    expect(JSON.stringify(j)).not.toContain('hemmelig');
  });

  it('rpc gir ukjent feil: 502 intern_feil uten detaljer', async () => {
    const { kall } = await last({ rpc: { data: null, error: { message: 'noe helt annet gikk galt med en verdi i teksten' } } });
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ kode: 'intern_feil' });
  });

  it('rpc kaster (f.eks. nettverksfeil/tidsavbrudd): 502 intern_feil, fanget av try/catch', async () => {
    const { kall } = await last({ rpcKaster: new Error('tidsavbrudd') });
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ kode: 'intern_feil' });
  });

  it('databasen svarer med en uventet/korrupt form: 502 uventet_svar', async () => {
    const { kall } = await last({ rpc: { data: { versjon: 1, generert: SQL_SVAR.generert, grupper: 'ikke-en-liste' }, error: null } });
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ kode: 'intern_feil' });
  });

  it('manglende SUPABASE_URL/SERVICE_ROLE_KEY: 500 ikke_konfigurert, ingen rpc', async () => {
    const { kall, rpcKall } = await last({ env: { SUPABASE_URL: undefined } });
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(500);
    expect(rpcKall).toHaveLength(0);
  });

  it('loggen inneholder aldri forhandler-id-er eller beløp, bare faste nøkler og tall', async () => {
    const { kall, logger } = await last();
    await kall({ headers: medNokkel, body: { versjon: 1, forhandler_kontakt_ider: ['k_hemmelig_forhandler_xyz'] } });
    const samlet = logger.join('\n');
    expect(samlet).not.toContain('k_hemmelig_forhandler_xyz');
    expect(samlet).not.toContain('154500');
    expect(samlet).toContain('"utfall":"ok"');
  });

  it('fetch kalles aldri (ingen utgående nettverkskall)', async () => {
    const { kall, fetchKall } = await last();
    await kall({ headers: medNokkel, body: GYLDIG });
    expect(fetchKall).toHaveLength(0);
  });
});
