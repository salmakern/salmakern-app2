import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';

// 2026-11-02: en ordre med vekter = {} (kolonnens default) tok ned Ordre-lista og Mer-fanen for ALLE. Eieren: «det er for mye
// viktig data i appen til at dette kan skje». Denne testen lukker FEILKLASSEN, ikke bare den ene kolonnen:
//  1) Den bygger en ordre slik databasen lager den når bare kolonne-defaultene brukes (SQL-funksjoner, edge-funksjoner,
//     migrasjoner og manuelle rader går utenom appens save()), ut fra et øyeblikksbilde av de FAKTISKE kolonnene
//     (test/fixtures/ordrer-kolonner.json, hentet fra information_schema; nattens QA sammenligner det med databasen).
//  2) Den setter så HVER kolonne, én om gangen, til hver verdi databasen tillater (NULL der kolonnen er nullable, tomt objekt,
//     tom liste, tom tekst), og kjører alle ordrevisningene. Ingen kombinasjon skal kaste eller logge en feil.
// Kalibrert: på koden fra før rettelsen (c6cedaf) kaster samme sele på «bare defaults»-raden i renderOrdreList og renderMer.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fasit = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/ordrer-kolonner.json'), 'utf8'));
const KOLONNER = fasit.kolonner;

const FULL_VEKTER = { totalvekt: { a: '', e: '', v: '' }, vogntog: { a: '', e: '', v: '' }, foraksel: { a: '', e: '', v: '' }, bakaksel: { a: '', e: '', v: '' } };

// Tolker kolonne-defaulten slik Postgres ville ga den. Ukjent default = testen feiler høyt, så en ny type default blir sett.
function defaultVerdi(k) {
  const d = k.default;
  if (d == null) {
    if (k.kolonne === 'id') return 'ord_TESTRAD';
    if (k.nullable) return null;
    throw new Error('NOT NULL-kolonnen ' + k.kolonne + ' mangler default - oppdater testen');
  }
  if (d === 'now()') return '2026-11-02T10:00:00+00:00';
  if (d === 'true') return true;
  if (d === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(d)) return Number(d);
  const tekst = d.match(/^'((?:[^']|'')*)'::(text|character varying)$/);
  if (tekst) return tekst[1].replace(/''/g, "'");
  const json = d.match(/^'(.*)'::jsonb?$/);
  if (json) return JSON.parse(json[1]);
  if (/^(public\.)?vekter_normalisert\(/.test(d)) return structuredClone(FULL_VEKTER);
  throw new Error('Ukjent kolonne-default for ' + k.kolonne + ': ' + d + ' - oppdater defaultVerdi() i testen');
}

const defaultRad = () => Object.fromEntries(KOLONNER.map((k) => [k.kolonne, defaultVerdi(k)]));

// Verdiene databasen faktisk tillater for en kolonne (ut over defaulten).
function varianter(k) {
  const v = [];
  if (k.nullable) v.push(['NULL', null]);
  if (k.type === 'jsonb') { v.push(['{}', {}]); v.push(['[]', []]); }
  if (k.type === 'text' || k.type === 'character varying') v.push(["''", '']);
  return v;
}

// Alle visninger som tegner ordrer. Parametere som trengs er felles og enkle; en ukjent funksjon hoppes over (og telles under).
const VISNINGER = [
  'renderOversikt', 'renderArkiv', 'renderMer', 'renderOrdreList', 'renderWeek', 'renderOrdreRapport', 'renderDetaljertOrdrerapport',
  'renderAarsStatistikk', 'renderFlaterListe', 'renderMaterialbehov', 'renderGlobalLavLagerVarsel', 'renderAdminHelsesjekk',
];
const LES_FUNKSJONER = ['tvangsflyt', 'tvangsflytBarHTML', 'tvangsflytBoksHTML'];

const app = lastApp();

// Kjører alle visninger mot en ordre-rad. Returnerer en liste med feilbeskrivelser (tom = trygt).
function kjorAlle(rad, status) {
  const feil = [];
  let o;
  try { o = app.sandbox.dbToOrdre({ ...rad, status: status ?? rad.status }); }
  catch (e) { return ['dbToOrdre kastet: ' + e.message]; }
  app.S.ordrer = [o];
  app.S.flater = [];
  app.settAktivOrdre(null);
  for (const fn of VISNINGER) {
    if (typeof app.sandbox[fn] !== 'function') { feil.push(fn + ' finnes ikke (testen er utdatert)'); continue; }
    app.consoleFeil.length = 0;
    try { app.kjor(fn + '()'); } catch (e) { feil.push(fn + ' kastet: ' + e.message); continue; }
    if (app.consoleFeil.length) feil.push(fn + ' logget feil: ' + app.consoleFeil[0]);
  }
  for (const fn of LES_FUNKSJONER) {
    try { app.sandbox[fn](o); } catch (e) { feil.push(fn + ' kastet: ' + e.message); }
  }
  // Ordredetaljen (åpnes fra lista), og Realtime-banen med den samme raden som «gammel» og «ny».
  app.consoleFeil.length = 0;
  try { app.sandbox.openOrdre(o.id); } catch (e) { feil.push('openOrdre kastet: ' + e.message); }
  if (app.consoleFeil.length) feil.push('openOrdre logget feil: ' + app.consoleFeil[0]);
  app.settAktivOrdre(null);
  try { app.sandbox.dbToOrdreFraRealtime(o, rad); } catch (e) { feil.push('dbToOrdreFraRealtime kastet: ' + e.message); }
  return feil;
}

describe('oppsettet', () => {
  it('hele appen lastes uten feil i testmiljøet, og ordrevisningene finnes', () => {
    expect(app.lasteFeil).toEqual([]);
    for (const fn of [...VISNINGER, ...LES_FUNKSJONER, 'openOrdre', 'dbToOrdre', 'dbToOrdreFraRealtime']) {
      expect(typeof app.sandbox[fn], fn).toBe('function');
    }
  });

  it('øyeblikksbildet av ordrer-kolonnene er komplett nok til å være en fasit (id, vekter, utstyr, ombygging, dokumenter finnes)', () => {
    const navn = KOLONNER.map((k) => k.kolonne);
    for (const k of ['id', 'vekter', 'utstyr', 'ombygging', 'drivstoff', 'dokumenter', 'fiken_linjer', 'status', 'ordre_status']) expect(navn).toContain(k);
    expect(KOLONNER.length).toBeGreaterThan(60);
  });
});

describe('en ordre slik databasen lager den når BARE kolonne-defaultene brukes', () => {
  it('alle visninger tåler den (aktiv)', () => {
    expect(kjorAlle(defaultRad(), 'aktiv')).toEqual([]);
  });

  it('alle visninger tåler den (arkivert)', () => {
    expect(kjorAlle(defaultRad(), 'arkivert')).toEqual([]);
  });

  it('en ordre med DE GAMLE defaultene (vekter = {}, fra før 2026-11-02) tåles også', () => {
    expect(kjorAlle({ ...defaultRad(), vekter: {} }, 'aktiv')).toEqual([]);
  });
});

describe('hver kolonne, én om gangen, satt til hver verdi databasen tillater', () => {
  const tilfeller = [];
  for (const k of KOLONNER) {
    if (k.kolonne === 'id') continue;
    for (const [navn, verdi] of varianter(k)) tilfeller.push({ k, navn, verdi });
  }

  it('det finnes mange tilfeller (testen tester faktisk noe)', () => {
    expect(tilfeller.length).toBeGreaterThan(60);
  });

  it('ingen kombinasjon av kolonne og tom/NULL-verdi får en visning til å kaste eller logge feil', () => {
    const funn = [];
    for (const t of tilfeller) {
      const rad = defaultRad();
      rad[t.k.kolonne] = t.verdi;
      for (const status of ['aktiv', 'arkivert']) {
        const feil = kjorAlle(rad, status);
        if (feil.length) funn.push(`${t.k.kolonne} = ${t.navn} (status ${status}): ${feil.join(' | ')}`);
      }
    }
    expect(funn).toEqual([]);
  });
});
