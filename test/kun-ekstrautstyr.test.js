import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// «Kun ekstrautstyr (ingen ombygging)» på en vanlig bil-ordre (Henrik 2026-11-17): en bil som ble bygget om for lenge siden og bare skal ha montert litt
// ekstrautstyr. Ingen av de vanlige tvangsflyt-kravene (bare «Status er Hentet», 2026-11-19), ingen automatisk utstyrsmal, «Varer fra lager» med bare Ekstra utstyr (ikke «Skal på bilen»), ikke i Admin-ark, kalenderen
// skrives målrettet (rører aldri Admin-ark), ordre-lapp som vanlig, og kolonnen skrives aldri av save()/ordreToDb.

const app = lastApp();
const { sandbox, S } = app;
const AAR = new Date().getFullYear();
const ekteSave = sandbox.save; // flere tester bytter ut save() med en spion

function lagDb({ feilPaa = null } = {}) {
  const kall = [];
  const kjede = (info) => new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') {
        const feil = feilPaa && feilPaa(info) ? { message: 'TEST-feil' } : null;
        return (res) => Promise.resolve({ data: null, error: feil }).then(res);
      }
      return (...args) => { info.kall.push([String(k), args]); return kjede(info); };
    },
  });
  return {
    kall,
    db: {
      from: (tabell) => { const info = { tabell, kall: [] }; kall.push(info); return kjede(info); },
      rpc: (navn, args) => { kall.push({ rpc: navn, args }); return Promise.resolve({ data: null, error: null }); },
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    },
  };
}
const metodeArg = (kall, metode) => kall.filter((k) => k.tabell === 'ordrer' && k.kall.some(([m]) => m === metode)).map((k) => k.kall.find(([m]) => m === metode)[1][0]);

// En gammel ordre (før «Skal på bilen»-porten) og en ny (etter), begge KIA EV9.
const GAMMEL_ID = 'ord_1700000000000';
const NY_ID = 'ord_' + (Date.parse('2026-11-18T08:00:00Z'));
const bil = (over = {}) => sandbox.dbToOrdre({
  id: GAMMEL_ID, status: 'aktiv', ordre_status: 'paabegynt', chassis: 'TESTWXYZ0000000K1', kunde: 'TEST Kunde AS', merke: 'KIA', modell: 'EV9',
  ankomstdato: `${AAR}-11-10`, created_at: '2023-11-14T22:13:20Z', ...over,
});

beforeEach(() => {
  S.ordrer = []; S.ansatte = []; S.lagerOppskrifter = []; S.lagerhistorikk = []; S.lagervarer = []; S.utstyrMaler = []; S.adminArk = [];
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  app.settAktivOrdre(null);
  app.settDb(null);
});
// Se CLAUDE.md (leveranse, «Test»): avsluttes en fil mens me er admin, kan worker-prosessen dø ved nedstenging.
afterAll(() => { app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' }); });

describe('lesing og skriving av kun_ekstrautstyr', () => {
  it('dbToOrdre leser kolonnen; mangler den (eldre database) er ordren en vanlig bil', () => {
    expect(bil({ kun_ekstrautstyr: true }).kunEkstrautstyr).toBe(true);
    expect(bil({ kun_ekstrautstyr: false }).kunEkstrautstyr).toBe(false);
    expect(bil().kunEkstrautstyr).toBe(false);
    expect(sandbox.erKunEkstrautstyr(bil({ kun_ekstrautstyr: true }))).toBe(true);
  });
  it('en leveranse er aldri «kun ekstrautstyr», selv om kolonnen skulle være satt', () => {
    expect(sandbox.erKunEkstrautstyr(bil({ ordretype: 'leveranse', kun_ekstrautstyr: true }))).toBe(false);
  });
  it('ordreToDb skriver aldri kolonnen (verken sann eller usann)', () => {
    expect('kun_ekstrautstyr' in sandbox.ordreToDb(bil({ kun_ekstrautstyr: true }))).toBe(false);
    expect('kun_ekstrautstyr' in sandbox.ordreToDb(bil())).toBe(false);
  });
  it('save() sender verken kun_ekstrautstyr eller kalenderen for en «kun ekstrautstyr»-ordre (kalenderen skrives målrettet); en vanlig bil sender kalenderen som før', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    const kun = bil({ kun_ekstrautstyr: true, kalender_dato: '2026-11-19', kalender_tid: '10:00' });
    const vanlig = bil({ id: 'ord_1700000000001', chassis: 'TESTWXYZ0000000K4', kalender_dato: '2026-11-19', kalender_tid: '10:00' });
    S.ordrer = [kun, vanlig];
    await ekteSave(kun.id); await ekteSave(vanlig.id);
    const up = metodeArg(kall, 'upsert');
    expect(up.length).toBe(2);
    const k = up.find((x) => x.id === kun.id), v = up.find((x) => x.id === vanlig.id);
    expect('kalender_dato' in k || 'kalender_tid' in k || 'kun_ekstrautstyr' in k).toBe(false);
    expect(v).toMatchObject({ kalender_dato: '2026-11-19', kalender_tid: '10:00' });
  });
  it('Realtime: en hendelse som slår avkrysningen på/av oppdaterer den lokale ordren', () => {
    const gammel = bil();
    expect(sandbox.dbToOrdreFraRealtime(gammel, { id: GAMMEL_ID, kun_ekstrautstyr: true }).kunEkstrautstyr).toBe(true);
    expect(sandbox.dbToOrdreFraRealtime(bil({ kun_ekstrautstyr: true }), { id: GAMMEL_ID, kun_ekstrautstyr: false }).kunEkstrautstyr).toBe(false);
  });
});

describe('tvangsflyt', () => {
  it('«kun ekstrautstyr» har ett eneste krav (status Hentet, Henrik 2026-11-19); en vanlig bil har fortsatt sine 7', () => {
    expect(sandbox.tvangsflyt(bil({ kun_ekstrautstyr: true, ordre_status: 'klar_henting' }))).toEqual([{ lbl: 'Status er Hentet', ok: false }]);
    expect(sandbox.tvangsflyt(bil({ kun_ekstrautstyr: true, ordre_status: 'hentet' }))).toEqual([{ lbl: 'Status er Hentet', ok: true }]);
    expect(sandbox.tvangsflyt(bil()).length).toBe(7);
  });
  // 2026-11-25 (ordrekort «Alternativ 3»): kortets stolpe er den vanlige («0 av 1 krav», som «Tvangsflyt 0/1» i PDF-en); merket står i pille-raden i stedet.
  it('Tvangsflyt-boksen viser kravet: ikke Hentet gir «0 av 1 krav» (godkjenner kan ikke lukke, admin kan overstyre), Hentet gir «1 av 1 krav» og «Godkjenn og lukk»; kortets stolpe viser det samme kravet', () => {
    const ikkeHentet = bil({ kun_ekstrautstyr: true, ordre_status: 'klar_henting' });
    app.settMe({ id: 1, navn: 'TEST - Godkjenner', rolle: 'godkjenner' });
    let boks = sandbox.tvangsflytBoksHTML(ikkeHentet);
    expect(boks).toContain('Status er Hentet');
    expect(boks).toContain('0 av 1 krav');
    expect(boks).toContain('Ufullstendig');
    expect(boks).not.toContain('Ingen krav');
    app.settMe({ id: 2, navn: 'TEST - Admin', rolle: 'admin' });
    expect(sandbox.tvangsflytBoksHTML(ikkeHentet)).toContain('⚠ Godkjenn og lukk (overstyr)');
    app.settMe({ id: 1, navn: 'TEST - Godkjenner', rolle: 'godkjenner' });
    boks = sandbox.tvangsflytBoksHTML(bil({ kun_ekstrautstyr: true, ordre_status: 'hentet' }));
    expect(boks).toContain('1 av 1 krav');
    expect(boks).toMatch(/>Godkjenn og lukk<\/button>/);
    expect(sandbox.tvangsflytBarHTML(ikkeHentet)).toContain('0 av 1 krav');
    expect(sandbox.tvangsflytBarHTML(ikkeHentet)).not.toContain('KUN EKSTRAUTSTYR');
    expect(sandbox.tvangsflytBarHTML(bil({ kun_ekstrautstyr: true, ordre_status: 'hentet' }))).toContain('1 av 1 krav');
    expect(sandbox.ordreKortPillerHTML(ikkeHentet)).toContain('KUN EKSTRAUTSTYR');
    expect(sandbox.tvangsflytBarHTML(bil())).toContain('av 7 krav');
  });
});

describe('autoVelgUtstyrMal', () => {
  const MAL = { navn: 'TEST EV9-mal', biltype: 'KIA EV9', punkter: ['Gummimatte', 'Kasse'] };
  it('velger ingen mal for «kun ekstrautstyr»', async () => {
    S.utstyrMaler = [MAL];
    const lagret = []; sandbox.save = (id) => { lagret.push(id); };
    const o = bil({ kun_ekstrautstyr: true }); S.ordrer = [o];
    await sandbox.autoVelgUtstyrMal(o.id);
    expect(o.utstyrMalNavn).toBe('');
    expect(o.utstyrSjekkliste).toEqual([]);
    expect(lagret).toEqual([]);
  });
  it('velger malen for en vanlig bil som før (kontroll)', async () => {
    S.utstyrMaler = [MAL];
    sandbox.save = () => {};
    const o = bil(); S.ordrer = [o];
    await sandbox.autoVelgUtstyrMal(o.id);
    expect(o.utstyrMalNavn).toBe('TEST EV9-mal');
  });
});

describe('Varer fra lager (renderOrdreLagerbruk, ordrer fra før «Skal på bilen»)', () => {
  const OPPSKRIFTER = [
    { id: 'opp_omb', navn: 'TEST Standard ombygging', biltype: 'KIA EV9', type: 'ombygging', ingredienser: [], fikenProduktnummer: '' },
    { id: 'opp_ekstra', navn: 'TEST Gummimatte', biltype: 'KIA EV9', type: 'ekstra_utstyr', ingredienser: [], fikenProduktnummer: '' },
  ];
  const vis = (o) => {
    S.ordrer = [o]; S.lagerOppskrifter = structuredClone(OPPSKRIFTER);
    app.settAktivOrdre(o.id);
    sandbox.renderOrdreLagerbruk();
    return sandbox.document.getElementById('ordreLagerbruk_' + o.id).innerHTML;
  };
  it('«kun ekstrautstyr»: bare Ekstra utstyr-nedtrekket, ikke Ombygging', () => {
    const html = vis(bil({ kun_ekstrautstyr: true }));
    expect(html).toContain('Ekstra utstyr');
    expect(html).toContain('TEST Gummimatte');
    expect(html).not.toContain('TEST Standard ombygging');
    expect(html).not.toContain('<label>Ombygging</label>');
  });
  it('vanlig (gammel) bil: begge nedtrekkene som før', () => {
    const html = vis(bil());
    expect(html).toContain('<label>Ombygging</label>');
    expect(html).toContain('TEST Standard ombygging');
    expect(html).toContain('TEST Gummimatte');
  });
  it('en NY «kun ekstrautstyr»-ordre får «Skal på bilen» (Henriks valg), uten ombyggingsrad', () => {
    const nyKun = bil({ id: NY_ID, created_at: '2026-11-18T08:00:00Z', kun_ekstrautstyr: true, ombygging: { nyttKjoretoy: true } });
    expect(sandbox.erNyProduktliste(nyKun)).toBe(true);
    expect(sandbox.beregnSkalPaaBilen(nyKun).rader.some((r) => r.kilde === 'ombygging')).toBe(false);
  });
  it('er en ombygging-oppskrift allerede trukket på ordren, vises Ombygging likevel (så trekket kan angres)', () => {
    S.lagerhistorikk = [{ id: 1, vareId: 'v1', ordreId: GAMMEL_ID, batchId: 'b1', oppskriftId: 'opp_omb', kommentar: 'TEST Standard ombygging', endring: -1 }];
    const html = vis(bil({ kun_ekstrautstyr: true }));
    expect(html).toContain('TEST Standard ombygging');
  });
  it('ingen ekstrautstyr-oppskrift for modellen: tydelig beskjed, ingen Ombygging', () => {
    S.ordrer = [bil({ kun_ekstrautstyr: true })]; S.lagerOppskrifter = [OPPSKRIFTER[0]];
    app.settAktivOrdre(GAMMEL_ID);
    sandbox.renderOrdreLagerbruk();
    const html = sandbox.document.getElementById('ordreLagerbruk_' + GAMMEL_ID).innerHTML;
    expect(html).toContain('Ingen ekstrautstyr-oppskrift funnet');
  });
});

describe('Admin-ark, ordre-lapp og ordrekort', () => {
  it('står ikke i Admin-ark; en vanlig bil samme år gjør det', () => {
    S.ordrer = [bil({ id: 'ord_kun', chassis: 'TESTWXYZ0000000K2', kun_ekstrautstyr: true }), bil({ id: 'ord_vanlig', chassis: 'TESTWXYZ0000000K3' })];
    const rader = sandbox.adminArkByggRader();
    expect(rader.some((r) => r._ordreId === 'ord_kun')).toBe(false);
    expect(rader.some((r) => r._ordreId === 'ord_vanlig')).toBe(true);
  });
  it('Admin-ark kobler aldri en rad til en «kun ekstrautstyr»-ordre på samme chassis', () => {
    S.ordrer = [bil({ kun_ekstrautstyr: true })];
    expect(sandbox.adminArkHentRadData('TESTWXYZ0000000K1').forhandler).toBe('');
  });
  it('får ordre-lapp som en vanlig aktiv bil', () => {
    expect(sandbox.ordreLappSkalHa(bil({ kun_ekstrautstyr: true }))).toBe(true);
  });
  it('merket står på kortet i Ordre-lista, og ikke på en vanlig bil', () => {
    S.ordrer = [bil({ id: 'ord_kun', chassis: 'TESTWXYZ0000000K2', kun_ekstrautstyr: true }), bil({ id: 'ord_vanlig', chassis: 'TESTWXYZ0000000K3' })];
    sandbox.renderOrdreList();
    const html = sandbox.document.getElementById('ordreListeResultat').innerHTML || '';
    expect((html.match(/KUN EKSTRAUTSTYR/g) || []).length).toBe(1);
  });
  it('merket (HTML) er tomt for en vanlig bil og en leveranse', () => {
    expect(sandbox.kunEkstrautstyrBadgeHTML(bil())).toBe('');
    expect(sandbox.kunEkstrautstyrBadgeHTML(bil({ ordretype: 'leveranse', kun_ekstrautstyr: true }))).toBe('');
  });
});

describe('kalenderen rører aldri Admin-ark', () => {
  const spioner = () => {
    const r = { admin: [], sted: [], lagret: [], toast: [] };
    sandbox.adminArkLagreFelter = async (...a) => { r.admin.push(a); };
    sandbox.openKalenderStedModal = (id) => { r.sted.push(id); };
    sandbox.save = (id) => { r.lagret.push(id); };
    sandbox.document.removeEventListener = () => {};
    sandbox.visToast = (m) => { r.toast.push(m); };
    return r;
  };
  it('dra: én målrettet kalenderoppdatering, ingen sted-dialog, ingen Admin-ark, ingen full lagring', async () => {
    const r = spioner(); const { db, kall } = lagDb(); app.settDb(db);
    const o = bil({ kun_ekstrautstyr: true }); S.ordrer = [o];
    sandbox.document.elementFromPoint = () => ({ closest: () => ({ dataset: { dato: '2026-11-19', tid: '10:00' } }) });
    app.kjor(`_dragOrdre = { id: '${o.id}', moved: true, ghostEl: null, kortEl: null, x: 0, y: 0, startX: 0, startY: 0 }`);
    sandbox.dragOrdreEnd({ clientX: 1, clientY: 1 });
    await new Promise((ok) => setTimeout(ok, 10));
    expect(metodeArg(kall, 'update').filter((u) => 'kalender_dato' in u)).toEqual([{ kalender_dato: '2026-11-19', kalender_tid: '10:00' }]);
    expect(r.admin).toEqual([]); expect(r.sted).toEqual([]); expect(r.lagret).toEqual([]);
  });
  it('Fjern: bare kalendertiden, ingen Admin-ark', async () => {
    const r = spioner(); const { db, kall } = lagDb(); app.settDb(db);
    const o = bil({ kun_ekstrautstyr: true, kalender_dato: '2026-11-19', kalender_tid: '10:00' }); S.ordrer = [o];
    await sandbox.fjernFraKalender(o.id);
    expect(metodeArg(kall, 'update').filter((u) => 'kalender_dato' in u)).toEqual([{ kalender_dato: null, kalender_tid: '' }]);
    expect(r.admin).toEqual([]);
  });
});

describe('Hentet: en kun-ordre skriver aldri til Admin-ark (hentetVarslet), en vanlig bil gjør det som før', () => {
  // Funnet i den uavhengige gjennomgangen 19.11: endreStatus(..., 'hentet') merket «hentetVarslet» i Admin-ark på ordrens chassis uten å se på «kun ekstrautstyr». Uten en Admin-ark-rad ble en NY rad opprettet
  // (en ukoblet rad som Helsesjekk meldte som mulig skrivefeil), og fantes det en rad fra bilens opprinnelige ombygging, fikk den grønn Hentet-knapp uten at kunden var varslet.
  const CHASSIS = 'TESTWXYZ0000000H1';
  const ORIG = { adminArkLagreFelter: sandbox.adminArkLagreFelter, renderAll: sandbox.renderAll, buildOrdreDetail: sandbox.buildOrdreDetail, visToast: sandbox.visToast, effektivOrdreTidPerAnsattMs: sandbox.effektivOrdreTidPerAnsattMs };
  beforeEach(() => {
    // Den ekte adminArkLagreFelter (en annen describe i denne fila bytter den ut med en spion uten å sette den tilbake).
    sandbox.adminArkLagreFelter = ORIG.adminArkLagreFelter;
    sandbox.renderAll = () => {}; sandbox.buildOrdreDetail = () => {}; sandbox.visToast = () => {};
    sandbox.effektivOrdreTidPerAnsattMs = async () => ({ totalMs: 0, perAnsatt: [] });
  });
  afterEach(() => { Object.assign(sandbox, ORIG); });
  const arkKall = (kall) => kall.filter((k) => k.tabell === 'admin_ark');
  const arkSkriv = (kall, metode) => arkKall(kall).flatMap((k) => k.kall.filter(([m]) => m === metode).map(([, a]) => a[0]));
  // Fra 2026-11-17/25 sendes «Bilen er hentet»-e-posten automatisk, og hentetVarslet settes BARE etter vellykket sending
  // (før ble raden merket uten e-post). Kontrollene for en vanlig bil har derfor en kontaktperson med e-post og en falsk edgeFetch.
  const ORIG_EDGE = sandbox.edgeFetch;
  let epostKall;
  async function settHentet({ kun, medArkRad, medEpost = true }) {
    const { db, kall } = lagDb(); app.settDb(db);
    epostKall = [];
    sandbox.edgeFetch = async (fn, init) => { epostKall.push({ fn, body: JSON.parse(init.body) }); return { ok: true, text: async () => 'ok' }; };
    S.kontakter = [{ id: 'k_TEST', navn: 'TEST Kunde AS', type: 'Forhandler', kontaktpersoner: [{ id: 'kp_TEST', navn: 'TEST Kari', epost: 'kari@example.test' }] }];
    const o = bil({ chassis: CHASSIS, ordre_status: 'klar_henting', kun_ekstrautstyr: kun, eier: medEpost ? 'TEST Kari' : 'TEST Ukjent' }); S.ordrer = [o];
    // _db: raden finnes i databasen (som en rad fra dbToAdminArkRad), så skrivingen er en update av bare det endrede feltet.
    S.adminArk = medArkRad ? [{ id: 'ark_TEST_H1', chassisNr: CHASSIS, aar: AAR, arkivert: false, hentetVarslet: false, _db: true }] : [];
    try { await sandbox.endreStatus(o.id, 'hentet'); } finally { sandbox.edgeFetch = ORIG_EDGE; }
    return { o, kall };
  }
  it('kun-ordre uten Admin-ark-rad: statusen settes, men ingen rad opprettes, ingen skriving til admin_ark og ingen ukoblet rad i Helsesjekk', async () => {
    const { o, kall } = await settHentet({ kun: true, medArkRad: false });
    expect(o.ordreStatus).toBe('hentet'); // endreStatus gikk hele veien
    expect(metodeArg(kall, 'update').some((u) => u.ordre_status === 'hentet')).toBe(true);
    expect(arkKall(kall)).toEqual([]);
    expect(S.adminArk).toEqual([]);
    expect(sandbox.finnUkobledeAdminArkRader()).toEqual([]);
  });
  it('kun-ordre med en eksisterende rad på samme chassis (bilens opprinnelige ombygging): raden røres ikke og får ikke grønn Hentet-knapp', async () => {
    const { o, kall } = await settHentet({ kun: true, medArkRad: true });
    expect(o.ordreStatus).toBe('hentet');
    expect(arkKall(kall)).toEqual([]);
    expect(S.adminArk).toHaveLength(1);
    expect(S.adminArk[0].hentetVarslet).toBe(false);
  });
  it('en kun-ordre sender heller ingen hentet-e-post', async () => {
    await settHentet({ kun: true, medArkRad: true });
    expect(epostKall).toEqual([]);
  });
  it('kontroll: en vanlig bil der e-posten ikke kan sendes (ingen e-post i Kontakter): ingen merking i Admin-ark', async () => {
    const { kall } = await settHentet({ kun: false, medArkRad: true, medEpost: false });
    expect(epostKall).toEqual([]);
    expect(arkKall(kall)).toEqual([]);
    expect(S.adminArk[0].hentetVarslet).toBe(false);
  });
  it('kontroll: en vanlig bil uten rad får e-posten og en ny Admin-ark-rad med hentet_varslet', async () => {
    const { kall } = await settHentet({ kun: false, medArkRad: false });
    expect(epostKall).toHaveLength(1);
    const upsert = arkSkriv(kall, 'upsert');
    expect(upsert).toHaveLength(1);
    expect(upsert[0]).toMatchObject({ chassis_nr: CHASSIS, hentet_varslet: true });
    expect(S.adminArk).toHaveLength(1);
    expect(S.adminArk[0].hentetVarslet).toBe(true);
  });
  it('kontroll: en vanlig bil med en eksisterende rad får e-posten, og bare hentet_varslet oppdatert på den raden', async () => {
    const { kall } = await settHentet({ kun: false, medArkRad: true });
    expect(epostKall).toHaveLength(1);
    expect(epostKall[0].body).toMatchObject({ type: 'hentet', kontaktpersonEpost: 'kari@example.test', chassisNr: CHASSIS });
    expect(arkSkriv(kall, 'update')).toEqual([{ hentet_varslet: true }]);
    expect(arkSkriv(kall, 'upsert')).toEqual([]);
    expect(S.adminArk[0].hentetVarslet).toBe(true);
  });
  it('en kun-ordre uten chassis.nr (bare reg.nr) skriver heller ikke til Admin-ark', async () => {
    const { db, kall } = lagDb(); app.settDb(db);
    const o = bil({ chassis: '', regnr: 'TE12345', ordre_status: 'klar_henting', kun_ekstrautstyr: true }); S.ordrer = [o]; S.adminArk = [];
    await sandbox.endreStatus(o.id, 'hentet');
    expect(o.ordreStatus).toBe('hentet');
    expect(arkKall(kall)).toEqual([]);
  });
});

describe('settKunEkstrautstyr (avkrysningen i ordredetaljen)', () => {
  beforeEach(() => { sandbox.buildOrdreDetail = () => {}; sandbox.renderAll = () => {}; });
  it('slår på med én målrettet oppdatering av bare kun_ekstrautstyr, og logger først etter vellykket skriving', async () => {
    const toast = []; sandbox.visToast = (m) => toast.push(m);
    const { db, kall } = lagDb(); app.settDb(db);
    const o = bil(); S.ordrer = [o];
    await sandbox.settKunEkstrautstyr(o.id, true);
    expect(o.kunEkstrautstyr).toBe(true);
    expect(metodeArg(kall, 'update')).toContainEqual({ kun_ekstrautstyr: true });
    expect(JSON.stringify(o.endringer)).toContain('Merket som kun ekstrautstyr');
    expect(toast).toEqual([]);
  });
  it('kan ikke slås på mens en Ombygging-boks er huket av (ingen skriving)', async () => {
    const toast = []; sandbox.visToast = (m) => toast.push(m);
    const { db, kall } = lagDb(); app.settDb(db);
    const o = bil({ ombygging: { nyttKjoretoy: true, bruktKjoretoy: false, lafinto: false, personbil: false } }); S.ordrer = [o];
    await sandbox.settKunEkstrautstyr(o.id, true);
    expect(o.kunEkstrautstyr).toBe(false);
    expect(metodeArg(kall, 'update')).toEqual([]);
    expect(toast.join('|')).toMatch(/Fjern avkrysningen i Ombygging/);
  });
  it('feiler skrivingen, rulles den lokale verdien tilbake og ingen logglinje skrives', async () => {
    const toast = []; sandbox.visToast = (m) => toast.push(m);
    const { db } = lagDb({ feilPaa: (info) => info.tabell === 'ordrer' }); app.settDb(db);
    const o = bil(); S.ordrer = [o];
    await sandbox.settKunEkstrautstyr(o.id, true);
    expect(o.kunEkstrautstyr).toBe(false);
    expect(JSON.stringify(o.endringer)).not.toContain('kun ekstrautstyr');
    expect(toast.join('|')).toMatch(/Kunne ikke lagre/);
  });
  it('slår av igjen (målrettet false)', async () => {
    sandbox.visToast = () => {};
    const { db, kall } = lagDb(); app.settDb(db);
    const o = bil({ kun_ekstrautstyr: true }); S.ordrer = [o];
    await sandbox.settKunEkstrautstyr(o.id, false);
    expect(o.kunEkstrautstyr).toBe(false);
    expect(metodeArg(kall, 'update')).toContainEqual({ kun_ekstrautstyr: false });
  });
  it('Ombygging-boksen viser avkrysningen og skjuler Nytt/Brukt når den er på', () => {
    const paa = sandbox.ombyggingBoksHTML(bil({ kun_ekstrautstyr: true }));
    expect(paa).toContain('Kun ekstrautstyr (ingen ombygging)');
    expect(paa).toContain('checked');
    expect(paa).not.toContain('Nytt Kjøretøy');
    const av = sandbox.ombyggingBoksHTML(bil());
    expect(av).toContain('Kun ekstrautstyr (ingen ombygging)');
    expect(av).toContain('Nytt Kjøretøy');
  });
});

describe('«+ Ny ordre» med avkrysningen', () => {
  it('insert-en har kun_ekstrautstyr: true, og ingen automatisk utstyrsmal velges', () => {
    S.utstyrMaler = [{ navn: 'TEST EV9-mal', biltype: 'KIA EV9', punkter: ['Gummimatte'] }];
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.edgeFetch = async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });
    sandbox.openOrdre = () => {}; sandbox.renderAll = () => {}; sandbox.closeModal = () => {};
    const verdier = { n_regnr: '', n_chassis: 'TESTWXYZ0000000K9', n_kunde: 'TEST Kunde AS', n_eier: '', n_merke: 'KIA', n_type: '', n_modell: 'EV9', n_variant: '', n_farge: '', n_versjon: '', n_dato: '', n_status: 'ikke_paabegynt' };
    for (const [id, v] of Object.entries(verdier)) sandbox.document.getElementById(id).value = v;
    sandbox.document.getElementById('n_kunEkstrautstyr').checked = true;
    sandbox.opprettOrdre();
    const ins = metodeArg(kall, 'insert');
    expect(ins.length).toBe(1);
    expect(ins[0].kun_ekstrautstyr).toBe(true);
    const o = S.ordrer.find((x) => x.chassis === 'TESTWXYZ0000000K9');
    expect(o.kunEkstrautstyr).toBe(true);
    expect(o.utstyrMalNavn).toBe('');
    expect(sandbox.document.getElementById('n_kunEkstrautstyr').checked).toBe(false); // nullstilt for neste ordre
  });
  it('uten avkrysningen er insert-en som før (ingen kun_ekstrautstyr-nøkkel)', () => {
    const { db, kall } = lagDb(); app.settDb(db);
    sandbox.document.getElementById('n_chassis').value = 'TESTWXYZ0000000K8';
    sandbox.document.getElementById('n_kunEkstrautstyr').checked = false;
    sandbox.opprettOrdre();
    const ins = metodeArg(kall, 'insert');
    expect(ins.length).toBe(1);
    expect('kun_ekstrautstyr' in ins[0]).toBe(false);
  });
});
