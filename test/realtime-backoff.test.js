import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Ekte produksjonshendelse 2026-10-22: en enhet som ALDRI klarte å holde en stabil
// sanntidsforbindelse (ikke bare midlertidig ustabil) nullstilte backoff-en til raskeste
// forsøk (1 sek) hver gang den "flappet" (lykkes kort, feiler igjen med én gang) - ca. 2,7
// millioner gjenoppkoblinger over 43 dager, hver med en full nedlasting av hele datasettet,
// resulterte i 1,9 petabyte egress. Fikset 2026-10-22 med et 5-minutters tak + krav om 60
// sekunder STABIL forbindelse før nullstilling - men Supabase bekreftet 2026-10-24 at dette
// fortsatt ga ~54 GB egress/døgn (288 forsøk/døgn × ~188 MB), fordi en PERMANENT ødelagt
// forbindelse bare fikk et tak på hvor OFTE den prøvde, ikke noen øvre grense for hvor LENGE
// den fikk fortsette å prøve. Fikset videre 2026-10-28 med en "gi opp"-grense på 60 min
// sammenhengende feil - se toppkommentaren på REALTIME_BACKOFF_KEY i core.js.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreKode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');

function lagMockLocalStorage() {
  const lager = new Map();
  return {
    getItem: k => (lager.has(k) ? lager.get(k) : null),
    setItem: (k, v) => lager.set(k, String(v)),
    removeItem: k => lager.delete(k),
  };
}

function nyEnvironment() {
  const localStorageMock = lagMockLocalStorage();
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: localStorageMock,
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      activeElement: null,
      createElement() { return { style: {}, classList: { add(){}, remove(){} }, appendChild(){} }; },
      body: { appendChild() {} },
      head: { appendChild() {} }
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {},
    setTimeout, clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  vm.runInContext(`
    function _getRealtimeForsok(){ return realtimeReconnectForsok; }
    function _setRealtimeForsok(v){ realtimeReconnectForsok = v; }
    function _getRealtimeForsteFeil(){ return realtimeForsteFeil; }
    function _setRealtimeForsteFeil(v){ realtimeForsteFeil = v; }
    function _getReconnectTimer(){ return realtimeReconnectTimer; }
    function _setDb(v){ db = v; }
    function _setMe(v){ me = v; }
  `, sandbox);
  return sandbox;
}

// Minimal chainable db.channel()-stub som fanger opp subscribe-callbacken, slik testen kan
// trigge statusoverganger (CLOSED/SUBSCRIBED) manuelt uten en ekte Supabase-tilkobling.
function lagMockDb() {
  let subscribeCb = null;
  const channelObj = {
    on() { return channelObj; },
    subscribe(cb) { subscribeCb = cb; return channelObj; },
  };
  return {
    channel() { return channelObj; },
    removeChannel() {},
    from() { return { select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }; },
    hentCb: () => subscribeCb,
  };
}

describe('lesRealtimeBackoff/lagreRealtimeBackoff (persistens av gjenoppkoblings-tilstand)', () => {
  let sandbox;
  beforeEach(() => { sandbox = nyEnvironment(); });

  it('starter på 0/0 uten lagret tilstand', () => {
    expect(sandbox.lesRealtimeBackoff()).toEqual({ forsok: 0, forsteFeil: 0 });
  });

  it('runder-trip: lagrer og leser tilbake forsøkstall og første-feil-tidspunkt', () => {
    const forsteFeil = Date.now() - 2 * 60 * 1000;
    sandbox.lagreRealtimeBackoff(4, forsteFeil);
    expect(sandbox.lesRealtimeBackoff()).toEqual({ forsok: 4, forsteFeil });
  });

  it('forfaller (nullstilles) etter 10 minutter uten ny feil', () => {
    // Simulerer en gammel lagret verdi ved å skrive rått til mock-localStorage med en
    // tidsstempel 20 minutter tilbake, slik ekte lagreRealtimeBackoff() ville gjort for 20
    // minutter siden.
    sandbox.localStorage.setItem('realtimeBackoff_v1', JSON.stringify({ forsok: 7, tid: Date.now() - 20 * 60 * 1000, forsteFeil: Date.now() - 25 * 60 * 1000 }));
    expect(sandbox.lesRealtimeBackoff()).toEqual({ forsok: 0, forsteFeil: 0 });
  });

  it('lagreRealtimeBackoff(0, ...) fjerner lagret tilstand helt', () => {
    sandbox.lagreRealtimeBackoff(5, Date.now());
    sandbox.lagreRealtimeBackoff(0);
    expect(sandbox.localStorage.getItem('realtimeBackoff_v1')).toBeNull();
  });
});

describe('subscribeRealtime() gir opp automatisk gjenoppkobling etter 60 min sammenhengende feil (bug funnet via Supabase 2026-10-24, ~54GB/døgn egress)', () => {
  let sandbox, mockDb;
  beforeEach(() => {
    sandbox = nyEnvironment();
    mockDb = lagMockDb();
    sandbox._setDb(mockDb);
    sandbox._setMe({ id: 1, navn: 'Test Testesen' });
  });

  it('planlegger et nytt gjenoppkoblingsforsøk ved en FERSK feil-rekke (under 60 min)', () => {
    sandbox._setRealtimeForsok(0);
    sandbox._setRealtimeForsteFeil(0);
    sandbox.subscribeRealtime();
    mockDb.hentCb()('CLOSED', null);
    expect(sandbox._getReconnectTimer()).not.toBeNull();
    expect(sandbox._getRealtimeForsok()).toBe(1);
  });

  it('IKKE planlegger et nytt forsøk når feilen har vart sammenhengende i over 60 min', () => {
    sandbox._setRealtimeForsok(20); // allerede lenge inne i backoff-rampen
    sandbox._setRealtimeForsteFeil(Date.now() - 61 * 60 * 1000); // feilet sammenhengende i 61 min
    sandbox.subscribeRealtime();
    mockDb.hentCb()('CLOSED', null);
    expect(sandbox._getReconnectTimer()).toBeNull();
    // forsøkstallet skal IKKE ha økt videre - vi har gitt helt opp, ikke bare utsatt
    expect(sandbox._getRealtimeForsok()).toBe(20);
  });

  it('nullstiller forsøkstall OG første-feil-tidspunkt når forbindelsen har vært stabil i 60 sek', async () => {
    vi.useFakeTimers();
    try {
      // Egen sandbox her siden setTimeout/clearTimeout må fanges opp ETTER at
      // vi.useFakeTimers() er aktivert, for at de fiktive klokkene faktisk skal styre
      // realtimeStabilTimer inni core.js.
      const fakeSandbox = nyEnvironment();
      const fakeDb = lagMockDb();
      fakeSandbox._setDb(fakeDb);
      fakeSandbox._setMe({ id: 1, navn: 'Test Testesen' });
      fakeSandbox._setRealtimeForsok(9);
      fakeSandbox._setRealtimeForsteFeil(Date.now() - 5 * 60 * 1000);
      fakeSandbox.subscribeRealtime();
      fakeDb.hentCb()('SUBSCRIBED', null);
      // Skal IKKE nullstille med en gang (flappende tilkobling skal ikke få lov til dette)
      expect(fakeSandbox._getRealtimeForsok()).toBe(9);
      await vi.advanceTimersByTimeAsync(60000);
      expect(fakeSandbox._getRealtimeForsok()).toBe(0);
      expect(fakeSandbox._getRealtimeForsteFeil()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
