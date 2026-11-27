import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// Samlet PIN-sperre / nødbrems (Henger igjen oe3ybyfat1g3ef6dx2rm, migrasjon 20261125200000_pin_nodbrems.sql), klientsiden:
//  - tvungen PIN-bytte etter nødbrems (ny_pin_kreves fra logg_inn_med_pin), for ALLE roller, via endre_pin_etter_nodbrems
//  - tydelig melding på PIN-skjermen når nødbremsen er aktiv (databasen svarer bevisst som ved feil PIN)
//  - sjekkOktFortsattGyldig(): logger ut bare når databasen sier at økta ikke gjelder lenger (aldri på en nettverksfeil)
//  - Realtime på sikkerhet_tilstand utløser sjekken
//  - admin-kortet «Nødbrems» i Mer (trekk / opphev)
// Selve sperren er i databasen og testes av supabase/tester/pin_nodbrems_TEST_body.sql.

const app = lastApp();
const { sandbox, S } = app;

function lagDb({ rpc = {}, tilstand = null, tilstandFeil = false } = {}) {
  const kall = [];
  const db = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 't' } } }),
      refreshSession: vi.fn(async () => { kall.push('refreshSession'); return { data: {}, error: null }; }),
      signInAnonymously: async () => ({ data: { session: { access_token: 't' } }, error: null }),
      signOut: async () => ({ error: null }),
    },
    rpc: vi.fn(async (navn, args) => {
      kall.push('rpc:' + navn);
      const r = rpc[navn];
      if (typeof r === 'function') return r(args);
      return r ?? { data: null, error: null };
    }),
    from: vi.fn((tabell) => {
      const b = {
        select() { return b; },
        eq() { return b; },
        maybeSingle: async () => {
          kall.push('from:' + tabell);
          if (tilstandFeil) return { data: null, error: { message: 'finnes ikke' } };
          return { data: tilstand, error: null };
        },
      };
      return b;
    }),
    removeChannel() {},
  };
  return { db, kall };
}

let toasts, utlogginger;
beforeEach(() => {
  toasts = [];
  utlogginger = [];
  sandbox.visToast = (melding, type) => toasts.push({ melding, type });
  sandbox.doLogout = (tvungen) => { utlogginger.push(tvungen); return Promise.resolve(); };
  sandbox.confirm = () => true;
  sandbox.aktiverInnloggetApp = vi.fn(async () => {});
  app.settMe(null);
  for (const id of ['pinByttSkjerm', 'pinByttTittel', 'pinByttTekst', 'pinByttErr', 'pinErr', 'merNodbremsKort']) {
    const el = sandbox.document.getElementById(id); el.textContent = ''; el.innerHTML = ''; el.style.display = '';
  }
});

describe('tvungen PIN-bytte etter nødbrems', () => {
  for (const rolle of ['ansatt', 'admin']) {
    it(`ny_pin_kreves viser bytteskjermen og IKKE appen (${rolle}: ingen rolleunntak)`, async () => {
      app.settMe({ id: 5, navn: 'TEST', rolle, pin_kort: false, ny_pin_kreves: true });
      await sandbox.fortsettEtterInnlogging();
      expect(sandbox.document.getElementById('pinByttSkjerm').style.display).toBe('flex');
      expect(sandbox.document.getElementById('pinByttTittel').textContent).toBe('Sett ny PIN');
      expect(sandbox.document.getElementById('pinByttTekst').textContent).toMatch(/Alle må sette en ny PIN/);
      expect(sandbox.aktiverInnloggetApp).not.toHaveBeenCalled();
    });
  }

  it('uten ny_pin_kreves vises appen som før', async () => {
    app.settMe({ id: 5, navn: 'TEST', rolle: 'ansatt', pin_kort: false, ny_pin_kreves: false });
    await sandbox.fortsettEtterInnlogging();
    expect(sandbox.aktiverInnloggetApp).toHaveBeenCalledTimes(1);
  });

  it('lagring bruker endre_pin_etter_nodbrems (ikke endre_egen_pin), og SAMME_PIN gir en melding uten å vise appen', async () => {
    const { db, kall } = lagDb({ rpc: { endre_pin_etter_nodbrems: { data: 'SAMME_PIN', error: null } } });
    app.settDb(db);
    app.settMe({ id: 5, navn: 'TEST', rolle: 'ansatt', ny_pin_kreves: true });
    sandbox.document.getElementById('pinByttNy').value = '123456';
    await sandbox.lagreTvungetPinBytte();
    expect(kall).toEqual(['rpc:endre_pin_etter_nodbrems']);
    expect(sandbox.document.getElementById('pinByttErr').textContent).toMatch(/annen PIN enn den du hadde/);
    expect(sandbox.aktiverInnloggetApp).not.toHaveBeenCalled();
  });

  it('vellykket bytte viser appen og nullstiller kravet', async () => {
    const { db } = lagDb({ rpc: { endre_pin_etter_nodbrems: { data: 'ok', error: null } } });
    app.settDb(db);
    const meg = { id: 5, navn: 'TEST', rolle: 'admin', ny_pin_kreves: true };
    app.settMe(meg);
    sandbox.document.getElementById('pinByttNy').value = '654321';
    await sandbox.lagreTvungetPinBytte();
    expect(db.rpc).toHaveBeenCalledWith('endre_pin_etter_nodbrems', { p_ny_pin: '654321' });
    expect(meg.ny_pin_kreves).toBe(false);
    expect(sandbox.aktiverInnloggetApp).toHaveBeenCalledTimes(1);
  });

  it('IKKE_INNLOGGET fra databasen gir en forståelig melding', async () => {
    const { db } = lagDb({ rpc: { endre_pin_etter_nodbrems: { data: null, error: { message: 'IKKE_INNLOGGET' } } } });
    app.settDb(db);
    app.settMe({ id: 5, navn: 'TEST', rolle: 'ansatt', ny_pin_kreves: true });
    sandbox.document.getElementById('pinByttNy').value = '654321';
    await sandbox.lagreTvungetPinBytte();
    expect(sandbox.document.getElementById('pinByttErr').textContent).toMatch(/logg inn på nytt/);
  });

  it('den gamle 6-sifre-sperren (pin_kort) bruker fortsatt endre_egen_pin', async () => {
    const { db, kall } = lagDb({ rpc: { endre_egen_pin: { data: 'ok', error: null } } });
    app.settDb(db);
    app.settMe({ id: 5, navn: 'TEST', rolle: 'ansatt', pin_kort: true, ny_pin_kreves: false });
    sandbox.document.getElementById('pinByttNy').value = '123456';
    await sandbox.lagreTvungetPinBytte();
    expect(kall).toEqual(['rpc:endre_egen_pin']);
  });
});

describe('PIN-skjermen når nødbremsen er aktiv', () => {
  it('tomt svar + aktiv nødbrems gir «stengt av admin», ikke «Feil PIN»', async () => {
    const { db } = lagDb({ rpc: { logg_inn_med_pin: { data: [], error: null } }, tilstand: { nodbrems_aktiv: true } });
    app.settDb(db);
    await sandbox.tryLogin();
    expect(sandbox.document.getElementById('pinErr').textContent).toBe('Innlogging er midlertidig stengt av admin');
  });

  it('tomt svar uten nødbrems gir «Feil PIN» som før', async () => {
    const { db } = lagDb({ rpc: { logg_inn_med_pin: { data: [], error: null } }, tilstand: { nodbrems_aktiv: false } });
    app.settDb(db);
    await sandbox.tryLogin();
    expect(sandbox.document.getElementById('pinErr').textContent).toMatch(/Feil PIN/);
  });

  it('tabellen finnes ikke (ny klient mot gammel database): «Feil PIN» som før', async () => {
    const { db } = lagDb({ rpc: { logg_inn_med_pin: { data: [], error: null } }, tilstandFeil: true });
    app.settDb(db);
    await sandbox.tryLogin();
    expect(sandbox.document.getElementById('pinErr').textContent).toMatch(/Feil PIN/);
  });

  it('ny_pin_kreves fra logg_inn_med_pin går videre til bytteskjermen', async () => {
    const { db } = lagDb({ rpc: { logg_inn_med_pin: { data: [{ id: 7, navn: 'TEST', rolle: 'admin', kan_fore_lonn: true, pin_kort: false, ny_pin_kreves: true }], error: null } } });
    app.settDb(db);
    await sandbox.tryLogin();
    expect(sandbox.document.getElementById('pinByttSkjerm').style.display).toBe('flex');
    expect(sandbox.aktiverInnloggetApp).not.toHaveBeenCalled();
  });
});

describe('sjekkOktFortsattGyldig', () => {
  const rad = [{ id: 5, rolle: 'ansatt' }];

  it('gyldig økt: ingen utlogging, ingen sesjonsfornyelse', async () => {
    const { db, kall } = lagDb({ rpc: { hent_innlogget_ansatt: { data: rad, error: null } } });
    app.settDb(db); app.settMe({ id: 5, rolle: 'ansatt' });
    expect(await sandbox.sjekkOktFortsattGyldig('periodisk')).toBe(false);
    expect(utlogginger).toEqual([]);
    expect(kall).toEqual(['rpc:hent_innlogget_ansatt']);
  });

  it('nettverksfeil: aldri utlogging', async () => {
    const { db } = lagDb({ rpc: { hent_innlogget_ansatt: { data: null, error: { message: 'Failed to fetch' } } } });
    app.settDb(db); app.settMe({ id: 5, rolle: 'ansatt' });
    expect(await sandbox.sjekkOktFortsattGyldig('periodisk')).toBe(false);
    expect(utlogginger).toEqual([]);
  });

  it('tomt svar, men gyldig etter sesjonsfornyelse: ingen utlogging', async () => {
    let n = 0;
    const { db, kall } = lagDb({ rpc: { hent_innlogget_ansatt: () => ({ data: n++ === 0 ? [] : rad, error: null }) } });
    app.settDb(db); app.settMe({ id: 5, rolle: 'ansatt' });
    expect(await sandbox.sjekkOktFortsattGyldig('periodisk')).toBe(false);
    expect(kall).toEqual(['rpc:hent_innlogget_ansatt', 'refreshSession', 'rpc:hent_innlogget_ansatt']);
    expect(utlogginger).toEqual([]);
  });

  it('tomt svar to ganger (nødbrems): tvungen utlogging med melding', async () => {
    const { db } = lagDb({ rpc: { hent_innlogget_ansatt: { data: [], error: null } } });
    app.settDb(db); app.settMe({ id: 5, rolle: 'ansatt' });
    expect(await sandbox.sjekkOktFortsattGyldig('nodbrems')).toBe(true);
    expect(utlogginger).toEqual([true]);
    expect(toasts.at(-1).melding).toMatch(/Admin har stengt innloggingen/);
  });

  it('ikke mens PIN-byttet etter nødbrems pågår (økta er bevisst ugyldig til da)', async () => {
    const { db, kall } = lagDb({ rpc: { hent_innlogget_ansatt: { data: [], error: null } } });
    app.settDb(db); app.settMe({ id: 5, rolle: 'ansatt', ny_pin_kreves: true });
    expect(await sandbox.sjekkOktFortsattGyldig('periodisk')).toBe(false);
    expect(kall).toEqual([]);
    expect(utlogginger).toEqual([]);
  });

  it('ikke innlogget: gjør ingenting', async () => {
    const { db, kall } = lagDb();
    app.settDb(db);
    expect(await sandbox.sjekkOktFortsattGyldig('synlig')).toBe(false);
    expect(kall).toEqual([]);
  });
});

describe('Realtime på sikkerhet_tilstand', () => {
  function abonner(db) {
    const handlere = {};
    const kanal = { on(_type, cfg, h) { handlere[cfg.table] = h; return kanal; }, subscribe() { return kanal; } };
    db.channel = () => kanal;
    sandbox.subscribeRealtime();
    return handlere;
  }

  it('abonnerer på tabellen, og «nødbrems aktiv» utløser en sjekk mot databasen (som logger ut når økta ikke gjelder)', async () => {
    const { db, kall } = lagDb({ rpc: { hent_innlogget_ansatt: { data: [], error: null } } });
    app.settDb(db); app.settMe({ id: 5, rolle: 'ansatt' });
    const h = abonner(db);
    expect(typeof h.sikkerhet_tilstand).toBe('function');
    h.sikkerhet_tilstand({ new: { id: 1, nodbrems_aktiv: true } });
    await sandbox.sjekkOktFortsattGyldig('vent'); // venter på den pågående sjekken
    expect(kall.filter((k) => k === 'rpc:hent_innlogget_ansatt').length).toBe(2);
    expect(utlogginger).toEqual([true]);
  });

  it('den som trakk nødbremsen (databasen sier at økta gjelder) blir værende', async () => {
    const { db } = lagDb({ rpc: { hent_innlogget_ansatt: { data: [{ id: 1, rolle: 'admin' }], error: null } } });
    app.settDb(db); app.settMe({ id: 1, rolle: 'admin' });
    const h = abonner(db);
    h.sikkerhet_tilstand({ new: { id: 1, nodbrems_aktiv: true } });
    await sandbox.sjekkOktFortsattGyldig('vent');
    expect(utlogginger).toEqual([]);
  });

  it('nødbrems av (eller bare varsel-tidspunktet endret): ingen sjekk', async () => {
    const { db, kall } = lagDb({ rpc: { hent_innlogget_ansatt: { data: [], error: null } } });
    app.settDb(db); app.settMe({ id: 5, rolle: 'ansatt' });
    const h = abonner(db);
    h.sikkerhet_tilstand({ new: { id: 1, nodbrems_aktiv: false, global_sperre_varslet_at: '2026-11-25T10:00:00Z' } });
    expect(kall).toEqual([]);
    expect(utlogginger).toEqual([]);
  });
});

describe('admin-kortet «Nødbrems» i Mer', () => {
  const kort = () => sandbox.document.getElementById('merNodbremsKort');

  it('skjult for alle andre enn admin', () => {
    app.settMe({ id: 5, navn: 'TEST', rolle: 'godkjenner' });
    sandbox.settSikkerhetTilstand({ nodbrems_aktiv: false });
    expect(kort().style.display).toBe('none');
    expect(kort().innerHTML).toBe('');
  });

  it('av: knappen «Trekk nødbrems»; trykk kaller nodbrems_pa etter bekreftelse', async () => {
    const { db } = lagDb({ rpc: { nodbrems_pa: { data: { ok: true, alleredeAktiv: false }, error: null } }, tilstand: { nodbrems_aktiv: true, nodbrems_av: 1, nodbrems_siden: '2026-11-25T09:00:00Z' } });
    app.settDb(db);
    S.ansatte = [{ id: 1, navn: 'TEST <Admin>' }];
    app.settMe({ id: 1, navn: 'TEST', rolle: 'admin' });
    sandbox.settSikkerhetTilstand({ nodbrems_aktiv: false });
    expect(kort().style.display).toBe('block');
    expect(kort().innerHTML).toContain('Trekk nødbrems');
    await sandbox.trekkNodbrems();
    expect(db.rpc).toHaveBeenCalledWith('nodbrems_pa');
    expect(toasts.at(-1)).toMatchObject({ type: 'ok' });
    // Tilstanden hentes på nytt etterpå: nå aktiv, med navnet escapet.
    expect(kort().innerHTML).toContain('NØDBREMS ER AKTIV');
    expect(kort().innerHTML).toContain('Opphev nødbrems');
    expect(kort().innerHTML).toContain('TEST &lt;Admin>');
    expect(kort().innerHTML).not.toContain('<Admin>');
  });

  it('avbrutt bekreftelse: ingenting skjer', async () => {
    const { db } = lagDb();
    app.settDb(db);
    app.settMe({ id: 1, navn: 'TEST', rolle: 'admin' });
    sandbox.settSikkerhetTilstand({ nodbrems_aktiv: false });
    sandbox.confirm = () => false;
    await sandbox.trekkNodbrems();
    await sandbox.opphevNodbrems();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('opphev kaller nodbrems_av; en feil fra databasen vises', async () => {
    const { db } = lagDb({ rpc: { nodbrems_av: { data: null, error: { message: 'KUN_ADMIN' } } }, tilstand: { nodbrems_aktiv: true } });
    app.settDb(db);
    app.settMe({ id: 1, navn: 'TEST', rolle: 'admin' });
    sandbox.settSikkerhetTilstand({ nodbrems_aktiv: true });
    await sandbox.opphevNodbrems();
    expect(db.rpc).toHaveBeenCalledWith('nodbrems_av');
    expect(toasts.at(-1).melding).toMatch(/Kunne ikke oppheve nødbremsen: KUN_ADMIN/);
  });
});

describe('godkjenner-PIN (bekreftGodkjenn) etter nødbrems', () => {
  const godkjErr = () => sandbox.document.getElementById('godkjErr');
  async function kjor(tilstand) {
    const { db } = lagDb({ rpc: { login_med_pin: { data: [], error: null } }, tilstand });
    app.settDb(db);
    app.settMe({ id: 5, navn: 'TEST', rolle: 'ansatt' });
    sandbox.document.getElementById('godkjPIN').value = '123456';
    godkjErr().textContent = '';
    await sandbox.bekreftGodkjenn();
    return godkjErr().textContent;
  }

  it('aktiv nødbrems: meldingen sier at man må logge inn og sette ny PIN først', async () => {
    expect(await kjor({ nodbrems_aktiv: true, nodbrems_opphevet_at: null })).toMatch(/^Feil PIN eller ikke godkjenner\. Har du ikke satt ny PIN.*logge inn selv og sette ny PIN først/);
  });

  it('opphevet for 2 dager siden: samme hint', async () => {
    expect(await kjor({ nodbrems_aktiv: false, nodbrems_opphevet_at: new Date(Date.now() - 2 * 86400000).toISOString() })).toMatch(/sette ny PIN først/);
  });

  it('opphevet for over 30 dager siden, eller aldri brukt: vanlig melding', async () => {
    expect(await kjor({ nodbrems_aktiv: false, nodbrems_opphevet_at: new Date(Date.now() - 31 * 86400000).toISOString() })).toBe('Feil PIN eller ikke godkjenner');
    expect(await kjor({ nodbrems_aktiv: false, nodbrems_opphevet_at: null })).toBe('Feil PIN eller ikke godkjenner');
    expect(await kjor(null)).toBe('Feil PIN eller ikke godkjenner');
  });

  it('for mange forsøk: uendret melding, uten hint', async () => {
    const { db } = lagDb({ rpc: { login_med_pin: { data: null, error: { message: 'FOR_MANGE_FORSOK' } } }, tilstand: { nodbrems_aktiv: true } });
    app.settDb(db);
    sandbox.document.getElementById('godkjPIN').value = '123456';
    await sandbox.bekreftGodkjenn();
    expect(godkjErr().textContent).toBe('For mange feilforsøk – vent noen minutter og prøv igjen');
  });
});
