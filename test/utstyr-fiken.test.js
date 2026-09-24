import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Dekker toggleUtstyrPunkt() sine modell-spesifikke kryss-huke -> Fiken-fakturering-
// koblinger i js/ansatte-utstyr.js (KIA EV9 og Mercedes-Benz Geländewagen). Disse rører
// ekte fakturagrunnlag (fikenLinjer), så de faller innenfor "penger er involvert"-
// prioriteringen testdekningen ellers er bevisst smal om (se prosjektets CLAUDE.md).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kode = readFileSync(path.resolve(__dirname, '../js/ansatte-utstyr.js'), 'utf8');

function nyEnvironment() {
  const fikenLinjeKall = [];
  const skalHaKall = [];
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    document: { addEventListener() {}, getElementById() { return null; } },
    window: { addEventListener() {} },
    S: { ordrer: [], kontakter: [] },
    db: null, me: null,
    esc: s => s,
    save() {},
    saveInnstillinger() {},
    oppdaterSkalHaForOppskrift(navn, skalStaa) { skalHaKall.push({ navn, skalStaa }); },
    oppdaterFikenLinjeForOppskrift(produktnummer, skalStaa) { fikenLinjeKall.push({ produktnummer, skalStaa }); },
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox, { filename: 'ansatte-utstyr.js' });
  return { env: sandbox, fikenLinjeKall, skalHaKall };
}

describe('toggleUtstyrPunkt - KIA EV9 (regresjon for panorama/4-seter bak 180)', () => {
  let env, o, fikenLinjeKall, skalHaKall;
  beforeEach(() => {
    ({ env, fikenLinjeKall, skalHaKall } = nyEnvironment());
    o = {
      id: 'ord_1', merke: 'KIA', modell: 'EV9',
      utstyrSjekkliste: [
        { punkt: 'Panorama glasstak', ok: false },
        { punkt: '4-seter bak 180', ok: false },
        { punkt: 'Airbag', ok: false },
      ],
    };
    env.S.ordrer = [o];
  });

  it('panorama: legger til 501 og "ikke 501" BÅDE i skal ha OG fiken', () => {
    env.toggleUtstyrPunkt('ord_1', 0);
    expect(o.utstyrSjekkliste[0].ok).toBe(true);
    expect(skalHaKall).toContainEqual({ navn: '501', skalStaa: true });
    expect(skalHaKall).toContainEqual({ navn: 'ikke 501', skalStaa: false });
    expect(fikenLinjeKall).toContainEqual({ produktnummer: '501', skalStaa: true });
  });

  it('4-seter bak 180: legger KUN til 502 i fiken, ikke i skal ha', () => {
    env.toggleUtstyrPunkt('ord_1', 1);
    expect(o.utstyrSjekkliste[1].ok).toBe(true);
    expect(fikenLinjeKall).toContainEqual({ produktnummer: '502', skalStaa: true });
    expect(skalHaKall.some(k => k.navn === '502')).toBe(false);
  });

  it('punkter uten kjent kobling (Airbag) rører verken skal ha eller fiken', () => {
    env.toggleUtstyrPunkt('ord_1', 2);
    expect(fikenLinjeKall.length).toBe(0);
    expect(skalHaKall.length).toBe(0);
  });
});

describe('toggleUtstyrPunkt - Mercedes-Benz Geländewagen', () => {
  let env, o, fikenLinjeKall, skalHaKall;
  beforeEach(() => {
    ({ env, fikenLinjeKall, skalHaKall } = nyEnvironment());
    o = {
      id: 'ord_1', merke: 'Mercedes-Benz', modell: 'Geländewagen',
      utstyrSjekkliste: [
        { punkt: 'Takluke', ok: false },
        { punkt: 'Airbag 2. seterad', ok: false },
        { punkt: 'DVD - skjermer', ok: false },
        { punkt: 'Taktrekk i skinn', ok: false },
        { punkt: 'Rollon', ok: false },
      ],
    };
    env.S.ordrer = [o];
  });

  it.each([
    ['Takluke', '306'],
    ['Airbag 2. seterad', '302'],
    ['DVD - skjermer', '308'],
    ['Taktrekk i skinn', '309'],
  ])('%s -> produktnummer %s i fiken, huk av og fjern igjen', (punktTekst, produktnr) => {
    const idx = o.utstyrSjekkliste.findIndex(p => p.punkt === punktTekst);
    env.toggleUtstyrPunkt('ord_1', idx);
    expect(o.utstyrSjekkliste[idx].ok).toBe(true);
    expect(fikenLinjeKall).toContainEqual({ produktnummer: produktnr, skalStaa: true });
    // Ingen av disse fire skal i "Skal ha etter visning" (bekreftet av Henrik 2026-09-24).
    expect(skalHaKall.length).toBe(0);

    env.toggleUtstyrPunkt('ord_1', idx);
    expect(o.utstyrSjekkliste[idx].ok).toBe(false);
    expect(fikenLinjeKall).toContainEqual({ produktnummer: produktnr, skalStaa: false });
  });

  it('punkter uten kjent kobling (Rollon) rører ikke fiken', () => {
    env.toggleUtstyrPunkt('ord_1', 4);
    expect(fikenLinjeKall.length).toBe(0);
  });

  it('samme punkt-tekster på en ANNEN modell (KIA EV9) rører ikke Geländewagen-koblingen', () => {
    o.merke = 'KIA'; o.modell = 'EV9';
    const idx = o.utstyrSjekkliste.findIndex(p => p.punkt === 'Takluke');
    env.toggleUtstyrPunkt('ord_1', idx);
    expect(fikenLinjeKall.some(k => k.produktnummer === '306')).toBe(false);
  });
});

describe('toggleUtstyrPunkt - Mercedes-Benz GLS', () => {
  let env, o, fikenLinjeKall, skalHaKall;
  beforeEach(() => {
    ({ env, fikenLinjeKall, skalHaKall } = nyEnvironment());
    o = {
      id: 'ord_1', merke: 'Mercedes-Benz', modell: 'GLS',
      utstyrSjekkliste: [
        { punkt: 'Klima i taket', ok: false },
        { punkt: 'Airbag', ok: false },
        { punkt: 'Koppholder i midt konsoll', ok: false },
        { punkt: 'Subwoofer', ok: false },
        { punkt: 'DVD-Skjermer', ok: false },
        { punkt: 'Rollon', ok: false },
      ],
    };
    env.S.ordrer = [o];
  });

  it.each([
    ['Klima i taket', '401'],
    ['Airbag', '402'],
    ['Koppholder i midt konsoll', '403'],
    ['Subwoofer', '404'],
    ['DVD-Skjermer', '405'],
  ])('%s -> produktnummer %s i fiken, huk av og fjern igjen', (punktTekst, produktnr) => {
    const idx = o.utstyrSjekkliste.findIndex(p => p.punkt === punktTekst);
    env.toggleUtstyrPunkt('ord_1', idx);
    expect(o.utstyrSjekkliste[idx].ok).toBe(true);
    expect(fikenLinjeKall).toContainEqual({ produktnummer: produktnr, skalStaa: true });
    // Ingen av disse fem skal i "Skal ha etter visning" (bekreftet av Henrik 2026-09-24).
    expect(skalHaKall.length).toBe(0);

    env.toggleUtstyrPunkt('ord_1', idx);
    expect(o.utstyrSjekkliste[idx].ok).toBe(false);
    expect(fikenLinjeKall).toContainEqual({ produktnummer: produktnr, skalStaa: false });
  });

  it('punkter uten kjent kobling (Rollon) rører ikke fiken', () => {
    env.toggleUtstyrPunkt('ord_1', 5);
    expect(fikenLinjeKall.length).toBe(0);
  });

  it('samme punkt-tekst ("Airbag") på Geländewagen rører ikke GLS-koblingen', () => {
    o.merke = 'Mercedes-Benz'; o.modell = 'Geländewagen';
    o.utstyrSjekkliste = [{ punkt: 'Airbag', ok: false }];
    env.toggleUtstyrPunkt('ord_1', 0);
    expect(fikenLinjeKall.some(k => k.produktnummer === '402')).toBe(false);
  });
});
