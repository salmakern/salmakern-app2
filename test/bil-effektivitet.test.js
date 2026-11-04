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
  // KUN Ombygging er automatisert - Klargjøring ble bevisst tatt ut igjen 2026-10-23
  // samme dag (Henrik: klargjøring skjer på varierende tidspunkter, ikke pålitelig
  // avgrenset til statusen "Vist på biltilsynet") og er nå en ren manuell klokke uten
  // noen kobling til status, se startOrdreTimer()/stoppOrdreTimer() i ordre-diverse.js.
  it('returnerer Ombygging-feltet for status "paabegynt"', () => {
    expect(env.ordreAktivFase({ ordreStatus: 'paabegynt' })).toBe('ordreTimerSessions');
  });
  it.each(['ikke_paabegynt', 'paa_vei', 'ikke_veid', 'klar_visning', 'vist_biltilsyn', 'klar_henting', 'hentet'])(
    'returnerer null (ingen automatisk klokke) for status "%s"', (status) => {
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

describe('ordreStandardMs() - standardtid er TOTAL forventet OMBYGGINGS-tid for bilen', () => {
  // Klargjøring telles bevisst IKKE med (bedt om av Henrik 2026-10-28) - det er en ren
  // manuell klokke uten fast fasegrense, og skal derfor ikke inngå i noen sammenligning.
  it('bruker kun ombygging-minuttene, ignorerer et evt. gammelt klargjoring-felt', () => {
    env.S.standardtider = { 'KIA EV9': { ombygging: 480, klargjoring: 120 } }; // 8t + 2t (klargjoring skal ignoreres)
    expect(env.ordreStandardMs({ modell: 'KIA EV9' })).toBe(480 * 60000);
  });
  it('returnerer null (ingen vurdering) for en modell uten satt standardtid', () => {
    env.S.standardtider = { 'KIA EV9': { ombygging: 480 } };
    expect(env.ordreStandardMs({ modell: 'VW Crafter' })).toBeNull();
  });
  it('returnerer null hvis standardtiden er satt til 0 (ikke konfigurert ennå)', () => {
    env.S.standardtider = { 'KIA EV9': { ombygging: 0 } };
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

// ── Reparert effektiv-tid-beregning (2026-11-04, «A: reparer dagens») ───────────────────────────────────────────────────────────────────────────────────────────
// Før: to overlappende timeføringer (funnet i dataene: Ismail 2.11, Henrik 30.9/7.10/10.10) telte tiden to ganger, 30 min lunsjpause som er trukket i lønnen ble ikke trukket her,
// og en ansatt som var stemplet inn akkurat nå (ennå uten timeføring) fikk 0 effektiv tid.
describe('slaaSammenTidsrom() - overlappende tidsrom telles én gang', () => {
  const T = (h, m = 0) => new Date(`2026-11-02T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
  it('slår sammen overlappende og innesluttede tidsrom, men holder tangerende adskilt', () => {
    const r = env.slaaSammenTidsrom([{ start: T(10), slutt: T(12) }, { start: T(7), slutt: T(15, 30) }, { start: T(16), slutt: T(17) }, { start: T(17), slutt: T(18) }]);
    expect(r.map((x) => [x.start, x.slutt])).toEqual([[T(7), T(15, 30)], [T(16), T(17)], [T(17), T(18)]]);
  });
  it('sammenslått gruppe får vekten til det LENGSTE tidsrommet; tidsrom uten vekt blir stående uten', () => {
    const r = env.slaaSammenTidsrom([{ start: T(7), slutt: T(15, 30), vekt: 0.94 }, { start: T(10), slutt: T(12), vekt: 1 }]);
    expect(r).toHaveLength(1); expect(r[0].vekt).toBe(0.94);
    // det LENGSTE tidsrommet kommer SIST (etter sortering på start): da må gruppen skifte vekt underveis
    const sist = env.slaaSammenTidsrom([{ start: T(9), slutt: T(10), vekt: 1 }, { start: T(9, 30), slutt: T(15, 30), vekt: 0.94 }]);
    expect(sist).toHaveLength(1); expect(sist[0].vekt).toBe(0.94); expect(sist[0].slutt).toBe(T(15, 30));
    expect(env.slaaSammenTidsrom([{ start: 1, slutt: 5 }])[0].vekt).toBeUndefined();
  });
  it('ugyldige tidsrom (slutt <= start), null og tom liste gir ingen feil', () => {
    expect(env.slaaSammenTidsrom([{ start: 5, slutt: 5 }, { start: 9, slutt: 2 }, null])).toEqual([]);
    expect(env.slaaSammenTidsrom(null)).toEqual([]);
    expect(env.slaaSammenTidsrom([])).toEqual([]);
  });
  it('uendelig tidsrom (offline-reserven) tåles', () => {
    expect(env.slaaSammenTidsrom([{ start: -Infinity, slutt: Infinity }])).toHaveLength(1);
  });
});

describe('beregnOverlappMs() - ingen dobbelttelling, pausevekt', () => {
  const T = (h, m = 0, dato = '2026-11-02') => new Date(`${dato}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
  it('to timeføringer som dekker samme tid (Ismail 2.11) gir tiden ÉN gang', () => {
    const sesjoner = [{ ansattId: 1, start: T(8), stopp: T(12) }];
    const dobbelt = { 1: [{ start: T(7), slutt: T(15, 30) }, { start: T(7), slutt: T(15, 30) }] };
    const enkelt = { 1: [{ start: T(7), slutt: T(15, 30) }] };
    expect(env.beregnOverlappMs(sesjoner, dobbelt)).toBe(4 * 3600000);
    expect(env.beregnOverlappMs(sesjoner, dobbelt)).toBe(env.beregnOverlappMs(sesjoner, enkelt));
  });
  it('delvis overlappende føringer (07:00–12:00 og 11:00–15:00) gir den sammenhengende tiden 07:00–15:00 én gang', () => {
    const sesjoner = [{ ansattId: 1, start: T(7), stopp: T(15) }];
    expect(env.beregnOverlappMs(sesjoner, { 1: [{ start: T(7), slutt: T(12) }, { start: T(11), slutt: T(15) }] })).toBe(8 * 3600000);
  });
  it('lunsjpausen trekkes: føring 07:00–15:30 (510 min rå, 480 netto) gir 480 min effektiv tid for en økt som dekker hele dagen', () => {
    const sesjoner = [{ ansattId: 1, start: T(7), stopp: T(15, 30) }];
    const vekt = env.arbeidstidVekt(480, T(7), T(15, 30));
    expect(env.beregnOverlappMs(sesjoner, { 1: [{ start: T(7), slutt: T(15, 30), vekt }] })).toBe(480 * 60000);
  });
  it('overlappende ØKTER for samme ansatt (to klokker samtidig på samme ordre) telles én gang, men ulike ansatte telles hver for seg', () => {
    const intervaller = { 1: [{ start: T(7), slutt: T(15) }], 2: [{ start: T(7), slutt: T(15) }] };
    expect(env.beregnOverlappMs([{ ansattId: 1, start: T(8), stopp: T(12) }, { ansattId: 1, start: T(10), stopp: T(14) }], intervaller)).toBe(6 * 3600000);
    expect(env.beregnOverlappMs([{ ansattId: 1, start: T(8), stopp: T(12) }, { ansattId: 2, start: T(8), stopp: T(12) }], intervaller)).toBe(8 * 3600000);
  });
  it('en økt som starter i går kveld og går over natta teller bare arbeidstiden (natta gir 0) - selve «hele natta»-tilfellet', () => {
    const sesjoner = [{ ansattId: 1, start: T(13, 56, '2026-11-03'), stopp: T(8, 0, '2026-11-04') }];
    const intervaller = { 1: [{ start: T(7, 0, '2026-11-03'), slutt: T(15, 0, '2026-11-03') }, { start: T(7, 0, '2026-11-04'), slutt: T(8, 0, '2026-11-04') }] };
    expect(env.beregnOverlappMs(sesjoner, intervaller)).toBe((64 + 60) * 60000);   // 13:56-15:00 + 07:00-08:00
  });
  it('en pågående økt (ingen stopp) regnes til nå, og ugyldige økter (stopp før start) bidrar ikke', () => {
    const naa = Date.now();
    expect(env.beregnOverlappMs([{ ansattId: 1, start: naa - 3600000, stopp: null }], { 1: [{ start: naa - 7200000, slutt: naa + 7200000 }] })).toBeGreaterThanOrEqual(3600000 - 50);
    expect(env.beregnOverlappMs([{ ansattId: 1, start: T(12), stopp: T(8) }], { 1: [{ start: T(7), slutt: T(15) }] })).toBe(0);
  });
  it('mangler vekt = hele tidsrommet teller (som før), og resultatet er alltid et helt tall', () => {
    expect(env.beregnOverlappMs([{ ansattId: 1, start: 0, stopp: 1000 }], { 1: [{ start: 0, slutt: 1000 }] })).toBe(1000);
    expect(Number.isInteger(env.beregnOverlappMs([{ ansattId: 1, start: 0, stopp: 1001 }], { 1: [{ start: 0, slutt: 1001, vekt: 480 / 510 }] }))).toBe(true);
  });
});

describe('arbeidstidVekt()', () => {
  it('netto delt på rå tid, aldri over 1, og 1 når mins mangler/er ugyldig', () => {
    const a = new Date('2026-11-02T07:00:00').getTime(), b = new Date('2026-11-02T15:30:00').getTime();
    expect(env.arbeidstidVekt(480, a, b)).toBeCloseTo(480 / 510, 10);
    expect(env.arbeidstidVekt(510, a, b)).toBe(1);
    expect(env.arbeidstidVekt(600, a, b)).toBe(1);        // aldri over 1
    for (const m of [0, null, undefined, 'x', -5]) expect(env.arbeidstidVekt(m, a, b)).toBe(1);
    expect(env.arbeidstidVekt(60, b, a)).toBe(1);         // ugyldig tidsrom
  });
});

describe('hentArbeidsintervaller() - mot en falsk database', () => {
  function dbMedRader(rader, feil = null) {
    const q = { filtre: [] };
    const b = new Proxy({}, { get(_, k) { if (k === 'then') return (res) => Promise.resolve({ data: feil ? null : rader, error: feil }).then(res); return (...a) => { q.filtre.push([k, ...a]); return b; }; } });
    return { db: { from: (t) => { q.tabell = t; return b; } }, q };
  }
  const lag = (db, ansatte = []) => loadScript('ordre-diverse.js', { S: { standardtider: {}, ansatte }, db, document: { addEventListener() {} },
    beregnNettoMinutter: (m) => ({ pause: m >= 480 ? 30 : 0, netto: Math.max(0, m - (m >= 480 ? 30 : 0)) }) });

  it('timeføringer blir tidsrom med pausevekt (mins/rå tid), fravær uten tid hoppes over, og datoene utvides en dag på hver side', async () => {
    const { db, q } = dbMedRader([
      { ansatt_id: 1, dato: '2026-11-02', start: '07:00', stopp: '15:30', type: 'normal', mins: 480 },
      { ansatt_id: 1, dato: '2026-11-03', start: '–', stopp: '–', type: 'normal', mins: 0 },
      { ansatt_id: 1, dato: '2026-11-04', start: '08:00', stopp: '12:00', type: 'manuell', mins: null },
    ]);
    const r = await lag(db).hentArbeidsintervaller([1], '2026-11-02', '2026-11-04');
    expect(r[1]).toHaveLength(2);
    expect(r[1][0].vekt).toBeCloseTo(480 / 510, 10);
    expect(r[1][1].vekt).toBe(1);
    expect(q.filtre).toContainEqual(['gte', 'dato', '2026-11-01']);
    expect(q.filtre).toContainEqual(['lte', 'dato', '2026-11-05']);
    expect(q.filtre).toContainEqual(['in', 'type', ['normal', 'manuell']]);
  });
  it('en ansatt som er stemplet inn akkurat nå (ingen føring ennå) får et pågående tidsrom frem til nå', async () => {
    const { db } = dbMedRader([]);
    const inn = new Date(Date.now() - 2 * 3600000).toISOString();
    const r = await lag(db, [{ id: 1, stempletInnSiden: inn }, { id: 2, stempletInnSiden: null }]).hentArbeidsintervaller([1, 2], '2026-11-04', '2026-11-04');
    expect(r[1]).toHaveLength(1);
    expect(r[1][0].slutt - r[1][0].start).toBeGreaterThanOrEqual(2 * 3600000 - 1000);
    expect(r[1][0].vekt).toBe(1);               // under 8 t: ingen pause trukket
    expect(r[2]).toBeUndefined();
  });
  it('stemplet inn i over 8 timer: pausetrekket (30 min) tas med i vekten; ansatt som ikke spørres om telles ikke', async () => {
    const { db } = dbMedRader([]);
    const inn = new Date(Date.now() - 10 * 3600000).toISOString();
    const r = await lag(db, [{ id: 1, stempletInnSiden: inn }, { id: 9, stempletInnSiden: inn }]).hentArbeidsintervaller([1], '2026-11-04', '2026-11-04');
    expect(r[1][0].vekt).toBeCloseTo(570 / 600, 3);
    expect(r[9]).toBeUndefined();
  });
  it('ugyldig innstemplingstidspunkt eller et i fremtiden gir ikke noe tidsrom (aldri kast)', async () => {
    const { db } = dbMedRader([]);
    const r = await lag(db, [{ id: 1, stempletInnSiden: 'ikke-en-dato' }, { id: 2, stempletInnSiden: new Date(Date.now() + 3600000).toISOString() }]).hentArbeidsintervaller([1, 2], '2026-11-04', '2026-11-04');
    expect(r).toEqual({});
  });
  it('databasefeil gir tomt resultat (som før), og uten database/ansatte likeså', async () => {
    expect(await lag(dbMedRader(null, { message: 'nett' }).db).hentArbeidsintervaller([1], '2026-11-04', '2026-11-04')).toEqual({});
    expect(await lag(null).hentArbeidsintervaller([1], '2026-11-04', '2026-11-04')).toEqual({});
    expect(await lag(dbMedRader([]).db).hentArbeidsintervaller([], '2026-11-04', '2026-11-04')).toEqual({});
  });
  it('sluttresultatet: en pågående økt for en stemplet-inn ansatt gir effektiv tid (ikke 0)', async () => {
    const naa = Date.now();
    const { db } = dbMedRader([]);
    const e = lag(db, [{ id: 1, stempletInnSiden: new Date(naa - 3 * 3600000).toISOString() }]);
    const r = await e.hentArbeidsintervaller([1], '2026-11-04', '2026-11-04');
    const ms = e.beregnOverlappMs([{ ansattId: 1, start: naa - 2 * 3600000, stopp: null }], r);
    expect(ms).toBeGreaterThan(2 * 3600000 - 5000);
    expect(ms).toBeLessThanOrEqual(2 * 3600000 + 5000);
  });
});

describe('hentArbeidsintervaller() - glemt utstempling gir ikke ubegrenset arbeidstid (gjennomgang 2026-11-04)', () => {
  const lag = (ansatte) => {
    const b = new Proxy({}, { get(_, k) { if (k === 'then') return (res) => Promise.resolve({ data: [], error: null }).then(res); return () => b; } });
    return loadScript('ordre-diverse.js', { S: { standardtider: {}, ansatte }, db: { from: () => b }, document: { addEventListener() {} },
      beregnNettoMinutter: (m) => ({ pause: m >= 480 ? 30 : 0, netto: Math.max(0, m - (m >= 480 ? 30 : 0)) }) });
  };
  it('stemplet inn for 40 timer siden (glemt utstempling): tidsrommet kuttes til 16 t etter innstemplingen', async () => {
    const start = Date.now() - 40 * 3600000;
    const e = lag([{ id: 1, stempletInnSiden: new Date(start).toISOString() }]);
    const r = await e.hentArbeidsintervaller([1], '2026-11-02', '2026-11-04');
    expect(r[1]).toHaveLength(1);
    expect(r[1][0].slutt - r[1][0].start).toBe(16 * 3600000);
    expect(r[1][0].vekt).toBeCloseTo(930 / 960, 6);        // pausetrekket regnes for de 16 timene
  });
  it('hele kjeden: en økt som gikk i 30 timer for en ansatt som glemte å stemple ut gir høyst 16 t effektiv tid (ikke 30)', async () => {
    const naa = Date.now(); const start = naa - 40 * 3600000;
    const e = lag([{ id: 1, stempletInnSiden: new Date(start).toISOString() }]);
    const r = await e.hentArbeidsintervaller([1], '2026-11-02', '2026-11-04');
    const ms = e.beregnOverlappMs([{ ansattId: 1, start: start + 3600000, stopp: start + 31 * 3600000 }], r);
    expect(ms).toBeLessThanOrEqual(15 * 3600000);          // 16 t tak minus 1 t før økta startet, ganget med pausevekten
    expect(ms).toBeGreaterThan(14 * 3600000);
  });
  it('innstemplet for 15 timer siden (under taket): tidsrommet går helt til nå', async () => {
    const e = lag([{ id: 1, stempletInnSiden: new Date(Date.now() - 15 * 3600000).toISOString() }]);
    const r = await e.hentArbeidsintervaller([1], '2026-11-04', '2026-11-04');
    expect(r[1][0].slutt - r[1][0].start).toBeGreaterThanOrEqual(15 * 3600000 - 1000);
    expect(r[1][0].slutt - r[1][0].start).toBeLessThan(15 * 3600000 + 5000);
  });
});
