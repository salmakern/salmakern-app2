import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { lastApp } from './helpers/app-harness.js';

// Henger igjen s09-027 (2026-11-25): standardtid per modell lagres med en egen rutine (RPC-en sett_standardtid), ikke via
// saveInnstillinger() («lagre alt», som kan skrive utdaterte utstyrsmaler/satser tilbake), og kalkylens kalkulerte minutter fra portalen
// vises som FORSLAG som admin selv tar i bruk. Hele appen lastes i testriggen med en falsk database.

const app = lastApp();
const { sandbox, S } = app;

function lagDb({ rpcSvar = (navn, args) => ({ data: { ...args && { [args.p_modell]: { ombygging: args.p_ombygging_min } } }, error: null }) } = {}) {
  const kall = [];
  return {
    kall,
    db: {
      from: (tabell) => ({
        upsert: (rad) => { kall.push({ type: 'upsert', tabell, rad }); return Promise.resolve({ error: null }); },
        update: (rad) => ({ eq: () => { kall.push({ type: 'update', tabell, rad }); return Promise.resolve({ error: null }); } }),
      }),
      rpc: (navn, args) => { kall.push({ type: 'rpc', navn, args }); return Promise.resolve(rpcSvar(navn, args)); },
    },
  };
}
const el = (id) => sandbox.document.getElementById(id);

beforeEach(() => {
  S.standardtider = { 'EV9': { ombygging: 600 }, 'Rexton': { ombygging: 300 } };
  S.utstyrMaler = [{ navn: 'EV9-mal', biltype: 'EV9', punkter: [] }, { navn: 'Rexton-mal', biltype: 'Rexton', punkter: [] }];
  S.lagervarer = []; S.ordrer = [];
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  app.settDb(null);
  sandbox.confirm = () => true;
  el('merStandardtiderView').style.display = 'none';
  el('standardtiderListe').innerHTML = '';
  el('kalkyleTiderStatus').textContent = '';
  el('hentKalkyleTiderBtn').disabled = false; // testriggens stub-element har ellers en funksjon (sann) for ukjente egenskaper
  app.kjor('KALKYLE_FORSLAG.data = null');
});
afterAll(() => { app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' }); });

describe('egen rutine for standardtid', () => {
  it('settStandardtid kaller sett_standardtid med bare denne modellen og hele minutter; ingen «lagre alt»', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    expect(await sandbox.settStandardtid('EV9', 'ombygging', '480,0'.replace(',', '.'))).toBe(true);
    expect(kall).toEqual([{ type: 'rpc', navn: 'sett_standardtid', args: { p_modell: 'EV9', p_ombygging_min: 480 } }]);
  });
  it('tomt felt og negative tall blir 0 (= ikke satt), desimaler rundes', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    await sandbox.settStandardtid('EV9', 'ombygging', '');
    await sandbox.settStandardtid('EV9', 'ombygging', '-5');
    await sandbox.settStandardtid('EV9', 'ombygging', '90.6');
    expect(kall.map((k) => k.args.p_ombygging_min)).toEqual([0, 0, 91]);
  });
  it('databasens svar (alle standardtider, ferske) erstatter den lokale kopien, så en annen admins endring kommer med', async () => {
    const { db } = lagDb({ rpcSvar: () => ({ data: { 'EV9': { ombygging: 480 }, 'GLS': { ombygging: 700 } }, error: null }) }); app.settDb(db);
    await sandbox.settStandardtid('EV9', 'ombygging', '480');
    expect(app.S.standardtider).toEqual({ 'EV9': { ombygging: 480 }, 'GLS': { ombygging: 700 } });
  });
  it('feiler lagringen, står den gamle verdien igjen lokalt og en beskjed vises', async () => {
    const { db } = lagDb({ rpcSvar: () => ({ data: null, error: { message: 'KUN_ADMIN' } }) }); app.settDb(db);
    let toast = ''; const ekte = sandbox.visToast; sandbox.visToast = (t) => { toast = t; };
    try {
      expect(await sandbox.settStandardtid('EV9', 'ombygging', '480')).toBe(false);
      expect(app.S.standardtider.EV9).toEqual({ ombygging: 600 });
      expect(toast).toMatch(/Bare administrator/);
      expect(await sandbox.settStandardtid('Ny modell', 'ombygging', '100')).toBe(false);
      expect('Ny modell' in app.S.standardtider).toBe(false); // en modell som ikke fantes, fjernes igjen
    } finally { sandbox.visToast = ekte; }
  });
  it('saveInnstillinger() sender ikke lenger standardtider (en utdatert kopi kan ikke skrive over)', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    app.kjor('saveInnstillinger()');
    const up = kall.find((k) => k.type === 'upsert' && k.tabell === 'innstillinger');
    expect(up).toBeTruthy();
    expect(up.rad).not.toHaveProperty('standardtider');
    expect(up.rad).not.toHaveProperty('dagens_pin');
  });
  it('andre felt enn ombygging ignoreres (ingen skriving)', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    expect(await sandbox.settStandardtid('EV9', 'klargjoring', '60')).toBe(false);
    expect(kall).toEqual([]);
  });
  it('ingen kode i js/ skriver standardtider via upsert/update (bare RPC-en)', () => {
    for (const f of ['core.js', 'ansatte-utstyr.js', 'arkiv-mer.js', 'ordre-diverse.js']) {
      const src = readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/standardtider\s*:/);
    }
  });
});

describe('forslag fra kalkylen', () => {
  const svar = (modeller) => ({ ok: true, status: 200, json: async () => ({ ok: true, generert: '2026-11-25T08:00:00Z', modeller }) });
  const KALK = [
    { kalkyle_id: 'k1', kalkyle_navn: 'KIA EV9', portal_modell_slug: 'kia-ev9', minutter: 960 },
    { kalkyle_id: 'k2', kalkyle_navn: 'KGM Rexton', portal_modell_slug: 'kgm-rexton', minutter: 300 },
    { kalkyle_id: 'k3', kalkyle_navn: 'Touran', portal_modell_slug: null, minutter: 500 },
  ];
  it('henter, viser forslag per modell (ingenting lagres), og sier «lik standardtiden» når tallet er likt', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.edgeFetch = async (fn) => { expect(fn).toBe('hent-kalkyle-tider-fra-portalen'); return svar(KALK); };
    await sandbox.hentKalkyleTider();
    expect(kall).toEqual([]); // ingen skriving
    const html = el('standardtiderListe').innerHTML;
    expect(html).toContain('Kalkyle («KIA EV9»): 960 min (16t 0min)');
    expect(html).toContain('data-modell="EV9"');
    expect(html).toContain('Kalkyle («KGM Rexton»): 300 min');
    expect(html).toContain('lik standardtiden');
    expect(el('kalkyleTiderStatus').textContent).toMatch(/forslag på 2 av modellene/);
  });
  it('«Bruk» lagrer kalkylens tall med den egne rutinen, etter bekreftelse', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.edgeFetch = async () => svar(KALK);
    await sandbox.hentKalkyleTider();
    expect(await sandbox.brukKalkyleStandardtid('EV9')).toBe(true);
    expect(kall).toEqual([{ type: 'rpc', navn: 'sett_standardtid', args: { p_modell: 'EV9', p_ombygging_min: 960 } }]);
  });
  it('avbrytes bekreftelsen, skjer ingenting', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.edgeFetch = async () => svar(KALK);
    await sandbox.hentKalkyleTider();
    sandbox.confirm = () => false;
    expect(await sandbox.brukKalkyleStandardtid('EV9')).toBe(false);
    expect(kall).toEqual([]);
  });
  it('to kalkylemodeller med samme modellnøkkel: ingen gjetning, ikke noe forslag', async () => {
    sandbox.edgeFetch = async () => svar([...KALK, { kalkyle_id: 'k4', kalkyle_navn: 'KIA EV9 (annen)', portal_modell_slug: 'kia-ev9', minutter: 900 }]);
    await sandbox.hentKalkyleTider();
    expect(sandbox.kalkyleForslagForModell('EV9')).toBe(null);
    expect(el('standardtiderListe').innerHTML).not.toContain('KIA EV9');
  });
  it('en modell kalkylen ikke har tall for (null), eller som ikke gjenkjennes, får ikke noe forslag', async () => {
    sandbox.edgeFetch = async () => svar([{ kalkyle_id: 'k1', kalkyle_navn: 'KIA EV9', portal_modell_slug: 'kia-ev9', minutter: null }]);
    await sandbox.hentKalkyleTider();
    expect(sandbox.kalkyleForslagForModell('EV9')).toBe(null);
    expect(sandbox.kalkyleForslagForModell('Helt ukjent bil')).toBe(null);
  });
  it('feil fra funksjonen vises i statuslinja, og ingen forslag', async () => {
    sandbox.edgeFetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'Kalkylen i portalen gir ikke ut standardtider ennå' }) });
    await sandbox.hentKalkyleTider();
    expect(el('kalkyleTiderStatus').textContent).toMatch(/gir ikke ut standardtider ennå/);
    expect(sandbox.kalkyleForslagForModell('EV9')).toBe(null);
  });
  it('kalkylenavnet escapes', async () => {
    sandbox.edgeFetch = async () => svar([{ kalkyle_id: 'k1', kalkyle_navn: '<img src=x onerror=alert(1)>', portal_modell_slug: 'kia-ev9', minutter: 10 }]);
    await sandbox.hentKalkyleTider();
    expect(el('standardtiderListe').innerHTML).not.toContain('<img');
  });
});

describe('sw.js', () => {
  it('CACHE er hevet til minst v111', () => {
    const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    expect(Number((sw.match(/const CACHE = 'salmakern-v(\d+)'/) || [])[1])).toBeGreaterThanOrEqual(111);
  });
});
