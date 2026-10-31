// Hele fiken-oppdater-pris-handleren (s04-005, 2026-10-31), ikke bare pris-avvik-sjekken
// (se fiken-pris-avvik.test.js for den isolerte sammenligningen). Funksjonen kjører i Deno og
// kan ikke lastes direkte her, og den trenger en ekte FIKEN_SYNC_SECRET og ekte Fiken-kall for
// å teste manuelt - begge utilgjengelige herfra (hemmeligheten kan ikke leses ut igjen når den
// er satt, og et ekte PUT mot Fiken ville endret en reell pris). Denne testen laster derfor
// HELE kildefilen i en isolert modul med falsk Deno.env og falsk fetch (Deno.serve fanges opp
// i stedet for å faktisk starte en server), og dekker nettopp grenene et ekte kall ikke trygt
// kan utforske herfra: avvik blokkerer skriving, bekreftAvvik overstyrer, og gamle kall uten
// forventetGammelPrisKr er helt uendret.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(
  path.resolve(__dirname, '../supabase/functions/fiken-oppdater-pris/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const PRODUKT_500 = {
  productId: 4242,
  name: 'Standard ombygging',
  unitPrice: 5150000, // 51 500,00 kr i øre
  incomeAccount: '3010',
  vatType: 'high',
  active: true,
  productNumber: '500',
  note: 'Et eksisterende notat',
};

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

// Laster hele funksjonen med gitt miljø og falske Fiken-svar; gir { kall(req), putKall } -
// putKall samler opp hvert PUT-kall mot Fiken (body inkludert), slik at en test kan bekrefte
// at PUT ALDRI kalles når avviket skal blokkere skrivingen.
async function last(env) {
  const putKall = [];
  globalThis.Deno = { env: { get: (k) => env[k] } };
  let handler;
  globalThis.Deno.serve = (fn) => { handler = fn; };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (b, s = 200, headers = {}) => new Response(JSON.stringify(b), { status: s, headers });
    if (u.includes('/products?') && (!init.method || init.method === 'GET')) {
      return json([PRODUKT_500], 200, { 'Fiken-Api-Page-Count': '1' });
    }
    if (u.includes(`/products/${PRODUKT_500.productId}`) && init.method === 'PUT') {
      putKall.push({ url: u, body: JSON.parse(init.body) });
      return json({ ok: true });
    }
    throw new Error(`Uventet fetch-kall i testen: ${init.method || 'GET'} ${u}`);
  };
  const fil = path.resolve(__dirname, `_fiken_pris_tmp_${Math.random().toString(36).slice(2)}.ts`);
  tmpFiler.push(fil);
  writeFileSync(fil, kilde);
  await import(/* @vite-ignore */ pathToFileURL(fil).href);
  return {
    putKall,
    kall: (body, headers = {}) =>
      handler(new Request('https://x.supabase.co/functions/v1/fiken-oppdater-pris', {
        method: 'POST',
        headers: { 'x-sync-secret': 'HEMMELIG', ...headers },
        body: JSON.stringify(body),
      })),
  };
}

const BASE_ENV = { FIKEN_API_KEY: 'fake-fiken-key', FIKEN_SYNC_SECRET: 'HEMMELIG' };

describe('fiken-oppdater-pris: avvik-sjekk i hele handleren', () => {
  it('uten forventetGammelPrisKr er oppførselen UENDRET - skriver alltid (gamle kallere)', async () => {
    const { kall, putKall } = await last(BASE_ENV);
    const res = await kall({ productNumber: '500', unitPriceKr: 52000 });
    expect(res.status).toBe(200);
    const svar = await res.json();
    expect(svar).toMatchObject({ synced: true, productNumber: '500', unitPriceKr: 52000 });
    expect(putKall).toHaveLength(1);
    expect(putKall[0].body.unitPrice).toBe(5200000);
    expect(putKall[0].body.note).toBe(PRODUKT_500.note); // s04-004: notatet skal aldri forsvinne
  });

  it('forventetGammelPrisKr som stemmer med Fiken: skriver som normalt', async () => {
    const { kall, putKall } = await last(BASE_ENV);
    const res = await kall({ productNumber: '500', unitPriceKr: 52000, forventetGammelPrisKr: 51500 });
    expect(res.status).toBe(200);
    expect((await res.json()).synced).toBe(true);
    expect(putKall).toHaveLength(1);
  });

  it('avvik uten bekreftAvvik: blokkerer og skriver INGENTING', async () => {
    const { kall, putKall } = await last(BASE_ENV);
    const res = await kall({ productNumber: '500', unitPriceKr: 52000, forventetGammelPrisKr: 500 });
    expect(res.status).toBe(409);
    const svar = await res.json();
    expect(svar).toMatchObject({
      synced: false, avvik: true, productNumber: '500',
      faktiskGammelPrisKr: 51500, forventetGammelPrisKr: 500, nyPrisKr: 52000,
    });
    expect(putKall).toHaveLength(0);
  });

  it('avvik MED bekreftAvvik:true: overstyrer og skriver likevel', async () => {
    const { kall, putKall } = await last(BASE_ENV);
    const res = await kall({ productNumber: '500', unitPriceKr: 52000, forventetGammelPrisKr: 500, bekreftAvvik: true });
    expect(res.status).toBe(200);
    expect((await res.json()).synced).toBe(true);
    expect(putKall).toHaveLength(1);
    expect(putKall[0].body.unitPrice).toBe(5200000);
  });

  it('1 øre avrundingsstøy i forventetGammelPrisKr blokkerer ikke (ekte avvik vs. støy, se fiken-pris-avvik.test.js)', async () => {
    const { kall, putKall } = await last(BASE_ENV);
    const res = await kall({ productNumber: '500', unitPriceKr: 52000, forventetGammelPrisKr: 51500.001 });
    expect(res.status).toBe(200);
    expect(putKall).toHaveLength(1);
  });

  it('ukjent produktnummer gir fortsatt 404, uavhengig av forventetGammelPrisKr', async () => {
    const { kall, putKall } = await last(BASE_ENV);
    const res = await kall({ productNumber: '999999', unitPriceKr: 100, forventetGammelPrisKr: 100 });
    expect(res.status).toBe(404);
    expect(putKall).toHaveLength(0);
  });

  it('feil x-sync-secret avvises før avvik-sjekken i det hele tatt kjører', async () => {
    const { kall, putKall } = await last(BASE_ENV);
    const res = await kall({ productNumber: '500', unitPriceKr: 1, forventetGammelPrisKr: 1 }, { 'x-sync-secret': 'FEIL' });
    expect(res.status).toBe(401);
    expect(putKall).toHaveLength(0);
  });
});
