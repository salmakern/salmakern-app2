// fiken-endre-produkt (s09-034, 2026-10-31): Henrik fant ekte produktnummer-kollisjoner i Fiken
// (flere produkter med SAMME produktnummer, f.eks. 553 "Oppbevaringskasse standard" til både
// 6600 og 6900 kr). Funksjonen tok tidligere bare siste treff på nummeret uten varsel - denne
// testen dekker den nye expectedUnitPriceKr-disambigueringen (samme "spør i stedet for å anta"-
// prinsipp som fiken-pris-avvik.test.js). Ekte secret/Fiken-skriving er ikke tilgjengelig herfra,
// så hele handleren lastes mot falsk Deno/fetch, samme teknikk som fiken-oppdater-pris.test.js.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(
  path.resolve(__dirname, '../supabase/functions/fiken-endre-produkt/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const OPPBEVARINGSKASSE_GAMMEL = {
  productId: 1001, name: 'Oppbevaringskasse standard', unitPrice: 660000,
  incomeAccount: '3010', vatType: 'high', active: true, productNumber: '553',
};
const OPPBEVARINGSKASSE_NY = {
  productId: 1002, name: 'Oppbevaringskasse standard', unitPrice: 690000,
  incomeAccount: '3010', vatType: 'high', active: true, productNumber: '553',
};
const EV9_OMBYGGING = {
  productId: 500, name: 'Standard ombygging', unitPrice: 5150000,
  incomeAccount: '3010', vatType: 'high', active: true, productNumber: '500', note: 'Et notat',
};

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

// produkter: alle Fiken-produkter som skal "finnes" i den falske produktlisten.
// fullt: hva GET /products/{id} svarer per productId (standard: produktet fra listen + stock/costPrice + skrivebeskyttede felt).
async function last(produkter, { fullt = {}, getStatus = 200 } = {}) {
  const putKall = [];
  const getKall = [];
  globalThis.Deno = { env: { get: (k) => ({ FIKEN_API_KEY: 'fake-key', FIKEN_SYNC_SECRET: 'HEMMELIG' }[k]) } };
  let handler;
  globalThis.Deno.serve = (fn) => { handler = fn; };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (b, s = 200, headers = {}) => new Response(JSON.stringify(b), { status: s, headers });
    if (u.includes('/products?') && (!init.method || init.method === 'GET')) {
      return json(produkter, 200, { 'Fiken-Api-Page-Count': '1' });
    }
    const putMatch = u.match(/\/products\/(\d+)$/);
    if (putMatch && (!init.method || init.method === 'GET')) {
      const id = Number(putMatch[1]);
      getKall.push(id);
      if (getStatus !== 200) return new Response('feil', { status: getStatus });
      const fraListe = produkter.find((p) => p.productId === id);
      return json(fullt[id] ?? { ...fraListe, stock: 7, costPrice: 99900, createdDate: '2025-01-01', lastModifiedDate: '2026-11-01', unitPricesInForeignCurrency: [] });
    }
    if (putMatch && init.method === 'PUT') {
      putKall.push({ productId: Number(putMatch[1]), body: JSON.parse(init.body) });
      return json({ ok: true });
    }
    throw new Error(`Uventet fetch-kall i testen: ${init.method || 'GET'} ${u}`);
  };
  const fil = path.resolve(__dirname, `_fiken_endre_tmp_${Math.random().toString(36).slice(2)}.ts`);
  tmpFiler.push(fil);
  writeFileSync(fil, kilde);
  await import(/* @vite-ignore */ pathToFileURL(fil).href);
  return {
    putKall,
    getKall,
    kall: (body) =>
      handler(new Request('https://x.supabase.co/functions/v1/fiken-endre-produkt', {
        method: 'POST',
        headers: { 'x-sync-secret': 'HEMMELIG' },
        body: JSON.stringify(body),
      })),
  };
}

describe('fiken-endre-produkt: uendret oppførsel uten kollisjon', () => {
  it('ett treff: gjør inaktiv uten at expectedUnitPriceKr trengs', async () => {
    const { kall, putKall } = await last([EV9_OMBYGGING]);
    const res = await kall({ productNumber: '500', active: false });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(true);
    expect(putKall).toHaveLength(1);
    expect(putKall[0].productId).toBe(500);
    expect(putKall[0].body.active).toBe(false);
    expect(putKall[0].body.note).toBe('Et notat'); // notatet skal fortsatt bevares
  });

  it('ukjent produktnummer: 404, ingen PUT', async () => {
    const { kall, putKall } = await last([EV9_OMBYGGING]);
    const res = await kall({ productNumber: '999999', active: false });
    expect(res.status).toBe(404);
    expect(putKall).toHaveLength(0);
  });

  it('nytt nummer som allerede finnes: 409, ingen PUT', async () => {
    const { kall, putKall } = await last([EV9_OMBYGGING, OPPBEVARINGSKASSE_GAMMEL]);
    const res = await kall({ productNumber: '500', newProductNumber: '553' });
    expect(res.status).toBe(409);
    expect(putKall).toHaveLength(0);
  });
});

describe('fiken-endre-produkt: kollisjon (flere produkter på samme nummer)', () => {
  it('uten expectedUnitPriceKr: 409, lister begge treffene, ingen PUT', async () => {
    const { kall, putKall } = await last([OPPBEVARINGSKASSE_GAMMEL, OPPBEVARINGSKASSE_NY]);
    const res = await kall({ productNumber: '553', active: false });
    expect(res.status).toBe(409);
    const svar = await res.json();
    expect(svar.updated).toBe(false);
    expect(svar.avvik).toBe(true);
    expect(svar.treff).toHaveLength(2);
    expect(svar.treff.map((t) => t.unitPriceKr).sort()).toEqual([6600, 6900]);
    expect(putKall).toHaveLength(0);
  });

  it('med expectedUnitPriceKr som treffer nøyaktig én: endrer KUN den raden', async () => {
    const { kall, putKall } = await last([OPPBEVARINGSKASSE_GAMMEL, OPPBEVARINGSKASSE_NY]);
    const res = await kall({ productNumber: '553', active: false, expectedUnitPriceKr: 6600 });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(true);
    expect(putKall).toHaveLength(1);
    expect(putKall[0].productId).toBe(1001); // den gamle (6600 kr) - IKKE 1002 (6900 kr)
    expect(putKall[0].body.active).toBe(false);
    expect(putKall[0].body.unitPrice).toBe(660000); // prisen på raden som faktisk endres, uendret
  });

  it('den ANDRE prisen velger den andre raden (sanity-sjekk motsatt vei)', async () => {
    const { kall, putKall } = await last([OPPBEVARINGSKASSE_GAMMEL, OPPBEVARINGSKASSE_NY]);
    const res = await kall({ productNumber: '553', active: false, expectedUnitPriceKr: 6900 });
    expect(res.status).toBe(200);
    expect(putKall[0].productId).toBe(1002);
  });

  it('expectedUnitPriceKr som ikke matcher noen av radene: 409, ingen PUT', async () => {
    const { kall, putKall } = await last([OPPBEVARINGSKASSE_GAMMEL, OPPBEVARINGSKASSE_NY]);
    const res = await kall({ productNumber: '553', active: false, expectedUnitPriceKr: 1234 });
    expect(res.status).toBe(409);
    expect(putKall).toHaveLength(0);
  });

  it('tre rader, to med lik pris: expectedUnitPriceKr som treffer to er fortsatt flertydig, nekter', async () => {
    const duplikat = { ...OPPBEVARINGSKASSE_GAMMEL, productId: 1003 };
    const { kall, putKall } = await last([OPPBEVARINGSKASSE_GAMMEL, duplikat, OPPBEVARINGSKASSE_NY]);
    const res = await kall({ productNumber: '553', active: false, expectedUnitPriceKr: 6600 });
    expect(res.status).toBe(409);
    const svar = await res.json();
    expect(svar.reason).toMatch(/matcher 2 av de 3/);
    expect(putKall).toHaveLength(0);
  });
});

describe('fiken-endre-produkt: sender hele produktet tilbake (stock/costPrice nulles ikke, s00-20261126-2)', () => {
  it('gjør inaktiv: alle felt fra GET følger med uendret, bare active byttes, ingen skrivebeskyttede felt', async () => {
    const { kall, putKall, getKall } = await last([EV9_OMBYGGING]);
    const res = await kall({ productNumber: '500', active: false });
    expect(res.status).toBe(200);
    expect(getKall).toEqual([500]);
    expect(putKall[0].body).toEqual({
      name: 'Standard ombygging', unitPrice: 5150000, incomeAccount: '3010', vatType: 'high',
      active: false, productNumber: '500', note: 'Et notat', stock: 7, costPrice: 99900,
    });
  });

  it('nytt produktnummer: bare productNumber byttes, stock/costPrice uendret', async () => {
    const { kall, putKall } = await last([EV9_OMBYGGING]);
    const res = await kall({ productNumber: '500', newProductNumber: '5000' });
    expect(res.status).toBe(200);
    expect(putKall[0].body.productNumber).toBe('5000');
    expect(putKall[0].body.active).toBe(true);
    expect(putKall[0].body.stock).toBe(7);
    expect(putKall[0].body.costPrice).toBe(99900);
  });

  it('kollisjon løst med expectedUnitPriceKr: henter og skriver bare den valgte raden, med dens egne stock/costPrice', async () => {
    const { kall, putKall, getKall } = await last([OPPBEVARINGSKASSE_GAMMEL, OPPBEVARINGSKASSE_NY], {
      fullt: { 1002: { ...OPPBEVARINGSKASSE_NY, stock: 2, costPrice: 400000 } },
    });
    const res = await kall({ productNumber: '553', active: false, expectedUnitPriceKr: 6900 });
    expect(res.status).toBe(200);
    expect(getKall).toEqual([1002]);
    expect(putKall[0].productId).toBe(1002);
    expect(putKall[0].body).toMatchObject({ stock: 2, costPrice: 400000, unitPrice: 690000, active: false });
  });

  it('GET /products/{id} feiler: 502 og INGEN PUT', async () => {
    const { kall, putKall } = await last([EV9_OMBYGGING], { getStatus: 404 });
    const res = await kall({ productNumber: '500', active: false });
    expect(res.status).toBe(502);
    expect(putKall).toHaveLength(0);
  });

  it('prisen er endret mellom listen og GET (kan være feil rad ved kollisjon): 409 og INGEN PUT', async () => {
    const { kall, putKall } = await last([EV9_OMBYGGING], { fullt: { 500: { ...EV9_OMBYGGING, unitPrice: 1 } } });
    const res = await kall({ productNumber: '500', active: false });
    expect(res.status).toBe(409);
    expect(putKall).toHaveLength(0);
  });
});
