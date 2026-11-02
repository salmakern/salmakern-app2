import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Supabase Realtime utelater STORE, UENDREDE, eksternt lagrede (TOAST) kolonner fra `new` i en
// UPDATE-hendelse. Målt mot ekte `ordrer` 2026-11-02 (TEST-ordre): en 160 KB `bilder_levering`
// manglet, mens små eksterne kolonner (`endringer`, `dokumenter`) kom med. Uten
// dbToOrdreFraRealtime() ble bildelisten/signaturen tom lokalt etter en urelatert oppdatering,
// og save() kunne skrive det tomme tilbake til databasen. Testene under bruker de ekte
// kolonnenavnene for å vise mekanismen (inkludert bilder og signatur); de påstår ikke at
// dokumentlista mangler i hendelser - det ble IKKE funnet.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreKode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8').replace(/\r\n/g, '\n');

function nyttMiljo() {
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp, Proxy,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: {
      addEventListener() {}, getElementById() { return null; },
      createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; },
      body: { appendChild() {} }, head: { appendChild() {} },
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  return sandbox;
}

const dok = (n) => ({ navn: n, url: 'https://x/ordre-dokumenter/1/' + n });

describe('ordreKolonneKart', () => {
  it('kobler de eksternt lagrede kolonnene til riktig ordre-egenskap', () => {
    const kart = nyttMiljo().ordreKolonneKart();
    expect(kart.dokumenter).toEqual(['dokumenter']);
    expect(kart.endringer).toEqual(['endringer']);
    expect(kart.vegvesen_fingerprint).toEqual(['vegvesenFingerprint']);
    expect(kart.fiken_linjer).toEqual(['fikenLinjer']);
    expect(kart.bilder_levering).toEqual(['bilderLevering']);
    expect(kart.bilder_ankomst).toEqual(['bilderAnkomst']);
    expect(kart.signatur).toEqual(['signatur']);
  });

  it('vakt: hver kolonne dbToOrdre leser er koblet til minst én egenskap (en ny kolonne uten treff ville blitt tømt av Realtime uten at noen merket det)', () => {
    const kart = nyttMiljo().ordreKolonneKart();
    const utenTreff = Object.keys(kart).filter((k) => kart[k].length === 0);
    expect(utenTreff).toEqual([]);
    expect(Object.keys(kart).length).toBeGreaterThan(40);
  });
});

describe('dbToOrdreFraRealtime', () => {
  it('beholder lokale dokumenter/logg/bilder/signatur/fingerprint når kolonnene mangler i hendelsen', () => {
    const m = nyttMiljo();
    const gammel = m.dbToOrdre({
      id: 'ord_1', chassis: 'ABC', farge: 'Hvit',
      dokumenter: [dok('Egenerklæring-25.pdf'), dok('Fabrikantattest-25.pdf')],
      endringer: [{ av: 'A', tid: 't', txt: 'x' }],
      vegvesen_fingerprint: '["fp"]',
      fiken_linjer: [{ id: 'fl_1', produktnummer: '21', antall: 1 }],
      bilder_levering: ['b1', null, null, null, null, null],
      signatur: 'data:image/png;base64,AAA',
    });
    // Hendelse etter en urelatert oppdatering: bare små kolonner er med.
    const ny = m.dbToOrdreFraRealtime(gammel, { id: 'ord_1', chassis: 'ABC', farge: 'Svart', status: 'aktiv' });
    expect(ny.farge).toBe('Svart');
    expect(ny.dokumenter.map((d) => d.navn)).toEqual(['Egenerklæring-25.pdf', 'Fabrikantattest-25.pdf']);
    expect(ny.endringer).toHaveLength(1);
    expect(ny.vegvesenFingerprint).toBe('["fp"]');
    expect(ny.fikenLinjer).toHaveLength(1);
    expect(ny.bilderLevering[0]).toBe('b1');
    expect(ny.signatur).toBe('data:image/png;base64,AAA');
  });

  it('bruker den nye verdien når kolonnen FØLGER med - også tom liste og null', () => {
    const m = nyttMiljo();
    const gammel = m.dbToOrdre({ id: 'ord_1', dokumenter: [dok('a.pdf'), dok('b.pdf')], signatur: 'sig' });
    const ny = m.dbToOrdreFraRealtime(gammel, { id: 'ord_1', dokumenter: [dok('b.pdf')], signatur: null });
    expect(ny.dokumenter.map((d) => d.navn)).toEqual(['b.pdf']);
    expect(ny.signatur).toBeNull();
    const tom = m.dbToOrdreFraRealtime(gammel, { id: 'ord_1', dokumenter: [] });
    expect(tom.dokumenter).toEqual([]);
  });

  it('en kolonne som faktisk er endret og stor (følger med) vinner over den lokale kopien', () => {
    const m = nyttMiljo();
    const gammel = m.dbToOrdre({ id: 'ord_1', endringer: [{ txt: 'gammel' }] });
    const ny = m.dbToOrdreFraRealtime(gammel, { id: 'ord_1', endringer: [{ txt: 'gammel' }, { txt: 'ny' }] });
    expect(ny.endringer.map((e) => e.txt)).toEqual(['gammel', 'ny']);
  });

  it('uten lokal kopi (ordren er ikke lastet) bygges den som vanlig', () => {
    const m = nyttMiljo();
    const ny = m.dbToOrdreFraRealtime(undefined, { id: 'ord_9', chassis: 'Z' });
    expect(ny.id).toBe('ord_9');
    expect(ny.dokumenter).toEqual([]);
  });

  it('endrer ikke den gamle ordren (kun den nye returneres)', () => {
    const m = nyttMiljo();
    const gammel = m.dbToOrdre({ id: 'ord_1', farge: 'Hvit', dokumenter: [dok('a.pdf')] });
    m.dbToOrdreFraRealtime(gammel, { id: 'ord_1', farge: 'Svart' });
    expect(gammel.farge).toBe('Hvit');
    expect(gammel.dokumenter).toHaveLength(1);
  });
});

describe('vakt mot gammel form i kildekoden', () => {
  it('Realtime-UPDATE for ordrer bruker dbToOrdreFraRealtime, aldri dbToOrdre(p.new) direkte', () => {
    expect(coreKode).toContain('S.ordrer[i]=dbToOrdreFraRealtime(S.ordrer[i], p.new)');
    expect(coreKode).not.toMatch(/S\.ordrer\[i\]\s*=\s*dbToOrdre\(p\.new\)/);
  });

  it('Realtime-UPDATE for innstillinger tømmer ikke en kolonne som mangler i hendelsen', () => {
    expect(coreKode).toContain("if ('kontakter' in row) S.kontakter = row.kontakter || [];");
    expect(coreKode).not.toMatch(/^\s*S\.kontakter = row\.kontakter \|\| \[\];/m);
  });
});
