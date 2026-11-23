// Edge-funksjonen portal-oppskrift (trinn 1 av «Én produktliste»): portalen leser lagervarer/oppskrift og lagrer delene for en variant/et tillegg.
//  1) logikk.ts lastes direkte (parse, rpc-argumenter, svaravgrensning, feilkoder).
//  2) index.ts kjøres mot falsk Deno og en falsk klient som BARE har rpc (samme teknikk som portal-timer-fakta.test.js).
// Postgres-funksjonene har egen test: supabase/tester/portal_oppskrift_TEST_body.sql (rulles tilbake). Alle verdier er syntetiske (TEST).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseForesporsel, rpcFor, mapHent, mapLagre, mapFeil, gyldigAntall, MAKS_BODY_BYTES, DELER_MAKS } from '../supabase/functions/portal-oppskrift/logikk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJON = path.resolve(__dirname, '../supabase/functions/portal-oppskrift');
const kilde = readFileSync(path.join(FUNKSJON, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const logikkKilde = readFileSync(path.join(FUNKSJON, 'logikk.ts'), 'utf8').replace(/\r\n/g, '\n');
const kopi = (x) => JSON.parse(JSON.stringify(x));

const LAGRE = {
  versjon: 1, handling: 'lagre', variantId: 'v_TEST', produktnummer: 'TEST901', navn: 'TEST - Skuffesystem', prisgruppe: 'EKSTRAUTSTYR',
  modellSlug: 'kia-ev9', modellNavn: 'KIA EV9', deler: [{ vareId: 'vare_TEST_a', antall: 4 }, { vareId: 'vare_TEST_b', antall: 0.5 }],
};
const HENT_DATA = {
  varer: [{ id: 'vare_TEST_a', navn: 'TEST - Skuffeskinne', enhet: 'stk', antall: 10, modell: 'EV9', kategori: 'Skuffer' }],
  oppskrift: { id: 'oppskrift_TEST', navn: 'TEST - Skuffesystem', biltype: 'EV9', type: 'ekstra_utstyr', ingredienser: [{ vareId: 'vare_TEST_a', antall: 4 }], koblet: true },
  flere: 0,
};

describe('parseForesporsel', () => {
  it('gyldig lagre gir alle felt, og ukjente felt kastes', () => {
    const r = parseForesporsel({ ...LAGRE, hemmelig: 'x' });
    expect(r.ok).toBe(true);
    expect(r.input).toEqual({ handling: 'lagre', variantId: 'v_TEST', tilleggId: null, produktnummer: 'TEST901', navn: 'TEST - Skuffesystem', prisgruppe: 'EKSTRAUTSTYR', modellSlug: 'kia-ev9', modellNavn: 'KIA EV9', deler: LAGRE.deler });
    expect(JSON.stringify(r)).not.toContain('hemmelig');
  });
  it('hent tar valgfri id og nummer; uten noe gir bare varene', () => {
    expect(parseForesporsel({ versjon: 1, handling: 'hent' })).toEqual({ ok: true, input: { handling: 'hent', variantId: null, tilleggId: null, produktnummer: null } });
    expect(parseForesporsel({ versjon: 1, handling: 'hent', tilleggId: ' t_1 ', produktnummer: '502' }).input).toMatchObject({ tilleggId: 't_1', produktnummer: '502' });
  });
  it('versjon, handling og kropp må stemme', () => {
    expect(parseForesporsel([])).toEqual({ ok: false, felt: 'body' });
    expect(parseForesporsel({ ...LAGRE, versjon: '1' })).toEqual({ ok: false, felt: 'versjon' });
    expect(parseForesporsel({ ...LAGRE, handling: 'slett' })).toEqual({ ok: false, felt: 'handling' });
  });
  it('nøyaktig én av variantId/tilleggId ved lagring', () => {
    const { variantId: _v, ...uten } = LAGRE;
    expect(parseForesporsel(uten)).toEqual({ ok: false, felt: 'id' });
    expect(parseForesporsel({ ...LAGRE, tilleggId: 't_1' })).toEqual({ ok: false, felt: 'id' });
    expect(parseForesporsel({ ...uten, tilleggId: 't_1' }).ok).toBe(true);
    expect(parseForesporsel({ ...LAGRE, variantId: 'x'.repeat(65) })).toEqual({ ok: false, felt: 'id' });
  });
  it('produktnummer uten mellomrom/komma, navn, prisgruppe og modellnavn påkrevd', () => {
    for (const nr of ['', '500, 502', '500 502', '500;502', 'x'.repeat(21), 500]) expect(parseForesporsel({ ...LAGRE, produktnummer: nr }), String(nr)).toEqual({ ok: false, felt: 'produktnummer' });
    expect(parseForesporsel({ ...LAGRE, navn: '  ' })).toEqual({ ok: false, felt: 'navn' });
    expect(parseForesporsel({ ...LAGRE, prisgruppe: 'standard' })).toEqual({ ok: false, felt: 'prisgruppe' });
    expect(parseForesporsel({ ...LAGRE, modellNavn: '' })).toEqual({ ok: false, felt: 'modellNavn' });
    expect(parseForesporsel({ ...LAGRE, modellSlug: null }).ok).toBe(true);
  });
  it('PERSONBIL (priskategori, 2026-11-23) er en gyldig prisgruppe', () => {
    expect(parseForesporsel({ ...LAGRE, prisgruppe: 'PERSONBIL' })).toMatchObject({ ok: true, input: { prisgruppe: 'PERSONBIL' } });
  });
  it('deler: liste, høyst 100, gyldig antall og ingen vare to ganger', () => {
    const bad = [
      'x', [{ vareId: 'a' }], [{ vareId: 'a', antall: 0 }], [{ vareId: 'a', antall: -1 }], [{ vareId: 'a', antall: '2' }], [{ vareId: 'a', antall: 10001 }],
      [{ vareId: 'a', antall: 1.0001 }], [{ vareId: '', antall: 1 }], [{ vareId: 'a', antall: 1 }, { vareId: 'a', antall: 2 }], [{ vareId: 'a', antall: Infinity }],
      Array.from({ length: DELER_MAKS + 1 }, (_, i) => ({ vareId: 'v' + i, antall: 1 })),
    ];
    for (const deler of bad) expect(parseForesporsel({ ...LAGRE, deler }), JSON.stringify(deler).slice(0, 60)).toEqual({ ok: false, felt: 'deler' });
    expect(parseForesporsel({ ...LAGRE, deler: [] }).ok).toBe(true);
    expect(parseForesporsel({ ...LAGRE, deler: [{ vareId: 'a', antall: 1.125 }] }).ok).toBe(true);
  });
  it('gyldigAntall', () => {
    expect([1, 0.5, 0.001, 10000].every(gyldigAntall)).toBe(true);
    expect([0, -1, 10000.5, NaN, '1', null].some(gyldigAntall)).toBe(false);
  });
});

describe('rpcFor', () => {
  it('hent og lagre gir nøyaktig argumentnavnene i migrasjonen', () => {
    expect(rpcFor(parseForesporsel({ versjon: 1, handling: 'hent', variantId: 'v' }).input)).toEqual({ navn: 'portal_oppskrift_hent', args: { p_variant_id: 'v', p_tillegg_id: null, p_produktnummer: null } });
    const r = rpcFor(parseForesporsel(LAGRE).input);
    expect(r.navn).toBe('portal_oppskrift_lagre');
    expect(Object.keys(r.args)).toEqual(['p']);
    expect(r.args.p).not.toHaveProperty('handling');
    expect(r.args.p).toMatchObject({ variantId: 'v_TEST', tilleggId: null, produktnummer: 'TEST901', deler: LAGRE.deler });
    const sql = readFileSync(path.resolve(__dirname, '../supabase/migrations/20261117200000_portal_oppskrift.sql'), 'utf8');
    for (const n of ['variantId', 'tilleggId', 'produktnummer', 'navn', 'prisgruppe', 'modellSlug', 'modellNavn', 'deler']) expect(sql).toContain(`p->>'${n}'`.replace("p->>'deler'", "p->'deler'"));
  });
});

describe('mapHent / mapLagre / mapFeil', () => {
  it('mapHent avgrenser til kjente felt', () => {
    const inn = kopi(HENT_DATA);
    inn.varer[0].kostpris = 123; inn.oppskrift.hemmelig = 'x'; inn.ekstra = 1;
    const r = mapHent(inn);
    expect(r).toEqual({ versjon: 1, varer: [{ id: 'vare_TEST_a', navn: 'TEST - Skuffeskinne', enhet: 'stk', antall: 10, modell: 'EV9', kategori: 'Skuffer' }],
      oppskrift: { id: 'oppskrift_TEST', navn: 'TEST - Skuffesystem', type: 'ekstra_utstyr', ingredienser: [{ vareId: 'vare_TEST_a', antall: 4 }], koblet: true, utelatteDeler: 0 }, flere: 0 });
    expect(JSON.stringify(r)).not.toMatch(/kostpris|hemmelig|"ekstra"/);
  });
  it('mapHent teller deler med rar form i stedet for å skjule dem', () => {
    const inn = kopi(HENT_DATA);
    inn.oppskrift.ingredienser = [{ vareId: 'a', antall: '2,5' }, { vareId: 'b' }, { antall: 1 }, 'x', { vareId: 'a', antall: 1 }];
    const r = mapHent(inn);
    expect(r.oppskrift.ingredienser).toEqual([{ vareId: 'a', antall: 2.5 }]);
    expect(r.oppskrift.utelatteDeler).toBe(4);
  });
  it('mapHent: ingen oppskrift og flere-tall; feil form gir null', () => {
    expect(mapHent({ varer: [], oppskrift: null, flere: 2 })).toEqual({ versjon: 1, varer: [], oppskrift: null, flere: 2 });
    expect(mapHent(null)).toBeNull();
    expect(mapHent({ varer: 'x' })).toBeNull();
    expect(mapHent({ varer: [{ id: 'a', antall: 'mange' }] })).toBeNull();
    expect(mapHent({ varer: [], oppskrift: { id: 'x' } })).toBeNull();
  });
  it('mapLagre', () => {
    expect(mapLagre({ status: 'opprettet', oppskriftId: 'o1', antallDeler: 2, biltypeFraKobling: true, ekstra: 1 })).toEqual({ versjon: 1, status: 'opprettet', oppskriftId: 'o1', antallDeler: 2, biltypeFraKobling: true });
    expect(mapLagre({ status: 'ingen_deler', oppskriftId: null, antallDeler: 0 })).toMatchObject({ status: 'ingen_deler', oppskriftId: null, biltypeFraKobling: false });
    expect(mapLagre({ status: 'opprettet', oppskriftId: null, antallDeler: 1 })).toBeNull();
    expect(mapLagre({ status: 'slettet', oppskriftId: 'o', antallDeler: 1 })).toBeNull();
    expect(mapLagre({ status: 'oppdatert', oppskriftId: 'o', antallDeler: -1 })).toBeNull();
  });
  it('mapFeil slipper bare egne koder gjennom', () => {
    expect(mapFeil({ message: 'UGYLDIG_INPUT:deler' })).toEqual({ status: 400, kode: 'ugyldig_input', felt: 'deler' });
    expect(mapFeil({ message: 'UKJENT_VARE' })).toEqual({ status: 422, kode: 'ukjent_vare' });
    expect(mapFeil({ message: 'FLERE_OPPSKRIFTER' })).toEqual({ status: 409, kode: 'flere_oppskrifter' });
    expect(mapFeil({ message: 'SAMTIDIG_LAGRING' })).toEqual({ status: 409, kode: 'samtidig_lagring' });
    expect(mapFeil({ message: 'duplicate key value violates unique constraint "x" detail: (navn)=(hemmelig)' })).toEqual({ status: 502, kode: 'intern_feil' });
    expect(mapFeil({ message: 'UGYLDIG_INPUT:<script>' })).toEqual({ status: 502, kode: 'intern_feil' });
    expect(mapFeil(null)).toEqual({ status: 502, kode: 'intern_feil' });
  });
  it('logikk.ts er ren (ingen Deno, fetch eller databaseklient)', () => {
    const utenKommentarer = logikkKilde.replace(/\/\/.*$/gm, '');
    expect(utenKommentarer).not.toMatch(/\bDeno\b|\bfetch\b|\bcreateClient\b|^import /m);
  });
});

describe('index.ts mot falsk Deno og falsk klient', () => {
  const HEMMELIGHET = 'test-oppskrift-hemmelighet-aaaaaaaaaaaaaaaaaaaaaa';
  const tmpFiler = [];
  const fetchOrig = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = fetchOrig;
    while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* borte */ } }
  });

  async function last({ env = {}, rpc = { data: kopi(HENT_DATA), error: null } } = {}) {
    const fullEnv = { SALMAKERN_OPPSKRIFT_SECRET: HEMMELIGHET, SALMAKERN_HENT_SECRET: 'hent-hemmelighet-cccccccccccccccccccccccccccccc', SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'tjeneste-nokkel-test', ...env };
    const rpcKall = []; const fetchKall = []; const logger = [];
    let handler = null;
    globalThis.Deno = { env: { get: (k) => fullEnv[k] }, serve: (h) => { handler = h; } };
    globalThis.fetch = (...a) => { fetchKall.push(a); throw new Error('fetch skal aldri kalles'); };
    globalThis.__fakeCreateClient = () => {
      const klient = { rpc: (navn, args) => { rpcKall.push({ navn, args }); return { abortSignal: () => Promise.resolve(typeof rpc === 'function' ? rpc(navn, args) : rpc) }; } };
      return new Proxy(klient, { get: (t, k) => { if (k in t) return t[k]; throw new Error('Uventet bruk av databaseklienten: ' + String(k)); } });
    };
    const importLinje = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
    const logikkLinje = "import { MAKS_BODY_BYTES, mapFeil, mapHent, mapLagre, parseForesporsel, rpcFor } from './logikk.ts'";
    if (!kilde.includes(importLinje) || !kilde.includes(logikkLinje)) throw new Error('fant ikke importlinjene i index.ts - oppdater testen');
    const kode = kilde.replace(importLinje, 'const createClient = globalThis.__fakeCreateClient')
      .replace(logikkLinje, logikkLinje.replace("'./logikk.ts'", JSON.stringify(pathToFileURL(path.join(FUNKSJON, 'logikk.ts')).href)));
    const fil = path.resolve(__dirname, `_pop_tmp_${Math.random().toString(36).slice(2)}.ts`);
    tmpFiler.push(fil); writeFileSync(fil, kode);
    await import(/* @vite-ignore */ pathToFileURL(fil).href);
    const kall = async ({ body, headers = {}, method = 'POST' } = {}) => {
      const logOrig = console.log; console.log = (...a) => { logger.push(a.join(' ')); };
      try {
        return await handler(new Request('https://test.supabase.invalid/functions/v1/portal-oppskrift', {
          method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' && body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        }));
      } finally { console.log = logOrig; }
    };
    return { kall, rpcKall, fetchKall, logger };
  }
  const medNokkel = { 'x-salmakern-oppskrift-secret': HEMMELIGHET };

  it('bare POST', async () => {
    const t = await last();
    const r = await t.kall({ method: 'GET', headers: medNokkel });
    expect(r.status).toBe(405);
    expect(t.rpcKall).toHaveLength(0);
  });
  it('uten, med feil eller med HENT-hemmeligheten: 401 og ingen database', async () => {
    const t = await last();
    for (const headers of [{}, { 'x-salmakern-oppskrift-secret': 'feil' }, { 'x-salmakern-hent-secret': 'hent-hemmelighet-cccccccccccccccccccccccccccccc' }, { 'x-salmakern-oppskrift-secret': 'hent-hemmelighet-cccccccccccccccccccccccccccccc' }]) {
      const r = await t.kall({ body: LAGRE, headers });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ kode: 'uautorisert' });
    }
    expect(t.rpcKall).toHaveLength(0);
  });
  it('hemmelighet som mangler eller er for kort: 500 (aldri åpen)', async () => {
    for (const s of [undefined, '', 'kort']) {
      const t = await last({ env: { SALMAKERN_OPPSKRIFT_SECRET: s } });
      const r = await t.kall({ body: LAGRE, headers: { 'x-salmakern-oppskrift-secret': s ?? '' } });
      expect(r.status).toBe(500);
      expect(t.rpcKall).toHaveLength(0);
    }
  });
  it('hemmeligheten trimmes på begge sider', async () => {
    const t = await last({ env: { SALMAKERN_OPPSKRIFT_SECRET: HEMMELIGHET + '\n' } });
    const r = await t.kall({ body: { versjon: 1, handling: 'hent' }, headers: { 'x-salmakern-oppskrift-secret': ' ' + HEMMELIGHET } });
    expect(r.status).toBe(200);
  });
  it('for stor kropp og ugyldig JSON/input gir 413/400 uten database', async () => {
    const t = await last();
    expect((await t.kall({ body: 'x'.repeat(MAKS_BODY_BYTES + 1), headers: medNokkel })).status).toBe(413);
    expect((await t.kall({ body: '{ikke json', headers: medNokkel })).status).toBe(400);
    const r = await t.kall({ body: { ...LAGRE, deler: 'x' }, headers: medNokkel });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ kode: 'ugyldig_input', felt: 'deler' });
    expect(t.rpcKall).toHaveLength(0);
  });
  it('hent: én rpc, avgrenset svar, logg uten verdier', async () => {
    const t = await last();
    const r = await t.kall({ body: { versjon: 1, handling: 'hent', variantId: 'v_TEST', produktnummer: 'TEST901' }, headers: medNokkel });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.oppskrift.id).toBe('oppskrift_TEST');
    expect(t.rpcKall).toEqual([{ navn: 'portal_oppskrift_hent', args: { p_variant_id: 'v_TEST', p_tillegg_id: null, p_produktnummer: 'TEST901' } }]);
    expect(t.logger.join('\n')).not.toMatch(/TEST|Skuff|v_TEST|hemmelighet/);
    expect(t.fetchKall).toHaveLength(0);
  });
  it('lagre: én rpc med p, og svaret', async () => {
    const t = await last({ rpc: { data: { status: 'opprettet', oppskriftId: 'oppskrift_TEST', antallDeler: 2, biltypeFraKobling: true }, error: null } });
    const r = await t.kall({ body: LAGRE, headers: medNokkel });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ versjon: 1, status: 'opprettet', oppskriftId: 'oppskrift_TEST', antallDeler: 2, biltypeFraKobling: true });
    expect(t.rpcKall[0].navn).toBe('portal_oppskrift_lagre');
    expect(t.rpcKall[0].args.p.deler).toEqual(LAGRE.deler);
  });
  it('databasefeil blir faste koder, aldri databasetekst', async () => {
    const cases = [
      [{ message: 'FLERE_OPPSKRIFTER', code: 'P0001' }, 409, { kode: 'flere_oppskrifter' }],
      [{ message: 'UKJENT_VARE', code: 'P0001' }, 422, { kode: 'ukjent_vare' }],
      [{ message: 'UGYLDIG_INPUT:navn', code: 'P0001' }, 400, { kode: 'ugyldig_input', felt: 'navn' }],
      [{ message: 'relation "lager_oppskrifter" hemmelig detalj', code: '42P01' }, 502, { kode: 'intern_feil' }],
    ];
    for (const [error, status, body] of cases) {
      const t = await last({ rpc: { data: null, error } });
      const r = await t.kall({ body: LAGRE, headers: medNokkel });
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual(body);
    }
  });
  it('svar med feil form gir 502', async () => {
    const t = await last({ rpc: { data: { status: 'rart' }, error: null } });
    expect((await t.kall({ body: LAGRE, headers: medNokkel })).status).toBe(502);
  });
  it('kildeteksten: bare rpc, ingen fetch/from/Fiken/push', () => {
    const utenKommentarer = kilde.replace(/\/\/.*$/gm, '');
    expect(utenKommentarer).not.toMatch(/\.from\(|fetch\(|fiken|send-push|Access-Control/i);
    expect(utenKommentarer).toContain("Deno.env.get('SALMAKERN_OPPSKRIFT_SECRET')");
    expect(utenKommentarer).not.toContain('SALMAKERN_HENT_SECRET');
  });
});
