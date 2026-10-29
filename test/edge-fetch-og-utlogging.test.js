import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// edgeFetch() (alle kall til edge-funksjonene med den innloggede ansattes token) og utlogging
// (doLogout/avsluttSesjon/sikreAnonymSesjon) i js/core.js. Samme oppsett som offline-ko.test.js:
// core.js kjøres i en vm-context med minimale document/window/localStorage-stubber, og en
// falsk `db` (Supabase-klient) og `fetch` settes inn per test. `let`-bindinger (db, me,
// realtimeChannel) nås via små function-broer i samme context - se CLAUDE.md, "vm-særtrekk".

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');
const SUPA_URL = 'https://qoqpenbfdxeduylxirwk.supabase.co';
const SUPA_KEY = kode.match(/const SUPA_KEY\s*=\s*'([^']+)'/)[1];

// En falsk Supabase-klient. `state.session` er sesjonen nettleseren har akkurat nå; `kall`
// logger rekkefølgen på alt som skjer, slik at tester kan sjekke "logg_ut før signOut" o.l.
function lagFalskDb(opts = {}) {
  const state = { session: 'session' in opts ? opts.session : { access_token: 'tok1' } };
  const kall = [];
  const db = {
    auth: {
      getSession: vi.fn(async () => { kall.push('getSession'); if (opts.getSessionFeiler) throw new Error('lagring utilgjengelig'); return { data: { session: state.session } }; }),
      refreshSession: vi.fn(async () => {
        kall.push('refreshSession');
        if (opts.refreshFeiler) throw new Error('nett');
        if (opts.refreshGirIngenSesjon) { state.session = null; return { data: { session: null }, error: { message: 'refresh_token_not_found' } }; }
        state.session = { access_token: opts.nyttToken || 'tok2' };
        return { data: { session: state.session }, error: null };
      }),
      signOut: vi.fn(async (arg) => {
        kall.push('signOut:' + (arg?.scope || ''));
        if (opts.signOutVenter) await opts.signOutVenter;
        if (opts.signOutHenger) await new Promise(() => {});
        if (opts.signOutFeil) return { error: { message: 'nettverksfeil' } };
        state.session = null;
        return { error: null };
      }),
      signInAnonymously: vi.fn(async () => {
        kall.push('signInAnonymously');
        if (opts.anonymFeiler) return { data: { session: null }, error: { message: 'rate limit' } };
        state.session = { access_token: 'anon-tok' };
        return { data: { session: state.session }, error: null };
      })
    },
    rpc: vi.fn(async (navn) => {
      kall.push('rpc:' + navn);
      if (navn === 'logg_ut' && opts.loggUtFeiler) return { data: null, error: { message: 'finnes ikke' } };
      if (navn === 'logg_inn_med_pin') return { data: [], error: null };
      return { data: null, error: null };
    }),
    removeChannel: vi.fn((ch) => { kall.push('removeChannel'); return ch; }),
    from: vi.fn(() => ({
      upsert: () => { kall.push('upsert'); return Promise.resolve(opts.lagringLykkes ? { error: null } : { error: { message: 'nettverksfeil' } }); }
    }))
  };
  return { db, state, kall };
}

function nyEnvironment() {
  const lagerData = {};
  const elementer = {};
  const getElementById = (id) => (elementer[id] ??= { style: {}, textContent: '', value: '' });
  const unref = (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; };
  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp, URL, Headers,
    localStorage: {
      getItem: k => (k in lagerData ? lagerData[k] : null),
      setItem: (k, v) => { lagerData[k] = String(v); },
      removeItem: k => { delete lagerData[k]; }
    },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: {
      addEventListener() {},
      getElementById,
      querySelectorAll() { return []; },
      createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; },
      body: { appendChild() {} },
      head: { appendChild() {} }
    },
    location: { hostname: 'localhost' },
    // Hver tidtaker slår opp setTimeout ved kall, så vi.useFakeTimers() virker også her.
    setTimeout: (f, ms) => unref(f, ms), clearTimeout: (t) => clearTimeout(t),
    setInterval() {}, clearInterval() {},
    fetch: vi.fn(),
    confirm: vi.fn(() => true)
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox, { filename: 'core.js' });
  vm.runInContext(`
    function _getS(){ return S; }
    function _setS(v){ S = v; }
    function _getOfflineKo(){ return offlineKo; }
    function _setDb(v){ db = v; }
    function _getMe(){ return me; }
    function _setMe(v){ me = v; }
    function _getChannel(){ return realtimeChannel; }
    function _setChannel(v){ realtimeChannel = v; }
    function _setPinBuf(v){ pinBuf = v; }
  `, sandbox);
  return { sandbox, lagerData, elementer };
}

const svar = (status) => ({ status, ok: status >= 200 && status < 300 });
const toastTekst = (env) => env.elementer.globalToast?.textContent ?? null;

describe('edgeFetch', () => {
  let env, f;
  beforeEach(() => { env = nyEnvironment(); f = env.sandbox.fetch; });

  const POST = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"lav_lager"}' };

  it('sender den innloggedes token som Authorization og SUPA_KEY som apikey - og beholder metode, body og Content-Type', async () => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    f.mockResolvedValue(svar(200));
    const res = await env.sandbox.edgeFetch('send-push', POST);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`${SUPA_URL}/functions/v1/send-push`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"type":"lav_lager"}');
    expect(init.headers.get('Authorization')).toBe('Bearer tok1');
    expect(init.headers.get('apikey')).toBe(SUPA_KEY);
    expect(init.headers.get('Content-Type')).toBe('application/json');
    expect(db.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('sender aldri den offentlige nøkkelen som Authorization, selv om kalleren prøver (uansett store/små bokstaver)', async () => {
    env.sandbox._setDb(lagFalskDb().db);
    f.mockResolvedValue(svar(200));
    await env.sandbox.edgeFetch('send-push', { method: 'POST', headers: { authorization: 'Bearer ' + SUPA_KEY } });
    expect(f.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer tok1');
  });

  it('henter sesjonen på nytt ved HVERT kall (token-et kan ha blitt fornyet)', async () => {
    const { db, state } = lagFalskDb();
    env.sandbox._setDb(db);
    f.mockResolvedValue(svar(200));
    await env.sandbox.edgeFetch('send-push', POST);
    state.session = { access_token: 'tok-fornyet' };
    await env.sandbox.edgeFetch('send-push', POST);
    expect(db.auth.getSession).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer tok1');
    expect(f.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer tok-fornyet');
  });

  it('ved 401: fornyer sesjonen og prøver ÉN gang til med det nye token-et', async () => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    f.mockResolvedValueOnce(svar(401)).mockResolvedValueOnce(svar(200));
    const res = await env.sandbox.edgeFetch('fiken-fakturer', POST);
    expect(res.status).toBe(200);
    expect(db.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer tok1');
    expect(f.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer tok2');
    expect(f.mock.calls[1][1].body).toBe(POST.body); // samme body i forsøk nr. 2
    expect(toastTekst(env)).toBeNull(); // lyktes etter fornyelse: ingen støy
  });

  it('ingen uendelig løkke: 401 to ganger gir nøyaktig to kall, ÉN fornyelse, og en norsk toast', async () => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    f.mockResolvedValue(svar(401));
    const res = await env.sandbox.edgeFetch('fiken-fakturer', POST);
    expect(res.status).toBe(401); // kalleren får svaret og viser sin egen feil
    expect(f).toHaveBeenCalledTimes(2);
    expect(db.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(toastTekst(env)).toMatch(/logg ut og inn igjen/);
  });

  it('401 og fornyelsen gir ingen sesjon: ikke et nytt kall, svaret leveres og toast vises', async () => {
    const { db } = lagFalskDb({ refreshGirIngenSesjon: true });
    env.sandbox._setDb(db);
    f.mockResolvedValue(svar(401));
    const res = await env.sandbox.edgeFetch('send-frakt-epost', POST);
    expect(res.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1);
    expect(toastTekst(env)).toMatch(/logg ut og inn igjen/);
  });

  it('401 og fornyelsen kaster: samme som over, ingen krasj', async () => {
    const { db } = lagFalskDb({ refreshFeiler: true });
    env.sandbox._setDb(db);
    f.mockResolvedValue(svar(401));
    const res = await env.sandbox.edgeFetch('send-push', POST);
    expect(res.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404, 500, 503])('%i fornyer ikke sesjonen og prøver ikke på nytt (kalleren håndterer det selv)', async (status) => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    f.mockResolvedValue(svar(status));
    const res = await env.sandbox.edgeFetch('vegvesen-oppslag', POST);
    expect(res.status).toBe(status);
    expect(f).toHaveBeenCalledTimes(1);
    expect(db.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('ingen sesjon: kaster en norsk feil, viser toast og kaller aldri funksjonen', async () => {
    env.sandbox._setDb(lagFalskDb({ session: null }).db);
    await expect(env.sandbox.edgeFetch('send-push', POST)).rejects.toThrow('Du er ikke innlogget - logg inn på nytt');
    expect(f).not.toHaveBeenCalled();
    expect(toastTekst(env)).toBe('Du er ikke innlogget - logg inn på nytt');
  });

  it('ingen Supabase-klient (db er null): samme som ingen sesjon, ingen krasj', async () => {
    env.sandbox._setDb(null);
    await expect(env.sandbox.edgeFetch('send-push', POST)).rejects.toThrow('Du er ikke innlogget');
    expect(f).not.toHaveBeenCalled();
  });

  it('getSession() som kaster behandles som ingen sesjon', async () => {
    env.sandbox._setDb(lagFalskDb({ getSessionFeiler: true }).db);
    await expect(env.sandbox.edgeFetch('send-push', POST)).rejects.toThrow('Du er ikke innlogget');
    expect(f).not.toHaveBeenCalled();
  });

  it('nettverksfeil fra fetch gir en avvist Promise (kalleren sin .catch/try-catch tar den), uten nytt forsøk', async () => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    f.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(env.sandbox.edgeFetch('send-push', POST)).rejects.toThrow('Failed to fetch');
    expect(f).toHaveBeenCalledTimes(1);
    expect(db.auth.refreshSession).not.toHaveBeenCalled();
  });
});

describe('sikreAnonymSesjon', () => {
  let env;
  beforeEach(() => { env = nyEnvironment(); });

  it('gjør ingenting hvis det allerede finnes en sesjon', async () => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    expect(await env.sandbox.sikreAnonymSesjon()).toBe(true);
    expect(db.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('starter en anonym sesjon hvis det ikke finnes noen', async () => {
    const { db, state } = lagFalskDb({ session: null });
    env.sandbox._setDb(db);
    expect(await env.sandbox.sikreAnonymSesjon()).toBe(true);
    expect(db.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(state.session).toBeTruthy();
  });

  it('gir false (ikke krasj) når anonym innlogging avvises', async () => {
    env.sandbox._setDb(lagFalskDb({ session: null, anonymFeiler: true }).db);
    expect(await env.sandbox.sikreAnonymSesjon()).toBe(false);
  });
});

describe('utlogging', () => {
  let env;
  const KEY = 'sb-qoqpenbfdxeduylxirwk-auth-token';
  beforeEach(() => {
    env = nyEnvironment();
    env.sandbox._setMe({ id: 17, navn: 'TEST', rolle: 'admin' });
    env.sandbox._setChannel({ navn: 'salmakern_live' });
    env.lagerData[KEY] = '{"access_token":"x"}';
  });
  afterEach(() => { vi.useRealTimers(); });

  it('kaller logg_ut FØR signOut({scope:"local"}), fjerner kanalen, skjuler appen og nuller me', async () => {
    const { db, kall } = lagFalskDb();
    env.sandbox._setDb(db);
    await env.sandbox.doLogout();
    expect(kall.filter(k => k !== 'getSession')).toEqual(['removeChannel', 'rpc:logg_ut', 'signOut:local']);
    expect(env.sandbox._getMe()).toBeNull();
    expect(env.sandbox._getChannel()).toBeNull();
    expect(env.elementer.appScreen.style.display).toBe('none');
    expect(env.elementer.loginScreen.style.display).toBe('flex');
  });

  it('rører ikke noe annet i databasen (ingen tabell-skriving, ingen andre RPC-er)', async () => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    await env.sandbox.doLogout();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.map(c => c[0])).toEqual(['logg_ut']);
    expect(db.rpc).toHaveBeenCalledWith('logg_ut'); // ingen parametere - kan bare gjelde auth.uid()
  });

  it('logg_ut som feiler (f.eks. funksjonen mangler) stopper ikke signOut', async () => {
    const { db, kall } = lagFalskDb({ loggUtFeiler: true });
    env.sandbox._setDb(db);
    await env.sandbox.doLogout();
    expect(kall).toContain('signOut:local');
    expect(env.sandbox._getMe()).toBeNull();
  });

  it('vellykket signOut lar nettleserens sesjonsnøkkel være (supabase-js fjerner den selv)', async () => {
    env.sandbox._setDb(lagFalskDb().db);
    await env.sandbox.doLogout();
    expect(env.lagerData[KEY]).toBeDefined(); // vår falske signOut rører ikke localStorage, og vi skal heller ikke
  });

  it('signOut som feiler (uten nett): sesjonen fjernes lokalt likevel', async () => {
    env.sandbox._setDb(lagFalskDb({ signOutFeil: true }).db);
    await env.sandbox.doLogout();
    expect(env.lagerData[KEY]).toBeUndefined();
    expect(env.sandbox._getMe()).toBeNull();
  });

  it('signOut som henger: gir opp etter 5 sek og fjerner sesjonen lokalt, utloggingen henger ikke', async () => {
    vi.useFakeTimers();
    env.sandbox._setDb(lagFalskDb({ signOutHenger: true }).db);
    const ferdig = env.sandbox.doLogout();
    await vi.advanceTimersByTimeAsync(11000);
    await ferdig;
    expect(env.lagerData[KEY]).toBeUndefined();
  });

  it('db = null (Supabase aldri startet): utlogging virker uten å kaste', async () => {
    env.sandbox._setDb(null);
    await env.sandbox.doLogout();
    expect(env.sandbox._getMe()).toBeNull();
  });

  it('to utlogginger i samme øyeblikk gir bare én logg_ut/signOut', async () => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    await Promise.all([env.sandbox.doLogout(), env.sandbox.doLogout()]);
    expect(db.auth.signOut).toHaveBeenCalledTimes(1);
    expect(db.rpc.mock.calls.filter(c => c[0] === 'logg_ut')).toHaveLength(1);
  });

  describe('offline-køen (mislykkede lagringer)', () => {
    beforeEach(() => {
      env.sandbox.ordreToDb = o => ({ id: o.id });
      env.sandbox._setS({ ordrer: [{ id: 'ord_1' }] });
      env.sandbox._getOfflineKo().add('ord_1');
    });

    it('køen får en siste sjanse FØR sesjonen avsluttes, og utloggingen skjer uten spørsmål når den lykkes', async () => {
      const { db, kall } = lagFalskDb({ lagringLykkes: true });
      env.sandbox._setDb(db);
      await env.sandbox.doLogout();
      expect(kall.indexOf('upsert')).toBeGreaterThan(-1);
      expect(kall.indexOf('upsert')).toBeLessThan(kall.indexOf('signOut:local'));
      expect(env.sandbox._getOfflineKo().size).toBe(0);
      expect(env.sandbox.confirm).not.toHaveBeenCalled();
      expect(env.sandbox._getMe()).toBeNull();
    });

    it('lagring som fortsatt feiler: spør før utlogging, og blir innlogget hvis svaret er nei', async () => {
      const { db, kall } = lagFalskDb();
      env.sandbox._setDb(db);
      env.sandbox.confirm.mockReturnValue(false);
      await env.sandbox.doLogout();
      expect(env.sandbox.confirm).toHaveBeenCalledTimes(1);
      expect(env.sandbox.confirm.mock.calls[0][0]).toMatch(/1 endring er ikke lagret ennå/);
      expect(env.sandbox._getMe()).not.toBeNull();
      expect(kall).not.toContain('signOut:local');
      expect(env.sandbox._getOfflineKo().has('ord_1')).toBe(true); // køen er urørt
    });

    it('lagring som fortsatt feiler og svaret er ja: logger ut, køen bevares i localStorage', async () => {
      const { db, kall } = lagFalskDb();
      env.sandbox._setDb(db);
      await env.sandbox.doLogout();
      expect(kall).toContain('signOut:local');
      expect(env.sandbox._getOfflineKo().has('ord_1')).toBe(true);
      expect(JSON.parse(env.lagerData['salmakern_offline_ko'])).toEqual(['ord_1']);
    });

    it('tvungen utlogging (dagens PIN byttet) spør aldri', async () => {
      const { db, kall } = lagFalskDb();
      env.sandbox._setDb(db);
      await env.sandbox.doLogout(true);
      expect(env.sandbox.confirm).not.toHaveBeenCalled();
      expect(kall).toContain('signOut:local');
    });
  });
});

describe('innlogging etter utlogging (tryLogin)', () => {
  let env;
  beforeEach(() => {
    env = nyEnvironment();
    env.sandbox._setPinBuf('0000');
  });

  it('starter en NY anonym sesjon før PIN-sjekken når sesjonen er avsluttet', async () => {
    const { db, kall } = lagFalskDb({ session: null });
    env.sandbox._setDb(db);
    await env.sandbox.tryLogin();
    const rekkefolge = kall.filter(k => k === 'signInAnonymously' || k === 'rpc:logg_inn_med_pin');
    expect(rekkefolge).toEqual(['signInAnonymously', 'rpc:logg_inn_med_pin']);
    expect(env.elementer.pinErr.textContent).toBe('Feil PIN – prøv igjen'); // falsk db: ingen treff
  });

  it('gjenbruker eksisterende sesjon (ingen ekstra anonym innlogging ved vanlig oppstart)', async () => {
    const { db } = lagFalskDb();
    env.sandbox._setDb(db);
    await env.sandbox.tryLogin();
    expect(db.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith('logg_inn_med_pin', { kandidat_pin: '0000' });
  });

  it('anonym innlogging som avvises gir en egen, tydelig melding (ikke «Feil PIN») og ingen PIN-sjekk', async () => {
    const { db } = lagFalskDb({ session: null, anonymFeiler: true });
    env.sandbox._setDb(db);
    await env.sandbox.tryLogin();
    expect(env.elementer.pinErr.textContent).toMatch(/Kunne ikke starte innlogging/);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('venter til en pågående utlogging er helt ferdig før PIN kobles til en sesjon', async () => {
    let slippSignOut;
    const signOutVenter = new Promise(r => { slippSignOut = r; });
    const { db, kall } = lagFalskDb({ signOutVenter });
    env.sandbox._setDb(db);
    const utlogging = env.sandbox.doLogout();
    const innlogging = env.sandbox.tryLogin();
    await new Promise(r => setTimeout(r, 30));
    expect(kall).toContain('signOut:local');
    expect(kall).not.toContain('rpc:logg_inn_med_pin'); // ennå ikke: sesjonen er ikke slettet ferdig
    slippSignOut();
    await Promise.all([utlogging, innlogging]);
    const rekkefolge = kall.filter(k => ['signOut:local', 'signInAnonymously', 'rpc:logg_inn_med_pin'].includes(k));
    expect(rekkefolge).toEqual(['signOut:local', 'signInAnonymously', 'rpc:logg_inn_med_pin']);
  });
});
