// s00-20261126-2 (26.11): fiken-oppdater-pris og fiken-endre-produkt sendte bare et utvalg felt i PUT /products/{id}, og Fikens PUT
// erstatter HELE produktet, så stock og costPrice ble nullet. Begge har nå samme FULL-PUT-blokk (GET først, alt tilbake unntatt de
// skrivebeskyttede feltene). Denne testen vokter at blokken er byte-lik i de to funksjonene.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = (fn) => readFileSync(path.resolve(__dirname, `../supabase/functions/${fn}/index.ts`), 'utf8').replace(/\r\n/g, '\n');
const blokk = (src) => src.match(/\/\/ ── FULL-PUT BEGIN[\s\S]*?\/\/ ── FULL-PUT END ──/)?.[0] ?? null;

describe('FULL-PUT-blokken', () => {
  it('er byte-lik i fiken-oppdater-pris og fiken-endre-produkt', () => {
    const a = blokk(kilde('fiken-oppdater-pris'));
    const b = blokk(kilde('fiken-endre-produkt'));
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('ingen av de to bygger lenger PUT-innholdet felt for felt (det var det som nullet stock/costPrice)', () => {
    for (const fn of ['fiken-oppdater-pris', 'fiken-endre-produkt']) {
      const src = kilde(fn);
      expect(src).toMatch(/byggPutBody\(fullt,/);
      expect(src).not.toMatch(/incomeAccount: found\.incomeAccount/);
    }
  });
});
