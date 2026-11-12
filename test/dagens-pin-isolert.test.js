import { describe, it, expect, beforeEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// Bug funnet 2026-11-12 under undersøkelse av "vi blir logget ut hele tiden" (se CLAUDE.md):
// saveInnstillinger() sendte alltid med enhetens lokale (potensielt utdaterte) kopi av
// dagens_pin - en GPS-lignende "overstyrings-PIN" for timeklokka som roterer automatisk hvert
// døgn kl. 00:00 - når NOEN lagret noe helt urelatert (drivstoffsats, biltilsyn-reisetid,
// utstyrsmal, standardtid). En fane som sto åpen gjennom midnatt fikk en utdatert kopi, og
// neste urelaterte lagring skrev den gamle PIN-en tilbake - noe core.js sin Realtime-handler
// tolket som et bevisst PIN-bytte og tvangslogget HELE bedriften ut. Rettet ved å fjerne
// dagens_pin fra "lagre alt"-upserten (samme mønster som allerede brukt for gps_lat/gps_lng/
// gps_radius via saveGPS()) og gi den sin egen, målrettede saveDagensPin(), kalt kun fra
// genPIN() - det eneste stedet som faktisk skal endre den.

function nyUpsertSpion() {
  const kall = [];
  const db = {
    from: (tabell) => ({
      upsert: (rad, opts) => { kall.push({ type: 'upsert', tabell, rad, opts }); return Promise.resolve({ error: null }); },
      update: (rad) => ({ eq: (felt, verdi) => { kall.push({ type: 'update', tabell, rad, felt, verdi }); return Promise.resolve({ error: null }); } }),
    }),
  };
  return { db, kall };
}

describe('dagens_pin skrives ALDRI av saveInnstillinger() - kun av saveDagensPin()', () => {
  let app, db, kall;
  beforeEach(() => {
    app = lastApp();
    ({ db, kall } = nyUpsertSpion());
    app.settDb(db);
    app.S.dagensPIN = '1234';
    app.S.utstyrMaler = [];
    app.S.drivstoffSatser = [];
    app.S.biltilsynReisetider = [];
    app.S.standardtider = {};
  });

  it('saveInnstillinger() sin upsert mot "innstillinger" inneholder IKKE dagens_pin', () => {
    app.kjor('saveInnstillinger()');
    const upsert = kall.find(k => k.type === 'upsert' && k.tabell === 'innstillinger');
    expect(upsert).toBeTruthy();
    expect(upsert.rad).not.toHaveProperty('dagens_pin');
    expect(upsert.rad).toHaveProperty('utstyr_maler');
    expect(upsert.rad).toHaveProperty('drivstoff_satser');
    expect(upsert.rad).toHaveProperty('biltilsyn_reisetider');
    expect(upsert.rad).toHaveProperty('standardtider');
  });

  it('en urelatert lagring (f.eks. settStandardtid) skriver aldri dagens_pin', () => {
    app.kjor("settStandardtid('EV9','ombygging','120')");
    const upsert = kall.find(k => k.type === 'upsert' && k.tabell === 'innstillinger');
    expect(upsert.rad).not.toHaveProperty('dagens_pin');
  });

  it('saveDagensPin() gjør et MÅLRETTET update med KUN dagens_pin', () => {
    app.kjor('saveDagensPin()');
    const update = kall.find(k => k.type === 'update' && k.tabell === 'innstillinger');
    expect(update).toBeTruthy();
    expect(update.rad).toEqual({ dagens_pin: '1234' });
    expect(update.felt).toBe('id');
    expect(update.verdi).toBe(1);
    expect(kall.some(k => k.type === 'upsert')).toBe(false); // ingen "lagre alt" i det hele tatt
  });

  it('genPIN() genererer en ny PIN og lagrer den KUN via saveDagensPin() (målrettet update)', () => {
    app.kjor('genPIN()');
    expect(app.S.dagensPIN).toMatch(/^\d{4}$/);
    const update = kall.find(k => k.type === 'update' && k.tabell === 'innstillinger');
    expect(update).toBeTruthy();
    expect(update.rad).toEqual({ dagens_pin: app.S.dagensPIN });
    expect(kall.some(k => k.type === 'upsert' && k.tabell === 'innstillinger')).toBe(false);
  });

  it('ingen kodefeil ved lasting av hele appen (sanity - app-harness)', () => {
    expect(app.lasteFeil).toEqual([]);
  });
});
