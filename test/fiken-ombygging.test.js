import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Regresjonstest for en reell bug funnet 2026-09-17: 41 aktive ordre hadde en
// ombygging-boks (Nytt/Brukt Kjøretøy) huket av, men MANGLET likevel selve
// ombyggings-linjen i fikenLinjer - fordi den kun ble lagt til i selve
// avkrysningsøyeblikket (sfOmbygging sitt onchange-kall), aldri i etterkant for
// ordre der boksen allerede var/ble huket av uavhengig av det. Fikset ved å
// legge synkroniserOmbyggingFikenLinjer() inn i buildOrdreDetail() også, slik at
// hver åpning av en ordre selv retter opp misforholdet. Denne testen dekker
// begge funksjonene (ordre-detalj.js + lager.js) i samme vm-context siden de
// kaller hverandre.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ordreDetaljKode = readFileSync(path.resolve(__dirname, '../js/ordre-detalj.js'), 'utf8');
const lagerKode = readFileSync(path.resolve(__dirname, '../js/lager.js'), 'utf8');

function nyEnvironment() {
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    document: { addEventListener() {}, getElementById() { return null; } },
    window: { addEventListener() {} },
    S: { ordrer: [] },
    activeOrdreId: null,
    save() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(ordreDetaljKode, sandbox, { filename: 'ordre-detalj.js' });
  vm.runInContext(lagerKode, sandbox, { filename: 'lager.js' });
  return sandbox;
}

describe('finnFikenOmbyggingModell (matcher merke/modell mot Fiken-produktnumre)', () => {
  const env = nyEnvironment();

  it.each([
    ['KIA', 'EV9', '500', '524'],
    ['Land Rover', 'Discovery 5', '200', '229'],
    ['Land Rover', 'Defender', '1400', '1415'],
    ['Mercedes-Benz', 'Geländewagen', '300', '318'],
    ['Mercedes-Benz', 'GLS', '400', '417'],
    ['Mercedes-Benz', 'Vito', '1500', null],
    ['Mercedes-Benz', 'EQV', '1600', null],
    ['Mercedes-Benz', 'V-Klasse', '1700', null],
    ['VW', 'ID.Buzz', '1800', '1812'],
    ['KGM', 'Rexton', '2400', null],
    ['Toyota', 'Land Cruiser 250', '2500', '2508'],
  ])('%s %s -> ombygging %s, personbil %s', (merke, modell, ombygging, personbil) => {
    const treff = env.finnFikenOmbyggingModell(merke, modell);
    expect(treff).not.toBeNull();
    expect(treff.ombygging).toBe(ombygging);
    expect(treff.personbil).toBe(personbil);
  });

  it('gir ingen treff for en modell som ikke er i tabellen', () => {
    expect(env.finnFikenOmbyggingModell('Toyota', 'Yaris')).toBeNull();
  });

  it('KGM Rexton har lafinto-koden 2401 satt', () => {
    expect(env.finnFikenOmbyggingModell('KGM', 'Rexton').lafinto).toBe('2401');
  });
});

describe('synkroniserOmbyggingFikenLinjer (regresjon: ordre med huket boks men manglende linje)', () => {
  let env, o;
  beforeEach(() => {
    env = nyEnvironment();
    o = {
      id: 'ord_1',
      merke: 'KIA',
      modell: 'EV9',
      ombygging: { nyttKjoretoy: true, bruktKjoretoy: false, lafinto: false, personbil: false },
      fikenLinjer: [{ produktnummer: '503', antall: 1 }], // tilbehør fra før, men IKKE selve ombyggingen
    };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
  });

  it('legger til den manglende hovedlinjen (nøyaktig scenarioet fra bug-rapporten)', () => {
    expect(o.fikenLinjer.some(l => l.produktnummer === '500')).toBe(false);
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '500')).toBe(true);
    // tilbehøret som allerede lå der skal ikke forsvinne
    expect(o.fikenLinjer.some(l => l.produktnummer === '503')).toBe(true);
  });

  it('er en no-op når linjen allerede står riktig (kalles trygt på hvert render)', () => {
    env.synkroniserOmbyggingFikenLinjer(o);
    const etterFørste = JSON.stringify(o.fikenLinjer);
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(JSON.stringify(o.fikenLinjer)).toBe(etterFørste);
  });

  it('fjerner linjen igjen hvis boksen hukes av (symmetrisk oppførsel)', () => {
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '500')).toBe(true);
    o.ombygging.nyttKjoretoy = false;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '500')).toBe(false);
  });

  it('legger til personbil-linjen når personbil-boksen er huket av', () => {
    o.ombygging.personbil = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '524')).toBe(true);
  });

  it('gjør ingenting for en modell uten Fiken-oppsett, uten å kaste feil', () => {
    o.merke = 'Toyota'; o.modell = 'Yaris';
    expect(() => env.synkroniserOmbyggingFikenLinjer(o)).not.toThrow();
    expect(o.fikenLinjer).toEqual([{ produktnummer: '503', antall: 1 }]);
  });

  it('gjør ingenting hvis ingen ombygging-bokser er huket av', () => {
    o.ombygging.nyttKjoretoy = false;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '500')).toBe(false);
  });
});

// "305" (MB-stjerne montert på skillevegg) er FELLES for alle Mercedes-modeller, ikke
// modell-spesifikk som resten av FIKEN_OMBYGGING_MODELLER - bekreftet av Henrik
// 2026-09-24. Egen describe-blokk siden dette gjelder på tvers av modeller, ikke bare én.
describe('synkroniserOmbyggingFikenLinjer - "305" MB-stjerne er felles for alle Mercedes-modeller', () => {
  function lagOrdre(env, merke, modell) {
    const o = {
      id: 'ord_1', merke, modell,
      ombygging: { nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false },
      fikenLinjer: [],
    };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
    return o;
  }

  it.each(['Geländewagen', 'GLS', 'Vito', 'EQV', 'V-klasse'])('legges til for Mercedes-Benz %s når Nytt Kjøretøy hukes av', modell => {
    const env = nyEnvironment();
    const o = lagOrdre(env, 'Mercedes-Benz', modell);
    o.ombygging.nyttKjoretoy = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '305')).toBe(true);
  });

  it('legges til for Brukt Kjøretøy også, ikke bare Nytt', () => {
    const env = nyEnvironment();
    const o = lagOrdre(env, 'Mercedes-Benz', 'GLS');
    o.ombygging.bruktKjoretoy = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '305')).toBe(true);
  });

  it('fjernes igjen når ingen ombygging-boks lenger er huket av', () => {
    const env = nyEnvironment();
    const o = lagOrdre(env, 'Mercedes-Benz', 'Geländewagen');
    o.ombygging.nyttKjoretoy = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '305')).toBe(true);
    o.ombygging.nyttKjoretoy = false;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '305')).toBe(false);
  });

  it('legges IKKE til for ikke-Mercedes-modeller', () => {
    const env = nyEnvironment();
    const o = lagOrdre(env, 'KIA', 'EV9');
    o.ombygging.nyttKjoretoy = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '305')).toBe(false);
  });
});

// KGM Rexton "Lafinto": 2401 er en ALTERNATIV variant av samme ombygging som 2400
// ("Varebilombygging av Rexton" vs. "...- Lafinto" i Fiken) - de to skal derfor aldri stå
// samtidig i fakturering (bekreftet av Henrik 2026-09-24).
describe('synkroniserOmbyggingFikenLinjer - KGM Rexton "Lafinto" (2401) erstatter standard ombygging (2400)', () => {
  function lagRextonOrdre(env) {
    const o = {
      id: 'ord_1', merke: 'KGM', modell: 'Rexton',
      ombygging: { nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false },
      fikenLinjer: [],
    };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
    return o;
  }

  it('uten Lafinto huket av: kun 2400 (standard)', () => {
    const env = nyEnvironment();
    const o = lagRextonOrdre(env);
    o.ombygging.nyttKjoretoy = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2400')).toBe(true);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2401')).toBe(false);
  });

  it('med Lafinto huket av: kun 2401, IKKE 2400', () => {
    const env = nyEnvironment();
    const o = lagRextonOrdre(env);
    o.ombygging.nyttKjoretoy = true;
    o.ombygging.lafinto = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2401')).toBe(true);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2400')).toBe(false);
  });

  it('bytter fra 2400 til 2401 når Lafinto hukes av i etterkant, og tilbake igjen', () => {
    const env = nyEnvironment();
    const o = lagRextonOrdre(env);
    o.ombygging.bruktKjoretoy = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2400')).toBe(true);

    o.ombygging.lafinto = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2400')).toBe(false);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2401')).toBe(true);

    o.ombygging.lafinto = false;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2400')).toBe(true);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2401')).toBe(false);
  });

  it('ingen av linjene står igjen hvis ingen ombygging-boks er huket av, selv med Lafinto huket', () => {
    const env = nyEnvironment();
    const o = lagRextonOrdre(env);
    o.ombygging.lafinto = true;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2400')).toBe(false);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2401')).toBe(false);
  });
});
