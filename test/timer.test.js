import { describe, it, expect } from 'vitest';
import { loadScript } from './helpers/load-script.js';

// timer.js sine DOM-avhengige funksjoner (initTimerPage, updateClock osv.)
// kalles aldri her - de rene beregningsfunksjonene lastes bare inn i en
// isolert context uten document/window, akkurat som en vanlig Node-modul.
const {
  beregnNettoMinutter, beregnManuellMinutter, beregnOvertid, erHelg,
  genererEgenmeldingDager, egenmeldingEpisoderSisteAar, egenmeldingerAaAvbryte,
  egenmeldingKvalifisert
} = loadScript('timer.js');

describe('beregnNettoMinutter (pauseregel for automatisk klokke)', () => {
  it('trekker ikke fra pause under 8 timer', () => {
    expect(beregnNettoMinutter(240)).toEqual({ pause: 0, netto: 240 });
  });
  it('trekker ikke fra pause for en kort økt', () => {
    expect(beregnNettoMinutter(20)).toEqual({ pause: 0, netto: 20 });
  });
  it('trekker fra 30 min pause ved nøyaktig 8 timer (480 min)', () => {
    expect(beregnNettoMinutter(480)).toEqual({ pause: 30, netto: 450 });
  });
  it('trekker fra 30 min pause over 8 timer', () => {
    expect(beregnNettoMinutter(510)).toEqual({ pause: 30, netto: 480 });
  });
  it('går aldri under 0 netto minutter', () => {
    expect(beregnNettoMinutter(0).netto).toBe(0);
  });
});

describe('beregnManuellMinutter (manuell timeregistrering)', () => {
  // Regresjonstest for feilen fikset 2026-08-24: manuell registrering trakk
  // FØR alltid fra 30 min pause uansett vaktlengde - en 4-timers halv dag ble
  // registrert som 3,5t, og en økt under 30 min ble registrert som 0 minutter.
  it('full arbeidsdag (07:30-15:30, 8t) gir 450 min etter pause', () => {
    expect(beregnManuellMinutter('07:30', '15:30').mins).toBe(450);
  });
  it('halv dag (07:30-11:30, 4t) skal IKKE miste 30 min pause', () => {
    expect(beregnManuellMinutter('07:30', '11:30').mins).toBe(240);
  });
  it('kort økt (09:00-09:20, 20 min) skal IKKE bli 0', () => {
    expect(beregnManuellMinutter('09:00', '09:20').mins).toBe(20);
  });
  it('gir samme resultat som beregnNettoMinutter for samme rå-minutter', () => {
    const manuell = beregnManuellMinutter('08:00', '16:30'); // 8,5t
    const auto = beregnNettoMinutter(510);
    expect(manuell.mins).toBe(auto.netto);
    expect(manuell.pause).toBe(auto.pause);
  });
});

describe('erHelg', () => {
  it('kjenner igjen lørdag og søndag', () => {
    expect(erHelg('2026-08-22')).toBe(true); // lørdag
    expect(erHelg('2026-08-23')).toBe(true); // søndag
  });
  it('kjenner igjen en hverdag', () => {
    expect(erHelg('2026-08-24')).toBe(false); // mandag
  });
});

describe('beregnOvertid', () => {
  it('all tid på helg regnes som 100% overtid', () => {
    expect(beregnOvertid(300, '2026-08-22')).toEqual({ normal: 0, ot50: 0, ot100: 300 });
  });
  it('under 7,5 timer på hverdag er alt normaltid', () => {
    expect(beregnOvertid(400, '2026-08-24')).toEqual({ normal: 400, ot50: 0, ot100: 0 });
  });
  it('nøyaktig 7,5 timer (450 min) er alt normaltid, ingen overtid', () => {
    expect(beregnOvertid(450, '2026-08-24')).toEqual({ normal: 450, ot50: 0, ot100: 0 });
  });
  it('7,5-11,5 timer gir 50% overtid på resten', () => {
    // 450 normal + 120 min (2t) 50%-overtid = 570 min totalt
    expect(beregnOvertid(570, '2026-08-24')).toEqual({ normal: 450, ot50: 120, ot100: 0 });
  });
  it('over 11,5 timer gir 100% overtid på resten', () => {
    // 450 normal + 240 (maks 50%) + 60 min (1t) 100%-overtid = 750 min totalt
    expect(beregnOvertid(750, '2026-08-24')).toEqual({ normal: 450, ot50: 240, ot100: 60 });
  });
});

// Egenmelding dekker 3 sammenhengende KALENDERDAGER (IKKE bare virkedager) fra og med
// registreringsdatoen - rettet 2026-10-08 etter at Henrik delte den faktiske
// minimumsregelen for egenmelding uten IA-avtale ("maks 3 kalenderdager per gang"). Var
// feilaktig 3 VIRKEDAGER (hoppet over helg) i en tidligere versjon, se git-historikk.
describe('genererEgenmeldingDager', () => {
  it('3 dager på rad uten helg i veien gir dagen selv + de to neste', () => {
    // 2026-08-24 er en mandag (se erHelg-testen over)
    expect(genererEgenmeldingDager('2026-08-24', 3)).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });
  it('teller MED lørdag+søndag når perioden starter på en fredag (kalenderdager, ikke virkedager)', () => {
    // 2026-08-21 er fredagen før mandagen 2026-08-24 - skal IKKE hoppe til mandag/tirsdag
    expect(genererEgenmeldingDager('2026-08-21', 3)).toEqual(['2026-08-21', '2026-08-22', '2026-08-23']);
  });
  it('kan starte på en lørdag uten å hoppe til mandag', () => {
    expect(genererEgenmeldingDager('2026-08-22', 3)).toEqual(['2026-08-22', '2026-08-23', '2026-08-24']);
  });
  it('respekterer et annet antall dager enn standard 3', () => {
    expect(genererEgenmeldingDager('2026-08-24', 1)).toEqual(['2026-08-24']);
    expect(genererEgenmeldingDager('2026-08-21', 5)).toEqual(['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25']);
  });
});

// Maks 4 BETALTE egenmeldinger (episoder, ikke dager) de siste RULLERENDE 12 månedene -
// rettet 2026-10-08 fra feilaktig telling per KALENDERÅR (1. jan-31. des) til faktisk
// rullerende 12-måneders vindu bakover fra registreringsdatoen, etter presisering fra
// Henrik ("maks 4 ganger i løpet av 12 måneder", ikke "per kalenderår"). En 5. (eller
// senere) episode innenfor vinduet skal registreres som ubetalt.
describe('egenmeldingEpisoderSisteAar', () => {
  const lagTimer = (ansattId, type, dato, periodeId) => ({ ansattId, type, dato, egenmeldingPeriodeId: periodeId });
  it('teller 0 når ansatten ikke har hatt noen egenmelding', () => {
    expect(egenmeldingEpisoderSisteAar([], 1, '2026-06-15')).toBe(0);
  });
  it('teller ANTALL EPISODER, ikke antall dager - 2 episoder á 3 dager gir 2, ikke 6', () => {
    const timer = [
      ...['2026-01-05','2026-01-06','2026-01-07'].map(d=>lagTimer(1,'egenmelding',d,'ep1')),
      ...['2026-03-02','2026-03-03','2026-03-04'].map(d=>lagTimer(1,'egenmelding',d,'ep2'))
    ];
    expect(egenmeldingEpisoderSisteAar(timer, 1, '2026-06-15')).toBe(2);
  });
  it('teller ikke en annen ansatts egenmeldinger', () => {
    const timer = [lagTimer(2, 'egenmelding', '2026-01-05', 'ep1')];
    expect(egenmeldingEpisoderSisteAar(timer, 1, '2026-06-15')).toBe(0);
  });
  // Regresjonstest for selve bug-fiksen: en episode fra like før nyttår skal FORTSATT
  // telle med rett etter årsskiftet, siden det er godt innenfor de siste 12 månedene -
  // den gamle (feilaktige) kalenderår-tellingen ville gitt 0 her.
  it('teller MED en episode fra rett før nyttår når man sjekker rett etter nyttår (rullerende, ikke kalenderår)', () => {
    const timer = [lagTimer(1, 'egenmelding', '2025-12-30', 'ep1')];
    expect(egenmeldingEpisoderSisteAar(timer, 1, '2026-01-05')).toBe(1);
  });
  it('teller ikke en episode som er mer enn 12 måneder gammel', () => {
    const timer = [lagTimer(1, 'egenmelding', '2025-06-15', 'ep1')]; // én dag for tidlig
    expect(egenmeldingEpisoderSisteAar(timer, 1, '2026-06-15')).toBe(0);
  });
  it('teller MED en episode nøyaktig 12 måneder tilbake (vinduets første dag)', () => {
    const timer = [lagTimer(1, 'egenmelding', '2025-06-16', 'ep1')];
    expect(egenmeldingEpisoderSisteAar(timer, 1, '2026-06-15')).toBe(1);
  });
  it('teller ikke andre fraværstyper (syk/ferie/permisjon)', () => {
    const timer = [lagTimer(1, 'syk', '2026-01-05', 'ep1'), lagTimer(1, 'ferie', '2026-01-06', 'ep2')];
    expect(egenmeldingEpisoderSisteAar(timer, 1, '2026-06-15')).toBe(0);
  });
  it('ignorerer rader uten egenmeldingPeriodeId (f.eks. gamle rader fra før denne kolonnen fantes)', () => {
    const timer = [{ ansattId:1, type:'egenmelding', dato:'2026-01-05' }];
    expect(egenmeldingEpisoderSisteAar(timer, 1, '2026-06-15')).toBe(0);
  });
});

// Starter den ansatte en vanlig timer igjen før de 3 egenmeldingsdagene er omme, skal
// resten av perioden kuttes bort - men ALLEREDE PASSERTE dager beholdes, siden de faktisk
// ble brukt (bedt om av Henrik 2026-10-02: "blir overkjørt av hvis den ansatte starter
// timer").
describe('egenmeldingerAaAvbryte', () => {
  const lagTimer = (id, ansattId, type, dato) => ({ id, ansattId, type, dato });
  it('finner kun dagene FRA OG MED i dag, ikke allerede passerte dager', () => {
    const timer = [
      lagTimer('t1', 1, 'egenmelding', '2026-08-24'),
      lagTimer('t2', 1, 'egenmelding', '2026-08-25'),
      lagTimer('t3', 1, 'egenmelding', '2026-08-26')
    ];
    // Ansatt starter en timer 2026-08-25 (dag 2 av 3) - dag 1 (24.) er allerede brukt og
    // skal IKKE kuttes, dag 2 og 3 (25./26.) skal kuttes.
    const resultat = egenmeldingerAaAvbryte(timer, 1, '2026-08-25');
    expect(resultat.map(t=>t.id)).toEqual(['t2', 't3']);
  });
  it('rører ikke en annen ansatts egenmelding', () => {
    const timer = [lagTimer('t1', 2, 'egenmelding', '2026-08-25')];
    expect(egenmeldingerAaAvbryte(timer, 1, '2026-08-25')).toEqual([]);
  });
  it('rører ikke andre fraværstyper (kun egenmelding skal kunne overkjøres slik)', () => {
    const timer = [lagTimer('t1', 1, 'syk', '2026-08-25'), lagTimer('t2', 1, 'ferie', '2026-08-25')];
    expect(egenmeldingerAaAvbryte(timer, 1, '2026-08-25')).toEqual([]);
  });
  it('gir tom liste når det ikke finnes noen aktiv/fremtidig egenmelding', () => {
    const timer = [lagTimer('t1', 1, 'egenmelding', '2026-08-20')];
    expect(egenmeldingerAaAvbryte(timer, 1, '2026-08-25')).toEqual([]);
  });
});

// Egenmelding kan først brukes etter minst 2 måneders ansettelse (faktisk norsk
// minimumsregel, bedt om av Henrik 2026-10-08).
describe('egenmeldingKvalifisert', () => {
  it('regnes som kvalifisert når ansettelsesdato er ukjent (tom/null) - ikke sperr eksisterende ansatte uten data', () => {
    expect(egenmeldingKvalifisert(null, '2026-06-15')).toBe(true);
    expect(egenmeldingKvalifisert(undefined, '2026-06-15')).toBe(true);
    expect(egenmeldingKvalifisert('', '2026-06-15')).toBe(true);
  });
  it('IKKE kvalifisert rett etter ansettelse', () => {
    expect(egenmeldingKvalifisert('2026-06-01', '2026-06-15')).toBe(false);
  });
  it('IKKE kvalifisert én dag før 2-månedersgrensen', () => {
    expect(egenmeldingKvalifisert('2026-06-01', '2026-07-31')).toBe(false);
  });
  it('kvalifisert nøyaktig på 2-månedersdagen', () => {
    expect(egenmeldingKvalifisert('2026-06-01', '2026-08-01')).toBe(true);
  });
  it('kvalifisert godt etter 2-månedersgrensen', () => {
    expect(egenmeldingKvalifisert('2026-01-01', '2026-06-15')).toBe(true);
  });
});
