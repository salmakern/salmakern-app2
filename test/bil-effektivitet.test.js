import { describe, it, expect, beforeEach } from 'vitest';
import { loadScript } from './helpers/load-script.js';

// Dekker de rene beregningsfunksjonene bak bil-effektivitet-funksjonen (måle tid brukt på en
// bil mot en standardtid per modell, og gi ansatte en beskrivende vurdering - bedt om av
// Henrik 2026-10-23). Dekker IKKE de automatiske start/stopp-triggerne (meldPå/meldAv,
// statusoverganger) eller de async DB-kallene (effektivOrdreTidMs/hentArbeidsintervaller) -
// disse krever en ekte/mocket Supabase-klient og er mindre egnet for isolert enhetstesting.
// Se også endreStatus()-testene i ankomstdato-status.test.js for fasetrigger-integrasjonen.

let env;
beforeEach(() => {
  // ordre-diverse.js har en topp-nivå document.addEventListener() for lightbox-Escape
  // (kjører ved innlasting, ikke bare fra en funksjon) - trenger derfor en minimal
  // document-stub for i det hele tatt å kunne lastes i en isolert vm-context.
  env = loadScript('ordre-diverse.js', { S: { standardtider: {} }, document: { addEventListener() {} } });
});

describe('ordreAktivFase() - hvilken klokke skal løpe gitt ordrens status', () => {
  it('returnerer Ombygging-feltet for status "paabegynt"', () => {
    expect(env.ordreAktivFase({ ordreStatus: 'paabegynt' })).toBe('ordreTimerSessions');
  });
  it('returnerer Klargjøring-feltet for status "vist_biltilsyn"', () => {
    expect(env.ordreAktivFase({ ordreStatus: 'vist_biltilsyn' })).toBe('klargjoringTimerSessions');
  });
  it.each(['ikke_paabegynt', 'paa_vei', 'ikke_veid', 'klar_visning', 'klar_henting', 'hentet'])(
    'returnerer null (ingen klokke) for status "%s" - bevisst dødsone/ferdig', (status) => {
      expect(env.ordreAktivFase({ ordreStatus: status })).toBeNull();
    }
  );
});

describe('bilEffektivitetVurdering() - beskrivende vurdering, ikke karakter', () => {
  it('gir "God" når brukt tid er på eller under standard', () => {
    expect(env.bilEffektivitetVurdering(1.0).label).toBe('God');
    expect(env.bilEffektivitetVurdering(0.7).label).toBe('God');
  });
  it('gir "Nokså god" ved moderat overforbruk (over standard, innenfor terskel)', () => {
    expect(env.bilEffektivitetVurdering(1.1).label).toBe('Nokså god');
    expect(env.bilEffektivitetVurdering(1.2).label).toBe('Nokså god');
  });
  it('gir "Bør følges opp" ved stort overforbruk', () => {
    expect(env.bilEffektivitetVurdering(1.21).label).toBe('Bør følges opp');
    expect(env.bilEffektivitetVurdering(2.0).label).toBe('Bør følges opp');
  });
});

describe('ordreStandardMs() - standardtid er TOTAL for bilen (Ombygging + Klargjøring)', () => {
  it('summerer ombygging og klargjøring til én total standard i millisekunder', () => {
    env.S.standardtider = { 'KIA EV9': { ombygging: 480, klargjoring: 120 } }; // 8t + 2t
    expect(env.ordreStandardMs({ modell: 'KIA EV9' })).toBe(600 * 60000);
  });
  it('returnerer null (ingen vurdering) for en modell uten satt standardtid', () => {
    env.S.standardtider = { 'KIA EV9': { ombygging: 480, klargjoring: 120 } };
    expect(env.ordreStandardMs({ modell: 'VW Crafter' })).toBeNull();
  });
  it('returnerer null hvis standardtiden er satt til 0 (ikke konfigurert ennå)', () => {
    env.S.standardtider = { 'KIA EV9': { ombygging: 0, klargjoring: 0 } };
    expect(env.ordreStandardMs({ modell: 'KIA EV9' })).toBeNull();
  });
});

describe('beregnOverlappMs() - effektiv tid er overlapp mot FAKTISK stemplet arbeidstid', () => {
  const T = (dato, hh, mm=0) => new Date(`${dato}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`).getTime();

  it('teller kun den delen av økten som overlapper med stemplet arbeidstid', () => {
    // Økt fra mandag 14:00 til tirsdag 10:00 (26t rått), men ansatt var kun stemplet inn
    // mandag 14:00-15:30 og tirsdag 07:30-10:00 - natta i mellom skal IKKE telle (dette er
    // selve "står og går hele natta"-problemet fiksen løser).
    const sesjoner = [{ ansattId: 1, start: T('2026-10-19', 14, 0), stopp: T('2026-10-20', 10, 0) }];
    const intervaller = {
      1: [
        { start: T('2026-10-19', 14, 0), slutt: T('2026-10-19', 15, 30) },
        { start: T('2026-10-20', 7, 30), slutt: T('2026-10-20', 10, 0) }
      ]
    };
    const forventetMs = (90 + 150) * 60000; // 1t30m + 2t30m
    expect(env.beregnOverlappMs(sesjoner, intervaller)).toBe(forventetMs);
  });

  it('gir 0 hvis ansatte ikke har noen registrert arbeidstid i det hele tatt', () => {
    const sesjoner = [{ ansattId: 1, start: T('2026-10-19', 8, 0), stopp: T('2026-10-19', 16, 0) }];
    expect(env.beregnOverlappMs(sesjoner, {})).toBe(0);
  });

  it('summerer overlapp separat for flere ansatte på samme ordre (jobbet samtidig)', () => {
    const sesjoner = [
      { ansattId: 1, start: T('2026-10-19', 8, 0), stopp: T('2026-10-19', 12, 0) },
      { ansattId: 2, start: T('2026-10-19', 8, 0), stopp: T('2026-10-19', 12, 0) }
    ];
    const intervaller = {
      1: [{ start: T('2026-10-19', 8, 0), slutt: T('2026-10-19', 12, 0) }],
      2: [{ start: T('2026-10-19', 8, 0), slutt: T('2026-10-19', 12, 0) }]
    };
    // Standardtid er TOTAL for bilen (ikke delt per hode) - to personer x 4t = 8t telles
    // samlet, akkurat som om én person hadde brukt 8t alene.
    expect(env.beregnOverlappMs(sesjoner, intervaller)).toBe(2 * 4 * 3600000);
  });

  it('ignorerer økter uten ansattId (bør ikke forekomme, men skal ikke krasje)', () => {
    const sesjoner = [{ ansattId: null, start: T('2026-10-19', 8, 0), stopp: T('2026-10-19', 12, 0) }];
    expect(env.beregnOverlappMs(sesjoner, {})).toBe(0);
  });
});
