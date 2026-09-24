import { describe, it, expect } from 'vitest';
import { loadScript } from './helpers/load-script.js';

// Formlene her er hentet direkte fra Telemark Salmakerverksted sitt eget
// Vektfordeling-regneark (KIA EV9), ikke utledet på nytt - testene under bruker de
// SAMME tallene som står i deres referanseeksempel for å bekrefte at formlene er
// transkribert riktig, siden dette er tall som går videre til Statens vegvesen.
const {
  beregnVektfordeling, finnJustertTotalvekt, vegvesenGeometri, vegvesenFinnModell,
  egenerklaeringAvsnitt, egenerklaeringAvsnittRexton, egenerklaeringAvsnittLandRover, egenerklaeringAvsnittMercedes
} = loadScript('vegvesen-dokumenter.js');

// Regresjonstest for feil funnet 2026-09-23: "🔄 Regenerer Vegvesen-dokumenter"-knappen
// (genererVegvesenDokumenter) hadde INGEN sperre på o.ombygging.nyttKjoretoy, i motsetning
// til den automatiske genereringen (vegvesenAutoGenererHvisKomplett) - en admin kunne derfor
// trykke knappen på en ordre som faktisk var Brukt Kjøretøy og få genererte Nytt
// Kjøretøy-utformede dokumenter (reelt skjedd på ordre SALEA7BW7T2506245). Brukt Kjøretøy
// ble en gyldig, støttet kategori samme dag - testen under er oppdatert til å reflektere
// det (kun "verken/eller" skal nå avvises).
describe('genererVegvesenDokumenter - sperre på Nytt/Brukt Kjøretøy', () => {
  function nySandbox() {
    const toasts = [];
    const sandbox = loadScript('vegvesen-dokumenter.js', {
      visToast: (msg) => toasts.push(msg),
      db: null
    });
    return { sandbox, toasts };
  }

  it('slipper forbi sperren for en ordre som er Brukt Kjøretøy (ikke lenger avvist)', async () => {
    const { sandbox, toasts } = nySandbox();
    sandbox.S = { ordrer: [{ id: 'ord1', merke: 'KIA', modell: 'EV9', ombygging: { nyttKjoretoy: false, bruktKjoretoy: true } }] };
    await sandbox.genererVegvesenDokumenter('ord1');
    expect(toasts.some(t => /gjelder kun Nytt Kjøretøy/.test(t))).toBe(false);
  });

  it('nekter når verken nyttKjoretoy eller bruktKjoretoy er satt', async () => {
    const { sandbox, toasts } = nySandbox();
    sandbox.S = { ordrer: [{ id: 'ord1', merke: 'KIA', modell: 'EV9' }] };
    await sandbox.genererVegvesenDokumenter('ord1');
    expect(toasts.some(t => /Nytt Kjøretøy/.test(t))).toBe(true);
  });
});

const KIA_EV9_GEOMETRI = { a: 3.100, b: 1.480, d: 2.120, cOffset: 1.75 };

describe('vegvesenGeometri', () => {
  it('finner geometri for KIA EV9 uavhengig av store/små bokstaver', () => {
    expect(vegvesenGeometri('KIA', 'EV9')).toEqual(KIA_EV9_GEOMETRI);
    expect(vegvesenGeometri('kia', 'ev9')).toEqual(KIA_EV9_GEOMETRI);
  });
  it('returnerer null for ukjent modell', () => {
    expect(vegvesenGeometri('Mercedes', 'Sprinter')).toBeNull();
  });

  // cOffset er IKKE en universell EU-konstant (1.75), men varierer reelt per modell
  // (1.55-1.97) - verifisert direkte mot FORMELEN (ikke bare hurtigbufret verdi) i hvert
  // referanseregneark 2026-09-18. En feil her gir feil "jevnt fordelt last"-tall til
  // Statens vegvesen for disse modellene.
  it('bruker riktig per-modell cOffset for de nye modellene (ikke KIA sin 1.75)', () => {
    expect(vegvesenGeometri('KGM', 'Rexton')).toEqual({ a: 2.865, b: 1.430, d: 2.061, cOffset: 1.75 });
    expect(vegvesenGeometri('Land Rover', 'Defender 110')).toEqual({ a: 3.022, b: 1.600, d: 1.600, cOffset: 1.94 });
    expect(vegvesenGeometri('Land Rover', 'Discovery 5')).toEqual({ a: 2.923, b: 1.550, d: 1.860, cOffset: 1.97 });
    expect(vegvesenGeometri('Mercedes-Benz', 'GLS')).toEqual({ a: 3.135, b: 1.510, d: 2.080, cOffset: 1.88 });
    expect(vegvesenGeometri('Mercedes-Benz', 'Geländewagen')).toEqual({ a: 2.890, b: 1.490, d: 1.620, cOffset: 1.87 });
    expect(vegvesenGeometri('Volkswagen', 'ID.Buzz')).toEqual({ a: 3.239, b: 1.180, d: 2.416, cOffset: 1.55 });
  });
});

describe('beregnVektfordeling (mot referanseeksempelet fra Henrik)', () => {
  // P=3240, P1=1590, P2=1860, M=2500, M1=1240, M2=1260 - de originale tallene fra
  // Vektfordeling - KIA EV9.xlsx. Regnearket viser her at aksel 2 for n=1 ("606,42 kg")
  // IKKE er sann (606,42 > 600), mens n=2 ("574,24 kg") ER sann - altså et eksempel som
  // FEILER Henrik sitt krav (de to nederste på bakaksel må begge være sanne).
  const P=3240, P1=1590, P2=1860, M=2500, M1=1240, M2=1260;

  it('gjenskaper de eksakte tallene fra referanseregnearket', () => {
    const res = beregnVektfordeling(P, P1, P2, M, M1, M2, KIA_EV9_GEOMETRI);
    expect(res.frontMaks).toBeCloseTo(350, 1);   // C10-C13 = 1590-1240
    expect(res.bakMaks).toBeCloseTo(600, 1);     // C11-C14 = 1860-1260

    expect(res.rader[0].nyttelast).toBeCloseTo(665, 1);
    expect(res.rader[1].nyttelast).toBeCloseTo(590, 1);
    expect(res.rader[2].nyttelast).toBeCloseTo(515, 1);

    expect(res.rader[0].front).toBeCloseTo(101.40, 1);
    expect(res.rader[1].front).toBeCloseTo(133.58, 1);
    expect(res.rader[2].front).toBeCloseTo(165.76, 1);
    expect(res.frontOppfylt).toBe(true);

    expect(res.rader[0].bak).toBeCloseTo(638.60, 1);
    expect(res.rader[1].bak).toBeCloseTo(606.42, 1);
    expect(res.rader[2].bak).toBeCloseTo(574.24, 1);
    expect(res.rader[1].bakOk).toBe(false); // 606.42 > 600
    expect(res.rader[2].bakOk).toBe(true);  // 574.24 <= 600
    expect(res.bakOppfylt).toBe(false); // n=1 feiler kravet
    expect(res.oppfylt).toBe(false);
  });

  it('finner en lavere totalvekt som gjør at kravet oppfylles', () => {
    const justertP = finnJustertTotalvekt(P, P1, P2, M, M1, M2, KIA_EV9_GEOMETRI);
    expect(justertP).toBeLessThan(P);
    expect(Number.isInteger(justertP)).toBe(true);

    // Med den justerte totalvekten skal ALLE kravene være oppfylt.
    const res = beregnVektfordeling(justertP, P1, P2, M, M1, M2, KIA_EV9_GEOMETRI);
    expect(res.oppfylt).toBe(true);

    // Justeringen skal være minst mulig (justertP+1 skal IKKE lenger tilfredsstille -
    // runder ned til nærmeste hele kg, ikke lenger enn nødvendig).
    const resPluss1 = beregnVektfordeling(justertP + 1, P1, P2, M, M1, M2, KIA_EV9_GEOMETRI);
    expect(resPluss1.oppfylt).toBe(false);
  });

  it('rører ikke en totalvekt som allerede tilfredsstiller kravet', () => {
    // Svært høy P1/P2 (aksel-rating) gir rikelig klaring uansett P/M - garantert sann.
    const romsligP1 = 5000, romsligP2 = 5000;
    const res = beregnVektfordeling(P, romsligP1, romsligP2, M, M1, M2, KIA_EV9_GEOMETRI);
    expect(res.oppfylt).toBe(true);
    const justertP = finnJustertTotalvekt(P, romsligP1, romsligP2, M, M1, M2, KIA_EV9_GEOMETRI);
    expect(justertP).toBe(P);
  });
});

describe('beregnVektfordeling (mot et andre ekte eksempel, chassis KNAAD8156T6076001)', () => {
  const P=3111, P1=1590, P2=1860, M=2500, M1=1230, M2=1260;
  it('gjenskaper tallene og alt er SANN uten justering', () => {
    const res = beregnVektfordeling(P, P1, P2, M, M1, M2, {a:3.100,b:1.480,d:2.120,cOffset:1.75});
    expect(res.rader[0].nyttelast).toBeCloseTo(536, 0);
    expect(res.rader[1].nyttelast).toBeCloseTo(461, 0);
    expect(res.rader[2].nyttelast).toBeCloseTo(386, 0);
    expect(res.rader[0].front).toBeCloseTo(89.34, 1);
    expect(res.rader[1].front).toBeCloseTo(121.51, 1);
    expect(res.rader[2].front).toBeCloseTo(153.69, 1);
    expect(res.rader[0].bak).toBeCloseTo(521.66, 1);
    expect(res.rader[1].bak).toBeCloseTo(489.49, 1);
    expect(res.rader[2].bak).toBeCloseTo(457.31, 1);
    expect(res.oppfylt).toBe(true);
    const justertP = finnJustertTotalvekt(P, P1, P2, M, M1, M2, {a:3.100,b:1.480,d:2.120,cOffset:1.75});
    expect(justertP).toBe(P);
  });
});

// vegvesenErKomplett/vegvesenFingerprint/vegvesenFlateKontext trenger en egen S -
// lastes i en egen sandbox (samme fil, men denne gangen med S i ekstraGlobals) i
// stedet for å gjenbruke instansen over, som bevisst har ingen S.
function nyFlateSandbox() {
  const S = { ordrer: [], flater: [] };
  const env = loadScript('vegvesen-dokumenter.js', { S });
  return { S, ...env };
}

function komplettOrdre(overrides = {}) {
  return {
    id: 'ord_1', merke: 'KIA', modell: 'EV9', chassis: 'KNAAD8159S6071163',
    farge: 'Hvit', kunde: 'Testforhandler AS', forhandlerOrgnr: '999888777',
    vekter: {
      totalvekt: { a: '3240', v: '2500' },
      foraksel: { a: '1590', v: '1240' },
      bakaksel: { a: '1860', v: '1260' },
    },
    ...overrides,
  };
}

describe('vegvesenErKomplett', () => {
  it('er komplett når chassis/farge/forhandler/org.nr og alle 6 vektfelt er fylt ut', () => {
    const { vegvesenErKomplett } = nyFlateSandbox();
    expect(vegvesenErKomplett(komplettOrdre())).toBe(true);
  });

  it.each(['chassis', 'farge', 'kunde', 'forhandlerOrgnr'])('er IKKE komplett når %s mangler', (felt) => {
    const { vegvesenErKomplett } = nyFlateSandbox();
    expect(vegvesenErKomplett(komplettOrdre({ [felt]: '' }))).toBe(false);
  });

  it.each(['totalvekt', 'foraksel', 'bakaksel'])('er IKKE komplett når vekt-feltet %s mangler "Ved ankomst"', (akse) => {
    const { vegvesenErKomplett } = nyFlateSandbox();
    const o = komplettOrdre();
    o.vekter[akse].a = '';
    expect(vegvesenErKomplett(o)).toBe(false);
  });

  it.each(['totalvekt', 'foraksel', 'bakaksel'])('er IKKE komplett når vekt-feltet %s mangler "Før visning"', (akse) => {
    const { vegvesenErKomplett } = nyFlateSandbox();
    const o = komplettOrdre();
    o.vekter[akse].v = '';
    expect(vegvesenErKomplett(o)).toBe(false);
  });
});

describe('vegvesenFingerprint', () => {
  it('gir samme fingerprint for identiske data (idempotent - ingen unødvendig regenerering)', () => {
    const { vegvesenFingerprint } = nyFlateSandbox();
    const o1 = komplettOrdre();
    const o2 = komplettOrdre();
    expect(vegvesenFingerprint(o1, null)).toBe(vegvesenFingerprint(o2, null));
  });

  it('endrer fingerprint når en vekt endres', () => {
    const { vegvesenFingerprint } = nyFlateSandbox();
    const o = komplettOrdre();
    const fp1 = vegvesenFingerprint(o, null);
    o.vekter.totalvekt.a = '3250';
    expect(vegvesenFingerprint(o, null)).not.toBe(fp1);
  });

  it('endrer fingerprint når chassis endres', () => {
    const { vegvesenFingerprint } = nyFlateSandbox();
    const o = komplettOrdre();
    const fp1 = vegvesenFingerprint(o, null);
    o.chassis = 'ANNET-CHASSIS';
    expect(vegvesenFingerprint(o, null)).not.toBe(fp1);
  });

  it('endrer fingerprint når et flåtemedlem legges til, selv om primær-dataene er uendret', () => {
    const { vegvesenFingerprint } = nyFlateSandbox();
    const primaer = komplettOrdre();
    const flate = { id: 'flate_1', flatenummer: '1032', primaerOrdreId: primaer.id };
    const fp1 = vegvesenFingerprint(primaer, { flate, primaer, medlemmer: [primaer] });
    const annen = komplettOrdre({ id: 'ord_2', chassis: 'ANNET-CHASSIS-2' });
    const fp2 = vegvesenFingerprint(primaer, { flate, primaer, medlemmer: [primaer, annen] });
    expect(fp2).not.toBe(fp1);
  });
});

describe('vegvesenFlateKontext', () => {
  it('returnerer null for en ordre uten flateId', () => {
    const { S, vegvesenFlateKontext } = nyFlateSandbox();
    S.ordrer = [komplettOrdre()];
    expect(vegvesenFlateKontext(S.ordrer[0])).toBeNull();
  });

  it('returnerer null hvis flateId peker på en flåte som ikke finnes', () => {
    const { S, vegvesenFlateKontext } = nyFlateSandbox();
    const o = komplettOrdre({ flateId: 'finnes_ikke' });
    S.ordrer = [o];
    S.flater = [];
    expect(vegvesenFlateKontext(o)).toBeNull();
  });

  it('finner primær- og medlemslista for en flåte', () => {
    const { S, vegvesenFlateKontext } = nyFlateSandbox();
    const primaer = komplettOrdre({ id: 'ord_primaer', flateId: 'flate_1' });
    const sekundaer = komplettOrdre({ id: 'ord_sek', chassis: 'ANNET-CHASSIS', flateId: 'flate_1' });
    S.ordrer = [primaer, sekundaer];
    S.flater = [{ id: 'flate_1', flatenummer: '1032', primaerOrdreId: 'ord_primaer' }];

    const kontekst = vegvesenFlateKontext(sekundaer);
    expect(kontekst.primaer.id).toBe('ord_primaer');
    expect(kontekst.medlemmer.map(m => m.id).sort()).toEqual(['ord_primaer', 'ord_sek']);
  });

  it('faller tilbake til første medlem som primær hvis primaerOrdreId mangler eller peker på en ordre som ikke lenger er i flåten', () => {
    const { S, vegvesenFlateKontext } = nyFlateSandbox();
    const a = komplettOrdre({ id: 'ord_a', chassis: 'AAA', flateId: 'flate_1' });
    const b = komplettOrdre({ id: 'ord_b', chassis: 'BBB', flateId: 'flate_1' });
    S.ordrer = [a, b];
    S.flater = [{ id: 'flate_1', flatenummer: '1032', primaerOrdreId: 'ordre_som_er_fjernet' }];

    const kontekst = vegvesenFlateKontext(a);
    expect(kontekst.primaer.id).toBe('ord_a'); // sortert på chassis - "AAA" før "BBB"
  });
});

// Defender sin saerligAnmerkning/antallSitteplasser er funksjoner av ordren (unntak fra
// resten av modellene, som har faste verdier) - bekreftet av Henrik 2026-09-23 ut fra
// hakene i Utstyr->Ved ankomst. Eksakte punkt-tekster hentet fra den ekte utstyr-malen
// "Land Rover Defender" (u104) i databasen: "AD", "3-seter foran", "4-seter bak",
// "5-seter bak" - feil skrivemåte her ville stille sluttet å virke.
describe('Land Rover Defender - dynamisk særlig anmerkning og antall sitteplasser', () => {
  const defender = vegvesenFinnModell('Land Rover', 'Defender 110');
  const ordreMed = (...punkter) => ({ utstyrSjekkliste: punkter.map(p => ({ punkt: p, ok: true })) });

  it('bruker TS 095866 og 5/2 seter når ingenting er huket av', () => {
    const o = ordreMed();
    expect(defender.saerligAnmerkning(o)).toBe('Støtdempertårn er merket med delenummer: TS 095866');
    expect(defender.antallSitteplasser(o)).toEqual({ inn: '5', ut: '2' });
  });

  it('bruker TS 034244 L/R når AD er huket av', () => {
    const o = ordreMed('AD');
    expect(defender.saerligAnmerkning(o)).toBe('Støtdempertårn er merket med delenummer: TS 034244 L/R');
  });

  it('gir 6/2 seter for "4-seter bak"', () => {
    expect(defender.antallSitteplasser(ordreMed('4-seter bak'))).toEqual({ inn: '6', ut: '2' });
  });

  it('gir 7/2 seter for "5-seter bak"', () => {
    expect(defender.antallSitteplasser(ordreMed('5-seter bak'))).toEqual({ inn: '7', ut: '2' });
  });

  it('gir 6/3 seter for "3-seter foran"', () => {
    expect(defender.antallSitteplasser(ordreMed('3-seter foran'))).toEqual({ inn: '6', ut: '3' });
  });

  it('ignorerer punkter som ikke er huket av', () => {
    const o = { utstyrSjekkliste: [{ punkt: '5-seter bak', ok: false }, { punkt: 'AD', ok: false }] };
    expect(defender.antallSitteplasser(o)).toEqual({ inn: '5', ut: '2' });
    expect(defender.saerligAnmerkning(o)).toBe('Støtdempertårn er merket med delenummer: TS 095866');
  });
});

// Discovery 5 deler samme AD-avhengige støtdempertårn-logikk som Defender (bekreftet av
// Henrik 2026-09-23: "ja samme der") - antallSitteplasser er UBERØRT (fast verdi), siden
// Discovery 5 sin egen utstyr-mal ("Land Rover Discovery 5", u108) ikke har noen
// tilsvarende sitteplass-avkrysninger.
describe('Land Rover Discovery 5 - dynamisk særlig anmerkning', () => {
  const discovery5 = vegvesenFinnModell('Land Rover', 'Discovery 5');
  const ordreMed = (...punkter) => ({ utstyrSjekkliste: punkter.map(p => ({ punkt: p, ok: true })) });

  it('bruker TS 095866 når AD ikke er huket av', () => {
    expect(discovery5.saerligAnmerkning(ordreMed())).toBe('Støtdempertårn er merket med delenummer: TS 095866');
  });

  it('bruker TS 034244 L/R når AD er huket av', () => {
    expect(discovery5.saerligAnmerkning(ordreMed('AD'))).toBe('Støtdempertårn er merket med delenummer: TS 034244 L/R');
  });

  it('antallSitteplasser er fortsatt en fast verdi, ikke en funksjon av utstyr', () => {
    expect(discovery5.antallSitteplasser()).toEqual({ inn: '5/7', ut: '2' });
  });
});

// Brukt Kjøretøy lagt til 2026-09-23, etter å ha lest Henriks egne referansedokumenter for
// 6 av 7 modeller. Bekreftet forskjell på tvers av ALLE 6: Egenerklæringen utelater alltid
// setningen om merkeplate/fabrikasjonsplate for trinn 2-påbygger, resten er ordrett likt.
describe('Egenerklæring - Brukt Kjøretøy utelater merkeplate/fabrikasjonsplate-setningen', () => {
  it('egenerklaeringAvsnitt (KIA EV9/VW): setningen er med for Nytt, borte for Brukt', () => {
    const nytt = egenerklaeringAvsnitt('standard', 'CHASSIS123', 'KIA EV9', false);
    const brukt = egenerklaeringAvsnitt('standard', 'CHASSIS123', 'KIA EV9', true);
    expect(nytt.some(t => /merket med merkeplate for trinn 2/.test(t))).toBe(true);
    expect(brukt.some(t => /merket med merkeplate for trinn 2/.test(t))).toBe(false);
    expect(brukt.length).toBe(nytt.length - 1);
    // Alt annet skal være ordrett uendret, ikke bare kortere.
    expect(brukt).toEqual(nytt.filter(t => !/merket med merkeplate for trinn 2/.test(t)));
  });

  it('egenerklaeringAvsnittRexton: bruker "fabrikasjonsplate", ikke "merkeplate"', () => {
    const nytt = egenerklaeringAvsnittRexton('CHASSIS123', 'KGM Rexton', false);
    const brukt = egenerklaeringAvsnittRexton('CHASSIS123', 'KGM Rexton', true);
    expect(nytt.some(t => /merket med fabrikasjonsplate for trinn 2/.test(t))).toBe(true);
    expect(brukt.some(t => /merket med fabrikasjonsplate for trinn 2/.test(t))).toBe(false);
    expect(brukt).toEqual(nytt.filter(t => !/merket med fabrikasjonsplate for trinn 2/.test(t)));
  });

  it('egenerklaeringAvsnittLandRover (Defender/Discovery 5)', () => {
    const nytt = egenerklaeringAvsnittLandRover('CHASSIS123', 'Land Rover Defender', false);
    const brukt = egenerklaeringAvsnittLandRover('CHASSIS123', 'Land Rover Defender', true);
    expect(brukt).toEqual(nytt.filter(t => !/merket med merkeplate for trinn 2/.test(t)));
  });

  it('egenerklaeringAvsnittMercedes (Geländewagen/GLS)', () => {
    const nytt = egenerklaeringAvsnittMercedes('CHASSIS123', 'Mercedes-Benz GLS', false);
    const brukt = egenerklaeringAvsnittMercedes('CHASSIS123', 'Mercedes-Benz GLS', true);
    expect(brukt).toEqual(nytt.filter(t => !/merket med merkeplate for trinn 2/.test(t)));
  });

  it('erBruktKjoretoy=undefined oppfører seg som false (ikke krasje/fjerne noe)', () => {
    const uten = egenerklaeringAvsnitt('standard', 'CHASSIS123', 'KIA EV9');
    const eksplisittFalse = egenerklaeringAvsnitt('standard', 'CHASSIS123', 'KIA EV9', false);
    expect(uten).toEqual(eksplisittFalse);
  });
});

// F7 Fabrikasjonsplate-raden skal finnes i ALLE modellers kravRader for Nytt Kjøretøy
// (selve F7-filtreringen for Brukt Kjøretøy skjer inline i genFabrikantattestPDF - dekket
// av manuell PDF-verifisering, se commit - denne testen er en sikkerhetsnett-sjekk på at
// F7-koden faktisk finnes å filtrere bort for hver modell som har ekte Fabrikantattest-data).
describe('kravRader - F7 Fabrikasjonsplate finnes for alle modeller med Fabrikantattest-data', () => {
  const modellerMedF7 = ['KIA EV9', 'KGM Rexton', 'Land Rover Defender 110', 'Land Rover Discovery 5', 'Mercedes-Benz GLS', 'Mercedes-Benz Geländewagen'];
  it.each(modellerMedF7)('%s har en F7-kodet krav-rad', navn => {
    const modell = vegvesenFinnModell('', navn);
    expect(modell.kravRader.some(([kode]) => kode === 'F7')).toBe(true);
  });
});

// KGM Rexton sitt Brukt Kjøretøy-referansedokument har en egen "Andre endringer"-tabell
// (Høyde i stedet for Tillatt totalvekt/vogntogvekt) - bekreftet 2026-09-23, se
// andreEndringerBruktEkstra/Ekskluder-forklaringen på selve VEGVESEN_MODELLER-oppføringen.
describe('KGM Rexton - Andre endringer-overstyring for Brukt Kjøretøy', () => {
  const rexton = vegvesenFinnModell('KGM', 'Rexton');

  it('har en Høyde-rad definert for Brukt Kjøretøy', () => {
    expect(rexton.andreEndringerBruktEkstra).toEqual([['Høyde', '1825mm', '1845mm', 'Egenerklæring', 'Telemark Salmakerverksted']]);
  });

  it('ekskluderer Tillatt totalvekt og Tillatt vogntogvekt for Brukt Kjøretøy', () => {
    expect(rexton.andreEndringerBruktEkskluder).toEqual(['Tillatt totalvekt', 'Tillatt vogntogvekt']);
  });

  it('andre modeller har INGEN slik overstyring (standardoppsettet gjelder)', () => {
    const ev9 = vegvesenFinnModell('KIA', 'EV9');
    expect(ev9.andreEndringerBruktEkstra).toBeUndefined();
    expect(ev9.andreEndringerBruktEkskluder).toBeUndefined();
  });
});
