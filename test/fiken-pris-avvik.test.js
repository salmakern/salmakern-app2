// Pris-avvik-sjekken i fiken-oppdater-pris (s04-005, 2026-10-31): hindrer at en skrivefeil i
// produktnummer (eller en pris endret direkte i Fiken siden sist) fører til at feil pris
// skrives over i Fiken uten varsel. Funksjonen kjører i Deno og kan ikke lastes direkte her,
// så testen trekker ut selve funksjonen (samme teknikk som edge-auth-gate.test.js: skriver
// blokken til en midlertidig .ts-fil, Vite fjerner typene) og kjører den isolert. Hele
// endepunktets oppførsel (404/409/200-grenene) er ikke testet her - det krever en ekte eller
// mocket Fiken-respons; denne testen dekker bare selve sammenligningen.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(
  path.resolve(__dirname, '../supabase/functions/fiken-oppdater-pris/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');
const blokk = kilde.match(/\/\/ ── PRIS-AVVIK-SJEKK BEGIN[\s\S]*?\/\/ ── PRIS-AVVIK-SJEKK END ──/)?.[0];

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

async function lastErPrisAvvik() {
  expect(blokk).toBeTruthy();
  const fil = path.resolve(__dirname, `_pris_avvik_tmp_${Math.random().toString(36).slice(2)}.ts`);
  tmpFiler.push(fil);
  writeFileSync(fil, `${blokk}\nexport { erPrisAvvik }\n`);
  const mod = await import(/* @vite-ignore */ pathToFileURL(fil).href);
  return mod.erPrisAvvik;
}

describe('fiken-oppdater-pris: pris-avvik-sjekk', () => {
  it('samme pris er aldri avvik', async () => {
    const erPrisAvvik = await lastErPrisAvvik();
    expect(erPrisAvvik(10000, 10000)).toBe(false);
    expect(erPrisAvvik(0, 0)).toBe(false);
  });

  it('flyttallsstøy på under 1 øre er ikke avvik', async () => {
    const erPrisAvvik = await lastErPrisAvvik();
    expect(erPrisAvvik(10000, 10000 + 0.001)).toBe(false);
    expect(erPrisAvvik(299.99999999, 300)).toBe(false);
  });

  it('en ekte forskjell er avvik, uansett retning', async () => {
    const erPrisAvvik = await lastErPrisAvvik();
    expect(erPrisAvvik(10000, 10500)).toBe(true);
    expect(erPrisAvvik(10500, 10000)).toBe(true);
    expect(erPrisAvvik(1, 0)).toBe(true);
  });

  it('en stor forskjell (typisk feil produkt truffet) er avvik', async () => {
    const erPrisAvvik = await lastErPrisAvvik();
    expect(erPrisAvvik(500, 48650)).toBe(true);
  });
});
