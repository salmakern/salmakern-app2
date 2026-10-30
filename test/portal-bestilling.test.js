// Edge-funksjonen portal-bestilling (supabase/functions/portal-bestilling): døra inn for bestillinger fra Forhandlerportalen.
//  1) logikk.ts (ren validering/avgrensning) lastes direkte.
//  2) index.ts kjøres mot falsk Deno og falsk supabase-klient: kildefilen kopieres til en midlertidig .ts-modul med de to importlinjene byttet ut
//     (samme teknikk som edge-auth-gate.test.js), så HELE håndtereren testes: autentisering, grenser, allowlist, svaravgrensning, feil, logging.
// Postgres-funksjonen bak (portal_koble_bestilling) har sin egen test: supabase/tester/portal_koble_bestilling_TEST_body.sql.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseInnkommende, mapSvar, mapFeil, TILLATTE_FELT, MAKS_BODY_BYTES } from '../supabase/functions/portal-bestilling/logikk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJON = path.resolve(__dirname, '../supabase/functions/portal-bestilling');
const kilde = readFileSync(path.join(FUNKSJON, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

const GYLDIG = {
  bestilling_id: 'cm9testbestilling0001',
  nr: 'B-2026-0001',
  ident_type: 'CHASSIS',
  ident: 'TESTWXYZ000000001',
  kontakt_id: 'k_portal_akauto',
  orgnr: '831862122',
  forhandler_navn: 'AK Auto AS',
  selger_navn: 'Test Selger',
  selger_epost: 'test.selger@example.test',
  modell_slug: 'kia-ev9',
};

describe('parseInnkommende: gyldig input', () => {
  it('chassis og serienummer godtas, og bare de ti navngitte feltene sendes videre', () => {
    const r = parseInnkommende({ ...GYLDIG });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.p).sort()).toEqual([...TILLATTE_FELT].sort());
    expect(r.ignorerte).toBe(0);
    const s = parseInnkommende({ ...GYLDIG, ident_type: 'SERIENUMMER', ident: ' ab-1234/5 ' });
    expect(s.ok).toBe(true);
  });

  it('valgfrie felt kan mangle (forhandler_navn, selger_epost ...) eller være null', () => {
    const r = parseInnkommende({ bestilling_id: GYLDIG.bestilling_id, nr: GYLDIG.nr, ident_type: 'CHASSIS', ident: GYLDIG.ident, selger_epost: null });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.p).sort()).toEqual(['bestilling_id', 'ident', 'ident_type', 'nr']);
  });

  it('originalverdiene sendes videre uendret (Postgres er eneste sted som normaliserer)', () => {
    const r = parseInnkommende({ ...GYLDIG, ident: ' testwxyz-000000001 ', selger_epost: ' Test@Example.Test ' });
    expect(r.ok).toBe(true);
    expect(r.p.ident).toBe(' testwxyz-000000001 ');
    expect(r.p.selger_epost).toBe(' Test@Example.Test ');
  });

  it('kjor_pa_nytt og alle andre ukjente felt kastes og telles (aldri videre til databasen)', () => {
    const r = parseInnkommende({ ...GYLDIG, kjor_pa_nytt: true, status: 'bekreftet', ordre_id: 'ord_1', portal_bekreftet_at: 'x', __proto__x: 1 });
    expect(r.ok).toBe(true);
    expect(r.p.kjor_pa_nytt).toBeUndefined();
    expect(Object.keys(r.p)).not.toContain('status');
    expect(Object.keys(r.p)).not.toContain('ordre_id');
    expect(r.ignorerte).toBe(5);
  });

  it('en «__proto__»-nøkkel fra JSON.parse forurenser ingenting og videresendes ikke', () => {
    const r = parseInnkommende(JSON.parse('{"bestilling_id":"cm9testbestilling0001","nr":"B-2026-0001","ident_type":"CHASSIS","ident":"TESTWXYZ000000001","__proto__":{"kjor_pa_nytt":true},"constructor":"x"}'));
    expect(r.ok).toBe(true);
    expect(Object.keys(r.p).sort()).toEqual(['bestilling_id', 'ident', 'ident_type', 'nr']);
    expect({}.kjor_pa_nytt).toBeUndefined();
    expect(r.ignorerte).toBe(2);
  });
});

describe('parseInnkommende: avvises tidlig (400) uten å røre databasen', () => {
  const avvist = (endring, felt) => {
    const r = parseInnkommende({ ...GYLDIG, ...endring });
    expect(r.ok, JSON.stringify(endring)).toBe(false);
    expect(r.felt).toBe(felt);
  };

  it('body som ikke er et vanlig objekt', () => {
    for (const b of [null, undefined, 'tekst', 5, true, [], [GYLDIG]]) expect(parseInnkommende(b)).toEqual({ ok: false, felt: 'body' });
  });

  it('påkrevde felt som mangler', () => {
    for (const f of ['bestilling_id', 'nr', 'ident_type', 'ident']) {
      const b = { ...GYLDIG };
      delete b[f];
      expect(parseInnkommende(b)).toEqual({ ok: false, felt: f });
    }
  });

  it('felt som ikke er tekst (tall, objekt, liste, boolsk)', () => {
    for (const v of [5, true, {}, ['a'], { a: 1 }]) {
      avvist({ selger_navn: v }, 'selger_navn');
      avvist({ bestilling_id: v }, 'bestilling_id');
    }
  });

  it('for lange felt og NUL-tegn (kan ikke lagres i Postgres)', () => {
    avvist({ selger_navn: 'a'.repeat(201) }, 'selger_navn');
    avvist({ selger_epost: 'a'.repeat(321) }, 'selger_epost');
    avvist({ selger_navn: 'Ola\u0000Nordmann' }, 'selger_navn');
    avvist({ ident: 'TESTWXYZ0000000\u000001' }, 'ident');
  });

  it('bestilling_id: for kort, for lang, mellomrom eller tegn utenfor [A-Za-z0-9_-]', () => {
    for (const v of ['abc', 'a'.repeat(65), 'cm9 test bestilling', 'cm9test;bestilling', "cm9test'bestilling", 'cm9testbestilling\n0001']) avvist({ bestilling_id: v }, 'bestilling_id');
  });

  it('Unicode-mellomrom og -tegn avvises (ASCII-strengt, så det som slipper gjennom aldri avvises av Postgres)', () => {
    // Funnet av differensialtesten mot Postgres: JS \s/trim() tar med BOM og Unicode-mellomrom, Postgres sin btrim() bare vanlig mellomrom.
    for (const w of [' ', '﻿', ' ', '　', ' ', '\u0085', '​']) {
      avvist({ bestilling_id: w + GYLDIG.bestilling_id }, 'bestilling_id');
      avvist({ bestilling_id: GYLDIG.bestilling_id + w }, 'bestilling_id');
      avvist({ ident: w + GYLDIG.ident }, 'ident');
      avvist({ ident: GYLDIG.ident.slice(0, 8) + w + GYLDIG.ident.slice(8) }, 'ident');
      avvist({ ident_type: 'SERIENUMMER', ident: 'AB' + w + 'CD' }, 'ident');
    }
    // Tab, linjeskift osv. rundt bestilling_id godtas IKKE av Postgres (btrim tar bare mellomrom), så de avvises også her.
    for (const w of ['\t', '\n', '\r', '\f', '\v']) {
      avvist({ bestilling_id: w + GYLDIG.bestilling_id }, 'bestilling_id');
      avvist({ bestilling_id: GYLDIG.bestilling_id + w }, 'bestilling_id');
    }
    expect(parseInnkommende({ ...GYLDIG, bestilling_id: ' ' + GYLDIG.bestilling_id + ' ' }).ok).toBe(true);
    // Ikke-ASCII som store bokstaver utvider eller gjør om til A-Z (ß -> SS, ﬁ -> FI, ŉ -> ʼN) skal ikke kunne gi et gyldig chassis.
    for (const c of ['ß', 'ﬁ', 'ŉ', 'ı', 'İ', 'А', 'Ａ', '٣']) {
      avvist({ ident: GYLDIG.ident.slice(0, 15) + c + '1' }, 'ident');
      avvist({ ident: GYLDIG.ident.slice(0, 15) + c }, 'ident');
      avvist({ ident: GYLDIG.ident.slice(0, 16) + c }, 'ident');
    }
  });

  it('nr uten ett eneste gyldig tegn', () => {
    avvist({ nr: '' }, 'nr');
    avvist({ nr: '###' }, 'nr');
  });

  it('ident_type må være nøyaktig CHASSIS eller SERIENUMMER (store bokstaver)', () => {
    for (const v of ['chassis', 'Chassis', 'serienummer', 'VIN', '', 'CHASSIS ']) avvist({ ident_type: v }, 'ident_type');
  });

  it('chassis: 17 tegn A-Z/0-9 uten I, O og Q', () => {
    for (const v of ['TESTWXYZ00000000', 'TESTWXYZ0000000001', 'TESTWXIZ000000001', 'TESTWXOZ000000001', 'TESTWXQZ000000001', 'TESTWXYZ00000000!', '', '                 ']) avvist({ ident: v }, 'ident');
    expect(parseInnkommende({ ...GYLDIG, ident: 'test wxyz-0000-00001' }).ok).toBe(true);
  });

  it('serienummer: 3-40 tegn, bare A-Z 0-9 . _ / mellomrom og bindestrek', () => {
    const s = (ident) => parseInnkommende({ ...GYLDIG, ident_type: 'SERIENUMMER', ident });
    for (const v of ['ab', '<script>alert(1)</script>', 'a'.repeat(41), 'ab;cd', 'æøå123']) expect(s(v).ok, v).toBe(false);
    // Linjeskift i serienummeret blir ett mellomrom (som i Postgres-funksjonen: \s+ -> ' '), så det er gyldig og ikke et injeksjonshull.
    for (const v of ['abc', 'a'.repeat(40), 'AB 12.3/4_5-6', 'abc\ndef']) expect(s(v).ok, v).toBe(true);
  });
});

describe('mapSvar: det portalen får se', () => {
  it('ok og trenger_avklaring godtas, ekstra felt fjernes', () => {
    expect(mapSvar({ kode: 'ok', status: 'ny_ordre', ordre_id: 'ord_1788100000000' })).toEqual({ kode: 'ok', status: 'ny_ordre', ordre_id: 'ord_1788100000000' });
    expect(mapSvar({ kode: 'trenger_avklaring', status: 'avklaring_annen_forhandler' })).toEqual({ kode: 'trenger_avklaring', status: 'avklaring_annen_forhandler' });
    expect(mapSvar({ kode: 'ok', status: 'koblet', ordre_id: 'ord_1', detalj: 'AK Auto AS har allerede bilen', forhandler: 'Annen AS' })).toEqual({ kode: 'ok', status: 'koblet', ordre_id: 'ord_1' });
  });

  it('uventet form gir null (blir 502), aldri en ukjent verdi videre', () => {
    for (const d of [null, undefined, 'ok', 5, [], { kode: 'ok' }, { status: 'ny_ordre' }, { kode: 'feil', status: 'x' }, { kode: 'ok', status: 'Ny Ordre' }, { kode: 'ok', status: 5 },
      { kode: 'ok', status: 'ny_ordre', ordre_id: 5 }, { kode: 'ok', status: 'ny_ordre', ordre_id: 'a b' }, { kode: 'ok', status: 'ny_ordre', ordre_id: '<x>' }, { kode: 'ok', status: 'a'.repeat(41) }]) {
      expect(mapSvar(d), JSON.stringify(d)).toBeNull();
    }
  });
});

describe('mapFeil: databasefeil blir aldri tekst til portalen', () => {
  it('UGYLDIG_INPUT: felt gir 400 med feltnavnet', () => {
    expect(mapFeil({ message: 'UGYLDIG_INPUT: chassis' })).toEqual({ status: 400, kode: 'ugyldig_input', felt: 'chassis' });
    expect(mapFeil({ message: 'UGYLDIG_INPUT: bestilling_id', code: 'P0001' })).toEqual({ status: 400, kode: 'ugyldig_input', felt: 'bestilling_id' });
    expect(mapFeil({ message: 'UGYLDIG_INPUT: ikke et objekt' })).toEqual({ status: 400, kode: 'ugyldig_input' });
  });

  it('alt annet er en intern feil (502) uten detaljer', () => {
    for (const f of [{ message: 'password authentication failed for user "postgres"' }, { message: 'canceling statement due to statement timeout', code: '57014' }, { message: 'AbortError' }, null, undefined, 'tekst', {}, { message: 5 },
      { message: 'noe UGYLDIG_INPUT: chassis i midten' }]) {
      expect(mapFeil(f), JSON.stringify(f)).toEqual({ status: 502, kode: 'intern_feil' });
    }
  });
});

describe('index.ts: oppsett (kildetekst)', () => {
  it('hemmeligheten sjekkes før body leses, og bare PORTAL_BESTILLING_SECRET brukes', () => {
    expect(kilde.indexOf("req.headers.get('x-sync-secret')")).toBeGreaterThan(-1);
    expect(kilde.indexOf("req.headers.get('x-sync-secret')")).toBeLessThan(kilde.indexOf('await req.text()'));
    expect(kilde).toMatch(/Deno\.env\.get\('PORTAL_BESTILLING_SECRET'\)/);
    expect(kilde).not.toMatch(/Deno\.env\.get\('FIKEN_SYNC_SECRET'\)/);
  });

  it('ingen hardkodet nøkkel, ingen CORS, og bare allowlist-objektet (input.p) sendes til databasen', () => {
    expect(kilde).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(kilde).not.toMatch(/Access-Control-Allow/i);
    expect(kilde).toMatch(/\.rpc\('portal_koble_bestilling', \{ p: input\.p \}\)/);
    expect(kilde).not.toMatch(/\.rpc\([^)]*raa/);
    expect(kilde.replace(/\/\/[^\n]*/g, '')).not.toMatch(/kjor_pa_nytt/);
    expect(TILLATTE_FELT).not.toContain('kjor_pa_nytt');
  });
});

describe('index.ts: oppførsel (håndtereren kjørt mot falsk Deno og falsk supabase-klient)', () => {
  const HEMMELIGHET = 'test-hemmelighet-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const TJENESTE_NOKKEL = 'tjeneste-nokkel-test-bbbbbbbbbbbbbbbbbbbbbbbb';
  const tmpFiler = [];
  afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

  // Laster index.ts med gitt miljø og et svar fra «databasen». Gir { kall: (init) => Response, rpcKall, klientKall, logger }.
  async function last({ env = {}, rpc = { data: { kode: 'ok', status: 'ny_ordre', ordre_id: 'ord_1788100000000' }, error: null }, rpcKaster = null } = {}) {
    const fullEnv = { PORTAL_BESTILLING_SECRET: HEMMELIGHET, SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: TJENESTE_NOKKEL, ...env };
    const rpcKall = [];
    const klientKall = [];
    const logger = [];
    const logOrig = console.log;
    let handler = null;
    globalThis.Deno = { env: { get: (k) => fullEnv[k] }, serve: (h) => { handler = h; } };
    globalThis.__fakeCreateClient = (url, nokkel, opts) => {
      klientKall.push({ url, nokkel, opts });
      return {
        rpc: (navn, args) => {
          rpcKall.push({ navn, args });
          return { abortSignal: (signal) => { rpcKall[rpcKall.length - 1].signal = !!signal; if (rpcKaster) return Promise.reject(rpcKaster); return Promise.resolve(rpc); } };
        },
      };
    };
    console.log = (...a) => { logger.push(a.join(' ')); };
    const kode = kilde
      .replace("import { createClient } from 'jsr:@supabase/supabase-js@2'", 'const createClient = globalThis.__fakeCreateClient')
      .replace("import { MAKS_BODY_BYTES, mapFeil, mapSvar, parseInnkommende } from './logikk.ts'", `import { MAKS_BODY_BYTES, mapFeil, mapSvar, parseInnkommende } from ${JSON.stringify(pathToFileURL(path.join(FUNKSJON, 'logikk.ts')).href)}`);
    const fil = path.resolve(__dirname, `_pb_tmp_${Math.random().toString(36).slice(2)}.ts`);
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
        return await handler(new Request('https://test.supabase.invalid/functions/v1/portal-bestilling', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }));
      } finally {
        console.log = logOrig2;
      }
    };
    return { kall, rpcKall, klientKall, logger };
  }
  const medNokkel = { 'x-sync-secret': HEMMELIGHET };

  it('riktig hemmelighet og gyldig bestilling: 200 med bare {kode, status, ordre_id}; databasen kalles én gang med bare allowlist-feltene', async () => {
    const { kall, rpcKall, klientKall } = await last();
    const res = await kall({ headers: medNokkel, body: { ...GYLDIG, kjor_pa_nytt: true, status: 'bekreftet' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kode: 'ok', status: 'ny_ordre', ordre_id: 'ord_1788100000000' });
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(rpcKall).toHaveLength(1);
    expect(rpcKall[0].navn).toBe('portal_koble_bestilling');
    expect(Object.keys(rpcKall[0].args)).toEqual(['p']);
    expect(rpcKall[0].args.p).toEqual(GYLDIG);
    expect(rpcKall[0].signal).toBe(true);
    expect(klientKall).toEqual([{ url: 'https://test.supabase.invalid', nokkel: TJENESTE_NOKKEL, opts: { auth: { persistSession: false, autoRefreshToken: false } } }]);
  });

  it('utfall som trenger avklaring gir også 200, uten detaljer fra databasen', async () => {
    const { kall } = await last({ rpc: { data: { kode: 'trenger_avklaring', status: 'avklaring_annen_forhandler', detalj: 'AK Auto AS har bilen', forhandler: 'AK Auto AS' }, error: null } });
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kode: 'trenger_avklaring', status: 'avklaring_annen_forhandler' });
  });

  it('manglende eller feil hemmelighet: 401, databasen røres ikke', async () => {
    const { kall, rpcKall, klientKall } = await last();
    for (const headers of [{}, { 'x-sync-secret': '' }, { 'x-sync-secret': 'feil' }, { 'x-sync-secret': HEMMELIGHET + 'x' }, { 'x-sync-secret': HEMMELIGHET.slice(0, -1) }, { authorization: `Bearer ${HEMMELIGHET}` }, { 'x-sync-secret': HEMMELIGHET.toUpperCase() }]) {
      const res = await kall({ headers, body: GYLDIG });
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(await res.json()).toEqual({ kode: 'uautorisert' });
    }
    expect(rpcKall).toHaveLength(0);
    expect(klientKall).toHaveLength(0);
  });

  it('ingen hemmelighet satt i miljøet: 500 (aldri åpen), også med en header som ser riktig ut', async () => {
    const { kall, rpcKall } = await last({ env: { PORTAL_BESTILLING_SECRET: undefined } });
    for (const headers of [medNokkel, { 'x-sync-secret': '' }, {}, { 'x-sync-secret': 'undefined' }]) {
      const res = await kall({ headers, body: GYLDIG });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ kode: 'ikke_konfigurert' });
    }
    expect(rpcKall).toHaveLength(0);
  });

  it('manglende databasenøkkel i miljøet: 500 ikke_konfigurert', async () => {
    for (const env of [{ SUPABASE_SERVICE_ROLE_KEY: undefined }, { SUPABASE_URL: undefined }]) {
      const { kall, rpcKall } = await last({ env });
      const res = await kall({ headers: medNokkel, body: GYLDIG });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ kode: 'ikke_konfigurert' });
      expect(rpcKall).toHaveLength(0);
    }
  });

  it('andre metoder enn POST: 405', async () => {
    const { kall, rpcKall } = await last();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const res = await kall({ method, headers: medNokkel });
      expect(res.status, method).toBe(405);
    }
    expect(rpcKall).toHaveLength(0);
  });

  it('for stor body: 413 (både ved content-length og uten), og ugyldig JSON/felt: 400, uten database', async () => {
    const { kall, rpcKall } = await last();
    const stor = JSON.stringify({ ...GYLDIG, nr: 'x'.repeat(MAKS_BODY_BYTES + 10) });
    let res = await kall({ headers: { ...medNokkel, 'content-length': String(stor.length) }, body: stor });
    expect(res.status).toBe(413);
    res = await kall({ headers: medNokkel, body: stor });
    expect(res.status).toBe(413);
    res = await kall({ headers: medNokkel, body: '{ikke json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'body' });
    res = await kall({ headers: medNokkel, body: { ...GYLDIG, ident: 'TESTWXIZ000000001' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'ident' });
    res = await kall({ headers: medNokkel, body: [GYLDIG] });
    expect(res.status).toBe(400);
    expect(rpcKall).toHaveLength(0);
  });

  it('UGYLDIG_INPUT fra databasen: 400 med feltnavn; alle andre databasefeil: 502 uten feilteksten', async () => {
    let t = await last({ rpc: { data: null, error: { message: 'UGYLDIG_INPUT: chassis', code: 'P0001' } } });
    let res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'chassis' });

    t = await last({ rpc: { data: null, error: { message: 'password authentication failed for user "postgres" at db.internal:5432', code: '28P01' } } });
    res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    const tekst = await res.text();
    expect(JSON.parse(tekst)).toEqual({ kode: 'intern_feil' });
    expect(tekst).not.toMatch(/password|postgres|internal/);
  });

  it('uventet svar fra databasen (feil form) og kastet unntak (tidsavbrudd): 502 intern_feil', async () => {
    let t = await last({ rpc: { data: { kode: 'noe_nytt', status: 'x' }, error: null } });
    let res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ kode: 'intern_feil' });

    t = await last({ rpcKaster: new DOMException('The operation was aborted due to timeout https://test.supabase.invalid/rest/v1/rpc', 'TimeoutError') });
    res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    const tekst = await res.text();
    expect(JSON.parse(tekst)).toEqual({ kode: 'intern_feil' });
    expect(tekst).not.toMatch(/supabase|timeout|aborted/i);
  });

  it('loggen har én JSON-linje per kall og aldri chassis, e-post, navn, hemmelighet eller nøkkel', async () => {
    const t = await last();
    await t.kall({ headers: medNokkel, body: GYLDIG });
    await t.kall({ headers: { 'x-sync-secret': 'feil-verdi-xyz' }, body: GYLDIG });
    await t.kall({ headers: medNokkel, body: { ...GYLDIG, ident: 'TESTWXIZ000000001' } });
    await t.kall({ headers: medNokkel, body: '{ikke json' });
    expect(t.logger).toHaveLength(4);
    const alt = t.logger.join('\n');
    for (const hemmelig of [GYLDIG.ident, GYLDIG.selger_epost, GYLDIG.selger_navn, GYLDIG.forhandler_navn, GYLDIG.bestilling_id, GYLDIG.kontakt_id, HEMMELIGHET, TJENESTE_NOKKEL, 'feil-verdi-xyz', 'TESTWXIZ000000001']) {
      expect(alt, hemmelig).not.toContain(hemmelig);
    }
    const linjer = t.logger.map((l) => JSON.parse(l));
    expect(linjer.map((l) => l.utfall)).toEqual(['ny_ordre', 'uautorisert', 'ugyldig_input', 'ugyldig_json']);
    for (const l of linjer) {
      expect(l.portal_bestilling).toBe(1);
      expect(l.fn).toBe('portal-bestilling');
      expect(typeof l.ms).toBe('number');
    }
    expect(linjer[2].felt).toBe('ident');
  });
});
