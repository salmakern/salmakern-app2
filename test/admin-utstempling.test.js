import { describe, it, expect, beforeEach } from 'vitest';
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
    // rekkefølge: lese stemplingen, så timen, så nullstilling (aldri nullstille før timen er sikret)
    const rekkefolge = kall.filter((k) => k.tabell).map((k) => k.tabell + (k.insert ? ':insert' : k.update ? ':update' : ':select'));
    expect(rekkefolge).toEqual(['ansatte:select', 'timer_entries:insert', 'ansatte:update']);
    expect(kall.some((k) => k.rpc === 'oppdater_ordre_timer_sesjon' && k.args.p_handling === 'stopp' && k.args.p_ansatt_id === 5)).toBe(true);
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
