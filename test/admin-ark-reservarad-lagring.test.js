import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Regresjonstest for feil bekreftet i produksjon 2026-11-01 (portal-økta sin prøve):
// en tom reserverad nederst i Admin-ark (adminArkNyTomRadObjekt/adminArkSikreTommeRader)
// legges inn i S.adminArk RENT I MINNET - aldri i databasen - til noen faktisk skriver et
// felt i den. adminArkLagreFelter() fant likevel raden i S.adminArk og trodde den alt var
// lagret, og sendte en UPDATE (ikke en INSERT) som stille traff 0 rader: ordren kunne bli
// opprettet (adminArkOpprettOrdreForChassis leser bare rad.chassisNr, ikke databasen), men
// selve Admin-ark-raden forsvant sporløst ved neste omlasting. Fikset med et _db-flagg
// (satt av dbToAdminArkRad() for alt som faktisk kommer fra databasen) i stedet for å anta
// at "finnes i S.adminArk" betyr "finnes i databasen". Samme fiks i
// adminArkPersisterRekkefolge() (rad-flytting), som hadde nøyaktig samme feil.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreKode = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8');
const adminArkKode = readFileSync(path.resolve(__dirname, '../js/admin-ark.js'), 'utf8');

// Enkel fake av Supabase-klientens kjedede spørringsbygger: .from(tabell).upsert(payload, opts)
// og .from(tabell).update(payload).eq(kol, verdi) - begge "await"-bare og uten feil som standard.
function lagFakeDb(kall) {
  return {
    from(tabell) {
      return {
        upsert(payload, opts) {
          kall.push({ tabell, type: 'upsert', payload, opts });
          return Promise.resolve({ error: null });
        },
        update(payload) {
          kall.push({ tabell, type: 'update', payload });
          return { eq: (kol, verdi) => { kall[kall.length - 1].eq = [kol, verdi]; return Promise.resolve({ error: null }); } };
        },
      };
    },
  };
}

function nyEnvironment() {
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: { addEventListener() {}, getElementById() { return null; }, createElement() { return { style: {}, appendChild(){} }; }, head: { appendChild() {} } },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout(fn) { fn(); }, clearTimeout() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  vm.runInContext(adminArkKode, sandbox, { filename: 'admin-ark.js' });
  vm.runInContext(`
    function _setS(v){ S = v; }
    function _setDb(v){ db = v; }
    function _setMe(v){ me = v; }
    function _setAdminArkTable(v){ adminArkTable = v; }
  `, sandbox);
  return sandbox;
}

describe('adminArkLagreFelter: tom reserverad vs. ekte databaserad', () => {
  it('bruker UPSERT (ikke UPDATE) for en tom reserverad som aldri er lagret (bugen)', async () => {
    const sandbox = nyEnvironment();
    const kall = [];
    const reserverad = { id: 'ark_reserve_1', chassisNr: '', aar: 2026, rekkefolge: 2147483647,
      forhandler: '', kontaktperson: '', serienummer: '', mottatt: false, papirer: '', dokumenter: false,
      fraktselskap: '', bestiltFrakt: false, hentetVarslet: false, utstyr: '', merknader: '', flateHypotetisk: '',
      timeBekreftet: '', timeBekreftetTid: '', ventendeTimer: '', arkivert: false }; // ingen _db-felt = aldri lagret
    sandbox._setS({ ordrer: [], adminArk: [reserverad] });
    sandbox._setDb(lagFakeDb(kall));

    const rad = { _arkId: 'ark_reserve_1', _erOrdre: false, chassisNr: 'TESTWXYZ000000001' };
    await sandbox.adminArkLagreFelter(rad, { chassisNr: 'TESTWXYZ000000001' });

    expect(kall).toHaveLength(1);
    expect(kall[0].type).toBe('upsert');
    expect(kall[0].payload.id).toBe('ark_reserve_1');
    expect(kall[0].payload.chassis_nr).toBe('TESTWXYZ000000001');
  });

  it('setter _db=true på raden etter en vellykket lagring, slik neste skriving blir en ekte UPDATE', async () => {
    const sandbox = nyEnvironment();
    const kall = [];
    const reserverad = { id: 'ark_reserve_2', chassisNr: '', aar: 2026, rekkefolge: 2147483647,
      forhandler: '', kontaktperson: '', serienummer: '', mottatt: false, papirer: '', dokumenter: false,
      fraktselskap: '', bestiltFrakt: false, hentetVarslet: false, utstyr: '', merknader: '', flateHypotetisk: '',
      timeBekreftet: '', timeBekreftetTid: '', ventendeTimer: '', arkivert: false };
    sandbox._setS({ ordrer: [], adminArk: [reserverad] });
    sandbox._setDb(lagFakeDb(kall));

    const rad = { _arkId: 'ark_reserve_2', _erOrdre: false, chassisNr: 'TESTWXYZ000000002' };
    await sandbox.adminArkLagreFelter(rad, { chassisNr: 'TESTWXYZ000000002' });
    expect(kall[0].type).toBe('upsert');

    // Andre skriving på SAMME rad (f.eks. et merknad-felt rett etterpå) skal nå være en vanlig UPDATE.
    await sandbox.adminArkLagreFelter(rad, { merknader: 'Testmerknad' });
    expect(kall).toHaveLength(2);
    expect(kall[1].type).toBe('update');
    expect(kall[1].eq).toEqual(['id', 'ark_reserve_2']);
  });

  it('bruker UPDATE (ikke UPSERT) for en rad som faktisk kommer fra databasen (dbToAdminArkRad, _db=true)', async () => {
    const sandbox = nyEnvironment();
    const kall = [];
    const ekteRadFraDb = sandbox.dbToAdminArkRad({
      id: 'ark_ekte_1', chassis_nr: 'TESTWXYZ000000003', aar: 2026, rekkefolge: 1,
      forhandler: 'Test Forhandler', kontaktperson: 'Test Kontakt', serienummer: '', arkivert: false,
    });
    expect(ekteRadFraDb._db).toBe(true); // selve mappingen skal markere raden som lagret
    sandbox._setS({ ordrer: [], adminArk: [ekteRadFraDb] });
    sandbox._setDb(lagFakeDb(kall));

    const rad = { _arkId: 'ark_ekte_1', _erOrdre: false, chassisNr: 'TESTWXYZ000000003' };
    await sandbox.adminArkLagreFelter(rad, { merknader: 'En endring' });

    expect(kall).toHaveLength(1);
    expect(kall[0].type).toBe('update');
    expect(kall[0].payload).toEqual({ merknader: 'En endring' });
  });

  it('en helt ny rad (finnes ikke i S.adminArk i det hele tatt) bruker fortsatt UPSERT som før', async () => {
    const sandbox = nyEnvironment();
    const kall = [];
    sandbox._setS({ ordrer: [], adminArk: [] });
    sandbox._setDb(lagFakeDb(kall));

    const rad = { _arkId: null, _erOrdre: false, chassisNr: 'TESTWXYZ000000004', forhandler: 'X', kontaktperson: 'Y' };
    await sandbox.adminArkLagreFelter(rad, { chassisNr: 'TESTWXYZ000000004' });

    expect(kall).toHaveLength(1);
    expect(kall[0].type).toBe('upsert');
  });
});

describe('adminArkPersisterRekkefolge: samme _db-sjekk ved rad-flytting', () => {
  function lagTabellFake(radData) {
    return {
      getData: () => radData,
      getRows: () => radData.map((d, i) => ({ update() {}, getPosition: () => i, getData: () => d })),
    };
  }

  it('en tom reserverad som flyttes (uten noe felt skrevet ennå) havner i nyeRader (UPSERT full rad), ikke i rekkefolgeOppdateringer (delvis UPSERT)', async () => {
    const sandbox = nyEnvironment();
    const kall = [];
    const reserverad = { id: 'ark_reserve_3', chassisNr: 'TESTWXYZ000000005', aar: 2026, rekkefolge: 2147483647,
      forhandler: '', kontaktperson: '', serienummer: '', mottatt: false, papirer: '', dokumenter: false,
      fraktselskap: '', bestiltFrakt: false, hentetVarslet: false, utstyr: '', merknader: '', flateHypotetisk: '',
      timeBekreftet: '', timeBekreftetTid: '', ventendeTimer: '', arkivert: false }; // ingen _db = aldri lagret ennå
    sandbox._setS({ ordrer: [], adminArk: [reserverad] });
    sandbox._setDb(lagFakeDb(kall));
    sandbox._setAdminArkTable(lagTabellFake([{ _arkId: 'ark_reserve_3', chassisNr: 'TESTWXYZ000000005', _erOrdre: false }]));

    await sandbox.adminArkPersisterRekkefolge(['']);

    expect(kall).toHaveLength(1);
    expect(kall[0].type).toBe('upsert');
    expect(kall[0].payload[0].chassis_nr).toBe('TESTWXYZ000000005'); // full rad, ikke bare {id, rekkefolge, ventende_timer}
    expect(reserverad._db).toBe(true); // markert lagret etter suksess
  });

  it('en rad som ALLEREDE er i databasen bruker fortsatt den smale rekkefolge-oppdateringen', async () => {
    const sandbox = nyEnvironment();
    const kall = [];
    const ekteRad = sandbox.dbToAdminArkRad({ id: 'ark_ekte_2', chassis_nr: 'TESTWXYZ000000006', aar: 2026, rekkefolge: 0, arkivert: false });
    sandbox._setS({ ordrer: [], adminArk: [ekteRad] });
    sandbox._setDb(lagFakeDb(kall));
    sandbox._setAdminArkTable(lagTabellFake([{ _arkId: 'ark_ekte_2', chassisNr: 'TESTWXYZ000000006', _erOrdre: false }]));

    await sandbox.adminArkPersisterRekkefolge(['']);

    expect(kall).toHaveLength(1);
    expect(kall[0].type).toBe('upsert');
    expect(Object.keys(kall[0].payload[0])).toEqual(['id', 'rekkefolge', 'ventende_timer']); // smalt felt-sett
  });
});
