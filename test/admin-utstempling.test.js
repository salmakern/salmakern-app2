import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// 2026-11-02 (Henrik): «det må være mulig for meg å logge ut ansatte, stemple ut». Admin stempler ut en annen ansatt fra
// «Stemplet inn nå». Timer er lønn, så testene vokter at tiden aldri kan gå tapt eller dobles: innsetting med fast id
// (idempotent), nullstilling bare hvis stemplingen er uendret, og at den ansattes egen klokke stopper uten å registrere på nytt.

const app = lastApp();
const { sandbox, S } = app;
const pad = (n) => String(n).padStart(2, '0');

// En fersk, helt lokal «i går kl. 07:00» så testen ikke avhenger av klokka.
function igaar0700() {
  const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(7, 0, 0, 0);
  return { iso: d.toISOString(), dato: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, ms: d.getTime() };
}

// Falsk Supabase-klient: bygger opp kallet (tabell, innsetting/oppdatering, filtre) og svarer fra en funksjon.
function lagFakeDb(svar) {
  const kall = [];
  const db = {
    from(tabell) {
      const q = { tabell, filtre: [] };
      const b = {
        // .select() ETTER update/insert betyr «returner radene», ikke en lesing: skilles slik at svar-funksjonene kan avgjøre på update/insert først.
        select(k) { if (!q.update && !q.insert) q.select = k; return b; }, insert(r) { q.insert = r; return b; }, update(r) { q.update = r; return b; },
        eq(k, v) { q.filtre.push(['eq', k, v]); return b; }, gte(k, v) { q.filtre.push(['gte', k, v]); return b; },
        limit(n) { q.limit = n; return b; }, single() { q.single = true; return b; },
        then(res, rej) { kall.push(q); return Promise.resolve(svar(q)).then(res, rej); },
      };
      return b;
    },
    rpc(navn, args) { kall.push({ rpc: navn, args }); return Promise.resolve({ data: { sessions: [{ ansattId: args.p_ansatt_id, stopp: 1 }] }, error: null }); },
  };
  return { db, kall };
}

function oppsett({ innIso, rolle = 'admin', ordrer = [] }) {
  S.ansatte = [{ id: 5, navn: 'TEST - Ansatt', aktiv: true, stempletInnSiden: innIso }];
  S.timer = [];
  S.ordrer = ordrer;
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle });
}
function aapneOgSett(tid) {
  sandbox.apneStempleUtModal(5);
  sandbox.document.getElementById('stempleUtTid').value = tid;
}

describe('beregnAdminUtstempling (ren beregning)', () => {
  const inn = igaar0700().iso;
  it('08:30 mellom 07:00 og 15:30 gir 480 netto minutter (30 min pause trekkes fra 8 t 30)', () => {
    const r = sandbox.beregnAdminUtstempling(inn, '15:30');
    expect(r.feil).toBeUndefined();
    expect(r).toMatchObject({ start: '07:00', stopp: '15:30', raatid: 510, mins: 480, pause: 30 });
  });
  it('under 8 timer gir ingen pause', () => {
    expect(sandbox.beregnAdminUtstempling(inn, '14:00')).toMatchObject({ raatid: 420, mins: 420, pause: 0 });
  });
  it('utstempling før eller lik innstemplingen avvises', () => {
    expect(sandbox.beregnAdminUtstempling(inn, '07:00').feil).toMatch(/etter innstemplingen/);
    expect(sandbox.beregnAdminUtstempling(inn, '06:00').feil).toMatch(/etter innstemplingen/);
  });
  it('mer enn 16 timer avvises (sannsynlig feilskriving)', () => {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(1, 0, 0, 0);
    expect(sandbox.beregnAdminUtstempling(d.toISOString(), '23:30').feil).toMatch(/16 timer/);
  });
  it('frem i tid avvises', () => {
    const naa = new Date(); const innNaa = new Date(naa.getFullYear(), naa.getMonth(), naa.getDate(), 0, 1).toISOString();
    expect(sandbox.beregnAdminUtstempling(innNaa, '23:59', new Date(naa.getFullYear(), naa.getMonth(), naa.getDate(), 12, 0)).feil).toMatch(/frem i tid/);
  });
  it('ugyldig inndata gir feilmelding, aldri kast', () => {
    for (const [i, t] of [[null, '15:00'], ['ikke-en-dato', '15:00'], [inn, ''], [inn, null], [inn, '25:61'], [inn, 'abc']]) {
      expect(() => sandbox.beregnAdminUtstempling(i, t)).not.toThrow();
      expect(sandbox.beregnAdminUtstempling(i, t).feil).toBeTruthy();
    }
  });
  it('fast id: samme ansatt og samme innstempling gir alltid samme id', () => {
    expect(sandbox.adminUtstemplingEntryId(5, inn)).toBe('tadm_5_' + new Date(inn).getTime());
  });
});

describe('adminStempleUt', () => {
  let inn;
  beforeEach(() => { inn = igaar0700(); });

  it('registrerer timene med fast id, nullstiller stemplingen (bare hvis uendret), stopper ordre-klokka og oppdaterer lista', async () => {
    const o = { id: 'ord_1', ordreTimerSessions: [{ ansattId: 5, start: 1, stopp: null }] };
    oppsett({ innIso: inn.iso, ordrer: [o] });
    const { db, kall } = lagFakeDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
      if (q.tabell === 'timer_entries' && q.insert) return { data: null, error: null };
      if (q.tabell === 'ansatte' && q.update) return { data: [{ id: 5 }], error: null };
      return { data: null, error: null };
    });
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();

    const ins = kall.find((k) => k.tabell === 'timer_entries' && k.insert);
    expect(ins.insert).toEqual({ id: 'tadm_5_' + inn.ms, ansatt_id: 5, ansatt: 'TEST - Ansatt', dato: inn.dato, type: 'normal', start: '07:00', stopp: '15:30', mins: 480 });
    const upd = kall.find((k) => k.tabell === 'ansatte' && k.update);
    expect(upd.update).toEqual({ stemplet_inn_siden: null });
    expect(upd.filtre).toEqual([['eq', 'id', 5], ['eq', 'stemplet_inn_siden', inn.iso]]);
    // rekkefølge: lese stemplingen, sjekke overlapp mot eksisterende timer, så timen, så nullstilling (aldri nullstille før timen er sikret)
    const rekkefolge = kall.filter((k) => k.tabell).map((k) => k.tabell + (k.insert ? ':insert' : k.update ? ':update' : ':select'));
    expect(rekkefolge).toEqual(['ansatte:select', 'timer_entries:select', 'timer_entries:insert', 'ansatte:update']);
    // Ordreklokkene stoppes i databasen på det VALGTE utstemplingstidspunktet (15:30 den dagen), ikke «nå»
    const stoppKall = kall.find((k) => k.rpc === 'stopp_ordreklokker_for_ansatt');
    expect(stoppKall.args.p_ansatt_id).toBe(5);
    const kl1530 = new Date(inn.ms); kl1530.setHours(15, 30, 0, 0);
    expect(stoppKall.args.p_stopp_ms).toBe(kl1530.getTime());
    expect(S.timer.map((t) => t.id)).toEqual(['tadm_5_' + inn.ms]);
    expect(S.timer[0]).toMatchObject({ ansattId: 5, type: 'normal', mins: 480 });
    expect(S.ansatte[0].stempletInnSiden).toBeNull();
  });

  it('feiler innsettingen av timen: INGEN nullstilling og ingen lokal endring (ingen tid går tapt)', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = lagFakeDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
      if (q.insert) return { data: null, error: { code: '42501', message: 'rls' } };
      return { data: [{ id: 5 }], error: null };
    });
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.update)).toBe(false);
    expect(S.timer).toEqual([]);
    expect(S.ansatte[0].stempletInnSiden).toBe(inn.iso);
  });

  it('duplikat-feil (23505) = «allerede registrert»: går videre og nullstiller, ingen dobbel timeføring', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = lagFakeDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
      if (q.insert) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      if (q.update) return { data: [{ id: 5 }], error: null };
      return { data: null, error: null };
    });
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.update)).toBe(true);
    expect(S.ansatte[0].stempletInnSiden).toBeNull();
  });

  it('nullstillingen treffer ingen rad (stemplingen endret seg): ingen lokal nullstilling, og et nytt forsøk er trygt', async () => {
    oppsett({ innIso: inn.iso });
    const { db } = lagFakeDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
      if (q.insert) return { data: null, error: null };
      if (q.update) return { data: [], error: null };
      return { data: null, error: null };
    });
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(S.ansatte[0].stempletInnSiden).toBe(inn.iso);
  });

  it('ansatten har allerede stemplet ut (databasen viser tom): ingenting registreres', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = lagFakeDb((q) => (q.select ? { data: { stemplet_inn_siden: null }, error: null } : { data: null, error: null }));
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.insert || k.update)).toBe(false);
    expect(S.ansatte[0].stempletInnSiden).toBeNull();
  });

  it('en ugyldig tid (før innstemplingen) registrerer ingenting', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = lagFakeDb((q) => (q.select ? { data: { stemplet_inn_siden: inn.iso }, error: null } : { data: null, error: null }));
    app.settDb(db);
    aapneOgSett('06:00');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.insert || k.update)).toBe(false);
  });

  it('bare admin: en vanlig ansatt kan ikke stemple ut andre (ingen databasekall)', async () => {
    oppsett({ innIso: inn.iso, rolle: 'ansatt' });
    const { db, kall } = lagFakeDb(() => ({ data: null, error: null }));
    app.settDb(db);
    sandbox.apneStempleUtModal(5);
    await sandbox.adminStempleUt();
    expect(kall).toEqual([]);
  });
});

describe('adminStempleUt: advarsel ved overlapp med eksisterende timer (2026-11-04)', () => {
  let inn;
  beforeEach(() => { inn = igaar0700(); sandbox.confirm = () => true; });
  const medEksisterende = (rader) => lagFakeDb((q) => {
    if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
    if (q.tabell === 'timer_entries' && q.select) return { data: rader, error: null };
    if (q.tabell === 'ansatte' && q.update) return { data: [{ id: 5 }], error: null };
    return { data: null, error: null };
  });

  it('overlapper en eksisterende føring (10:00–12:00 mot 07:00–15:30): spør først, og Avbryt gjør INGENTING (ingen innsetting, ingen nullstilling, ingen stopp av klokker)', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = medEksisterende([{ id: 't1', type: 'normal', start: '10:00', stopp: '12:00' }]); app.settDb(db);
    const spurt = []; sandbox.confirm = (t) => { spurt.push(t); return false; };
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(spurt).toHaveLength(1);
    expect(spurt[0]).toContain('10:00–12:00');
    expect(kall.some((k) => k.insert || k.update || k.rpc)).toBe(false);
    expect(S.ansatte[0].stempletInnSiden).toBe(inn.iso);
  });

  it('bekrefter admin likevel, registreres timene som vanlig', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = medEksisterende([{ id: 't1', type: 'manuell', start: '08:00', stopp: '09:00' }]); app.settDb(db);
    sandbox.confirm = () => true;
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.insert)).toBe(true);
    expect(S.ansatte[0].stempletInnSiden).toBeNull();
  });

  it('ingen overlapp: ingen spørsmål. Føringer som bare tangerer (slutter 07:00, starter 15:30), andre typer (ferie/syk) og rader uten tid regnes ikke', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = medEksisterende([
      { id: 'a', type: 'normal', start: '05:00', stopp: '07:00' }, { id: 'b', type: 'normal', start: '15:30', stopp: '16:00' },
      { id: 'c', type: 'ferie', start: '–', stopp: '–' }, { id: 'd', type: 'syk', start: '08:00', stopp: '12:00' }, { id: 'e', type: 'normal', start: null, stopp: null },
    ]); app.settDb(db);
    let spurt = 0; sandbox.confirm = () => { spurt++; return false; };
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(spurt).toBe(0);
    expect(kall.some((k) => k.insert)).toBe(true);
  });

  it('et nytt forsøk av SAMME utstempling (raden med den faste id-en finnes) regnes ikke som overlapp med seg selv', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = medEksisterende([{ id: 'tadm_5_' + inn.ms, type: 'normal', start: '07:00', stopp: '15:30' }]); app.settDb(db);
    let spurt = 0; sandbox.confirm = () => { spurt++; return false; };
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(spurt).toBe(0);
    expect(kall.some((k) => k.insert)).toBe(true);
  });

  it('svikter overlapp-oppslaget, hindrer det aldri utstemplingen', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = lagFakeDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
      if (q.tabell === 'timer_entries' && q.select) return { data: null, error: { message: 'nett' } };
      if (q.update) return { data: [{ id: 5 }], error: null };
      return { data: null, error: null };
    }); app.settDb(db);
    let spurt = 0; sandbox.confirm = () => { spurt++; return false; };
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(spurt).toBe(0);
    expect(kall.some((k) => k.insert)).toBe(true);
  });

  it('rpc for stopp av klokker svikter: den gamle veien brukes som reserve og stopper den åpne økta (en økt per kall)', async () => {
    const o = { id: 'ord_1', ordreTimerSessions: [{ ansattId: 5, start: 1, stopp: null }] };
    oppsett({ innIso: inn.iso, ordrer: [o] });
    const { db, kall } = medEksisterende([]);
    const rpcOpprinnelig = db.rpc;
    db.rpc = (navn, args) => { if (navn === 'stopp_ordreklokker_for_ansatt') { kall.push({ rpc: navn, args }); return Promise.resolve({ data: null, error: { message: 'function does not exist' } }); } return rpcOpprinnelig(navn, args); };
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.rpc === 'oppdater_ordre_timer_sesjon' && k.args.p_handling === 'stopp' && k.args.p_ansatt_id === 5)).toBe(true);
  });
});

describe('tidsrommOverlapper (ren sjekk)', () => {
  it('overlapp, innenfor, tangering, uten overlapp og over midnatt', () => {
    expect(sandbox.tidsrommOverlapper('07:00', '15:30', '10:00', '12:00')).toBe(true);   // det ene inni det andre
    expect(sandbox.tidsrommOverlapper('07:00', '12:00', '11:00', '15:00')).toBe(true);   // delvis
    expect(sandbox.tidsrommOverlapper('07:00', '12:00', '12:00', '15:00')).toBe(false);  // tangerer
    expect(sandbox.tidsrommOverlapper('07:00', '08:00', '09:00', '10:00')).toBe(false);
    expect(sandbox.tidsrommOverlapper('22:00', '02:00', '23:00', '23:30')).toBe(true);   // over midnatt
    // null varighet (Start og Stopp i samme minutt, finnes i dataene) er IKKE et døgn: overlapper aldri, verken som ny eller eksisterende føring
    expect(sandbox.tidsrommOverlapper('08:15', '08:15', '10:00', '12:00')).toBe(false);
    expect(sandbox.tidsrommOverlapper('10:00', '12:00', '08:15', '08:15')).toBe(false);
    expect(sandbox.tidsrommOverlapper('08:15', '08:15', '08:15', '08:15')).toBe(false);
    expect(sandbox.tidsrommOverlapper('08:15', '08:15', '08:00', '09:00')).toBe(false);   // null varighet MIDT i en annen føring
    expect(sandbox.tidsrommOverlapper('08:00', '09:00', '08:15', '08:15')).toBe(false);
  });
  it('mangler eller ugyldig tid gir aldri en falsk advarsel', () => {
    expect(sandbox.tidsrommOverlapper('07:00', '15:30', '–', '–')).toBe(false);
    expect(sandbox.tidsrommOverlapper('', '', '07:00', '15:30')).toBe(false);
    expect(sandbox.tidsrommOverlapper(null, null, null, null)).toBe(false);
  });
});

describe('doLagreManuellTimer: advarsel ved overlapp (2026-11-04)', () => {
  const sett = (fra, til, dato) => {
    sandbox.document.getElementById('mFra').value = fra; sandbox.document.getElementById('mTil').value = til; sandbox.document.getElementById('mDato').value = dato;
  };
  beforeEach(() => { S.timer = []; S.ordrer = []; app.settMe({ id: 7, navn: 'TEST - Ansatt', rolle: 'ansatt' }); });
  const medEksisterende = (rader) => lagFakeDb((q) => {
    if (q.tabell === 'timer_entries' && q.select) return { data: rader, error: null };
    return { data: null, error: null };
  });

  it('overlapp og bruker sier nei: ingenting lagres, feltene beholdes så tidene kan rettes', async () => {
    const { db, kall } = medEksisterende([{ id: 'x', type: 'normal', start: '07:00', stopp: '15:00' }]); app.settDb(db);
    sett('08:00', '12:00', '2026-11-02');
    const spurt = []; sandbox.confirm = (t) => { spurt.push(t); return false; };
    await sandbox.doLagreManuellTimer();
    expect(spurt[0]).toContain('Du har allerede timer');
    expect(spurt[0]).toContain('07:00–15:00');
    expect(kall.some((k) => k.insert)).toBe(false);
    expect(S.timer).toEqual([]);
    expect(sandbox.document.getElementById('mFra').value).toBe('08:00');
  });

  it('overlapp og bruker sier ja: lagres som før', async () => {
    const { db, kall } = medEksisterende([{ id: 'x', type: 'normal', start: '07:00', stopp: '15:00' }]); app.settDb(db);
    sett('08:00', '12:00', '2026-11-02');
    sandbox.confirm = () => true;
    await sandbox.doLagreManuellTimer();
    expect(kall.filter((k) => k.insert)).toHaveLength(1);
    expect(S.timer).toHaveLength(1);
    expect(S.timer[0]).toMatchObject({ type: 'manuell', start: '08:00', stopp: '12:00', dato: '2026-11-02' });
  });

  it('ingen overlapp: lagres uten spørsmål, og spørringen gjelder riktig ansatt og dato', async () => {
    const { db, kall } = medEksisterende([{ id: 'x', type: 'normal', start: '12:00', stopp: '15:00' }]); app.settDb(db);
    sett('08:00', '12:00', '2026-11-02');
    let spurt = 0; sandbox.confirm = () => { spurt++; return false; };
    await sandbox.doLagreManuellTimer();
    expect(spurt).toBe(0);
    expect(kall.filter((k) => k.insert)).toHaveLength(1);
    const les = kall.find((k) => k.tabell === 'timer_entries' && k.select);
    expect(les.filtre).toEqual([['eq', 'ansatt_id', 7], ['eq', 'dato', '2026-11-02']]);
  });

  it('dobbeltrykk mens overlappet sjekkes gir bare én føring', async () => {
    const { db, kall } = medEksisterende([]); app.settDb(db);
    sett('08:00', '12:00', '2026-11-02');
    sandbox.confirm = () => true;
    await Promise.all([sandbox.doLagreManuellTimer(), sandbox.doLagreManuellTimer()]);
    expect(kall.filter((k) => k.insert)).toHaveLength(1);
    expect(S.timer).toHaveLength(1);
  });
});

describe('sjekkAdminUtstempling: den ansattes egen klokke', () => {
  const start = () => Date.now() - 3 * 3600 * 1000;
  const dbMed = (stemplet, registrert, feil) => lagFakeDb((q) => {
    if (feil) return { data: null, error: { message: 'nett' } };
    if (q.tabell === 'ansatte') return { data: { stemplet_inn_siden: stemplet }, error: null };
    return { data: registrert ? [{ id: 'tadm_x' }] : [], error: null };
  });
  beforeEach(() => { app.settMe({ id: 5, navn: 'TEST - Ansatt', rolle: 'ansatt', stempletInnSiden: 'x' }); });

  it('stemplingen er borte og timen er ført etter at klokka startet: klokka stoppes (uten å registrere noe)', async () => {
    const s = start(); app.settTimerStart(s);
    const { db, kall } = dbMed(null, true); app.settDb(db);
    expect(await sandbox.sjekkAdminUtstempling()).toBe(true);
    expect(app.hentTimerStart()).toBeNull();
    expect(kall.some((k) => k.insert)).toBe(false);
    const sporring = kall.find((k) => k.tabell === 'timer_entries');
    expect(sporring.filtre.find((f) => f[0] === 'gte' && f[1] === 'created_at')[2]).toBe(new Date(s).toISOString());
  });

  it('stemplingen er borte, men INGEN timeføring finnes: klokka beholdes (f.eks. mislykket innstemplingsskriving)', async () => {
    const s = start(); app.settTimerStart(s);
    app.settDb(dbMed(null, false).db);
    expect(await sandbox.sjekkAdminUtstempling()).toBe(false);
    expect(app.hentTimerStart()).toBe(s);
  });

  it('stemplingen finnes fortsatt: klokka beholdes', async () => {
    const s = start(); app.settTimerStart(s);
    app.settDb(dbMed('2026-11-02T06:00:00+00:00', true).db);
    expect(await sandbox.sjekkAdminUtstempling()).toBe(false);
    expect(app.hentTimerStart()).toBe(s);
  });

  it('databasefeil: klokka beholdes (aldri slett en ekte klokke på mistanke)', async () => {
    const s = start(); app.settTimerStart(s);
    app.settDb(dbMed(null, true, true).db);
    expect(await sandbox.sjekkAdminUtstempling()).toBe(false);
    expect(app.hentTimerStart()).toBe(s);
  });

  it('ingen gående klokke: ingen databasekall', async () => {
    app.settTimerStart(null);
    const { db, kall } = dbMed(null, true); app.settDb(db);
    expect(await sandbox.sjekkAdminUtstempling()).toBe(false);
    expect(kall).toEqual([]);
  });
});

describe('kobling i appen', () => {
  it('«Stemplet inn nå» har en Stemple ut-knapp per ansatt (kun synlig for admin-kortet)', () => {
    oppsett({ innIso: igaar0700().iso });
    sandbox.renderStempletInnNa();
    const html = sandbox.document.getElementById('stempletInnNaListe').innerHTML;
    expect(html).toContain('apneStempleUtModal(5)');
  });
});

describe('adminStempleUt: utstemplingen er allerede registrert med andre klokkeslett (23505) - gjennomgang 2026-11-04', () => {
  let inn, toasts, ekteToast;
  beforeEach(() => { inn = igaar0700(); toasts = []; ekteToast = sandbox.visToast; sandbox.visToast = (t) => { toasts.push(t); }; sandbox.confirm = () => true; });
  afterEach(() => { sandbox.visToast = ekteToast; });
  const medDuplikat = (eksisterende) => lagFakeDb((q) => {
    if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
    if (q.tabell === 'timer_entries' && q.insert) return { data: null, error: { code: '23505', message: 'duplicate key' } };
    if (q.tabell === 'timer_entries' && q.select) return q.single ? { data: eksisterende, error: null } : { data: [], error: null };
    if (q.update) return { data: [{ id: 5 }], error: null };
    return { data: null, error: null };
  });

  it('raden finnes med ANDRE klokkeslett: avbryter med beskjed, uten nullstilling og uten å stoppe klokker (skjerm og lønnsgrunnlag skal ikke si ulike ting)', async () => {
    oppsett({ innIso: inn.iso, ordrer: [{ id: 'ord_1', ordreTimerSessions: [{ ansattId: 5, start: 1, stopp: null }] }] });
    const { db, kall } = medDuplikat({ start: '07:00', stopp: '15:00' }); app.settDb(db);
    aapneOgSett('16:00');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.update)).toBe(false);
    expect(kall.some((k) => k.rpc)).toBe(false);
    expect(S.ansatte[0].stempletInnSiden).toBe(inn.iso);
    expect(S.timer).toEqual([]);
    expect(toasts.join(' ')).toContain('allerede registrert som 07:00–15:00');
  });
  it('raden finnes med SAMME klokkeslett (nytt forsøk etter at nullstillingen feilet): fullfører som før', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = medDuplikat({ start: '07:00', stopp: '15:30' }); app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.update)).toBe(true);
    expect(S.ansatte[0].stempletInnSiden).toBeNull();
  });
  it('kan raden ikke leses (null), fortsettes som før (aldri en hindring)', async () => {
    oppsett({ innIso: inn.iso });
    const { db, kall } = medDuplikat(null); app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(kall.some((k) => k.update)).toBe(true);
  });
});

describe('adminStempleUt: valgt klokkeslett kan ikke brukes på ordreklokkene (reserve-vei)', () => {
  let toasts, ekteToast;
  beforeEach(() => { toasts = []; ekteToast = sandbox.visToast; sandbox.visToast = (t) => { toasts.push(t); }; sandbox.confirm = () => true; });
  afterEach(() => { sandbox.visToast = ekteToast; });
  it('stopp-funksjonen mangler i databasen og en klokke var åpen: den stoppes «nå», og admin får beskjed om at valgt tid ikke ble brukt', async () => {
    const inn = igaar0700();
    const o = { id: 'ord_1', ordreTimerSessions: [{ ansattId: 5, start: 1, stopp: null }] };
    oppsett({ innIso: inn.iso, ordrer: [o] });
    const { db, kall } = lagFakeDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
      if (q.update) return { data: [{ id: 5 }], error: null };
      return { data: null, error: null };
    });
    const rpcOpprinnelig = db.rpc;
    db.rpc = (navn, args) => (navn === 'stopp_ordreklokker_for_ansatt' ? (kall.push({ rpc: navn, args }), Promise.resolve({ data: null, error: { message: 'function does not exist' } })) : rpcOpprinnelig(navn, args));
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(toasts.join(' ')).toContain('stoppet nå, ikke kl. 15:30');
  });
  it('ingen åpne klokker: ingen merknad om reserve-vei (ingenting å si fra om)', async () => {
    const inn = igaar0700();
    oppsett({ innIso: inn.iso });
    const { db } = lagFakeDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
      if (q.update) return { data: [{ id: 5 }], error: null };
      return { data: null, error: null };
    });
    db.rpc = () => Promise.resolve({ data: null, error: { message: 'function does not exist' } });
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(toasts.join(' ')).not.toContain('ikke kl.');
  });
});

describe('adminLagreTimer (Ny/Rediger registrering i Ansatte): dato kreves og overlapp advares (gjennomgang 2026-11-04)', () => {
  let toasts, ekteToast, ekteRender;
  const felt = (id, v) => { sandbox.document.getElementById(id).value = v; };
  const skjema = ({ id = '', dato = '2026-11-02', type = 'normal', fra = '08:00', til = '12:00', ansatt = '5' } = {}) => {
    felt('adminTimerId', id); felt('adminTimerDato', dato); felt('adminTimerType', type); felt('adminTimerFra', fra); felt('adminTimerTil', til); felt('adminTimerAnsattId', ansatt);
  };
  beforeEach(() => {
    toasts = []; ekteToast = sandbox.visToast; ekteRender = sandbox.renderAnsattDetalj;
    sandbox.visToast = (t) => { toasts.push(t); }; sandbox.renderAnsattDetalj = () => {}; sandbox.confirm = () => true;
    S.ansatte = [{ id: 5, navn: 'TEST - Ansatt', aktiv: true }]; S.timer = []; S.nextId = 1000;
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  });
  afterEach(() => { sandbox.visToast = ekteToast; sandbox.renderAnsattDetalj = ekteRender; });
  const medEksisterende = (rader) => lagFakeDb((q) => (q.tabell === 'timer_entries' && q.select ? { data: rader, error: null } : { data: null, error: null }));

  it('uten dato lagres ingenting (en føring uten dato kan ikke tolkes av noe som leser timene), med beskjed', async () => {
    const { db, kall } = medEksisterende([]); app.settDb(db);
    for (const d of ['', 'ikke-en-dato', '2026-13']) {
      skjema({ dato: d });
      await sandbox.adminLagreTimer();
    }
    expect(kall.some((k) => k.insert || k.update || k.select)).toBe(false);
    expect(S.timer).toEqual([]);
    expect(toasts.join(' ')).toContain('Velg dato');
  });
  it('ny føring som overlapper en eksisterende: spør, og Avbryt lagrer ingenting', async () => {
    const { db, kall } = medEksisterende([{ id: 'x', type: 'normal', start: '07:00', stopp: '15:00' }]); app.settDb(db);
    const spurt = []; sandbox.confirm = (t) => { spurt.push(t); return false; };
    skjema();
    await sandbox.adminLagreTimer();
    expect(spurt[0]).toContain('TEST - Ansatt');
    expect(spurt[0]).toContain('07:00–15:00');
    expect(kall.some((k) => k.insert)).toBe(false);
    expect(S.timer).toEqual([]);
  });
  it('ny føring som overlapper, og admin bekrefter: lagres som før', async () => {
    const { db, kall } = medEksisterende([{ id: 'x', type: 'normal', start: '07:00', stopp: '15:00' }]); app.settDb(db);
    skjema();
    await sandbox.adminLagreTimer();
    expect(kall.filter((k) => k.insert)).toHaveLength(1);
    expect(S.timer).toHaveLength(1);
    expect(S.timer[0]).toMatchObject({ ansattId: 5, dato: '2026-11-02', start: '08:00', stopp: '12:00' });
  });
  it('rediger: føringen overlapper ikke seg selv (egen id unntas), og spørringen gjelder riktig ansatt og dato', async () => {
    S.timer = [{ id: 't1', ansattId: 5, ansatt: 'TEST - Ansatt', dato: '2026-11-02', type: 'normal', start: '07:00', stopp: '15:00', mins: 450 }];
    const { db, kall } = medEksisterende([{ id: 't1', type: 'normal', start: '07:00', stopp: '15:00' }]); app.settDb(db);
    let spurt = 0; sandbox.confirm = () => { spurt++; return false; };
    skjema({ id: 't1', fra: '07:30', til: '15:30' });
    await sandbox.adminLagreTimer();
    expect(spurt).toBe(0);
    expect(kall.filter((k) => k.update)).toHaveLength(1);
    const les = kall.find((k) => k.tabell === 'timer_entries' && k.select);
    expect(les.filtre).toEqual([['eq', 'ansatt_id', 5], ['eq', 'dato', '2026-11-02']]);
  });
  it('fravær (syk/ferie) og føringer uten tid sjekkes ikke for overlapp', async () => {
    const { db, kall } = medEksisterende([{ id: 'x', type: 'normal', start: '07:00', stopp: '15:00' }]); app.settDb(db);
    let spurt = 0; sandbox.confirm = () => { spurt++; return false; };
    skjema({ type: 'syk' });
    await sandbox.adminLagreTimer();
    expect(spurt).toBe(0);
    expect(kall.some((k) => k.select)).toBe(false);
    expect(kall.filter((k) => k.insert)).toHaveLength(1);
  });
  it('dobbeltrykk mens overlappet sjekkes gir bare én føring', async () => {
    const { db, kall } = medEksisterende([]); app.settDb(db);
    skjema();
    await Promise.all([sandbox.adminLagreTimer(), sandbox.adminLagreTimer()]);
    expect(kall.filter((k) => k.insert)).toHaveLength(1);
    expect(S.timer).toHaveLength(1);
  });
});

describe('adminStempleUt: klokkene kunne ikke stoppes i det hele tatt (heller ikke via reserve-veien)', () => {
  let toasts, ekteToast;
  beforeEach(() => { toasts = []; ekteToast = sandbox.visToast; sandbox.visToast = (t) => { toasts.push(t); }; sandbox.confirm = () => true; });
  afterEach(() => { sandbox.visToast = ekteToast; });
  it('timene er registrert og admin får beskjed om at klokkene IKKE ble stoppet (ikke «stoppet nå»)', async () => {
    const inn = igaar0700();
    const o = { id: 'ord_1', ordreTimerSessions: [{ ansattId: 5, start: 1, stopp: null }] };
    oppsett({ innIso: inn.iso, ordrer: [o] });
    const { db } = lagFakeDb((q) => {
      if (q.tabell === 'ansatte' && q.select) return { data: { stemplet_inn_siden: inn.iso }, error: null };
      if (q.update) return { data: [{ id: 5 }], error: null };
      return { data: null, error: null };
    });
    db.rpc = () => Promise.resolve({ data: null, error: { message: 'nett' } });
    app.settDb(db);
    aapneOgSett('15:30');
    await sandbox.adminStempleUt();
    expect(toasts.join(' ')).toContain('kunne IKKE stoppes');
    expect(toasts.join(' ')).not.toContain('stoppet nå');
    expect(S.ansatte[0].stempletInnSiden).toBeNull();   // selve utstemplingen (timene) er likevel gjennomført
  });
});

describe('adminLagreTimer: ansatt-feltet leses FØR overlapp-sjekken', () => {
  let ekteToast, ekteRender;
  const felt = (id, v) => { sandbox.document.getElementById(id).value = v; };
  beforeEach(() => {
    ekteToast = sandbox.visToast; ekteRender = sandbox.renderAnsattDetalj;
    sandbox.visToast = () => {}; sandbox.renderAnsattDetalj = () => {}; sandbox.confirm = () => true;
    S.ansatte = [{ id: 5, navn: 'TEST - Ansatt', aktiv: true }, { id: 6, navn: 'TEST - Annen', aktiv: true }]; S.timer = []; S.nextId = 1000;
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  });
  afterEach(() => { sandbox.visToast = ekteToast; sandbox.renderAnsattDetalj = ekteRender; });
  it('åpner admin et annet skjema (annen ansatt) mens sjekken pågår, havner føringen likevel på den ansatten skjemaet var åpnet for', async () => {
    felt('adminTimerId', ''); felt('adminTimerDato', '2026-11-02'); felt('adminTimerType', 'normal'); felt('adminTimerFra', '08:00'); felt('adminTimerTil', '12:00'); felt('adminTimerAnsattId', '5');
    const { db, kall } = lagFakeDb((q) => {
      if (q.tabell === 'timer_entries' && q.select) { felt('adminTimerAnsattId', '6'); return { data: [], error: null }; }   // skjemaet byttes mens oppslaget pågår
      return { data: null, error: null };
    });
    app.settDb(db);
    await sandbox.adminLagreTimer();
    expect(S.timer).toHaveLength(1);
    expect(S.timer[0].ansattId).toBe(5);
    expect(kall.find((k) => k.insert).insert.ansatt_id).toBe(5);
  });
});
