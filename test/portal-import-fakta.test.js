// Edge-funksjonen portal-import-fakta (supabase/functions/portal-import-fakta): gir Forhandlerportalen et SKRIVEBESKYTTET øyeblikksbilde av aktive bil-ordrer
// (import av aktive biler i selgernes «Mine bestillinger», etappe 1). Portalen henter; appen skriver aldri til portalen og funksjonen skriver aldri noe.
//  1) logikk.ts (ren validering/avgrensning) lastes direkte (V1-V3).
//  2) index.ts kjøres mot falsk Deno og en falsk supabase-klient som BARE har rpc (alt annet kaster): kildefilen kopieres til en midlertidig .ts-modul med
//     jsr:-importen byttet ut (samme teknikk som portal-bestilling.test.js), så HELE håndtereren testes: hemmelighet, grenser, svaravgrensning, feil, logging (V4-V7).
// Postgres-funksjonen bak (portal_import_fakta) har sin egen test: supabase/tester/portal_import_fakta_TEST_body.sql (kjøres i en transaksjon som rulles tilbake).
// Alle verdier her er SYNTETISKE (TEST ..., TESTWXYZ..., k_test_a): ingen ekte navn, e-poster, org.nr eller chassis.nr.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseForesporsel, mapFakta, mapFeil, VERSJON, MAKS_BODY_BYTES, IDER_MAKS, AKTIVE_MAKS, ID_FORM } from '../supabase/functions/portal-import-fakta/logikk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJON = path.resolve(__dirname, '../supabase/functions/portal-import-fakta');
const kilde = readFileSync(path.join(FUNKSJON, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const logikkKilde = readFileSync(path.join(FUNKSJON, 'logikk.ts'), 'utf8').replace(/\r\n/g, '\n');
// Gullfila: HELE kontraktssvaret (versjon 1), byte-lik portalens kopi (tests/fixtures/portal-import-fakta-svar.json i portal-testmappen).
const GULL = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/portal-import-fakta-svar.json'), 'utf8'));
// Det Postgres-funksjonen returnerer: gullfila uten `ok` (den settes av edge-funksjonen).
const { ok: _ok, ...SQL_SVAR } = GULL;
const kopi = (x) => JSON.parse(JSON.stringify(x));

const FELT = ['ordre_id', 'ordretype', 'kunde', 'chassis', 'eier', 'merke', 'modell', 'ordre_status', 'status', 'opprettet', 'kontakt_treff', 'kontakt_id', 'kontakt_navn', 'kontakt_orgnr', 'portal_bestilling_ider'];

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// V1 parseForesporsel
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('parseForesporsel (V1)', () => {
  it('konstantene er kontraktens (versjon 1, 500 id-er, 500 aktive, 65 536 byte, id-mønster)', () => {
    expect(VERSJON).toBe(1);
    expect(IDER_MAKS).toBe(500);
    expect(AKTIVE_MAKS).toBe(500);
    expect(MAKS_BODY_BYTES).toBe(65536);
    expect(ID_FORM.source).toBe('^[A-Za-z0-9_.-]{1,64}$');
  });

  it('gyldig forespørsel med ider: bare ider videre; versjon og ukjente felt kastes', () => {
    const r = parseForesporsel({ versjon: 1, ider: ['ord_1790000000001', 'ord_1790000000002'], ekstra: 'x', __proto__x: 1 });
    expect(r).toEqual({ ok: true, foresporsel: { ider: ['ord_1790000000001', 'ord_1790000000002'] } });
    expect(Object.keys(r.foresporsel)).toEqual(['ider']);
  });

  it('ider mangler eller er null: tom liste', () => {
    expect(parseForesporsel({ versjon: 1 })).toEqual({ ok: true, foresporsel: { ider: [] } });
    expect(parseForesporsel({ versjon: 1, ider: null })).toEqual({ ok: true, foresporsel: { ider: [] } });
    expect(parseForesporsel({ versjon: 1, ider: [] })).toEqual({ ok: true, foresporsel: { ider: [] } });
  });

  it('dubletter fjernes og rekkefølgen til første forekomst bevares', () => {
    expect(parseForesporsel({ versjon: 1, ider: ['b', 'a', 'b', 'c', 'a'] }).foresporsel.ider).toEqual(['b', 'a', 'c']);
  });

  it('en «__proto__»-nøkkel fra JSON.parse forurenser ingenting og videresendes ikke', () => {
    const r = parseForesporsel(JSON.parse('{"versjon":1,"ider":["a"],"__proto__":{"ider":["x"]},"constructor":"x"}'));
    expect(r).toEqual({ ok: true, foresporsel: { ider: ['a'] } });
    expect({}.ider).toBeUndefined();
  });

  it('versjon er PÅKREVD og må være tallet 1: mangler, 0, 2, «1», null, 1.5, true og liste gir felt «versjon»', () => {
    for (const versjon of [undefined, 0, 2, '1', null, 1.5, true, [1], { v: 1 }]) {
      const raa = versjon === undefined ? { ider: [] } : { versjon, ider: [] };
      expect(parseForesporsel(raa), JSON.stringify(versjon)).toEqual({ ok: false, felt: 'versjon' });
    }
  });

  it('ider som ikke er en liste gir felt «ider»', () => {
    for (const ider of ['abc', {}, 5, true, { 0: 'a', length: 1 }]) {
      expect(parseForesporsel({ versjon: 1, ider }), JSON.stringify(ider)).toEqual({ ok: false, felt: 'ider' });
    }
  });

  it('taket: nøyaktig 500 id-er er greit, 501 avvises (også når de er dubletter: taket gjelder det som sendes)', () => {
    const mange = (n) => Array.from({ length: n }, (_, i) => `ord_${i}`);
    expect(parseForesporsel({ versjon: 1, ider: mange(500) }).ok).toBe(true);
    expect(parseForesporsel({ versjon: 1, ider: mange(501) })).toEqual({ ok: false, felt: 'ider' });
    expect(parseForesporsel({ versjon: 1, ider: Array.from({ length: 501 }, () => 'a') })).toEqual({ ok: false, felt: 'ider' });
  });

  it('elementer som ikke er tekst eller bryter id-mønsteret avvises (hele kallet)', () => {
    for (const ugyldig of [1, null, undefined, {}, ['a'], true, '', 'a b', 'a;b', 'a/b', 'a\nb', 'a b ', 'ordreæ', "a'b", 'a:b', 'a'.repeat(65)]) {
      expect(parseForesporsel({ versjon: 1, ider: ['ord_ok', ugyldig] }), JSON.stringify(ugyldig)).toEqual({ ok: false, felt: 'ider' });
    }
    // Nøyaktig 64 tegn, og tegnene . - _ , er greit.
    expect(parseForesporsel({ versjon: 1, ider: ['a'.repeat(64), 'A.b-c_D1'] }).ok).toBe(true);
  });

  it('en kropp som ikke er et objekt (liste, null, tekst, tall) gir felt «body»', () => {
    for (const raa of [[], [{ versjon: 1 }], null, undefined, 'tekst', 1, true]) {
      expect(parseForesporsel(raa), JSON.stringify(raa)).toEqual({ ok: false, felt: 'body' });
    }
  });

  it('versjonsfeil meldes før ider-feil', () => {
    expect(parseForesporsel({ versjon: 2, ider: 'ugyldig' })).toEqual({ ok: false, felt: 'versjon' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// V2 mapFakta
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('mapFakta (V2)', () => {
  it('gullfila gir nøyaktig samme innhold (og ok settes av funksjonen, ikke av databasen)', () => {
    const r = mapFakta(kopi(SQL_SVAR));
    expect(r).toEqual(GULL);
    expect(Object.keys(r)).toEqual(['ok', 'versjon', 'generert', 'aktive', 'utvalgte']);
    expect(r.ok).toBe(true);
    for (const rad of r.aktive) expect(Object.keys(rad)).toEqual(FELT);
  });

  it('en ok-nøkkel fra databasen er uten betydning (ok er alltid true)', () => {
    expect(mapFakta({ ...kopi(SQL_SVAR), ok: false }).ok).toBe(true);
  });

  it('gullfila har de 15 feltene i hver rad (kontrollerer testens egen forutsetning)', () => {
    for (const rad of GULL.aktive) expect(Object.keys(rad)).toEqual(FELT);
    const funnet = GULL.utvalgte.find((u) => u.finnes);
    expect(Object.keys(funnet).sort()).toEqual([...FELT, 'finnes'].sort());
  });

  it('ekstra felt kastes (toppnivå, aktive-rad, utvalgt rad), også uten å røre inndata', () => {
    const inn = kopi(SQL_SVAR);
    inn.hemmelig = 'x';
    inn.aktive[0].passord = 'y';
    inn.utvalgte[1].intern = { a: 1 };
    const fasit = kopi(inn);
    const r = mapFakta(inn);
    expect(r).toEqual(GULL);
    expect(JSON.stringify(r)).not.toMatch(/hemmelig|passord|intern/);
    expect(inn).toEqual(fasit);
    // Resultatet deler ingen lister med inndata.
    expect(r.aktive[1].portal_bestilling_ider).not.toBe(inn.aktive[1].portal_bestilling_ider);
  });

  it('hvert av de 15 feltene må være til stede (aktive og utvalgte), ellers null', () => {
    for (const felt of FELT) {
      const a = kopi(SQL_SVAR);
      delete a.aktive[0][felt];
      expect(mapFakta(a), `aktive mangler ${felt}`).toBeNull();
      const u = kopi(SQL_SVAR);
      delete u.utvalgte[1][felt];
      expect(mapFakta(u), `utvalgte mangler ${felt}`).toBeNull();
    }
  });

  it('feil type på et felt gir null', () => {
    const feil = {
      ordre_id: [5, '', null], ordretype: [5, null], kunde: [5, null, {}], chassis: [5, null], eier: [5, null], merke: [5, null], modell: [5, null],
      ordre_status: [5, null], status: ['ukjent', 'AKTIV', null, 1, ''], opprettet: [5, '2026-11-03', '2026-11-03T08:15:30Z', '2026-02-30T08:15:30.123Z', '2026-11-03 08:15:30.123Z', {}],
      kontakt_treff: ['1', 1.5, -1, null, NaN, true], kontakt_id: [5, {}, true], kontakt_navn: [5, {}], kontakt_orgnr: [5, {}], portal_bestilling_ider: ['x', null, [1], [null], {}],
    };
    for (const [felt, verdier] of Object.entries(feil)) {
      for (const v of verdier) {
        const inn = kopi(SQL_SVAR);
        inn.aktive[0][felt] = v;
        expect(mapFakta(inn), `${felt} = ${JSON.stringify(v)}`).toBeNull();
      }
    }
  });

  it('en rad i aktive må være en aktiv bil (databasefunksjonen garanterer det: brudd er en feil i den, ikke i dataene)', () => {
    for (const [felt, verdi] of [['status', 'arkivert'], ['ordretype', 'leveranse']]) {
      const inn = kopi(SQL_SVAR);
      inn.aktive[0][felt] = verdi;
      expect(mapFakta(inn), `${felt} = ${verdi}`).toBeNull();
    }
    // En utvalgt rad kan derimot være arkivert eller en leveranse (portalen skjuler da med ORDRETYPE_ENDRET/ARKIVERT).
    const u = kopi(SQL_SVAR);
    u.utvalgte[1].status = 'arkivert';
    u.utvalgte[1].ordretype = 'leveranse';
    const r = mapFakta(u);
    expect(r.utvalgte[1]).toMatchObject({ finnes: true, status: 'arkivert', ordretype: 'leveranse' });
  });

  it('ukjente statuser og ordre_status-verdier: status må være aktiv/arkivert, ordre_status er fri tekst', () => {
    const inn = kopi(SQL_SVAR);
    inn.aktive[0].ordre_status = 'noe_nytt_fra_appen';
    expect(mapFakta(inn).aktive[0].ordre_status).toBe('noe_nytt_fra_appen');
  });

  it('finnes:false har BARE nøklene ordre_id og finnes: ekstra felt avvises (ikke bare kastes)', () => {
    const inn = kopi(SQL_SVAR);
    expect(inn.utvalgte[0]).toEqual({ ordre_id: 'ord_1789999999999', finnes: false });
    inn.utvalgte[0].kunde = 'TEST Forhandler A';
    expect(mapFakta(inn)).toBeNull();
    const inn2 = kopi(SQL_SVAR);
    inn2.utvalgte[0].ekstra = null;
    expect(mapFakta(inn2)).toBeNull();
  });

  it('finnes må være en ekte boolean (mangler, «true», 1 og null gir null)', () => {
    for (const finnes of [undefined, 'true', 1, null, 0, 'false']) {
      const inn = kopi(SQL_SVAR);
      if (finnes === undefined) delete inn.utvalgte[1].finnes; else inn.utvalgte[1].finnes = finnes;
      expect(mapFakta(inn), String(finnes)).toBeNull();
    }
    const inn = kopi(SQL_SVAR);
    inn.utvalgte[0].ordre_id = '';
    expect(mapFakta(inn)).toBeNull();
  });

  it('toppnivået: ukjent versjon, manglende/ugyldig generert, ikke-lister og for mange aktive gir null', () => {
    const med = (endr) => { const x = kopi(SQL_SVAR); endr(x); return x; };
    expect(mapFakta(med((x) => { x.versjon = 2; }))).toBeNull();
    expect(mapFakta(med((x) => { delete x.versjon; }))).toBeNull();
    expect(mapFakta(med((x) => { x.versjon = '1'; }))).toBeNull();
    expect(mapFakta(med((x) => { delete x.generert; }))).toBeNull();
    expect(mapFakta(med((x) => { x.generert = '2026-11-10 04:00:00'; }))).toBeNull();
    expect(mapFakta(med((x) => { x.generert = 5; }))).toBeNull();
    expect(mapFakta(med((x) => { x.aktive = {}; }))).toBeNull();
    expect(mapFakta(med((x) => { delete x.aktive; }))).toBeNull();
    expect(mapFakta(med((x) => { x.utvalgte = null; }))).toBeNull();
    expect(mapFakta(med((x) => { delete x.utvalgte; }))).toBeNull();
    // Nøyaktig 500 aktive er greit, 501 gir null (databasefunksjonen kaster FOR_MANGE_AKTIVE før dette).
    const rad = (i) => ({ ...kopi(SQL_SVAR.aktive[0]), ordre_id: `ord_${i}` });
    expect(mapFakta(med((x) => { x.aktive = Array.from({ length: 500 }, (_, i) => rad(i)); })).aktive).toHaveLength(500);
    expect(mapFakta(med((x) => { x.aktive = Array.from({ length: 501 }, (_, i) => rad(i)); }))).toBeNull();
  });

  it('noe som ikke er et objekt gir null (null, liste, tekst, tall, undefined)', () => {
    for (const x of [null, undefined, [], [SQL_SVAR], 'tekst', 5, true]) expect(mapFakta(x), JSON.stringify(x)).toBeNull();
  });

  it('tomme lister er gyldige (ingen aktive biler, ingen ønskede id-er)', () => {
    const r = mapFakta({ versjon: 1, generert: '2026-11-10T04:00:00.123Z', aktive: [], utvalgte: [] });
    expect(r).toEqual({ ok: true, versjon: 1, generert: '2026-11-10T04:00:00.123Z', aktive: [], utvalgte: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// V3 mapFeil
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('mapFeil (V3)', () => {
  it('«UGYLDIG_INPUT: ider» gir 400 med felt «ider»', () => {
    expect(mapFeil({ message: 'UGYLDIG_INPUT: ider', code: 'P0001' })).toEqual({ status: 400, kode: 'ugyldig_input', felt: 'ider' });
  });

  it('«FOR_MANGE_AKTIVE» gir 422 uten felt', () => {
    expect(mapFeil({ message: 'FOR_MANGE_AKTIVE', code: 'P0001' })).toEqual({ status: 422, kode: 'for_mange_aktive' });
  });

  it('alt annet, også tekst som bare ligner, gir 502 intern_feil uten felt', () => {
    const andre = [
      'xUGYLDIG_INPUT: ider', ' UGYLDIG_INPUT: ider', 'ugyldig_input: ider', 'UGYLDIG_INPUTX', 'Feil: UGYLDIG_INPUT: ider', 'noe med UGYLDIG_INPUT',
      'FOR_MANGE_AKTIVE_OG_MER', 'FOR_MANGE', 'Feil: FOR_MANGE_AKTIVE', 'for_mange_aktive', 'password authentication failed for user "postgres" at db.internal:5432',
      'canceling statement due to statement timeout', 'function public.portal_import_fakta(text[]) does not exist', '',
    ];
    for (const message of andre) expect(mapFeil({ message }), message).toEqual({ status: 502, kode: 'intern_feil' });
    for (const feil of [null, undefined, 'UGYLDIG_INPUT: ider', 42, {}, { message: 5 }, [], { melding: 'UGYLDIG_INPUT: ider' }]) {
      expect(mapFeil(feil), JSON.stringify(feil)).toEqual({ status: 502, kode: 'intern_feil' });
    }
  });

  it('meldingen fra databasen er aldri en del av resultatet', () => {
    const r = mapFeil({ message: 'UGYLDIG_INPUT: ider hemmelig-verdi-123' });
    expect(JSON.stringify(r)).not.toContain('hemmelig-verdi-123');
    expect(JSON.stringify(mapFeil({ message: 'FOR_MANGE_AKTIVE hemmelig-verdi-123' }))).not.toContain('hemmelig-verdi-123');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// index.ts: håndtereren kjørt mot falsk Deno og falsk databaseklient
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('index.ts: oppførsel (håndtereren kjørt mot falsk Deno og en falsk klient som bare har rpc)', () => {
  const HEMMELIGHET = 'test-hent-hemmelighet-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const TJENESTE_NOKKEL = 'tjeneste-nokkel-test-bbbbbbbbbbbbbbbbbbbbbbbb';
  const tmpFiler = [];
  const fetchOrig = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = fetchOrig;
    while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } }
  });

  // Laster index.ts med gitt miljø og et svar fra «databasen». Gir { kall: (init) => Response, rpcKall, klientKall, fetchKall, logger }.
  async function last({ env = {}, rpc = { data: kopi(SQL_SVAR), error: null }, rpcKaster = null } = {}) {
    const fullEnv = { SALMAKERN_HENT_SECRET: HEMMELIGHET, SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: TJENESTE_NOKKEL, ...env };
    const rpcKall = [];
    const klientKall = [];
    const fetchKall = [];
    const logger = [];
    const logOrig = console.log;
    let handler = null;
    globalThis.Deno = { env: { get: (k) => fullEnv[k] }, serve: (h) => { handler = h; } };
    // Funksjonen skal ALDRI gjøre utgående nettverkskall: et kall til fetch registreres og kaster.
    globalThis.fetch = (...a) => { fetchKall.push(a); throw new Error('fetch skal aldri kalles i portal-import-fakta'); };
    globalThis.__fakeCreateClient = (url, nokkel, opts) => {
      klientKall.push({ url, nokkel, opts });
      const klient = {
        rpc: (navn, args) => {
          rpcKall.push({ navn, args });
          return { abortSignal: (signal) => { rpcKall[rpcKall.length - 1].signal = !!signal; if (rpcKaster) return Promise.reject(rpcKaster); return Promise.resolve(rpc); } };
        },
      };
      // «Bare svarer»: alt annet enn rpc (from, auth, functions, storage ...) kaster.
      return new Proxy(klient, { get: (t, k) => { if (k in t) return t[k]; throw new Error('Uventet bruk av databaseklienten: ' + String(k)); } });
    };
    console.log = (...a) => { logger.push(a.join(' ')); };
    const importLinje = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
    const logikkLinje = "import { MAKS_BODY_BYTES, mapFakta, mapFeil, parseForesporsel } from './logikk.ts'";
    if (!kilde.includes(importLinje) || !kilde.includes(logikkLinje)) throw new Error('portal-import-fakta.test.js: fant ikke importlinjene i index.ts - oppdater testen');
    const kode = kilde
      .replace(importLinje, 'const createClient = globalThis.__fakeCreateClient')
      .replace(logikkLinje, `import { MAKS_BODY_BYTES, mapFakta, mapFeil, parseForesporsel } from ${JSON.stringify(pathToFileURL(path.join(FUNKSJON, 'logikk.ts')).href)}`);
    const fil = path.resolve(__dirname, `_pif_tmp_${Math.random().toString(36).slice(2)}.ts`);
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
        return await handler(new Request('https://test.supabase.invalid/functions/v1/portal-import-fakta', {
          method, headers: { 'content-type': 'application/json', ...headers }, body: harBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        }));
      } finally {
        console.log = logOrig2;
      }
    };
    return { kall, rpcKall, klientKall, fetchKall, logger };
  }
  const medNokkel = { 'x-salmakern-hent-secret': HEMMELIGHET };
  const GYLDIG = { versjon: 1, ider: ['ord_1790000000001', 'ord_1789999999999'] };

  // ---------------------------------------------------------------- V4: metode, hemmelighet, grenser, validering
  it('andre metoder enn POST: 405 {kode:metode_ikke_tillatt} uten database, også med riktig hemmelighet (ingen OPTIONS/CORS)', async () => {
    const { kall, rpcKall, klientKall } = await last();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      for (const headers of [medNokkel, {}]) {
        const res = await kall({ method, headers, body: GYLDIG });
        expect(res.status, method).toBe(405);
        expect(await res.json()).toEqual({ kode: 'metode_ikke_tillatt' });
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      }
    }
    expect(rpcKall).toHaveLength(0);
    expect(klientKall).toHaveLength(0);
  });

  it('ingen hemmelighet i miljøet: 500 (aldri åpen), også med en header som ser riktig ut', async () => {
    const { kall, rpcKall, klientKall } = await last({ env: { SALMAKERN_HENT_SECRET: undefined } });
    for (const headers of [medNokkel, { 'x-salmakern-hent-secret': '' }, {}, { 'x-salmakern-hent-secret': 'undefined' }]) {
      const res = await kall({ headers, body: GYLDIG });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ kode: 'ikke_konfigurert' });
    }
    expect(rpcKall).toHaveLength(0);
    expect(klientKall).toHaveLength(0);
  });

  it('for kort hemmelighet (under 32 tegn, etter trim) i miljøet: 500, også når headeren er lik den', async () => {
    for (const hemmelig of ['x'.repeat(31), '   ' + 'x'.repeat(31) + '\n', '   ', '']) {
      const { kall, rpcKall } = await last({ env: { SALMAKERN_HENT_SECRET: hemmelig } });
      const res = await kall({ headers: { 'x-salmakern-hent-secret': hemmelig.trim() || 'x' }, body: GYLDIG });
      expect(res.status, JSON.stringify(hemmelig)).toBe(500);
      expect(await res.json()).toEqual({ kode: 'ikke_konfigurert' });
      expect(rpcKall).toHaveLength(0);
    }
    // Nøyaktig 32 tegn er greit.
    const t = await last({ env: { SALMAKERN_HENT_SECRET: 'x'.repeat(32) } });
    const res = await t.kall({ headers: { 'x-salmakern-hent-secret': 'x'.repeat(32) }, body: GYLDIG });
    expect(res.status).toBe(200);
  });

  it('manglende eller feil header: 401 {kode:uautorisert}; andre hemmelighets-headere åpner ingenting, heller ikke med riktig verdi', async () => {
    const { kall, rpcKall, klientKall } = await last();
    const forsok = [
      {},
      { 'x-salmakern-hent-secret': '' },
      { 'x-salmakern-hent-secret': 'feil' },
      { 'x-salmakern-hent-secret': HEMMELIGHET.slice(0, -1) },
      { 'x-salmakern-hent-secret': HEMMELIGHET + 'x' },
      { 'x-salmakern-hent-secret': HEMMELIGHET.replace(/a/g, 'b') },
      { 'x-sync-secret': HEMMELIGHET },
      { 'x-salmakern-status-secret': HEMMELIGHET },
      { 'x-server-secret': HEMMELIGHET },
      { authorization: `Bearer ${HEMMELIGHET}`, apikey: HEMMELIGHET },
    ];
    for (const headers of forsok) {
      const res = await kall({ headers, body: GYLDIG });
      expect(res.status, JSON.stringify(Object.keys(headers))).toBe(401);
      expect(await res.json()).toEqual({ kode: 'uautorisert' });
    }
    expect(rpcKall).toHaveLength(0);
    expect(klientKall).toHaveLength(0);
  });

  it('hemmeligheten sjekkes FØR body leses: ugyldig JSON og for stor body gir 401 uten riktig hemmelighet', async () => {
    const { kall, rpcKall } = await last();
    let res = await kall({ headers: {}, body: '{ikke json' });
    expect(res.status).toBe(401);
    res = await kall({ headers: { 'x-salmakern-hent-secret': 'feil', 'content-length': '999999' }, body: GYLDIG });
    expect(res.status).toBe(401);
    expect(rpcKall).toHaveLength(0);
  });

  it('en hemmelighet med etterfølgende linjeskift i miljøet og mellomrom rundt i headeren gir likevel 200 (trim)', async () => {
    const { kall, rpcKall } = await last({ env: { SALMAKERN_HENT_SECRET: HEMMELIGHET + '\n' } });
    for (const verdi of [HEMMELIGHET, `  ${HEMMELIGHET}  `, `${HEMMELIGHET}\t`]) {
      const res = await kall({ headers: { 'x-salmakern-hent-secret': verdi }, body: GYLDIG });
      expect(res.status, JSON.stringify(verdi)).toBe(200);
    }
    expect(rpcKall).toHaveLength(3);
    // Også innlimt med mellomrom først i miljøet.
    const t = await last({ env: { SALMAKERN_HENT_SECRET: '  ' + HEMMELIGHET + '  ' } });
    expect((await t.kall({ headers: medNokkel, body: GYLDIG })).status).toBe(200);
  });

  it('manglende databasenøkkel eller -adresse i miljøet: 500 ikke_konfigurert (etter hemmeligheten og valideringen)', async () => {
    for (const env of [{ SUPABASE_SERVICE_ROLE_KEY: undefined }, { SUPABASE_URL: undefined }, { SUPABASE_URL: '' }]) {
      const { kall, rpcKall, klientKall } = await last({ env });
      const res = await kall({ headers: medNokkel, body: GYLDIG });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ kode: 'ikke_konfigurert' });
      expect(rpcKall).toHaveLength(0);
      expect(klientKall).toHaveLength(0);
    }
  });

  it('størrelsesgrensen: nøyaktig 65 536 byte slippes gjennom, 65 537 gir 413; grensen teller byte (ikke tegn) og content-length alene kan utløse den', async () => {
    const { kall, rpcKall, logger } = await last();
    const grunn = JSON.stringify(GYLDIG);
    const polstret = (n) => grunn + ' '.repeat(n - new TextEncoder().encode(grunn).length);
    // a) nøyaktig på grensen: gyldig JSON med mellomrom på slutten, ikke 413
    let res = await kall({ headers: medNokkel, body: polstret(65536) });
    expect(res.status).toBe(200);
    // b) én byte over: 413 uten database
    const rpcFoer = rpcKall.length;
    res = await kall({ headers: medNokkel, body: polstret(65537) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'body' });
    // c) 40000 × «æ» er 40000 tegn men 80000 byte: bytetellingen må ta den
    res = await kall({ headers: medNokkel, body: JSON.stringify({ versjon: 1, ider: [], notat: 'æ'.repeat(40000) }) });
    expect(res.status).toBe(413);
    // d) liten body men content-length 70000: content-length-grenen alene (leser aldri body) og eget loggutfall
    res = await kall({ headers: { ...medNokkel, 'content-length': '70000' }, body: GYLDIG });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'body' });
    expect(rpcKall.length).toBe(rpcFoer);
    expect(logger.map((l) => JSON.parse(l).utfall).slice(-3)).toEqual(['for_stor', 'for_stor', 'for_stor']);
  });

  it('ugyldig JSON eller felt: 400 uten database (versjon, ider, body)', async () => {
    const { kall, rpcKall } = await last();
    const tilfeller = [
      ['{ikke json', 'body'],
      ['', 'body'],
      [[GYLDIG], 'body'],
      [null, 'body'],
      [{ ider: ['a'] }, 'versjon'],
      [{ versjon: 2, ider: ['a'] }, 'versjon'],
      [{ versjon: '1', ider: [] }, 'versjon'],
      [{ versjon: null, ider: [] }, 'versjon'],
      [{ versjon: 1, ider: 'ord_1' }, 'ider'],
      [{ versjon: 1, ider: ['ord 1'] }, 'ider'],
      [{ versjon: 1, ider: ['a'.repeat(65)] }, 'ider'],
      [{ versjon: 1, ider: [1] }, 'ider'],
      [{ versjon: 1, ider: Array.from({ length: 501 }, (_, i) => `ord_${i}`) }, 'ider'],
    ];
    for (const [body, felt] of tilfeller) {
      const res = await kall({ headers: medNokkel, body });
      expect(res.status, JSON.stringify(body)?.slice(0, 40)).toBe(400);
      expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt });
    }
    expect(rpcKall).toHaveLength(0);
  });

  it('nøyaktig 500 id-er slippes gjennom til databasen', async () => {
    const { kall, rpcKall } = await last();
    const ider = Array.from({ length: 500 }, (_, i) => `ord_${i}`);
    const res = await kall({ headers: medNokkel, body: { versjon: 1, ider } });
    expect(res.status).toBe(200);
    expect(rpcKall[0].args.p_ider).toHaveLength(500);
  });

  // ---------------------------------------------------------------- V5: suksess, feil, uventet form, logging
  it('suksess: nøyaktig ÉN rpc «portal_import_fakta» med bare {p_ider}, service_role-nøkkelen fra miljøet, tidsavbrudd og ingen sesjon', async () => {
    const { kall, rpcKall, klientKall } = await last();
    const res = await kall({ headers: medNokkel, body: { ...GYLDIG, ekstra: 'kastes', versjon: 1 } });
    expect(res.status).toBe(200);
    expect(rpcKall).toHaveLength(1);
    expect(rpcKall[0].navn).toBe('portal_import_fakta');
    expect(rpcKall[0].args).toEqual({ p_ider: ['ord_1790000000001', 'ord_1789999999999'] });
    expect(Object.keys(rpcKall[0].args)).toEqual(['p_ider']);
    expect(rpcKall[0].signal).toBe(true);
    expect(klientKall).toHaveLength(1);
    expect(klientKall[0].url).toBe('https://test.supabase.invalid');
    expect(klientKall[0].nokkel).toBe(TJENESTE_NOKKEL);
    expect(klientKall[0].opts).toEqual({ auth: { persistSession: false, autoRefreshToken: false } });
  });

  it('dubletter i ider fjernes før databasen; mangler ider sendes en tom liste', async () => {
    const { kall, rpcKall } = await last();
    await kall({ headers: medNokkel, body: { versjon: 1, ider: ['b', 'a', 'b'] } });
    await kall({ headers: medNokkel, body: { versjon: 1 } });
    await kall({ headers: medNokkel, body: { versjon: 1, ider: null } });
    expect(rpcKall.map((k) => k.args)).toEqual([{ p_ider: ['b', 'a'] }, { p_ider: [] }, { p_ider: [] }]);
  });

  it('svaret er kontraktens fakta (ok, versjon, generert, aktive, utvalgte), JSON, uten cache og uten CORS', async () => {
    const { kall } = await last();
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const body = await res.json();
    expect(body).toEqual(GULL);
    expect(Object.keys(body)).toEqual(['ok', 'versjon', 'generert', 'aktive', 'utvalgte']);
  });

  it('ekstra felt fra databasen sendes aldri videre til portalen', async () => {
    const data = kopi(SQL_SVAR);
    data.intern_debug = 'topp-hemmelig';
    data.aktive[0].personnummer = '01010112345';
    data.utvalgte[1].passord = 'hunter2';
    const { kall } = await last({ rpc: { data, error: null } });
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(200);
    const tekst = await res.text();
    expect(tekst).not.toMatch(/topp-hemmelig|01010112345|hunter2|intern_debug|personnummer|passord/);
    expect(JSON.parse(tekst)).toEqual(GULL);
  });

  it('UGYLDIG_INPUT fra databasen: 400 med felt ider; FOR_MANGE_AKTIVE: 422; alle andre databasefeil: 502, og feilteksten finnes ikke i svaret', async () => {
    let t = await last({ rpc: { data: null, error: { message: 'UGYLDIG_INPUT: ider', code: 'P0001' } } });
    let res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'ider' });

    t = await last({ rpc: { data: null, error: { message: 'FOR_MANGE_AKTIVE', code: 'P0001' } } });
    res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ kode: 'for_mange_aktive' });

    const hemmelig = 'password authentication failed for user "postgres" at db.internal:5432 ord_1790000000001 TESTWXYZ000000001';
    t = await last({ rpc: { data: null, error: { message: hemmelig, details: 'detaljer-om-TEST-Forhandler-A', hint: 'hint-123', code: '28P01' } } });
    res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    const tekst = await res.text();
    expect(JSON.parse(tekst)).toEqual({ kode: 'intern_feil' });
    for (const bit of ['password', 'postgres', 'db.internal', 'ord_1790000000001', 'TESTWXYZ000000001', 'detaljer', 'hint-123']) {
      expect(tekst).not.toContain(bit);
      expect(t.logger.join('\n')).not.toContain(bit);
    }
  });

  it('et tidsavbrudd eller kast fra rpc: 502 intern_feil uten teksten fra feilen', async () => {
    const t = await last({ rpcKaster: new DOMException('Noe kastet https://test.supabase.invalid/rest/v1/rpc/portal_import_fakta', 'TimeoutError') });
    const res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    const tekst = await res.text();
    expect(JSON.parse(tekst)).toEqual({ kode: 'intern_feil' });
    expect(tekst).not.toContain('supabase.invalid');
    expect(t.logger.join('\n')).not.toContain('supabase.invalid');
  });

  it('uventet svarform fra databasen (null, tomt objekt, ukjent versjon, rad med manglende felt, feil type): 502 intern_feil', async () => {
    const feilRad = kopi(SQL_SVAR); delete feilRad.aktive[0].kunde;
    const feilVersjon = { ...kopi(SQL_SVAR), versjon: 2 };
    const feilType = kopi(SQL_SVAR); feilType.aktive[0].kontakt_treff = '1';
    const arkivertIAktive = kopi(SQL_SVAR); arkivertIAktive.aktive[0].status = 'arkivert';
    for (const data of [null, {}, [], 'tekst', feilVersjon, feilRad, feilType, arkivertIAktive, { ...kopi(SQL_SVAR), aktive: 'x' }]) {
      const t = await last({ rpc: { data, error: null } });
      const res = await t.kall({ headers: medNokkel, body: GYLDIG });
      expect(res.status, JSON.stringify(data)?.slice(0, 50)).toBe(502);
      expect(await res.json()).toEqual({ kode: 'intern_feil' });
    }
  });

  it('logglinjene er JSON uten verdier: ingen id-er, navn, chassis, org.nr, selger eller hemmeligheter (testen søker etter de syntetiske verdiene)', async () => {
    const t = await last();
    await t.kall({ headers: medNokkel, body: GYLDIG });                                        // ok
    await t.kall({ headers: { 'x-salmakern-hent-secret': 'feil-hemmelighet' }, body: GYLDIG }); // uautorisert
    await t.kall({ method: 'GET' });                                                           // metode
    await t.kall({ headers: medNokkel, body: { versjon: 3, ider: ['ord_1790000000001'] } });   // ugyldig_input
    await t.kall({ headers: medNokkel, body: '{ikke json ord_1790000000001' });                // ugyldig_json
    const feilt = await last({ rpc: { data: null, error: { message: 'FOR_MANGE_AKTIVE TEST Forhandler A', code: 'P0001' } } });
    await feilt.kall({ headers: medNokkel, body: GYLDIG });                                    // for_mange_aktive
    const ukjent = await last({ rpc: { data: { ...kopi(SQL_SVAR), versjon: 2 }, error: null } });
    await ukjent.kall({ headers: medNokkel, body: GYLDIG });                                   // uventet_svar
    const alle = [...t.logger, ...feilt.logger, ...ukjent.logger];
    expect(t.logger).toHaveLength(5);
    const objekter = alle.map((l) => JSON.parse(l));
    for (const o of objekter) {
      expect(o.portal_import_fakta).toBe(1);
      expect(o.fn).toBe('portal-import-fakta');
      expect(typeof o.utfall).toBe('string');
      expect(typeof o.ms).toBe('number');
    }
    expect(objekter.map((o) => o.utfall)).toEqual(['ok', 'uautorisert', 'metode', 'ugyldig_input', 'ugyldig_json', 'for_mange_aktive', 'uventet_svar']);
    // Suksesslinjen har tall: http, antall_aktive, antall_utvalgte, antall_ider.
    expect(objekter[0]).toMatchObject({ utfall: 'ok', http: 200, antall_aktive: 2, antall_utvalgte: 2, antall_ider: 2 });
    const tekst = alle.join('\n');
    for (const verdi of [
      'ord_1790000000001', 'ord_1790000000002', 'ord_1789999999999', 'TESTWXYZ000000001', 'TESTWXYZ000000002', 'TEST Forhandler A', 'Ukjent Firma', 'Test Selger',
      'k_test_a', '123456789', 'cm9testbestilling0001', 'Kia', 'EV9', HEMMELIGHET, TJENESTE_NOKKEL, 'feil-hemmelighet', 'test.supabase.invalid',
    ]) expect(tekst, verdi).not.toContain(verdi);
  });

  // ---------------------------------------------------------------- V6: bare svarer
  it('kildeteksten til index.ts har INGEN skrivende kall, ingen utgående nettverkskall og ingen push/e-post', () => {
    for (const forbudt of ['.from(', '.insert(', '.update(', '.delete(', '.upsert(', 'fetch(', 'send-push', 'web-push', 'resend', 'SALMAKERN_STATUS_SECRET']) {
      expect(kilde.toLowerCase().includes(forbudt.toLowerCase()), `index.ts inneholder «${forbudt}»`).toBe(false);
    }
    // Andre hemmeligheter enn den ene (valg 9) finnes ikke i filen.
    for (const hemmelighet of ['x-sync-secret', 'x-salmakern-status-secret', 'PORTAL_BESTILLING_SECRET', 'FIKEN_SYNC_SECRET', 'HENT_SELGERE_SERVER_SECRET', 'x-server-secret']) {
      expect(kilde.includes(hemmelighet), `index.ts nevner «${hemmelighet}»`).toBe(false);
    }
    // Det eneste databasekallet er rpc('portal_import_fakta'), og bare ett.
    expect([...kilde.matchAll(/\.rpc\(/g)]).toHaveLength(1);
    expect(kilde).toContain(".rpc('portal_import_fakta', { p_ider: ider })");
    // Bare to importer: databaseklienten og den rene logikken (ingen søsken-funksjoner, ingen push.ts).
    const importer = [...kilde.matchAll(/^import .* from '([^']+)'$/gm)].map((m) => m[1]);
    expect(importer).toEqual(['jsr:@supabase/supabase-js@2', './logikk.ts']);
    expect(kilde).not.toMatch(/import\(/);
    // logikk.ts er ren: ingen importer, ingen Deno-API-er, ingen nettverk.
    const logikkUtenKommentarer = logikkKilde.replace(/\/\/[^\n]*/g, '');
    expect(logikkUtenKommentarer).not.toMatch(/^import /m);
    expect(logikkUtenKommentarer).not.toMatch(/\bDeno\b|\bfetch\b|\bcreateClient\b/);
  });

  it('under kjøring: bare rpc finnes på klienten (alt annet kaster) og global fetch kalles aldri', async () => {
    const { kall, fetchKall, rpcKall } = await last();
    // Både suksess og alle feilgrener (de har ulike kodeveier) uten et eneste annet kall.
    expect((await kall({ headers: medNokkel, body: GYLDIG })).status).toBe(200);
    expect((await kall({ headers: medNokkel, body: { versjon: 1, ider: 'x' } })).status).toBe(400);
    expect((await kall({ headers: {}, body: GYLDIG })).status).toBe(401);
    expect(rpcKall).toHaveLength(1);
    const t = await last({ rpc: { data: null, error: { message: 'noe', code: 'X' } } });
    expect((await t.kall({ headers: medNokkel, body: GYLDIG })).status).toBe(502);
    expect(fetchKall).toHaveLength(0);
    expect(t.fetchKall).toHaveLength(0);
  });

  // ---------------------------------------------------------------- V7: hemmelighetssammenligning
  it('hemmeligheten sammenlignes i konstant tid via SHA-256 (likt), aldri med ===', () => {
    expect(kilde).toContain("crypto.subtle.digest('SHA-256'");
    expect(kilde).toMatch(/d \|= x\[i\] \^ y\[i\]/);
    expect(kilde).toMatch(/!\(await likt\(sendt, hemmelighet\)\)/);
    const utenKommentarer = kilde.replace(/\/\/[^\n]*/g, '');
    expect(utenKommentarer).not.toMatch(/\b(sendt|hemmelighet)\s*[!=]==?\s*(sendt|hemmelighet)\b/);
    expect(utenKommentarer).not.toMatch(/(sendt|hemmelighet)\.(startsWith|endsWith|includes|localeCompare)\(/);
    // Riktig navn på hemmelighet og header (valg 9), og begge trimmes.
    expect(kilde).toContain("Deno.env.get('SALMAKERN_HENT_SECRET')");
    expect(kilde).toContain("req.headers.get('x-salmakern-hent-secret')");
    expect(kilde).toMatch(/\(Deno\.env\.get\('SALMAKERN_HENT_SECRET'\) \?\? ''\)\.trim\(\)/);
    expect(kilde).toMatch(/\(req\.headers\.get\('x-salmakern-hent-secret'\) \?\? ''\)\.trim\(\)/);
    expect(kilde).toContain('MIN_HEMMELIGHET_LENGDE = 32');
  });

  it('en hemmelighet som bare avviker i siste tegn, eller har samme lengde, avvises; den riktige slippes gjennom', async () => {
    const { kall } = await last();
    const sisteFeil = HEMMELIGHET.slice(0, -1) + (HEMMELIGHET.endsWith('a') ? 'b' : 'a');
    expect((await kall({ headers: { 'x-salmakern-hent-secret': sisteFeil }, body: GYLDIG })).status).toBe(401);
    expect((await kall({ headers: { 'x-salmakern-hent-secret': 'y'.repeat(HEMMELIGHET.length) }, body: GYLDIG })).status).toBe(401);
    expect((await kall({ headers: medNokkel, body: GYLDIG })).status).toBe(200);
  });
});
