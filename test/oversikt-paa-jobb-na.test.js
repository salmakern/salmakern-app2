import { describe, it, expect, beforeEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// «På jobb nå» og navn direkte på ordrekortet (Henrik 2026-11-14: «se på det med ansatte
// melder seg på og hvilke biler som blir kjørt inn og hva de holder på med ... kom med
// forslag» - svarte «ta begge da» på de to viste forslagene). Forslag B (denne filens første
// describe): ETT sted, sortert per ansatt - hvem, hvilken bil og hvilken fase, pluss ansatte
// som er stemplet inn uten å ha meldt seg på noen ordre (ellers usynlig utenfor det admin-only
// "Stemplet inn nå"-kortet). Forslag A (andre describe): navnet rett på ordrekortet i Ordre-
// lista og begge Oversikt-listene, der kortet før bare lyste grønt uten å si hvem/hva.

const app = lastApp();
const { sandbox, S } = app;

function nyOrdre({ ansatteSignert, ...over } = {}) {
  return sandbox.dbToOrdre({ id: 'ord_T1', status: 'aktiv', ordre_status: 'paabegynt', chassis: 'TESTWXYZ0000000A1', kunde: 'TEST Kunde AS', ansatte_signert: ansatteSignert, ...over });
}

beforeEach(() => {
  S.ordrer = [];
  S.ansatte = [];
  app.settMe({ id: 1, navn: 'TEST Admin', rolle: 'admin' });
});

function kjor() {
  sandbox.renderPaaJobbNa();
  return {
    synlig: sandbox.document.getElementById('paaJobbNaKort').style.display === 'block',
    html: sandbox.document.getElementById('paaJobbNaListe').innerHTML,
  };
}

describe('renderPaaJobbNa', () => {
  it('ingen ansatte signert eller stemplet inn: kortet er skjult', () => {
    const { synlig, html } = kjor();
    expect(synlig).toBe(false);
    expect(html).toBe('');
  });

  it('én ansatt meldt på en ordre: vises med bil, status og klokkeslett', () => {
    S.ordrer = [nyOrdre({ ansatteSignert: [{ id: 1, navn: 'Ola Nordmann', tid: '09:12' }] })];
    const { synlig, html } = kjor();
    expect(synlig).toBe(true);
    expect(html).toContain('Ola Nordmann');
    expect(html).toContain('Påbegynt');
    expect(html).toContain('09:12');
  });

  it('en ansatt stemplet inn uten å være meldt på noen ordre: vises dempet med egen tekst', () => {
    S.ansatte = [{ id: 3, navn: 'Per Jensen', aktiv: true, stempletInnSiden: '2026-11-14T08:05:00.000Z' }];
    const { synlig, html } = kjor();
    expect(synlig).toBe(true);
    expect(html).toContain('Per Jensen');
    expect(html).toContain('ikke meldt på noen ordre');
  });

  it('en ansatt som ER meldt på en ordre OG stemplet inn: vises bare ÉN gang (i ordre-raden, ikke duplisert)', () => {
    S.ordrer = [nyOrdre({ ansatteSignert: [{ id: 1, navn: 'Ola Nordmann', tid: '09:12' }] })];
    S.ansatte = [{ id: 1, navn: 'Ola Nordmann', aktiv: true, stempletInnSiden: '2026-11-14T08:00:00.000Z' }];
    const { html } = kjor();
    expect((html.match(/Ola Nordmann/g) || []).length).toBe(1);
    expect(html).not.toContain('ikke meldt på noen ordre');
  });

  it('en ordre som ikke er "aktiv" (f.eks. arkivert) telles ikke, selv med ansatteSignert', () => {
    S.ordrer = [nyOrdre({ status: 'arkivert', ansatteSignert: [{ id: 1, navn: 'Ola Nordmann', tid: '09:12' }] })];
    const { synlig } = kjor();
    expect(synlig).toBe(false);
  });

  it('en inaktiv ansatt (aktiv:false) som fortsatt har stempletInnSiden stående, vises ikke', () => {
    S.ansatte = [{ id: 4, navn: 'Gammel Ansatt', aktiv: false, stempletInnSiden: '2026-11-14T08:05:00.000Z' }];
    const { synlig } = kjor();
    expect(synlig).toBe(false);
  });

  it('flere ansatte sorteres alfabetisk på navn', () => {
    S.ordrer = [
      nyOrdre({ id: 'ord_T1', chassis: 'TESTWXYZ0000000A1', ansatteSignert: [{ id: 1, navn: 'Kari Hansen', tid: '10:40' }] }),
      nyOrdre({ id: 'ord_T2', chassis: 'TESTWXYZ0000000A2', ansatteSignert: [{ id: 2, navn: 'Ola Nordmann', tid: '09:12' }] }),
    ];
    const { html } = kjor();
    expect(html.indexOf('Kari Hansen')).toBeLessThan(html.indexOf('Ola Nordmann'));
  });

  it('en ordre med uventet form (ansatteSignert er ikke en liste, f.eks. et korrupt lokalt objekt) hopper over seg selv, blanker ikke resten av lista', () => {
    const rar = nyOrdre({ id: 'ord_RAR' });
    rar.ansatteSignert = 'ikke-en-liste'; // forbi normaliserListe() - simulerer korrupt tilstand i minnet, ikke fra databasen
    S.ordrer = [
      rar,
      nyOrdre({ id: 'ord_OK', chassis: 'TESTWXYZ0000000A2', ansatteSignert: [{ id: 1, navn: 'Ola Nordmann', tid: '09:12' }] }),
    ];
    const { synlig, html } = kjor();
    expect(synlig).toBe(true);
    expect(html).toContain('Ola Nordmann');
  });
});

describe('ansatteSignertChipHTML (navn direkte på kortet, forslag A)', () => {
  it('ingen ansatte meldt på: tom streng', () => {
    expect(sandbox.ansatteSignertChipHTML({ ansatteSignert: [] })).toBe('');
  });

  it('én ansatt: viser navn og klokkeslett', () => {
    const html = sandbox.ansatteSignertChipHTML({ ansatteSignert: [{ navn: 'Ola Nordmann', tid: '09:12' }] });
    expect(html).toContain('Ola Nordmann');
    expect(html).toContain('09:12');
  });

  it('flere ansatte: hver på sin egen rad', () => {
    const html = sandbox.ansatteSignertChipHTML({ ansatteSignert: [{ navn: 'Ola Nordmann', tid: '09:12' }, { navn: 'Kari Hansen', tid: '10:40' }] });
    expect(html).toContain('Ola Nordmann');
    expect(html).toContain('Kari Hansen');
  });

  it('navn med spesialtegn escapes korrekt (XSS-vern)', () => {
    const html = sandbox.ansatteSignertChipHTML({ ansatteSignert: [{ navn: '<script>alert(1)</script>', tid: '09:12' }] });
    expect(html).not.toContain('<script>');
  });
});

// «+ Meld meg på» direkte på kortet (Henrik 2026-11-14, "ta A" av to viste forslag: knapp på
// kortet vs. QR-skann ved bilen). Gjenbruker meldPaa() uendret - "kun én ordre om gangen" (bedt
// om samme dag) er derfor allerede sikret av finnAndreApneOrdreForAnsatt() i den funksjonen,
// ikke noe denne knappen trenger å håndheve selv.
describe('meldPaaKnappHTML', () => {
  it('jeg er IKKE meldt på: viser knappen med riktig ordre-id i onclick', () => {
    const html = sandbox.meldPaaKnappHTML({ id: 'ord_T1', ansatteSignert: [] });
    expect(html).toContain('+ Meld meg på');
    expect(html).toContain("meldPaa('ord_T1')");
  });

  it('jeg er ALLEREDE meldt på denne ordren: tom streng (ingen dupliserende knapp)', () => {
    const html = sandbox.meldPaaKnappHTML({ id: 'ord_T1', ansatteSignert: [{ id: 1, navn: 'TEST Admin', tid: '09:12' }] });
    expect(html).toBe('');
  });

  it('en ANNEN ansatt er meldt på, men ikke meg: knappen vises fortsatt (flere kan stå på samme ordre)', () => {
    const html = sandbox.meldPaaKnappHTML({ id: 'ord_T1', ansatteSignert: [{ id: 2, navn: 'Kari Hansen', tid: '10:40' }] });
    expect(html).toContain('+ Meld meg på');
  });

  it('ingen innlogget ansatt (me er null): tom streng, ikke en krasj', () => {
    app.settMe(null);
    const html = sandbox.meldPaaKnappHTML({ id: 'ord_T1', ansatteSignert: [] });
    expect(html).toBe('');
  });
});
