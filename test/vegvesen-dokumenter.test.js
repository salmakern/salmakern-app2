import { describe, it, expect } from 'vitest';
import { loadScript } from './helpers/load-script.js';

// Formlene her er hentet direkte fra Telemark Salmakerverksted sitt eget
// Vektfordeling-regneark (KIA EV9), ikke utledet på nytt - testene under bruker de
// SAMME tallene som står i deres referanseeksempel for å bekrefte at formlene er
// transkribert riktig, siden dette er tall som går videre til Statens vegvesen.
const { beregnVektfordeling, finnJustertTotalvekt, vegvesenGeometri } = loadScript('vegvesen-dokumenter.js');

const KIA_EV9_GEOMETRI = { a: 3.100, b: 1.480, d: 2.120 };

describe('vegvesenGeometri', () => {
  it('finner geometri for KIA EV9 uavhengig av store/små bokstaver', () => {
    expect(vegvesenGeometri('KIA', 'EV9')).toEqual(KIA_EV9_GEOMETRI);
    expect(vegvesenGeometri('kia', 'ev9')).toEqual(KIA_EV9_GEOMETRI);
  });
  it('returnerer null for ukjent modell', () => {
    expect(vegvesenGeometri('Mercedes', 'Sprinter')).toBeNull();
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
    const res = beregnVektfordeling(P, P1, P2, M, M1, M2, {a:3.100,b:1.480,d:2.120});
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
    const justertP = finnJustertTotalvekt(P, P1, P2, M, M1, M2, {a:3.100,b:1.480,d:2.120});
    expect(justertP).toBe(P);
  });
});
