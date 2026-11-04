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
    S: { ordrer: [], fikenKundeAlias: [], fikenKundeRabatt: [] },
    activeOrdreId: null,
    me: null,
    save() {},
    planleggLocalSpeiling() {},
    db: null,
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

  // Regresjon 4.11 (portal-økta, demobestilling s90-20261031-7): en portal-bestilt EV9-ordre
  // fikk sin ombyggingslinje (500) MED frosset rabatt lagt til av leggTilPortalUtstyrLinjer
  // ved Bekreft, men Ombygging-boksen (nyttKjoretoy/bruktKjoretoy) ble ALDRI huket av for en
  // portal-ordre - så denne synken fjernet linjen (og rabatten) igjen på selve
  // Bekreft-renderingen. Linjen skal nå stå urørt når den bærer en rabatt, uavhengig av boksen.
  it('fjerner IKKE en linje med frosset portalrabatt, selv om ingen ombygging-boks er huket av', () => {
    o.ombygging.nyttKjoretoy = false;
    o.fikenLinjer.push({ produktnummer: '500', antall: 1, rabatt: 20 });
    env.synkroniserOmbyggingFikenLinjer(o);
    const linje = o.fikenLinjer.find(l => l.produktnummer === '500');
    expect(linje).toBeDefined();
    expect(linje.rabatt).toBe(20);
  });

  it('en linje UTEN rabatt fjernes fortsatt som før når ingen boks er huket av (ikke en portal-rabattlinje)', () => {
    env.synkroniserOmbyggingFikenLinjer(o); // legger til 500 uten rabatt (boksen er huket av i beforeEach)
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

// "305" (MB-stjerne) ble kort en tid 2026-09-24 lagt til automatisk for ALLE
// Mercedes-modeller ved Nytt/Brukt Kjøretøy - fjernet igjen 2026-09-25 etter beskjed fra
// Henrik ("kvitte deg med 305 produkt.nr på alle mercedes kjøretøyene"). Testen under
// dekker at den IKKE kommer tilbake ved en fremtidig regresjon.
describe('synkroniserOmbyggingFikenLinjer - "305" skal IKKE lenger legges til automatisk', () => {
  it.each(['Geländewagen', 'GLS', 'Vito', 'EQV', 'V-klasse'])('Mercedes-Benz %s: ingen 305-linje selv med Nytt Kjøretøy huket av', modell => {
    const env = nyEnvironment();
    const o = {
      id: 'ord_1', merke: 'Mercedes-Benz', modell,
      ombygging: { nyttKjoretoy: true, bruktKjoretoy: false, lafinto: false, personbil: false },
      fikenLinjer: [],
    };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
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

// s09-012 steg 2 (2026-10-31): modell-nøkkelen fra en portal-bestilling (o.portalModellSlug,
// slått opp i S.portalModellKobling) skal nå faktisk BRUKES i Fiken-matchingen i stedet for
// ordrens egen fritekst merke/modell - en ansatt som retter en skrivefeil i Merke/Modell i
// etterkant skal ikke kunne endre eller stoppe matchingen. Ordre uten slug (ingen av testene
// over) skal fortsette å fungere helt uendret, bekreftet av at de 28 testene over fortsatt
// er grønne uten noen endring.
describe('kanoniskMerkeModell (s09-012 steg 2: modell-nøkkel foran fritekst)', () => {
  it('ordre uten portalModellSlug: fallback til fritekst, uendret', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = { merke: 'Toyota', modell: 'Yaris' };
    expect(env.kanoniskMerkeModell(o)).toEqual({ merke: 'Toyota', modell: 'Yaris' });
  });

  it('portalModellSlug satt og funnet: bruker den kanoniske teksten, IKKE fritekst', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = { merke: 'kia (feilstavet)', modell: 'ev9??', portalModellSlug: 'kia-ev9' };
    expect(env.kanoniskMerkeModell(o)).toEqual({ merke: 'KIA', modell: 'EV9' });
  });

  it('portalModellSlug satt men IKKE funnet i S.portalModellKobling: fallback til fritekst (ikke kast feil)', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = { merke: 'KGM', modell: 'Rexton', portalModellSlug: 'finnes-ikke' };
    expect(env.kanoniskMerkeModell(o)).toEqual({ merke: 'KGM', modell: 'Rexton' });
  });

  it('S.portalModellKobling ikke lastet ennå (undefined): fallback til fritekst, kaster ikke', () => {
    const env = nyEnvironment();
    const o = { merke: 'KIA', modell: 'EV9', portalModellSlug: 'kia-ev9' };
    expect(() => env.kanoniskMerkeModell(o)).not.toThrow();
    expect(env.kanoniskMerkeModell(o)).toEqual({ merke: 'KIA', modell: 'EV9' });
  });
});

describe('synkroniserOmbyggingFikenLinjer med slug (s09-012 steg 2)', () => {
  it('fritekst er UKJENT, men slugen peker på en kjent modell: riktig Fiken-linje legges likevel til', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = {
      id: 'ord_1', merke: 'Ukjent skrivefeil', modell: 'xyz', portalModellSlug: 'kia-ev9',
      ombygging: { nyttKjoretoy: true, bruktKjoretoy: false, lafinto: false, personbil: false },
      fikenLinjer: [],
    };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '500')).toBe(true);
  });

  it('fritekst matcher en ANNEN kjent modell enn slugen: slugen vinner (kanonisk tekst brukes)', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kgm-rexton', merke: 'KGM', modell: 'Rexton' }];
    const o = {
      id: 'ord_1', merke: 'KIA', modell: 'EV9', portalModellSlug: 'kgm-rexton', // fritekst sier EV9, slugen sier Rexton
      ombygging: { nyttKjoretoy: true, bruktKjoretoy: false, lafinto: false, personbil: false },
      fikenLinjer: [],
    };
    env.S.ordrer = [o];
    env.activeOrdreId = o.id;
    env.synkroniserOmbyggingFikenLinjer(o);
    expect(o.fikenLinjer.some(l => l.produktnummer === '2400')).toBe(true); // Rexton, ikke EV9 (500)
    expect(o.fikenLinjer.some(l => l.produktnummer === '500')).toBe(false);
  });
});

describe('ombyggingBoksHTML: varsel når Merke/Modell avviker fra portalens modell (s09-012 steg 2)', () => {
  it('ingen slug: ingen avviksvarsel, uendret oppførsel', () => {
    const env = nyEnvironment();
    const o = { id: 'ord_1', merke: 'KIA', modell: 'EV9', ombygging: { nyttKjoretoy: true } };
    expect(env.ombyggingBoksHTML(o)).not.toMatch(/stemmer ikke med modellen/);
  });

  it('slug satt og fritekst STEMMER med kanonisk tekst: ingen avviksvarsel', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = { id: 'ord_1', merke: 'KIA', modell: 'EV9', portalModellSlug: 'kia-ev9', ombygging: { nyttKjoretoy: true } };
    expect(env.ombyggingBoksHTML(o)).not.toMatch(/stemmer ikke med modellen/);
  });

  it('slug satt men fritekst AVVIKER: viser et tydelig, men ikke-blokkerende varsel', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = { id: 'ord_1', merke: 'KIA (rettet)', modell: 'EV9', portalModellSlug: 'kia-ev9', ombygging: { nyttKjoretoy: true } };
    const html = env.ombyggingBoksHTML(o);
    expect(html).toMatch(/stemmer ikke med modellen fra portal-bestillingen/);
    expect(html).toMatch(/KIA \(rettet\)/); // fritekst-verdien som faktisk står på ordren
    expect(html).toMatch(/KIA EV9/); // den kanoniske teksten fra portal-bestillingen
  });

  it('«mangler Fiken-modell»-varselet bruker den kanoniske teksten, ikke fritekst som tilfeldigvis er ukjent', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = { id: 'ord_1', merke: 'Skrivefeil', modell: 'xyz', portalModellSlug: 'kia-ev9', ombygging: { nyttKjoretoy: true } };
    const html = env.ombyggingBoksHTML(o);
    // Kanonisk tekst (KIA EV9) ER en kjent Fiken-modell, så "mangler"-varselet skal IKKE vises -
    // bare avviks-varselet, siden fakturering uansett bruker kanonisk tekst og fungerer fint.
    expect(html).not.toMatch(/Ingen kjent Fiken-produktlinje/);
    expect(html).toMatch(/stemmer ikke med modellen fra portal-bestillingen/);
  });
});

// s90-20261104-5 steg 2 (avtalt rekkefølge for fakturering/lager, 5.11): fakturaSjekk(o) er den
// DELTE sjekken bak både "Klar til fakturering"-lista og selve blokkeringen i fakturerViaFiken -
// se kommentaren ved funksjonen (ordre-detalj.js) for bakgrunnen (funnet av uavhengig
// gjennomgang 4.11: fakturerViaFiken brukte fritekst merke/modell i stedet for
// kanoniskMerkeModell, så en portal-ordre for en modell uten hardkodet regex-match kunne bli
// blokkert selv om ombyggingslinjen kom riktig fra bestillingen).
describe('fakturaSjekk', () => {
  function basisOrdre(overrides = {}) {
    return {
      id: 'ord_1', merke: 'KIA', modell: 'EV9', kunde: 'Test Kunde AS', ordreStatus: 'klar_henting',
      ombygging: { nyttKjoretoy: false, bruktKjoretoy: false },
      fikenLinjer: [{ produktnummer: '502', antall: 1, pris: 1670, mva: 'high', rabatt: 20 }],
      ...overrides,
    };
  }

  it('ingen fakturalinjer: rød, stopper rett der (ingen andre sjekker kjøres)', () => {
    const env = nyEnvironment();
    const sjekk = env.fakturaSjekk(basisOrdre({ fikenLinjer: [] }));
    expect(sjekk.niva).toBe('rod');
    expect(sjekk.grunner).toEqual([{ kode: 'ingen_linjer', tekst: 'Ingen fakturalinjer' }]);
  });

  it('ombygging huket av, modellen er ukjent (fritekst): rød', () => {
    const env = nyEnvironment();
    const o = basisOrdre({ merke: 'Ukjent', modell: 'Modell', ombygging: { nyttKjoretoy: true } });
    const sjekk = env.fakturaSjekk(o);
    expect(sjekk.niva).toBe('rod');
    expect(sjekk.grunner.some((g) => g.kode === 'ukjent_modell')).toBe(true);
  });

  it('ombygging huket av, fritekst er ukjent MEN portal-slug gir en kjent kanonisk modell: IKKE rød (selve fiksen 5.11)', () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = basisOrdre({ merke: 'Skrivefeil', modell: 'xyz', portalModellSlug: 'kia-ev9', ombygging: { nyttKjoretoy: true } });
    const sjekk = env.fakturaSjekk(o);
    expect(sjekk.grunner.some((g) => g.kode === 'ukjent_modell')).toBe(false);
  });

  it('ingen kunde: rød', () => {
    const env = nyEnvironment();
    const sjekk = env.fakturaSjekk(basisOrdre({ kunde: '' }));
    expect(sjekk.niva).toBe('rod');
    expect(sjekk.grunner.some((g) => g.kode === 'ingen_kunde')).toBe(true);
  });

  it('en linje uten frosset pris (og ikke et overstyrt beløp): gul', () => {
    const env = nyEnvironment();
    const o = basisOrdre({ fikenLinjer: [{ produktnummer: '502', antall: 1, rabatt: 20 }] });
    const sjekk = env.fakturaSjekk(o);
    expect(sjekk.niva).toBe('gul');
    expect(sjekk.grunner.find((g) => g.kode === 'uten_frosset_pris').tekst).toMatch(/1 linje/);
  });

  it('et overstyrt beløp (f.eks. drivstoff) trenger ingen frosset pris: ikke gul for det', () => {
    const env = nyEnvironment();
    const o = basisOrdre({ fikenLinjer: [{ produktnummer: '21', antall: 1, belop: 500 }] });
    const sjekk = env.fakturaSjekk(o);
    expect(sjekk.grunner.some((g) => g.kode === 'uten_frosset_pris')).toBe(false);
  });

  it('kunde satt, men ingen alias registrert i Fiken ennå: gul', () => {
    const env = nyEnvironment();
    env.S.fikenKundeAlias = [{ alias: 'En annen kunde', fiken_contact_id: 1 }];
    const sjekk = env.fakturaSjekk(basisOrdre());
    expect(sjekk.niva).toBe('gul');
    expect(sjekk.grunner.some((g) => g.kode === 'ukjent_fiken_kunde')).toBe(true);
  });

  it('alias finnes, men ingen avtalt rabatt og linjen mangler frosset rabatt: gul', () => {
    const env = nyEnvironment();
    env.S.fikenKundeAlias = [{ alias: 'Test Kunde AS', fiken_contact_id: 1 }];
    const o = basisOrdre({ fikenLinjer: [{ produktnummer: '502', antall: 1, pris: 1670, mva: 'high' }] }); // ingen rabatt-felt
    const sjekk = env.fakturaSjekk(o);
    expect(sjekk.grunner.some((g) => g.kode === 'ingen_avtalt_rabatt')).toBe(true);
  });

  it('alias finnes og en avtalt rabatt-rad finnes: ingen rabatt-advarsel selv uten frosset rabatt på linjen', () => {
    const env = nyEnvironment();
    env.S.fikenKundeAlias = [{ alias: 'Test Kunde AS', fiken_contact_id: 1 }];
    env.S.fikenKundeRabatt = [{ fiken_contact_id: 1, rabatt_ombygging: 20, rabatt_ekstra_utstyr: 10 }];
    const o = basisOrdre({ fikenLinjer: [{ produktnummer: '502', antall: 1, pris: 1670, mva: 'high' }] });
    const sjekk = env.fakturaSjekk(o);
    expect(sjekk.grunner.some((g) => g.kode === 'ingen_avtalt_rabatt')).toBe(false);
  });

  it('linjen har en frosset rabatt (portal-ordre): ingen rabatt-advarsel, selv uten kjent alias/rabattrad', () => {
    const env = nyEnvironment();
    const sjekk = env.fakturaSjekk(basisOrdre()); // basisOrdre sin linje har rabatt:20, ingen alias satt opp
    expect(sjekk.grunner.some((g) => g.kode === 'ingen_avtalt_rabatt')).toBe(false);
  });

  it('ordre allerede "hentet": merkes "ikke avstemt", men blir ikke rød av bare det', () => {
    const env = nyEnvironment();
    const sjekk = env.fakturaSjekk(basisOrdre({ ordreStatus: 'hentet' }));
    expect(sjekk.niva).toBe('gul');
    expect(sjekk.grunner.some((g) => g.kode === 'ikke_avstemt')).toBe(true);
  });

  it('alt i orden: grønn, ingen grunner', () => {
    const env = nyEnvironment();
    env.S.fikenKundeAlias = [{ alias: 'Test Kunde AS', fiken_contact_id: 1 }];
    env.S.fikenKundeRabatt = [{ fiken_contact_id: 1, rabatt_ombygging: 20, rabatt_ekstra_utstyr: 10 }];
    const sjekk = env.fakturaSjekk(basisOrdre());
    expect(sjekk).toEqual({ niva: 'gronn', grunner: [] });
  });
});

// fakturerViaFiken bruker nå fakturaSjekk() for selve blokkeringen (samme funksjon som "Klar
// til fakturering"-lista viser) - dekker at den faktiske GATEN er rettet, ikke bare at
// fakturaSjekk() i isolasjon er riktig (se testene over).
describe('fakturerViaFiken: blokkering bruker fakturaSjekk (kanoniskMerkeModell), ikke fritekst direkte', () => {
  it('stopper IKKE lenger en portal-ordre med ukjent fritekst merke/modell når portal-sluggen er en kjent modell (den faktiske bugen fra 4.11)', async () => {
    const env = nyEnvironment();
    env.S.portalModellKobling = [{ portal_modell_slug: 'kia-ev9', merke: 'KIA', modell: 'EV9' }];
    const o = {
      id: 'ord_1', merke: 'Skrivefeil', modell: 'xyz', portalModellSlug: 'kia-ev9', kunde: 'Test Kunde AS',
      ombygging: { nyttKjoretoy: true }, fikenLinjer: [{ produktnummer: '502', antall: 1, pris: 1670, mva: 'high', rabatt: 20 }],
    };
    env.S.ordrer = [o];
    env.me = { id: 1, navn: 'Test Admin', rolle: 'admin' };
    const toaster = [];
    env.visToast = (m) => toaster.push(m);
    env.document.getElementById = () => null; // ingen knapp/avkrysning i DOM i denne testen
    env.kallFikenFakturer = async () => 'ok'; // selve Fiken-kallet er ikke det denne testen dekker
    await env.fakturerViaFiken('ord_1');
    expect(toaster.some((m) => /Ingen kjent Fiken-produktlinje/.test(m))).toBe(false);
  });

  it('stopper fortsatt en ordre med ekte ukjent modell (ombygging huket av, ingen portal-slug)', async () => {
    const env = nyEnvironment();
    const o = {
      id: 'ord_1', merke: 'Helt', modell: 'Ukjent', kunde: 'Test Kunde AS',
      ombygging: { nyttKjoretoy: true }, fikenLinjer: [{ produktnummer: '502', antall: 1, pris: 1670, mva: 'high', rabatt: 20 }],
    };
    env.S.ordrer = [o];
    env.me = { id: 1, navn: 'Test Admin', rolle: 'admin' };
    const toaster = [];
    env.visToast = (m) => toaster.push(m);
    env.document.getElementById = () => null;
    let kalt = false;
    env.kallFikenFakturer = async () => { kalt = true; return 'ok'; };
    await env.fakturerViaFiken('ord_1');
    expect(toaster.some((m) => /Ingen kjent Fiken-produktlinje/.test(m))).toBe(true);
    expect(kalt).toBe(false);
  });
});
