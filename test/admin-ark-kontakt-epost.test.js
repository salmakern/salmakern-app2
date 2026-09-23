import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Regresjonstest for feil oppdaget 2026-09-23: kontaktpersoner flyttet til å ligge
// nøstet under sin forhandler (S.kontakter type "Forhandler", .kontaktpersoner-array) i
// stedet for som egne toppnivå-rader. adminArkFinnKontaktEpost() - brukt av både
// "Bestill frakt" (kopi til kontaktperson) og "Varsle hentet" - søkte fortsatt kun i
// toppnivå-listen, så en kontaktperson lagt til via den nye "+ Legg til
// kontaktperson"-flyten ville gitt "Fant ingen e-post" selv om personen faktisk var
// registrert.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreKode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');
const adminArkKode = readFileSync(path.resolve(__dirname, '../js/admin-ark.js'), 'utf8');

function nyEnvironment() {
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: { addEventListener() {}, getElementById() { return null; } },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  vm.runInContext(adminArkKode, sandbox, { filename: 'admin-ark.js' });
  vm.runInContext(`function _setS(v){ S = v; }`, sandbox);
  return sandbox;
}

describe('adminArkFinnKontaktEpost', () => {
  it('finner e-post for en kontaktperson nøstet under en Forhandler-kontakt', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({
      kontakter: [
        { id: 'k1', navn: 'Bilhuset AS', type: 'Forhandler', epost: 'post@bilhuset.no', kontaktpersoner: [
          { id: 'kp1', navn: 'Ola Nordmann', epost: 'ola@bilhuset.no' }
        ] }
      ]
    });
    expect(sandbox.adminArkFinnKontaktEpost('Ola Nordmann')).toBe('ola@bilhuset.no');
  });

  it('er case- og whitespace-uavhengig for nøstet søk, samme som toppnivå-søket', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({
      kontakter: [
        { id: 'k1', navn: 'Bilhuset AS', type: 'Forhandler', kontaktpersoner: [
          { id: 'kp1', navn: 'Ola Nordmann', epost: 'ola@bilhuset.no' }
        ] }
      ]
    });
    expect(sandbox.adminArkFinnKontaktEpost('  ola nordmann  ')).toBe('ola@bilhuset.no');
  });

  it('finner fortsatt en toppnivå-kontakt (uendret oppførsel)', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({ kontakter: [{ id: 'k1', navn: 'Kari Kontakt', type: 'Annet', epost: 'kari@example.no' }] });
    expect(sandbox.adminArkFinnKontaktEpost('Kari Kontakt')).toBe('kari@example.no');
  });

  it('toppnivå-treff vinner over et nøstet treff med samme navn', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({
      kontakter: [
        { id: 'k1', navn: 'Ola Nordmann', type: 'Annet', epost: 'toppniva@example.no' },
        { id: 'k2', navn: 'Bilhuset AS', type: 'Forhandler', kontaktpersoner: [
          { id: 'kp1', navn: 'Ola Nordmann', epost: 'nostet@bilhuset.no' }
        ] }
      ]
    });
    expect(sandbox.adminArkFinnKontaktEpost('Ola Nordmann')).toBe('toppniva@example.no');
  });

  it('type-begrenset søk (Fraktselskap) bruker IKKE nøstet fallback', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({
      kontakter: [
        { id: 'k1', navn: 'Ekspress Transport', type: 'Forhandler', kontaktpersoner: [
          { id: 'kp1', navn: 'Ekspress Transport', epost: 'feil@example.no' }
        ] }
      ]
    });
    expect(sandbox.adminArkFinnKontaktEpost('Ekspress Transport', 'Fraktselskap')).toBe('');
  });

  it('returnerer tom streng når kontaktpersonen ikke finnes noe sted', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({ kontakter: [{ id: 'k1', navn: 'Bilhuset AS', type: 'Forhandler', kontaktpersoner: [] }] });
    expect(sandbox.adminArkFinnKontaktEpost('Ukjent Person')).toBe('');
  });

  it('returnerer tom streng for tomt/udefinert navn', () => {
    const sandbox = nyEnvironment();
    sandbox._setS({ kontakter: [] });
    expect(sandbox.adminArkFinnKontaktEpost('')).toBe('');
  });
});
