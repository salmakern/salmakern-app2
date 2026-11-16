// Edge-funksjonen portal-timer-fakta (supabase/functions/portal-timer-fakta): gir Forhandlerportalen et SKRIVEBESKYTTET øyeblikksbilde av FAKTISKE timer per bil
// (ordreklokka), til kalkylesiden i portalen. Portalen henter; appen skriver aldri til portalen og funksjonen skriver aldri noe.
//  1) logikk.ts (ren validering/avgrensning) lastes direkte (V1-V3).
//  2) index.ts kjøres mot falsk Deno og en falsk supabase-klient som BARE har rpc (alt annet kaster): kildefilen kopieres til en midlertidig .ts-modul med
//     jsr:-importen byttet ut (samme teknikk som portal-import-fakta.test.js), så HELE håndtereren testes: hemmelighet, grenser, svaravgrensning, feil, logging (V4-V7).
// Postgres-funksjonen bak (portal_timer_fakta) har sin egen test: supabase/tester/portal_timer_fakta_TEST_body.sql (kjøres i en transaksjon som rulles tilbake).
// Alle verdier her er SYNTETISKE (gullfila har KIA EV9 osv. med runde tall): ingen ekte kunder, chassis.nr eller ansatte, og ingen slike felt finnes i svaret.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseForesporsel, mapTimer, mapFeil, VERSJON, MAKS_BODY_BYTES, BILER_MAKS, TEKST_MAKS } from '../supabase/functions/portal-timer-fakta/logikk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJON = path.resolve(__dirname, '../supabase/functions/portal-timer-fakta');
const kilde = readFileSync(path.join(FUNKSJON, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const logikkKilde = readFileSync(path.join(FUNKSJON, 'logikk.ts'), 'utf8').replace(/\r\n/g, '\n');
// Gullfila: HELE kontraktssvaret (versjon 1), byte-lik portalens kopi (eksempel-svar.json i kontraktmappen). Svaret har INGEN `ok`-nøkkel (i motsetning til portal-import-fakta).
const GULL_TEKST = readFileSync(path.join(__dirname, 'fixtures/portal-timer-fakta-svar.json'), 'utf8');
const GULL = JSON.parse(GULL_TEKST);
const kopi = (x) => JSON.parse(JSON.stringify(x));

const FELT = ['merke', 'modell', 'ordre_status', 'arkivert', 'hentet', 'minutter_ombygging', 'okter_ombygging', 'okter_ombygging_glemt', 'minutter_klargjoring', 'pagaar', 'frossen_effektiv_minutter'];

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Gullfila (kontrollerer testens egen forutsetning)
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('gullfila (forutsetninger for resten av testen)', () => {
  it('har nøyaktig versjon, generert, antall og biler, og antall = lengden på biler', () => {
    expect(Object.keys(GULL)).toEqual(['versjon', 'generert', 'antall', 'biler']);
    expect(GULL.versjon).toBe(1);
    expect(GULL.antall).toBe(GULL.biler.length);
    expect(GULL.antall).toBe(4);
  });

  it('hver bil har de 11 feltene i kontraktens rekkefølge og ingen id, chassis, kunde, kontaktperson eller ansattfelt', () => {
    for (const bil of GULL.biler) expect(Object.keys(bil)).toEqual(FELT);
    expect(GULL_TEKST).not.toMatch(/chassis|kunde|eier|ansatt|ordre_id|"id"/i);
  });

  it('dekker de interessante tilfellene: glemt, pågår, frossen verdi og null, hentet og ikke hentet', () => {
    const b = GULL.biler;
    expect(b.some((x) => x.okter_ombygging_glemt > 0)).toBe(true);
    expect(b.some((x) => x.pagaar)).toBe(true);
    expect(b.some((x) => x.frossen_effektiv_minutter === null)).toBe(true);
    expect(b.some((x) => typeof x.frossen_effektiv_minutter === 'number')).toBe(true);
    expect(b.some((x) => x.hentet)).toBe(true);
    expect(b.some((x) => !x.hentet)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// V1 parseForesporsel
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('parseForesporsel (V1)', () => {
  it('konstantene er kontraktens (versjon 1, 2000 biler, 1024 byte, 100 tegn)', () => {
    expect(VERSJON).toBe(1);
    expect(BILER_MAKS).toBe(2000);
    expect(MAKS_BODY_BYTES).toBe(1024);
    expect(TEKST_MAKS).toBe(100);
  });

  it('{versjon: 1} er gyldig, og ukjente felt kastes (resultatet har ingen data å videresende)', () => {
    expect(parseForesporsel({ versjon: 1 })).toEqual({ ok: true });
    const r = parseForesporsel({ versjon: 1, ider: ['a'], ekstra: 'x', merke: 'KIA' });
    expect(r).toEqual({ ok: true });
    expect(Object.keys(r)).toEqual(['ok']);
  });

  it('en «__proto__»-nøkkel fra JSON.parse forurenser ingenting', () => {
    const r = parseForesporsel(JSON.parse('{"versjon":1,"__proto__":{"ider":["x"]},"constructor":"x"}'));
    expect(r).toEqual({ ok: true });
    expect({}.ider).toBeUndefined();
  });

  it('versjon er PÅKREVD og må være tallet 1: mangler, 0, 2, «1», null, 1.5, true, liste og objekt gir felt «versjon»', () => {
    for (const versjon of [undefined, 0, 2, '1', null, 1.5, true, [1], { v: 1 }]) {
      const raa = versjon === undefined ? {} : { versjon };
      expect(parseForesporsel(raa), JSON.stringify(versjon)).toEqual({ ok: false, felt: 'versjon' });
    }
  });

  it('en kropp som ikke er et objekt (liste, null, tekst, tall) gir felt «body»', () => {
    for (const raa of [[], [{ versjon: 1 }], null, undefined, 'tekst', 1, true]) {
      expect(parseForesporsel(raa), JSON.stringify(raa)).toEqual({ ok: false, felt: 'body' });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// V2 mapTimer
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('mapTimer (V2)', () => {
  it('gullfila gir nøyaktig samme innhold, uten ok-nøkkel, med nøklene i kontraktens rekkefølge (også serialisert)', () => {
    const r = mapTimer(kopi(GULL));
    expect(r).toEqual(GULL);
    expect(Object.keys(r)).toEqual(['versjon', 'generert', 'antall', 'biler']);
    expect(r).not.toHaveProperty('ok');
    for (const bil of r.biler) expect(Object.keys(bil)).toEqual(FELT);
    expect(JSON.stringify(r)).toBe(JSON.stringify(GULL));
  });

  it('en ok-nøkkel fra databasen er uten betydning og sendes ikke videre', () => {
    expect(mapTimer({ ...kopi(GULL), ok: true })).toEqual(GULL);
    expect(mapTimer({ ...kopi(GULL), ok: false })).not.toHaveProperty('ok');
  });

  it('ekstra felt kastes (toppnivå og bil), også uten å røre inndata', () => {
    const inn = kopi(GULL);
    inn.hemmelig = 'x';
    inn.biler[0].ordre_id = 'ord_1';
    inn.biler[1].chassis = 'TESTWXYZ000000001';
    inn.biler[2].ansatt = 'Test Ansatt';
    const fasit = kopi(inn);
    const r = mapTimer(inn);
    expect(r).toEqual(GULL);
    expect(JSON.stringify(r)).not.toMatch(/hemmelig|ord_1|TESTWXYZ|Ansatt/);
    expect(inn).toEqual(fasit);
  });

  it('hvert av de 11 feltene må være til stede, ellers null', () => {
    for (const felt of FELT) {
      const inn = kopi(GULL);
      delete inn.biler[0][felt];
      expect(mapTimer(inn), `mangler ${felt}`).toBeNull();
    }
  });

  it('feil type på et felt gir null', () => {
    const feil = {
      merke: [5, null, {}, ['KIA']], modell: [5, null, {}], ordre_status: [5, null, '', {}], arkivert: ['true', 1, null, 0], hentet: ['true', 1, null, 0],
      minutter_ombygging: ['540', 1.5, -1, null, NaN, Infinity, true, 2 ** 53], okter_ombygging: ['3', 1.5, -1, null, true], okter_ombygging_glemt: ['0', 0.5, -1, null],
      minutter_klargjoring: ['60', 1.5, -1, null, true], pagaar: ['false', 0, null], frossen_effektiv_minutter: ['480', 1.5, -1, NaN, true, {}, undefined],
    };
    for (const [felt, verdier] of Object.entries(feil)) {
      for (const v of verdier) {
        const inn = kopi(GULL);
        inn.biler[0][felt] = v; // NaN, Infinity og undefined settes direkte (kopi() via JSON ville gjort dem til null/borte)
        expect(mapTimer(inn), `${felt} = ${String(v)}`).toBeNull();
      }
    }
  });

  it('hentet må stemme med ordre_status (hentet = ordre_status er «hentet»), begge veier', () => {
    const a = kopi(GULL); a.biler[0].hentet = false;                       // ordre_status = hentet, men hentet = false
    const b = kopi(GULL); b.biler[1].hentet = true;                        // ordre_status = klar_henting, men hentet = true
    expect(mapTimer(a)).toBeNull();
    expect(mapTimer(b)).toBeNull();
  });

  it('frossen_effektiv_minutter kan være null eller et helt tall (også 0)', () => {
    const inn = kopi(GULL);
    inn.biler[0].frossen_effektiv_minutter = 0;
    inn.biler[1].frossen_effektiv_minutter = null;
    const r = mapTimer(inn);
    expect(r.biler[0].frossen_effektiv_minutter).toBe(0);
    expect(r.biler[1].frossen_effektiv_minutter).toBeNull();
  });

  it('ordre_status er fri tekst (en ny statuskode fra appen avvises ikke), men merke og modell kan være tomme', () => {
    const inn = kopi(GULL);
    inn.biler[0].ordre_status = 'noe_nytt_fra_appen'; inn.biler[0].hentet = false;
    inn.biler[1].merke = ''; inn.biler[1].modell = '';
    const r = mapTimer(inn);
    expect(r.biler[0].ordre_status).toBe('noe_nytt_fra_appen');
    expect(r.biler[1]).toMatchObject({ merke: '', modell: '' });
  });

  it('merke og modell: nøyaktig 100 tegn er greit, 101 gir null; tegn telles som kodepunkter (100 emoji = 100)', () => {
    const med = (merke, modell) => { const x = kopi(GULL); x.biler[0].merke = merke; x.biler[0].modell = modell; return x; };
    expect(mapTimer(med('m'.repeat(100), 'x'.repeat(100)))).not.toBeNull();
    expect(mapTimer(med('m'.repeat(101), 'x'))).toBeNull();
    expect(mapTimer(med('m', 'x'.repeat(101)))).toBeNull();
    expect(mapTimer(med('\u{1F697}'.repeat(100), 'x'))).not.toBeNull();   // 100 kodepunkter, men lengde 200 i UTF-16
    expect(mapTimer(med('\u{1F697}'.repeat(101), 'x'))).toBeNull();
  });

  it('antall må være lik lengden på biler (mangler, tekst, for lavt, for høyt gir null)', () => {
    for (const antall of [undefined, '4', 3, 5, 0, -1, null, 4.5]) {
      const inn = kopi(GULL);
      if (antall === undefined) delete inn.antall; else inn.antall = antall;
      expect(mapTimer(inn), String(antall)).toBeNull();
    }
  });

  it('toppnivået: ukjent versjon, manglende/ugyldig generert, ikke-lister og for mange biler gir null', () => {
    const med = (endr) => { const x = kopi(GULL); endr(x); return x; };
    expect(mapTimer(med((x) => { x.versjon = 2; }))).toBeNull();
    expect(mapTimer(med((x) => { delete x.versjon; }))).toBeNull();
    expect(mapTimer(med((x) => { x.versjon = '1'; }))).toBeNull();
    expect(mapTimer(med((x) => { delete x.generert; }))).toBeNull();
    expect(mapTimer(med((x) => { x.generert = '2026-11-16 12:00:00'; }))).toBeNull();
    expect(mapTimer(med((x) => { x.generert = '2026-02-30T12:00:00.000Z'; }))).toBeNull();
    expect(mapTimer(med((x) => { x.generert = 5; }))).toBeNull();
    expect(mapTimer(med((x) => { x.biler = {}; }))).toBeNull();
    expect(mapTimer(med((x) => { delete x.biler; }))).toBeNull();
    expect(mapTimer(med((x) => { x.biler = null; }))).toBeNull();
    // Nøyaktig 2000 biler er greit, 2001 gir null (databasefunksjonen kaster FOR_MANGE_BILER før dette).
    const mange = (n) => { const x = kopi(GULL); x.biler = Array.from({ length: n }, () => kopi(GULL.biler[0])); x.antall = n; return x; };
    expect(mapTimer(mange(2000)).biler).toHaveLength(2000);
    expect(mapTimer(mange(2001))).toBeNull();
  });

  it('en bil som ikke er et objekt gir null (null, tall, liste, tekst)', () => {
    for (const bil of [null, 5, [], 'tekst', true]) {
      const inn = kopi(GULL); inn.biler[0] = bil;
      expect(mapTimer(inn), JSON.stringify(bil)).toBeNull();
    }
  });

  it('noe som ikke er et objekt gir null (null, liste, tekst, tall, undefined)', () => {
    for (const x of [null, undefined, [], [GULL], 'tekst', 5, true]) expect(mapTimer(x), JSON.stringify(x)).toBeNull();
  });

  it('en tom liste er gyldig (ingen biler med timedata)', () => {
    const r = mapTimer({ versjon: 1, generert: '2026-11-16T12:00:00.123Z', antall: 0, biler: [] });
    expect(r).toEqual({ versjon: 1, generert: '2026-11-16T12:00:00.123Z', antall: 0, biler: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// V3 mapFeil
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('mapFeil (V3)', () => {
  it('«FOR_MANGE_BILER» gir 422 for_mange_biler', () => {
    expect(mapFeil({ message: 'FOR_MANGE_BILER', code: 'P0001' })).toEqual({ status: 422, kode: 'for_mange_biler' });
  });

  it('alt annet, også tekst som bare ligner, gir 502 intern_feil', () => {
    const andre = [
      'xFOR_MANGE_BILER', ' FOR_MANGE_BILER', 'for_mange_biler', 'FOR_MANGE_BILERX', 'FOR_MANGE_BILER_OG_MER', 'Feil: FOR_MANGE_BILER', 'noe med FOR_MANGE_BILER',
      'FOR_MANGE_AKTIVE', 'FOR_MANGE', 'UGYLDIG_INPUT: ider', 'password authentication failed for user "postgres" at db.internal:5432',
      'canceling statement due to statement timeout', 'function public.portal_timer_fakta() does not exist', '',
    ];
    for (const message of andre) expect(mapFeil({ message }), message).toEqual({ status: 502, kode: 'intern_feil' });
    for (const feil of [null, undefined, 'FOR_MANGE_BILER', 42, {}, { message: 5 }, [], { melding: 'FOR_MANGE_BILER' }]) {
      expect(mapFeil(feil), JSON.stringify(feil)).toEqual({ status: 502, kode: 'intern_feil' });
    }
  });

  it('meldingen fra databasen er aldri en del av resultatet', () => {
    expect(JSON.stringify(mapFeil({ message: 'FOR_MANGE_BILER hemmelig-verdi-123' }))).not.toContain('hemmelig-verdi-123');
    expect(JSON.stringify(mapFeil({ message: 'noe annet hemmelig-verdi-123' }))).not.toContain('hemmelig-verdi-123');
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
  async function last({ env = {}, rpc = { data: kopi(GULL), error: null }, rpcKaster = null } = {}) {
    const fullEnv = { SALMAKERN_HENT_SECRET: HEMMELIGHET, SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: TJENESTE_NOKKEL, ...env };
    const rpcKall = [];
    const klientKall = [];
    const fetchKall = [];
    const logger = [];
    const logOrig = console.log;
    let handler = null;
    globalThis.Deno = { env: { get: (k) => fullEnv[k] }, serve: (h) => { handler = h; } };
    // Funksjonen skal ALDRI gjøre utgående nettverkskall: et kall til fetch registreres og kaster.
    globalThis.fetch = (...a) => { fetchKall.push(a); throw new Error('fetch skal aldri kalles i portal-timer-fakta'); };
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
    const logikkLinje = "import { MAKS_BODY_BYTES, mapFeil, mapTimer, parseForesporsel } from './logikk.ts'";
    if (!kilde.includes(importLinje) || !kilde.includes(logikkLinje)) throw new Error('portal-timer-fakta.test.js: fant ikke importlinjene i index.ts - oppdater testen');
    const kode = kilde
      .replace(importLinje, 'const createClient = globalThis.__fakeCreateClient')
      .replace(logikkLinje, `import { MAKS_BODY_BYTES, mapFeil, mapTimer, parseForesporsel } from ${JSON.stringify(pathToFileURL(path.join(FUNKSJON, 'logikk.ts')).href)}`);
    const fil = path.resolve(__dirname, `_ptf_tmp_${Math.random().toString(36).slice(2)}.ts`);
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
        return await handler(new Request('https://test.supabase.invalid/functions/v1/portal-timer-fakta', {
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

  it('for kort hemmelighet (under 32 tegn, etter trim) i miljøet: 500, også når headeren er lik den; nøyaktig 32 tegn er greit', async () => {
    for (const hemmelig of ['x'.repeat(31), '   ' + 'x'.repeat(31) + '\n', '   ', '']) {
      const { kall, rpcKall } = await last({ env: { SALMAKERN_HENT_SECRET: hemmelig } });
      const res = await kall({ headers: { 'x-salmakern-hent-secret': hemmelig.trim() || 'x' }, body: GYLDIG });
      expect(res.status, JSON.stringify(hemmelig)).toBe(500);
      expect(await res.json()).toEqual({ kode: 'ikke_konfigurert' });
      expect(rpcKall).toHaveLength(0);
    }
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

  it('hemmeligheten sjekkes FØR body leses: ugyldig JSON, ugyldig versjon og for stor body gir 401 uten riktig hemmelighet', async () => {
    const { kall, rpcKall } = await last();
    let res = await kall({ headers: {}, body: '{ikke json' });
    expect(res.status).toBe(401);
    res = await kall({ headers: {}, body: { versjon: 99 } });
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

  it('størrelsesgrensen: nøyaktig 1024 byte slippes gjennom, 1025 gir 413; grensen teller byte (ikke tegn) og content-length alene kan utløse den', async () => {
    const { kall, rpcKall, logger } = await last();
    const grunn = JSON.stringify(GYLDIG);
    const polstret = (n) => grunn + ' '.repeat(n - new TextEncoder().encode(grunn).length);
    // a) nøyaktig på grensen: gyldig JSON med mellomrom på slutten, ikke 413
    let res = await kall({ headers: medNokkel, body: polstret(1024) });
    expect(res.status).toBe(200);
    // b) én byte over: 413 uten database
    const rpcFoer = rpcKall.length;
    res = await kall({ headers: medNokkel, body: polstret(1025) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'body' });
    // c) 600 × «æ» er 600 tegn men 1200 byte: bytetellingen må ta den
    res = await kall({ headers: medNokkel, body: JSON.stringify({ versjon: 1, notat: 'æ'.repeat(600) }) });
    expect(res.status).toBe(413);
    // d) liten body men content-length 5000: content-length-grenen alene (leser aldri body) og eget loggutfall
    res = await kall({ headers: { ...medNokkel, 'content-length': '5000' }, body: GYLDIG });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt: 'body' });
    expect(rpcKall.length).toBe(rpcFoer);
    expect(logger.map((l) => JSON.parse(l).utfall).slice(-3)).toEqual(['for_stor', 'for_stor', 'for_stor']);
  });

  it('ugyldig JSON eller versjon: 400 uten database (versjon, body)', async () => {
    const { kall, rpcKall } = await last();
    const tilfeller = [
      ['{ikke json', 'body'],
      ['', 'body'],
      [[GYLDIG], 'body'],
      [null, 'body'],
      [{}, 'versjon'],
      [{ versjon: 2 }, 'versjon'],
      [{ versjon: '1' }, 'versjon'],
      [{ versjon: null }, 'versjon'],
      [{ ider: ['a'] }, 'versjon'],
    ];
    for (const [body, felt] of tilfeller) {
      const res = await kall({ headers: medNokkel, body });
      expect(res.status, JSON.stringify(body)?.slice(0, 40)).toBe(400);
      expect(await res.json()).toEqual({ kode: 'ugyldig_input', felt });
    }
    expect(rpcKall).toHaveLength(0);
  });

  // ---------------------------------------------------------------- V5: suksess, feil, uventet form, logging
  it('suksess: nøyaktig ÉN rpc «portal_timer_fakta» UTEN argumenter (ukjente felt i body går aldri til databasen), service_role-nøkkelen fra miljøet, tidsavbrudd og ingen sesjon', async () => {
    const { kall, rpcKall, klientKall } = await last();
    const res = await kall({ headers: medNokkel, body: { ...GYLDIG, ekstra: 'kastes', ider: ['ord_1'], versjon: 1 } });
    expect(res.status).toBe(200);
    expect(rpcKall).toHaveLength(1);
    expect(rpcKall[0].navn).toBe('portal_timer_fakta');
    expect(rpcKall[0].args).toBeUndefined();
    expect(rpcKall[0].signal).toBe(true);
    expect(klientKall).toHaveLength(1);
    expect(klientKall[0].url).toBe('https://test.supabase.invalid');
    expect(klientKall[0].nokkel).toBe(TJENESTE_NOKKEL);
    expect(klientKall[0].opts).toEqual({ auth: { persistSession: false, autoRefreshToken: false } });
  });

  it('svaret er kontraktens fakta (versjon, generert, antall, biler) UTEN ok, JSON, uten cache og uten CORS, og tekstlig lik gullfila', async () => {
    const { kall } = await last();
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const tekst = await res.text();
    const body = JSON.parse(tekst);
    expect(body).toEqual(GULL);
    expect(Object.keys(body)).toEqual(['versjon', 'generert', 'antall', 'biler']);
    expect(body).not.toHaveProperty('ok');
    expect(tekst).toBe(JSON.stringify(GULL));
  });

  it('ekstra felt fra databasen sendes aldri videre til portalen (id, chassis, kunde, ansatt)', async () => {
    const data = kopi(GULL);
    data.intern_debug = 'topp-hemmelig';
    data.biler[0].ordre_id = 'ord_1790000000001';
    data.biler[1].chassis = 'TESTWXYZ000000001';
    data.biler[2].kunde = 'TEST Forhandler A';
    data.biler[3].ansatt = 'TEST Ansatt';
    const { kall } = await last({ rpc: { data, error: null } });
    const res = await kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(200);
    const tekst = await res.text();
    expect(tekst).not.toMatch(/topp-hemmelig|ord_1790000000001|TESTWXYZ000000001|TEST Forhandler A|TEST Ansatt|intern_debug|chassis|kunde|ansatt/);
    expect(JSON.parse(tekst)).toEqual(GULL);
  });

  it('FOR_MANGE_BILER fra databasen: 422 for_mange_biler; alle andre databasefeil: 502, og feilteksten finnes ikke i svaret eller loggen', async () => {
    let t = await last({ rpc: { data: null, error: { message: 'FOR_MANGE_BILER', code: 'P0001' } } });
    let res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ kode: 'for_mange_biler' });

    const hemmelig = 'password authentication failed for user "postgres" at db.internal:5432 TESTWXYZ000000001';
    t = await last({ rpc: { data: null, error: { message: hemmelig, details: 'detaljer-om-TEST-Forhandler-A', hint: 'hint-123', code: '28P01' } } });
    res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    const tekst = await res.text();
    expect(JSON.parse(tekst)).toEqual({ kode: 'intern_feil' });
    for (const bit of ['password', 'postgres', 'db.internal', 'TESTWXYZ000000001', 'detaljer', 'hint-123']) {
      expect(tekst).not.toContain(bit);
      expect(t.logger.join('\n')).not.toContain(bit);
    }
  });

  it('en manglende funksjon i databasen (PGRST202, ikke kjørt inn ennå) gir 502, og loggen skiller den fra andre feil via sqlstate', async () => {
    const t = await last({ rpc: { data: null, error: { message: 'Could not find the function public.portal_timer_fakta without parameters', code: 'PGRST202' } } });
    const res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ kode: 'intern_feil' });
    expect(JSON.parse(t.logger[0])).toMatchObject({ utfall: 'intern_feil', http: 502, sqlstate: 'PGRST202' });
  });

  it('et tidsavbrudd eller kast fra rpc: 502 intern_feil uten teksten fra feilen', async () => {
    const t = await last({ rpcKaster: new DOMException('Noe kastet https://test.supabase.invalid/rest/v1/rpc/portal_timer_fakta', 'TimeoutError') });
    const res = await t.kall({ headers: medNokkel, body: GYLDIG });
    expect(res.status).toBe(502);
    const tekst = await res.text();
    expect(JSON.parse(tekst)).toEqual({ kode: 'intern_feil' });
    expect(tekst).not.toContain('supabase.invalid');
    expect(t.logger.join('\n')).not.toContain('supabase.invalid');
  });

  it('uventet svarform fra databasen (null, tomt objekt, ukjent versjon, bil med manglende felt, feil type, feil antall): 502 intern_feil', async () => {
    const feilBil = kopi(GULL); delete feilBil.biler[0].minutter_ombygging;
    const feilVersjon = { ...kopi(GULL), versjon: 2 };
    const feilType = kopi(GULL); feilType.biler[0].pagaar = 'nei';
    const feilAntall = { ...kopi(GULL), antall: 5 };
    const feilHentet = kopi(GULL); feilHentet.biler[0].hentet = false;
    for (const data of [null, {}, [], 'tekst', feilVersjon, feilBil, feilType, feilAntall, feilHentet, { ...kopi(GULL), biler: 'x' }]) {
      const t = await last({ rpc: { data, error: null } });
      const res = await t.kall({ headers: medNokkel, body: GYLDIG });
      expect(res.status, JSON.stringify(data)?.slice(0, 50)).toBe(502);
      expect(await res.json()).toEqual({ kode: 'intern_feil' });
    }
  });

  it('logglinjene er JSON uten verdier: ingen merke, modell, timetall eller hemmeligheter (testen søker etter de syntetiske verdiene)', async () => {
    const t = await last();
    await t.kall({ headers: medNokkel, body: GYLDIG });                                        // ok
    await t.kall({ headers: { 'x-salmakern-hent-secret': 'feil-hemmelighet' }, body: GYLDIG }); // uautorisert
    await t.kall({ method: 'GET' });                                                           // metode
    await t.kall({ headers: medNokkel, body: { versjon: 3 } });                                // ugyldig_input
    await t.kall({ headers: medNokkel, body: '{ikke json KIA EV9' });                          // ugyldig_json
    const feilt = await last({ rpc: { data: null, error: { message: 'FOR_MANGE_BILER KIA EV9', code: 'P0001' } } });
    await feilt.kall({ headers: medNokkel, body: GYLDIG });                                    // for_mange_biler
    const ukjent = await last({ rpc: { data: { ...kopi(GULL), versjon: 2 }, error: null } });
    await ukjent.kall({ headers: medNokkel, body: GYLDIG });                                   // uventet_svar
    const alle = [...t.logger, ...feilt.logger, ...ukjent.logger];
    expect(t.logger).toHaveLength(5);
    const objekter = alle.map((l) => JSON.parse(l));
    for (const o of objekter) {
      expect(o.portal_timer_fakta).toBe(1);
      expect(o.fn).toBe('portal-timer-fakta');
      expect(typeof o.utfall).toBe('string');
      expect(typeof o.ms).toBe('number');
    }
    expect(objekter.map((o) => o.utfall)).toEqual(['ok', 'uautorisert', 'metode', 'ugyldig_input', 'ugyldig_json', 'for_mange_biler', 'uventet_svar']);
    // Suksesslinjen har tall: http og antall_biler.
    expect(objekter[0]).toMatchObject({ utfall: 'ok', http: 200, antall_biler: 4 });
    const tekst = alle.join('\n');
    for (const verdi of ['KIA', 'EV9', 'Mercedes', 'Geländewagen', 'Toyota', 'Land Cruiser', 'klar_henting', '540', '410', HEMMELIGHET, TJENESTE_NOKKEL, 'feil-hemmelighet', 'test.supabase.invalid']) {
      expect(tekst, verdi).not.toContain(verdi);
    }
  });

  // ---------------------------------------------------------------- V6: bare svarer
  it('kildeteksten til index.ts har INGEN skrivende kall, ingen utgående nettverkskall og ingen push/e-post', () => {
    for (const forbudt of ['.from(', '.insert(', '.update(', '.delete(', '.upsert(', 'fetch(', 'send-push', 'web-push', 'resend', 'SALMAKERN_STATUS_SECRET']) {
      expect(kilde.toLowerCase().includes(forbudt.toLowerCase()), `index.ts inneholder «${forbudt}»`).toBe(false);
    }
    // Andre hemmeligheter enn den ene finnes ikke i filen.
    for (const hemmelighet of ['x-sync-secret', 'x-salmakern-status-secret', 'PORTAL_BESTILLING_SECRET', 'FIKEN_SYNC_SECRET', 'HENT_SELGERE_SERVER_SECRET', 'x-server-secret']) {
      expect(kilde.includes(hemmelighet), `index.ts nevner «${hemmelighet}»`).toBe(false);
    }
    // Det eneste databasekallet er rpc('portal_timer_fakta') (uten argumenter), og bare ett.
    expect([...kilde.matchAll(/\.rpc\(/g)]).toHaveLength(1);
    expect(kilde).toContain(".rpc('portal_timer_fakta')");
    // Bare to importer: databaseklienten og den rene logikken (ingen søsken-funksjoner, ingen push.ts).
    const importer = [...kilde.matchAll(/^import .* from '([^']+)'$/gm)].map((m) => m[1]);
    expect(importer).toEqual(['jsr:@supabase/supabase-js@2', './logikk.ts']);
    expect(kilde).not.toMatch(/import\(/);
    // logikk.ts er ren: ingen importer, ingen Deno-API-er, ingen nettverk.
    const logikkUtenKommentarer = logikkKilde.replace(/\/\/[^\n]*/g, '');
    expect(logikkUtenKommentarer).not.toMatch(/^import /m);
    expect(logikkUtenKommentarer).not.toMatch(/\bDeno\b|\bfetch\b|\bcreateClient\b/);
  });

  it('ingen CORS: kildeteksten setter aldri Access-Control-headere og svarer aldri på OPTIONS', () => {
    expect(kilde.toLowerCase()).not.toContain('access-control');
    expect(kilde).not.toContain('OPTIONS');
  });

  it('under kjøring: bare rpc finnes på klienten (alt annet kaster) og global fetch kalles aldri', async () => {
    const { kall, fetchKall, rpcKall } = await last();
    expect((await kall({ headers: medNokkel, body: GYLDIG })).status).toBe(200);
    expect((await kall({ headers: medNokkel, body: { versjon: 'x' } })).status).toBe(400);
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
    // Riktig navn på hemmelighet og header, og begge trimmes.
    expect(kilde).toContain("Deno.env.get('SALMAKERN_HENT_SECRET')");
    expect(kilde).toContain("req.headers.get('x-salmakern-hent-secret')");
    expect(kilde).toMatch(/\(Deno\.env\.get\('SALMAKERN_HENT_SECRET'\) \?\? ''\)\.trim\(\)/);
    expect(kilde).toMatch(/\(req\.headers\.get\('x-salmakern-hent-secret'\) \?\? ''\)\.trim\(\)/);
    expect(kilde).toContain('MIN_HEMMELIGHET_LENGDE = 32');
  });

  it('hemmeligheten er det første som sjekkes etter metoden: INGEN lesing av body eller miljø før den (kildetekstens rekkefølge)', () => {
    const iMetode = kilde.indexOf("req.method !== 'POST'");
    const iHemmelighet = kilde.indexOf("Deno.env.get('SALMAKERN_HENT_SECRET')");
    const iBody = kilde.indexOf('req.text()');
    const iSupabaseUrl = kilde.indexOf("Deno.env.get('SUPABASE_URL')");
    const iRpc = kilde.indexOf('.rpc(');
    expect(iMetode).toBeGreaterThan(0);
    expect(iHemmelighet).toBeGreaterThan(iMetode);
    expect(iBody).toBeGreaterThan(iHemmelighet);
    expect(iSupabaseUrl).toBeGreaterThan(iBody);
    expect(iRpc).toBeGreaterThan(iSupabaseUrl);
    expect(kilde.indexOf('req.headers.get(\'content-length\')')).toBeGreaterThan(iHemmelighet);
  });

  it('en hemmelighet som bare avviker i siste tegn, eller har samme lengde, avvises; den riktige slippes gjennom', async () => {
    const { kall } = await last();
    const sisteFeil = HEMMELIGHET.slice(0, -1) + (HEMMELIGHET.endsWith('a') ? 'b' : 'a');
    expect((await kall({ headers: { 'x-salmakern-hent-secret': sisteFeil }, body: GYLDIG })).status).toBe(401);
    expect((await kall({ headers: { 'x-salmakern-hent-secret': 'y'.repeat(HEMMELIGHET.length) }, body: GYLDIG })).status).toBe(401);
    expect((await kall({ headers: medNokkel, body: GYLDIG })).status).toBe(200);
  });
});
