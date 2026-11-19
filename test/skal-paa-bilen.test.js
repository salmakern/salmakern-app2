// Trinn 3 av «Én produktliste»: «Skal på bilen» (js/skal-paa-bilen.js), kjørt i hele appen (test/helpers/app-harness.js) med falsk database.
// Syntetiske TEST-data: KIA EV9 med Standard ombygging 500, Takluke 501 («velges når» Panorama glasstak), 180-stoler 502 og to oppskrifter
// for ombyggingen (vanlig og «500, 502» med 180-brakettene), som i den ekte databasen 17.11.
import vm from 'node:vm';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

const app = lastApp();
const { sandbox, S } = app;
const EKTE_GATE = sandbox.erNyProduktliste;
const EKTE = { visToast: sandbox.visToast, logChange: sandbox.logChange };

function lagDb() {
  const rpc = [];
  const svar = {};
  const db = {
    rpc: (navn, args) => { rpc.push({ navn, args }); const s = svar[navn]; return Promise.resolve(typeof s === 'function' ? s(args) : (s || { data: null, error: null })); },
    from: () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? (res) => Promise.resolve({ data: null, error: null }).then(res) : () => db.from()) }),
  };
  return { db, rpc, svar };
}

const PRODUKTER = [
  { portal_id: 'v500', type: 'variant', modell_slug: 'kia-ev9', fiken_nummer: '500', nummer_status: 'ok', navn: 'Standard ombygging', app_rolle: 'ombygging', velges_nar: [] },
  { portal_id: 'v524', type: 'variant', modell_slug: 'kia-ev9', fiken_nummer: '524', nummer_status: 'ok', navn: 'Ombygging til personbil', app_rolle: 'personbil', velges_nar: [] },
  { portal_id: 't501', type: 'tillegg', modell_slug: 'kia-ev9', variant_portal_id: 'v500', fiken_nummer: '501', nummer_status: 'ok', navn: 'Takluke', app_rolle: null, velges_nar: ['Panorama glasstak'] },
  { portal_id: 't502', type: 'tillegg', modell_slug: 'kia-ev9', variant_portal_id: 'v500', fiken_nummer: '502', nummer_status: 'ok', navn: 'Tillegg for 180 graders stoler', app_rolle: null, velges_nar: ['4-seter bak 180', 'Tillegg for 180 graders stoler'] },
  { portal_id: 'v503', type: 'variant', modell_slug: 'kia-ev9', fiken_nummer: '503', nummer_status: 'ok', navn: 'Heldekkende gulv', app_rolle: null, velges_nar: [] },
];
const OPPSKRIFTER = [
  { id: 'opp_std', navn: 'TEST Standard ombygging', biltype: 'EV9', type: 'ombygging', fikenProduktnummer: '500', portalVariantId: 'v500', ingredienser: [{ vareId: 'vare_T1', antall: 1 }] },
  { id: 'opp_180', navn: 'TEST Ombygging 108 grader seter', biltype: 'EV9', type: 'ombygging', fikenProduktnummer: '500, 502', ingredienser: [{ vareId: 'vare_T2', antall: 1 }] },
  { id: 'opp_501', navn: 'TEST Takluke', biltype: 'EV9', type: 'ekstra_utstyr', fikenProduktnummer: '501', ingredienser: [{ vareId: 'vare_T3', antall: 2 }] },
];

let fake;
beforeEach(() => {
  sandbox.erNyProduktliste = (o) => !!o && o.ordretype !== 'leveranse'; // porten «på» for testene (PRODUKTLISTE_FRA er null i koden)
  sandbox.visToast = () => {};
  sandbox.logChange = () => {};
  S.portalProdukter = PRODUKTER.map((p) => ({ ...p }));
  S.portalProduktRoller = S.portalProdukter.filter((p) => p.app_rolle);
  S.lagerOppskrifter = OPPSKRIFTER.map((r) => ({ ...r }));
  S.lagervarer = [{ id: 'vare_T1', navn: 'TEST Gulv', antall: 5, enhet: 'stk' }, { id: 'vare_T2', navn: 'TEST Gulv 180', antall: 5, enhet: 'stk' }, { id: 'vare_T3', navn: 'TEST Takluke-ramme', antall: 1, enhet: 'stk' }];
  S.lagerhistorikk = [];
  S.portalModellKobling = [];
  fake = lagDb();
  app.settDb(fake.db);
  app.settMe({ id: 990001, navn: 'TEST Ansatt', rolle: 'admin' });
});
afterEach(() => { Object.assign(sandbox, EKTE); sandbox.erNyProduktliste = EKTE_GATE; app.settMe(null); });

const bil = (over = {}) => {
  const o = sandbox.dbToOrdre({ id: 'ord_TEST_SPB', status: 'aktiv', ordre_status: 'paa_vei', merke: 'KIA', modell: 'EV9', kunde: 'TEST Kunde AS', created_at: '2026-11-18T08:00:00Z', ...over });
  S.ordrer = [o];
  app.settAktivOrdre(o.id);
  return o;
};
const nr = (rader) => rader.filter((r) => !r.fjernet).map((r) => r.nr);

describe('porten', () => {
  it('slått på 2026-11-17T17:20:53Z: ordrer fra før beholder avkrysningen, nye får lista, leveranser aldri', () => {
    expect(sandbox.PRODUKTLISTE_FRA ?? app.kjor('PRODUKTLISTE_FRA')).toBe('2026-11-17T17:20:53Z');
    expect(EKTE_GATE(bil({ created_at: '2026-11-17T08:00:00Z' }))).toBe(false);
    expect(EKTE_GATE(bil({ created_at: '2026-11-18T08:00:00Z' }))).toBe(true);
    expect(EKTE_GATE(bil({ created_at: '2026-11-18T08:00:00Z', ordretype: 'leveranse', leveranse: { merking: 'TEST' } }))).toBe(false);
    // Nettopp laget i appen (ingen created_at ennå): tidspunktet i id-en avgjør.
    const ny = bil(); ny.createdAt = ''; ny.id = 'ord_' + (Date.parse('2026-11-17T17:20:53Z') + 60000);
    expect(EKTE_GATE(ny)).toBe(true);
    ny.id = 'ord_' + (Date.parse('2026-11-17T17:20:53Z') - 60000);
    expect(EKTE_GATE(ny)).toBe(false);
  });
});

describe('beregnSkalPaaBilen uten bestilling', () => {
  it('ombygging fra boksen + tillegg fra sjekklista, med «Valgt fordi»', () => {
    const o = bil({ ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }, { punkt: 'Klima i taket', ok: true }] });
    const { rader, varsler } = sandbox.beregnSkalPaaBilen(o);
    expect(nr(rader)).toEqual(['500', '501']);
    expect(rader[0]).toMatchObject({ kilde: 'ombygging', grunn: 'Nytt kjøretøy er huket av' });
    expect(rader[1]).toMatchObject({ kilde: 'sjekkliste', grunn: 'Sjekklista: «Panorama glasstak» er huket av', navn: 'Takluke' });
    expect(rader[0].oppskrift.id).toBe('opp_std');
    expect(rader[1].oppskrift.id).toBe('opp_501');
    expect(varsler).toEqual([]);
  });
  it('sjekklista uten store/små-forskjell, og et punkt som ikke er huket av gir ingenting', () => {
    const o = bil({ ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'panorama GLASSTAK', ok: true }, { punkt: '4-seter bak 180', ok: false }] });
    expect(nr(sandbox.beregnSkalPaaBilen(o).rader)).toEqual(['500', '501']);
  });
  it('180-stoler: oppskriften «500, 502» dekker begge (ingen dobbel gulvpakke)', () => {
    const o = bil({ ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Tillegg for 180 graders stoler', ok: true }] });
    const { rader } = sandbox.beregnSkalPaaBilen(o);
    expect(nr(rader)).toEqual(['500', '502']);
    expect(rader[0].oppskrift.id).toBe('opp_180');
    expect(rader[1].oppskrift).toBeNull();
    expect(rader[1].oppskriftViaNr).toBe('500');
  });
  it('personbil og ingen boks', () => {
    expect(nr(sandbox.beregnSkalPaaBilen(bil({ ombygging: { personbil: true } })).rader)).toEqual(['524']);
    expect(nr(sandbox.beregnSkalPaaBilen(bil()).rader)).toEqual([]);
  });
});

describe('beregnSkalPaaBilen med bestilling', () => {
  it('lista er bestillingen; sjekklista legger ikke til, bare varsler', () => {
    const o = bil({ portal_linjer: [{ produktnummer: '500', navn: 'Standard ombygging', rabatt_prosent: 20 }, { produktnummer: '503', navn: 'Heldekkende gulv', rabatt_prosent: 10 }],
      ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }] });
    const { rader, varsler, bestilt } = sandbox.beregnSkalPaaBilen(o);
    expect(bestilt).toBe(true);
    expect(nr(rader)).toEqual(['500', '503']);
    expect(rader.every((r) => r.grunn === 'Bestilt i portalen')).toBe(true);
    expect(rader[0].rolle).toBe('ombygging');
    expect(sandbox.skalPaaBilenHTML(o)).toContain('500 · Ombygging');
    expect(varsler).toHaveLength(1);
    expect(varsler[0]).toMatch(/Panorama glasstak.*501 Takluke.*Bestillingen gjelder/);
  });
});

describe('rettelser', () => {
  it('fjern, angre og legg til', () => {
    const o = bil({ ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }],
      produkt_rettelser: [{ handling: 'fjern', produktnummer: '501', av: 'TEST Ola', at: '2026-11-18T09:00:00Z' }, { handling: 'legg_til', produktnummer: '503', navn: 'Heldekkende gulv', av: 'TEST Kari', at: '2026-11-18T09:05:00Z' }] });
    let { rader } = sandbox.beregnSkalPaaBilen(o);
    expect(rader.find((r) => r.nr === '501')).toMatchObject({ fjernet: true, rettet: { av: 'TEST Ola' } });
    expect(rader.find((r) => r.nr === '503')).toMatchObject({ kilde: 'manuell', fjernet: false });
    expect(rader.find((r) => r.nr === '503').grunn).toMatch(/^Lagt til av TEST Kari/);
    o.produktRettelser.push({ handling: 'angre', produktnummer: '501' }, { handling: 'angre', produktnummer: '503' });
    ({ rader } = sandbox.beregnSkalPaaBilen(o));
    expect(nr(rader)).toEqual(['500', '501']);
  });
  it('rare verdier i rettelser kaster ikke', () => {
    for (const v of [null, {}, 'x', [null, 1, { handling: 'ukjent' }, { handling: 'fjern' }]]) {
      const o = bil({ ombygging: { nyttKjoretoy: true } });
      o.produktRettelser = v;
      expect(() => sandbox.beregnSkalPaaBilen(o)).not.toThrow();
      expect(() => sandbox.skalPaaBilenHTML(o)).not.toThrow();
    }
  });
});

describe('synkProduktliste: lager og fakturalinjer', () => {
  it('før ankomst: fakturalinje for sjekkliste-tillegget, men ingenting trekkes fra lager', async () => {
    const o = bil({ ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }] });
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((k) => k.navn === 'lager_trekk_oppskrift')).toEqual([]);
    expect(fake.rpc.filter((k) => k.navn === 'oppdater_ordre_fiken_linje').map((k) => [k.args.p_produktnummer, !!k.args.p_linje])).toEqual([['501', true]]);
  });
  it('ved ankomst: hver oppskrift trekkes én gang; neste synk trekker ikke igjen', async () => {
    const o = bil({ ordre_status: 'ikke_paabegynt', ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }] });
    fake.svar.lager_trekk_oppskrift = () => ({ data: { batchId: 'batch_TEST', ikkeFunnet: 0 }, error: null });
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((k) => k.navn === 'lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id).sort()).toEqual(['opp_501', 'opp_std']);
    expect(S.lagerhistorikk.filter((h) => h.ordreId === o.id).length).toBe(2);
    fake.rpc.length = 0;
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((k) => k.navn === 'lager_trekk_oppskrift')).toEqual([]);
  });
  it('ALLEREDE_TRUKKET (en annen fane rakk det) er ikke en feil', async () => {
    const o = bil({ ordre_status: 'ikke_paabegynt', ombygging: { nyttKjoretoy: true } });
    const toast = [];
    sandbox.visToast = (t) => toast.push(t);
    fake.svar.lager_trekk_oppskrift = () => ({ data: null, error: { message: 'ALLEREDE_TRUKKET' } });
    await sandbox.synkProduktliste(o);
    expect(toast).toEqual([]);
  });
  it('fjernet etter ankomst: delene legges tilbake bare ved en bevisst handling (tillatAngre)', async () => {
    const o = bil({ ordre_status: 'paabegynt', ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }] });
    S.lagerhistorikk = [{ id: 'h1', vareId: 'vare_T3', endring: -2, ordreId: o.id, oppskriftId: 'opp_501', batchId: 'b1' }, { id: 'h2', vareId: 'vare_T1', endring: -1, ordreId: o.id, oppskriftId: 'opp_std', batchId: 'b2' }];
    o.produktRettelser = [{ handling: 'fjern', produktnummer: '501', av: 'TEST', at: '2026-11-18T10:00:00Z' }];
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((k) => k.navn === 'lager_angre_oppskrift_trekk')).toEqual([]);
    await sandbox.synkProduktliste(o, { tillatAngre: true });
    expect(fake.rpc.filter((k) => k.navn === 'lager_angre_oppskrift_trekk').map((k) => k.args.p_oppskrift_id)).toEqual(['opp_501']);
    expect(S.lagerhistorikk.map((h) => h.oppskriftId)).toEqual(['opp_std']);
  });
  it('sjekklistepunkt tatt av igjen: tilleggets fakturalinje fjernes', async () => {
    const o = bil({ ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: false }], fiken_linjer: [{ produktnummer: '501', antall: 1 }] });
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((k) => k.navn === 'oppdater_ordre_fiken_linje').map((k) => [k.args.p_produktnummer, k.args.p_linje])).toEqual([['501', null]]);
  });
  it('lagt til for hånd og så angret: fakturalinjen fjernes også (nettlesertest 17.11)', async () => {
    const o = bil({ fiken_linjer: [{ produktnummer: '503', antall: 1 }],
      produkt_rettelser: [{ handling: 'legg_til', produktnummer: '503', av: 'TEST', at: '2026-11-18T10:00:00Z' }, { handling: 'angre', produktnummer: '503', av: 'TEST', at: '2026-11-18T10:01:00Z' }] });
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((k) => k.navn === 'oppdater_ordre_fiken_linje').map((k) => [k.args.p_produktnummer, k.args.p_linje])).toEqual([['503', null]]);
  });
  it('en bestilt linje med rabatt fjernes aldri automatisk', async () => {
    const o = bil({ portal_linjer: [{ produktnummer: '501', navn: 'Takluke' }], fiken_linjer: [{ produktnummer: '501', antall: 1, rabatt: 20 }],
      produkt_rettelser: [{ handling: 'fjern', produktnummer: '501', av: 'TEST', at: '2026-11-18T10:00:00Z' }] });
    await sandbox.synkProduktliste(o, { tillatAngre: true });
    expect(fake.rpc.filter((k) => k.navn === 'oppdater_ordre_fiken_linje')).toEqual([]);
  });
});

describe('produktRettelse og visning', () => {
  it('lagrer via RPC (aldri save), bruker svaret og tegner kortet', async () => {
    const o = bil({ ombygging: { nyttKjoretoy: true } });
    fake.svar.legg_til_ordre_produkt_rettelse = (a) => ({ data: [{ ...a.p_rettelse, av: 'TEST Ansatt', at: '2026-11-18T11:00:00Z' }], error: null });
    let lagret = 0;
    const save = sandbox.save; sandbox.save = () => { lagret++; };
    try { await sandbox.produktRettelse(o.id, 'legg_til', '503', 'Heldekkende gulv', 'v503'); } finally { sandbox.save = save; }
    expect(lagret).toBe(0);
    expect(fake.rpc[0]).toMatchObject({ navn: 'legg_til_ordre_produkt_rettelse', args: { p_ordre_id: o.id, p_rettelse: { handling: 'legg_til', produktnummer: '503' } } });
    expect(nr(sandbox.beregnSkalPaaBilen(o).rader)).toEqual(['500', '503']);
    const html = sandbox.skalPaaBilenHTML(o);
    expect(html).toContain('Skal på bilen');
    expect(html).toContain('Valgt fordi: Lagt til av TEST Ansatt');
    expect(html).toContain('Trekkes ved ankomst');
    S.lagervarer[0].antall = 0;
    expect(sandbox.skalPaaBilenHTML(o)).toContain('1 del mangler på lager');
  });
  it('ordreToDb skriver aldri produkt_rettelser (bare RPC-en gjør det)', () => {
    const o = bil({ produkt_rettelser: [{ handling: 'fjern', produktnummer: '501' }] });
    expect(sandbox.ordreToDb(o)).not.toHaveProperty('produkt_rettelser');
  });
  it('kortet er tegnet uten feil for en ordre uten modell i portalen', () => {
    const o = bil({ merke: 'TEST', modell: 'Ukjent' });
    expect(sandbox.skalPaaBilenHTML(o)).toContain('Ingenting valgt ennå');
    expect(app.consoleFeil).toEqual([]);
  });
});

// «Kun ekstrautstyr (ingen ombygging)» (Henrik 2026-11-17: bruk den nye lista): aldri en ombyggingsrad, ellers som vanlig.
describe('«Skal på bilen» for en «kun ekstrautstyr»-ordre', () => {
  it('ekte port: en ny kun-ekstrautstyr-ordre får den nye lista (porten gjelder likt)', () => {
    expect(EKTE_GATE(bil({ created_at: '2026-11-18T08:00:00Z', kun_ekstrautstyr: true }))).toBe(true);
    expect(EKTE_GATE(bil({ created_at: '2026-11-17T08:00:00Z', kun_ekstrautstyr: true }))).toBe(false);
  });
  it('ingen ombyggingsrad fra boksene (heller ikke personbil), og sjekklista styrer ikke radene (kortet «Har ved ankomst» finnes ikke i en slik ordre, 19.11)', () => {
    const o = bil({ kun_ekstrautstyr: true, ombygging: { nyttKjoretoy: true, personbil: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }] });
    const { rader } = sandbox.beregnSkalPaaBilen(o);
    expect(nr(rader)).toEqual([]);
    expect(rader.some((r) => r.kilde === 'ombygging')).toBe(false);
    // kontroll: samme data uten kun-flagget gir sjekkliste-raden som før
    expect(nr(sandbox.beregnSkalPaaBilen(bil({ ombygging: { nyttKjoretoy: true }, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }] })).rader)).toContain('501');
  });
  it('en bestilt ombygging tas ikke med (med varsel), bestilt ekstrautstyr gjør det', () => {
    const o = bil({ kun_ekstrautstyr: true, portal_linjer: [{ produktnummer: '500', navn: 'Standard ombygging' }, { produktnummer: '503', navn: 'Heldekkende gulv' }] });
    const { rader, varsler } = sandbox.beregnSkalPaaBilen(o);
    expect(nr(rader)).toEqual(['503']);
    expect(varsler.join('|')).toMatch(/Kun ekstrautstyr/);
  });
  it('«+ Legg til utstyr» og «Rett» (rettelser) virker som ellers', () => {
    const o = bil({ kun_ekstrautstyr: true, utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }],
      produkt_rettelser: [{ handling: 'fjern', produktnummer: '501', av: 'TEST Ola', at: '2026-11-18T09:00:00Z' }, { handling: 'legg_til', produktnummer: '503', navn: 'Heldekkende gulv', av: 'TEST Kari', at: '2026-11-18T09:05:00Z' }] });
    const { rader } = sandbox.beregnSkalPaaBilen(o);
    expect(nr(rader)).toEqual(['503']);
    expect(rader.find((r) => r.nr === '501')).toBeUndefined(); // sjekklista (som ville gitt 501) teller ikke, så det er ingen rad å overstryke
    // kontroll: en vanlig ordre med samme data har den overstrøkne sjekkliste-raden som før
    const vanlig = sandbox.beregnSkalPaaBilen(bil({ utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }], produkt_rettelser: o.produktRettelser }));
    expect(vanlig.rader.find((r) => r.nr === '501').fjernet).toBe(true);
  });
  it('lager: ingenting før ankomst; ved ankomst trekkes bare ekstrautstyret, aldri ombyggingsoppskriften', async () => {
    // 501 kommer fra «+ Legg til utstyr» (en rettelse): sjekklista styrer ikke radene i en kun-ordre (19.11)
    const o = bil({ kun_ekstrautstyr: true, ombygging: { nyttKjoretoy: true }, produkt_rettelser: [{ handling: 'legg_til', produktnummer: '501', navn: 'Takluke', av: 'TEST Kari', at: '2026-11-18T09:00:00Z' }] });
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((k) => k.navn === 'lager_trekk_oppskrift')).toEqual([]);
    expect(fake.rpc.filter((k) => k.navn === 'oppdater_ordre_fiken_linje').map((k) => [k.args.p_produktnummer, !!k.args.p_linje])).toEqual([['501', true]]);
    o.ordreStatus = 'ikke_paabegynt';
    fake.svar.lager_trekk_oppskrift = () => ({ data: { batchId: 'batch_TEST', ikkeFunnet: 0 }, error: null });
    await sandbox.synkProduktliste(o);
    expect(fake.rpc.filter((k) => k.navn === 'lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id)).toEqual(['opp_501']);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// KIA EV9 (Henrik 18.11): (A) «180 eller ikke?» i kortet, (B) «Dørbeskyttere» (en ombygging-oppskrift uten produktnummer: bare deler,
// ingen fakturalinje) følger med så lenge ordren ikke har ekstra utstyr. Rader med bare deler har kilde 'deler' og oppskriftens id som nøkkel.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const DOR = { id: 'oppskrift_1790236543257', navn: 'Dørbeskyttere', biltype: 'EV9', type: 'ombygging', ingredienser: [{ vareId: 'vare_T4', antall: 2 }] };
const rett = (handling, nokkel, over = {}) => ({ handling, produktnummer: nokkel, av: 'TEST Kari', at: '2026-11-18T09:00:00Z', ...over });
const angreAv = (nokkel) => ({ handling: 'angre', produktnummer: nokkel });
const ombygg = (over = {}) => bil({ ombygging: { nyttKjoretoy: true }, ...over });
const dorRad = (rader) => rader.find((r) => r.kilde === 'deler');
const SP180 = 'Er dette en 180-bil?';
const rpcKall = (navn) => fake.rpc.filter((k) => k.navn === navn);
const bareNummer = (n) => /^\d+$/.test(String(n));
const MED_PANORAMA = { utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }] };
// Svaret en ekte database gir: hele loggen med den nye rettelsen sist (navn og tid settes av databasen).
const rettelseRpc = (o, av = 'TEST Ansatt') => {
  fake.svar.legg_til_ordre_produkt_rettelse = (a) => ({ data: [...(o.produktRettelser || []), { ...a.p_rettelse, av, at: '2026-11-18T11:00:00Z' }], error: null });
};
const trekkSvar = () => { fake.svar.lager_trekk_oppskrift = () => ({ data: { batchId: 'b_T', ikkeFunnet: 0 }, error: null }); };

describe('KIA EV9: 180-spørsmål og dørbeskyttere', () => {
  beforeEach(() => {
    S.lagerOppskrifter = [...OPPSKRIFTER.map((r) => ({ ...r })), { ...DOR }];
    S.lagervarer.push({ id: 'vare_T4', navn: 'TEST Dørbeskytter', antall: 10, enhet: 'stk' });
  });
  afterEach(() => { sandbox.skalPaaBilenLukkSok(); });

  describe('(A) spørsmålet «180 eller ikke?»', () => {
    it('ubesvart: ravgul boks øverst med to knapper, og standardombyggingen (trygg standard)', () => {
      const o = ombygg();
      const { spm180, rader } = sandbox.beregnSkalPaaBilen(o);
      expect(spm180).toMatchObject({ svar: null, nr: '502', navn: 'Tillegg for 180 graders stoler', portalId: 't502' });
      expect(rader.find((r) => r.nr === '500').oppskrift.id).toBe('opp_std');
      expect(nr(rader)).not.toContain('502');
      const html = sandbox.skalPaaBilenHTML(o);
      expect(html).toContain(`${SP180} (Tillegg for 180 graders stoler, 502)`);
      expect(html).toContain("produktRettelse('ord_TEST_SPB','legg_til','502','Tillegg for 180 graders stoler','t502')");
      expect(html).toContain("produktRettelse('ord_TEST_SPB','fjern','502','Tillegg for 180 graders stoler','t502')");
      expect(html).toContain('Ja, 180');
      expect(html).toContain('Nei, standard');
      expect(html.indexOf(SP180)).toBeLessThan(html.indexOf('Valgt fordi')); // øverst i kortet, over radene
    });

    it.each([
      ['ikke EV9', () => bil({ merke: 'Mercedes-Benz', modell: 'GLS', ombygging: { nyttKjoretoy: true } })],
      ['portalbestilling (bestillingen gjelder, appen spør ikke)', () => ombygg({ portal_linjer: [{ produktnummer: '500', navn: 'Standard ombygging' }] })],
      ['kun ekstrautstyr', () => ombygg({ kun_ekstrautstyr: true })],
      ['ingen ombyggingsrad (ingen boks huket av)', () => bil()],
      ['bare personbil (ingen ombyggingsrad)', () => bil({ ombygging: { personbil: true } })],
      ['ombyggingen er fjernet fra lista', () => ombygg({ produkt_rettelser: [rett('fjern', '500')] })],
      ['kun ekstrautstyr, selv med ombyggingen lagt til for hånd', () => bil({ kun_ekstrautstyr: true, produkt_rettelser: [rett('legg_til', '500', { navn: 'Standard ombygging' })] })],
    ])('vises ikke: %s', (_navn, lag) => {
      const o = lag();
      expect(sandbox.beregnSkalPaaBilen(o).spm180).toBeNull();
      const html = sandbox.skalPaaBilenHTML(o);
      expect(html).not.toContain(SP180);
      expect(html).not.toContain('180 graders stoler:');
    });

    it('vises ikke uten produkt 502 i portalen, eller når 502 ikke har gyldig nummer', () => {
      S.portalProdukter = S.portalProdukter.filter((p) => p.fiken_nummer !== '502');
      expect(sandbox.beregnSkalPaaBilen(ombygg()).spm180).toBeNull();
      S.portalProdukter = PRODUKTER.map((p) => (p.portal_id === 't502' ? { ...p, fiken_nummer: null, nummer_status: 'mangler' } : { ...p }));
      expect(sandbox.beregnSkalPaaBilen(ombygg()).spm180).toBeNull();
      S.portalProdukter = PRODUKTER.map((p) => (p.portal_id === 't502' ? { ...p, nummer_status: 'ugyldig' } : { ...p }));
      expect(sandbox.beregnSkalPaaBilen(ombygg()).spm180).toBeNull();
      expect(sandbox.skalPaaBilenHTML(ombygg())).not.toContain(SP180);
    });

    it('besvart ja (rettelse): kompakt linje med hvem og når, «Endre», ingen boks, og 180-delene velges', () => {
      const o = ombygg({ produkt_rettelser: [rett('legg_til', '502', { navn: 'Tillegg for 180 graders stoler', av: 'TEST Kari' })] });
      const { spm180, rader } = sandbox.beregnSkalPaaBilen(o);
      expect(spm180).toMatchObject({ svar: 'ja', kilde: 'rettelse', av: 'TEST Kari' });
      expect(nr(rader).filter(bareNummer)).toEqual(['500', '502']);
      expect(rader.find((r) => r.nr === '500').oppskrift.id).toBe('opp_180'); // «500, 502»: ingen dobbel gulvpakke
      expect(rader.find((r) => r.nr === '502')).toMatchObject({ kilde: 'manuell', oppskriftViaNr: '500' });
      const html = sandbox.skalPaaBilenHTML(o);
      expect(html).not.toContain(SP180);
      expect(html).toMatch(/180 graders stoler: <b[^>]*>Ja<\/b>, svart av TEST Kari \d/);
      expect(html).toContain("produktRettelse('ord_TEST_SPB','fjern','502','Tillegg for 180 graders stoler','t502')"); // «Endre» bytter til Nei
      expect(html).toContain('>Endre</button>');
    });

    it('besvart nei (rettelse): standardombyggingen, og «Endre» bytter til ja', () => {
      const o = ombygg({ produkt_rettelser: [rett('fjern', '502', { av: 'TEST Ola' })] });
      const { spm180, rader } = sandbox.beregnSkalPaaBilen(o);
      expect(spm180).toMatchObject({ svar: 'nei', kilde: 'rettelse', av: 'TEST Ola' });
      expect(nr(rader).filter(bareNummer)).toEqual(['500']);
      expect(rader[0].oppskrift.id).toBe('opp_std');
      const html = sandbox.skalPaaBilenHTML(o);
      expect(html).not.toContain(SP180);
      expect(html).toMatch(/180 graders stoler: <b[^>]*>Nei<\/b>, svart av TEST Ola/);
      expect(html).toContain("produktRettelse('ord_TEST_SPB','legg_til','502','Tillegg for 180 graders stoler','t502')");
    });

    it('sjekklista «Tillegg for 180 graders stoler» svarer ja og skjuler spørsmålet (også den eldre teksten)', () => {
      for (const punkt of ['Tillegg for 180 graders stoler', '4-seter bak 180']) {
        const o = ombygg({ utstyr_sjekkliste: [{ punkt, ok: true }] });
        const { spm180, rader } = sandbox.beregnSkalPaaBilen(o);
        expect(spm180).toMatchObject({ svar: 'ja', kilde: 'sjekkliste' });
        expect(rader.find((r) => r.nr === '500').oppskrift.id).toBe('opp_180');
        const html = sandbox.skalPaaBilenHTML(o);
        expect(html).not.toContain(SP180);
        expect(html).toContain('fra sjekklista');
      }
    });

    it('angre tar svaret bort (ubesvart igjen); en rettelse går foran sjekklista; angre etter nei gir sjekklista tilbake', () => {
      expect(sandbox.beregnSkalPaaBilen(ombygg({ produkt_rettelser: [rett('legg_til', '502'), angreAv('502')] })).spm180.svar).toBeNull();
      const sjekk = { utstyr_sjekkliste: [{ punkt: 'Tillegg for 180 graders stoler', ok: true }] };
      const nei = sandbox.beregnSkalPaaBilen(ombygg({ ...sjekk, produkt_rettelser: [rett('fjern', '502')] }));
      expect(nei.spm180).toMatchObject({ svar: 'nei', kilde: 'rettelse' });
      expect(nei.rader.find((r) => r.nr === '502')).toMatchObject({ fjernet: true });
      expect(nei.rader.find((r) => r.nr === '500').oppskrift.id).toBe('opp_std');
      expect(sandbox.beregnSkalPaaBilen(ombygg({ ...sjekk, produkt_rettelser: [rett('fjern', '502'), angreAv('502')] })).spm180).toMatchObject({ svar: 'ja', kilde: 'sjekkliste' });
    });

    it('knappene lagrer vanlige rettelser på 502 via RPC (aldri save)', async () => {
      const o = ombygg();
      rettelseRpc(o);
      await sandbox.produktRettelse(o.id, 'legg_til', '502', 'Tillegg for 180 graders stoler', 't502');
      expect(rpcKall('legg_til_ordre_produkt_rettelse')[0].args).toEqual({ p_ordre_id: o.id, p_rettelse: { handling: 'legg_til', produktnummer: '502', navn: 'Tillegg for 180 graders stoler', portalId: 't502' } });
      expect(sandbox.beregnSkalPaaBilen(o).spm180).toMatchObject({ svar: 'ja', av: 'TEST Ansatt' });
      await sandbox.produktRettelse(o.id, 'fjern', '502', 'Tillegg for 180 graders stoler', 't502');
      expect(sandbox.beregnSkalPaaBilen(o).spm180.svar).toBe('nei');
      expect(sandbox.beregnSkalPaaBilen(o).rader.find((r) => r.nr === '500').oppskrift.id).toBe('opp_std');
    });

    it('etter ankomst: ja trekker 180-delene og legger standarddelene tilbake, nei gjør det motsatte', async () => {
      const o = ombygg({ ordre_status: 'ikke_paabegynt' });
      S.lagerhistorikk = [{ id: 'h1', vareId: 'vare_T1', endring: -1, ordreId: o.id, oppskriftId: 'opp_std', batchId: 'b1' }];
      rettelseRpc(o);
      trekkSvar();
      await sandbox.produktRettelse(o.id, 'legg_til', '502', 'Tillegg for 180 graders stoler', 't502');
      expect(rpcKall('lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id)).toContain('opp_180');
      expect(rpcKall('lager_angre_oppskrift_trekk').map((k) => k.args.p_oppskrift_id)).toEqual(['opp_std']);
      fake.rpc.length = 0;
      await sandbox.produktRettelse(o.id, 'fjern', '502', 'Tillegg for 180 graders stoler', 't502');
      expect(rpcKall('lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id)).toContain('opp_std');
      expect(rpcKall('lager_angre_oppskrift_trekk').map((k) => k.args.p_oppskrift_id)).toEqual(['opp_180']);
    });

    it('ubesvart etter ankomst: standarddelene trekkes (ingenting blokkeres)', async () => {
      const o = ombygg({ ordre_status: 'ikke_paabegynt' });
      trekkSvar();
      await sandbox.synkProduktliste(o);
      const trukket = rpcKall('lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id);
      expect(trukket).toContain('opp_std');
      expect(trukket).not.toContain('opp_180');
    });

    it('all fritekst i spørsmålet er HTML-escapet (portalnavn og navnet på den som svarte)', () => {
      S.portalProdukter = PRODUKTER.map((p) => (p.portal_id === 't502' ? { ...p, navn: `Tillegg <b>180</b> "x" 'y'` } : { ...p }));
      const html = sandbox.skalPaaBilenHTML(ombygg());
      expect(html).not.toContain('<b>180</b>');
      expect(html).toContain('&lt;b>180&lt;/b>');
      expect(html).toContain("\\'y\\'"); // apostrofer i onclick-strengen er escapet
      const svart = sandbox.skalPaaBilenHTML(ombygg({ produkt_rettelser: [rett('legg_til', '502', { av: '<img src=x onerror=alert(1)>' })] }));
      expect(svart).not.toContain('<img');
      expect(svart).toContain('&lt;img');
    });
  });

  describe('(B) dørbeskyttere (bare deler)', () => {
    it('ombygging uten ekstra utstyr: raden følger med, med oppskrift, delene og «Valgt fordi», men uten fakturalinje', async () => {
      const o = ombygg();
      const { rader } = sandbox.beregnSkalPaaBilen(o);
      const dor = dorRad(rader);
      expect(dor).toMatchObject({ nr: DOR.id, navn: 'Dørbeskyttere', kilde: 'deler', fjernet: false, grunn: 'KIA EV9 uten ekstra utstyr, bare ombygging' });
      expect(dor.oppskrift.id).toBe(DOR.id);
      expect(rader.filter((r) => r.kilde === 'deler')).toHaveLength(1);
      const html = sandbox.skalPaaBilenHTML(o);
      expect(html).toContain('Dørbeskyttere');
      expect(html).toContain('Kun deler, ingen fakturalinje · Deler');
      expect(html).toContain('Valgt fordi: KIA EV9 uten ekstra utstyr, bare ombygging');
      expect(html).toContain('TEST Dørbeskytter 2');
      expect(html).toContain('Trekkes ved ankomst');
      expect(html).not.toContain(`${DOR.id} ·`); // oppskrifts-id-en vises aldri som et produktnummer
      // Ingen fakturalinje, uansett: bare 500 er en ombyggingsrad, og den styres av boksene.
      const kall = [];
      const orig = sandbox.oppdaterFikenLinjeForOppskrift;
      sandbox.oppdaterFikenLinjeForOppskrift = async (n, skalStaa) => { kall.push([n, skalStaa]); };
      try { await sandbox.synkProduktliste(o, { tillatAngre: true }); } finally { sandbox.oppdaterFikenLinjeForOppskrift = orig; }
      expect(kall.filter(([n]) => !bareNummer(n))).toEqual([]);
      expect(rpcKall('oppdater_ordre_fiken_linje').filter((k) => !bareNummer(k.args.p_produktnummer))).toEqual([]);
    });

    it('ekstra utstyr (en ekstra_utstyr-oppskrift) hindrer dørbeskyttere; fjernes det, kommer de', () => {
      expect(dorRad(sandbox.beregnSkalPaaBilen(ombygg(MED_PANORAMA)).rader)).toBeUndefined();
      const fjernet = ombygg({ ...MED_PANORAMA, produkt_rettelser: [rett('fjern', '501')] });
      expect(dorRad(sandbox.beregnSkalPaaBilen(fjernet).rader)).toMatchObject({ fjernet: false, kilde: 'deler' });
      const tatt = ombygg({ utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: false }] });
      expect(dorRad(sandbox.beregnSkalPaaBilen(tatt).rader)).toBeDefined();
    });

    it('en rad med rolle (her personbil sammen med ombygging) er ikke ekstra utstyr, selv uten oppskrift', () => {
      const o = bil({ ombygging: { nyttKjoretoy: true, personbil: true } });
      const { rader } = sandbox.beregnSkalPaaBilen(o);
      expect(rader.find((r) => r.nr === '524')).toMatchObject({ rolle: 'personbil', oppskrift: null });
      expect(dorRad(rader)).toMatchObject({ kilde: 'deler', fjernet: false });
    });

    it('ekstra utstyr uten oppskrift teller også (forsiktig: tvil hindrer dørbeskyttere)', () => {
      const o = ombygg({ produkt_rettelser: [rett('legg_til', '503', { navn: 'Heldekkende gulv' })] });
      expect(sandbox.beregnSkalPaaBilen(o).rader.find((r) => r.nr === '503').oppskrift).toBeNull();
      expect(dorRad(sandbox.beregnSkalPaaBilen(o).rader)).toBeUndefined();
    });

    it('180-stoler: kombo-oppskriften «500, 502» er ombygging, så dørbeskyttere følger med; uten kombo-oppskrift teller 502 som ekstra utstyr', () => {
      const ja = ombygg({ produkt_rettelser: [rett('legg_til', '502')] });
      expect(dorRad(sandbox.beregnSkalPaaBilen(ja).rader)).toMatchObject({ kilde: 'deler', fjernet: false });
      S.lagerOppskrifter = S.lagerOppskrifter.filter((r) => r.id !== 'opp_180');
      const utenKombo = sandbox.beregnSkalPaaBilen(ja);
      expect(utenKombo.rader.find((r) => r.nr === '502').oppskrift).toBeNull();
      expect(dorRad(utenKombo.rader)).toBeUndefined();
    });

    it('portalbestilling: gjelder også (rad med bare deler, ikke et fakturert produkt), men ikke med bestilt ekstra utstyr', () => {
      const bare = ombygg({ portal_linjer: [{ produktnummer: '500', navn: 'Standard ombygging', rabatt_prosent: 20 }] });
      expect(dorRad(sandbox.beregnSkalPaaBilen(bare).rader)).toMatchObject({ kilde: 'deler', fjernet: false });
      const medUtstyr = ombygg({ portal_linjer: [{ produktnummer: '500', navn: 'Standard ombygging' }, { produktnummer: '503', navn: 'Heldekkende gulv' }] });
      expect(dorRad(sandbox.beregnSkalPaaBilen(medUtstyr).rader)).toBeUndefined();
    });

    it('kun ekstrautstyr og personbil har ingen ombyggingsrad, så ingen dørbeskyttere av seg selv', () => {
      expect(dorRad(sandbox.beregnSkalPaaBilen(bil({ kun_ekstrautstyr: true, ombygging: { nyttKjoretoy: true } })).rader)).toBeUndefined();
      expect(dorRad(sandbox.beregnSkalPaaBilen(bil({ ombygging: { personbil: true } })).rader)).toBeUndefined();
      expect(dorRad(sandbox.beregnSkalPaaBilen(bil()).rader)).toBeUndefined();
      // ... men en ansatt kan legge dem til for hånd også der.
      const kun = bil({ kun_ekstrautstyr: true, produkt_rettelser: [rett('legg_til', DOR.id, { navn: 'Dørbeskyttere' })] });
      expect(dorRad(sandbox.beregnSkalPaaBilen(kun).rader)).toMatchObject({ kilde: 'deler', manuell: true });
    });

    it('ikke på andre modeller (heller ikke med en oppskrift med samme navn), og uendret når oppskriften ikke finnes', () => {
      S.lagerOppskrifter.push({ id: 'oppskrift_1790236543999', navn: 'Dørbeskyttere', biltype: 'GLS', type: 'ombygging', ingredienser: [{ vareId: 'vare_T4', antall: 2 }] });
      const gls = bil({ merke: 'Mercedes-Benz', modell: 'GLS', ombygging: { nyttKjoretoy: true } });
      const medOppskrift = sandbox.beregnSkalPaaBilen(gls);
      expect(nr(medOppskrift.rader)).toEqual(['400']);
      expect(medOppskrift.spm180).toBeNull();
      S.lagerOppskrifter = OPPSKRIFTER.map((r) => ({ ...r }));
      const utenOppskrift = sandbox.beregnSkalPaaBilen(ombygg());
      expect(utenOppskrift.rader.filter((r) => r.kilde === 'deler')).toEqual([]); // finnes ikke: ingenting skjer, ingen feil
      expect(nr(utenOppskrift.rader)).toEqual(['500']);
    });

    it('oppskriften må ha riktig type, navn og ingen produktnummer, og passe bilen; flere like gir ingenting', () => {
      const prov = (over) => { S.lagerOppskrifter = [...OPPSKRIFTER.map((r) => ({ ...r })), { ...DOR, ...over }]; return dorRad(sandbox.beregnSkalPaaBilen(ombygg()).rader); };
      expect(prov({})).toBeDefined();
      expect(prov({ navn: '  DØRBESKYTTERE ' })).toBeDefined(); // store/små bokstaver og mellomrom spiller ingen rolle
      expect(prov({ type: 'ekstra_utstyr' })).toBeUndefined();
      expect(prov({ fikenProduktnummer: '504' })).toBeUndefined(); // har et produktnummer: ikke en rad med bare deler
      expect(prov({ biltype: 'GLS' })).toBeUndefined();
      expect(prov({ navn: 'Dørbeskyttere foran' })).toBeUndefined();
      S.lagerOppskrifter = [...OPPSKRIFTER.map((r) => ({ ...r })), { ...DOR }, { ...DOR, id: 'oppskrift_1790236543258' }];
      expect(dorRad(sandbox.beregnSkalPaaBilen(ombygg()).rader)).toBeUndefined();
    });

    it('velgOppskrifter hopper over en rad med bare deler (oppskriften den fikk settes aldri om)', () => {
      const o = ombygg();
      const deler = { nr: DOR.id, navn: 'Dørbeskyttere', kilde: 'deler', fjernet: false, oppskrift: S.lagerOppskrifter.find((r) => r.id === DOR.id) };
      const std = { nr: '500', navn: 'Standard ombygging', kilde: 'ombygging', fjernet: false, portalId: 'v500', rolle: 'ombygging' };
      sandbox.velgOppskrifter(o, [std, deler]);
      expect(deler.oppskrift.id).toBe(DOR.id);
      expect(std.oppskrift.id).toBe('opp_std');
    });

    describe('rettelser (nøkkelen er oppskriftens id)', () => {
      it('fjern: raden står overstrøket med hvem som fjernet den, og angre gir den tilbake', () => {
        const fjernet = sandbox.beregnSkalPaaBilen(ombygg({ produkt_rettelser: [rett('fjern', DOR.id, { av: 'TEST Ola' })] }));
        expect(dorRad(fjernet.rader)).toMatchObject({ fjernet: true, manuell: false, rettet: { av: 'TEST Ola' } });
        expect(fjernet.rader.filter((r) => r.nr === DOR.id)).toHaveLength(1); // aldri en dobbel rad
        const tilbake = sandbox.beregnSkalPaaBilen(ombygg({ produkt_rettelser: [rett('fjern', DOR.id), angreAv(DOR.id)] }));
        expect(dorRad(tilbake.rader)).toMatchObject({ fjernet: false });
        expect(dorRad(tilbake.rader).rettet).toBeUndefined();
      });

      it('lagt til for hånd (også med ekstra utstyr): raden kommer uansett regelen, som «Lagt til av»', () => {
        const o = ombygg({ ...MED_PANORAMA, produkt_rettelser: [rett('legg_til', DOR.id, { av: 'TEST Kari', navn: 'Dørbeskyttere' })] });
        const dor = dorRad(sandbox.beregnSkalPaaBilen(o).rader);
        expect(dor).toMatchObject({ kilde: 'deler', fjernet: false, manuell: true, rettet: { av: 'TEST Kari' } });
        expect(dor.grunn).toMatch(/^Lagt til av TEST Kari/);
        expect(sandbox.beregnSkalPaaBilen(o).rader.filter((r) => r.nr === DOR.id)).toHaveLength(1);
      });

      it('lagt til for hånd og så fjernet: overstrøket rad (ikke borte); fjern som regelen aldri ville gitt: ingen rad', () => {
        const rader = (rettelser) => sandbox.beregnSkalPaaBilen(ombygg({ ...MED_PANORAMA, produkt_rettelser: rettelser })).rader;
        const handFjernet = dorRad(rader([rett('legg_til', DOR.id), rett('fjern', DOR.id, { av: 'TEST Ola' })]));
        expect(handFjernet).toMatchObject({ fjernet: true, manuell: true, rettet: { av: 'TEST Ola' } });
        expect(handFjernet.grunn).toMatch(/^Lagt til av TEST Kari/);
        expect(dorRad(rader([rett('fjern', DOR.id)]))).toBeUndefined();
        expect(dorRad(rader([rett('legg_til', DOR.id), angreAv(DOR.id)]))).toBeUndefined();
        expect(dorRad(rader([rett('legg_til', DOR.id), rett('fjern', DOR.id), angreAv(DOR.id)]))).toBeUndefined();
        expect(dorRad(rader([rett('legg_til', DOR.id), angreAv(DOR.id), rett('fjern', DOR.id)]))).toBeUndefined(); // angre nullstiller «lagt til for hånd»
        expect(dorRad(rader([rett('fjern', DOR.id), rett('legg_til', DOR.id)]))).toMatchObject({ fjernet: false, manuell: true });
      });

      it('ukjente nøkler i loggen lager aldri et Fiken-produkt (ingen «manuell» rad med oppskrifts-id)', () => {
        const o = ombygg({ produkt_rettelser: [rett('legg_til', DOR.id), rett('legg_til', 'oppskrift_9999999999999'), rett('legg_til', 'x')] });
        const { rader } = sandbox.beregnSkalPaaBilen(o);
        expect(rader.filter((r) => r.kilde === 'manuell')).toEqual([]);
        expect(rader.filter((r) => r.kilde === 'deler')).toHaveLength(1);
      });

      it('«Rett»-menyen: Fjern fra bilen / Legg tilbake / Angre med oppskriftens id og navnet som argument', () => {
        const id = 'ord_TEST_SPB_MENY';
        const arg = `'${DOR.id}','Dørbeskyttere'`;
        try {
          sandbox.skalPaaBilenVeksleRett(id, DOR.id);
          const aktiv = sandbox.skalPaaBilenHTML(ombygg({ id }));
          expect(aktiv).toContain(`produktRettelse('${id}','fjern',${arg})`);
          expect(aktiv).not.toContain('Angre (ta bort igjen)');
          const regelFjernet = sandbox.skalPaaBilenHTML(ombygg({ id, produkt_rettelser: [rett('fjern', DOR.id)] }));
          expect(regelFjernet).toContain(`produktRettelse('${id}','angre',${arg})">Legg tilbake`);
          expect(regelFjernet).toContain('Fjernet av TEST Kari');
          const hand = sandbox.skalPaaBilenHTML(ombygg({ id, ...MED_PANORAMA, produkt_rettelser: [rett('legg_til', DOR.id)] }));
          expect(hand).toContain(`produktRettelse('${id}','fjern',${arg})`);
          expect(hand).toContain(`produktRettelse('${id}','angre',${arg})">Angre (ta bort igjen)`);
          const handFjernet = sandbox.skalPaaBilenHTML(ombygg({ id, ...MED_PANORAMA, produkt_rettelser: [rett('legg_til', DOR.id), rett('fjern', DOR.id)] }));
          expect(handFjernet).toContain(`produktRettelse('${id}','legg_til',${arg})">Legg tilbake`);
        } finally { sandbox.skalPaaBilenVeksleRett(id, DOR.id); }
      });

      it('RPC-et får oppskriftens id som produktnummer, og logglinjen bruker navnet (aldri den rå nøkkelen)', async () => {
        const o = ombygg();
        const logg = [];
        sandbox.logChange = (_o, t) => logg.push(t);
        rettelseRpc(o);
        await sandbox.produktRettelse(o.id, 'fjern', DOR.id, 'Dørbeskyttere');
        await sandbox.produktRettelse(o.id, 'angre', DOR.id); // uten navn: slås opp i oppskriftene
        await sandbox.produktRettelse(o.id, 'legg_til', DOR.id, 'Dørbeskyttere', '');
        await sandbox.produktRettelse(o.id, 'fjern', '502', 'Tillegg for 180 graders stoler', 't502');
        expect(rpcKall('legg_til_ordre_produkt_rettelse')[0].args).toEqual({ p_ordre_id: o.id, p_rettelse: { handling: 'fjern', produktnummer: DOR.id, navn: 'Dørbeskyttere', portalId: null } });
        expect(logg).toEqual(['Fjernet Dørbeskyttere fra «Skal på bilen»', 'Angret rettelse på Dørbeskyttere', 'La til Dørbeskyttere på «Skal på bilen»', 'Fjernet 502 fra «Skal på bilen»']);
        expect(logg.join(' ')).not.toContain('oppskrift_');
      });

      it('en feil fra databasen (migrasjonen ikke kjørt ennå) gir en melding og endrer ingenting', async () => {
        const o = ombygg();
        const toast = [];
        sandbox.visToast = (t) => toast.push(t);
        fake.svar.legg_til_ordre_produkt_rettelse = () => ({ data: null, error: { message: 'UGYLDIG_INPUT' } });
        await sandbox.produktRettelse(o.id, 'fjern', DOR.id, 'Dørbeskyttere');
        expect(toast).toEqual(['Kunne ikke lagre rettelsen: UGYLDIG_INPUT']);
        expect(dorRad(sandbox.beregnSkalPaaBilen(o).rader)).toMatchObject({ fjernet: false });
      });
    });

    describe('«+ Legg til utstyr»', () => {
      it('tilbyr «Dørbeskyttere (bare deler)» for EV9 når raden ikke er aktiv, og søket filtrerer', () => {
        const o = ombygg(MED_PANORAMA);
        sandbox.skalPaaBilenApneSok(o.id);
        expect(sandbox.skalPaaBilenHTML(o)).toContain(`produktRettelse('ord_TEST_SPB','legg_til','${DOR.id}','Dørbeskyttere','');skalPaaBilenLukkSok()">Dørbeskyttere (bare deler)</button>`);
        for (const sok of ['dør', 'bare deler']) {
          sandbox.skalPaaBilenSok(o.id, sok);
          expect(sandbox.skalPaaBilenHTML(o)).toContain('Dørbeskyttere (bare deler)');
        }
        for (const sok of ['gulv', 'xyz']) {
          sandbox.skalPaaBilenSok(o.id, sok);
          expect(sandbox.skalPaaBilenHTML(o)).not.toContain('Dørbeskyttere (bare deler)');
        }
      });

      it('tilbys ikke når raden allerede er aktiv, ikke på andre modeller, og ikke uten oppskriften', () => {
        const aktiv = ombygg();
        sandbox.skalPaaBilenApneSok(aktiv.id);
        expect(sandbox.skalPaaBilenHTML(aktiv)).not.toContain('Dørbeskyttere (bare deler)');
        S.lagerOppskrifter.push({ id: 'oppskrift_1790236543999', navn: 'Dørbeskyttere', biltype: 'GLS', type: 'ombygging', ingredienser: [] });
        const gls = bil({ merke: 'Mercedes-Benz', modell: 'GLS', ombygging: { nyttKjoretoy: true } });
        sandbox.skalPaaBilenApneSok(gls.id);
        expect(sandbox.skalPaaBilenHTML(gls)).not.toContain('Dørbeskyttere (bare deler)');
        S.lagerOppskrifter = OPPSKRIFTER.map((r) => ({ ...r }));
        const uten = ombygg(MED_PANORAMA);
        sandbox.skalPaaBilenApneSok(uten.id);
        expect(sandbox.skalPaaBilenHTML(uten)).not.toContain('Dørbeskyttere (bare deler)');
      });

      it('en fjernet rad tilbys igjen', () => {
        const o = ombygg({ produkt_rettelser: [rett('fjern', DOR.id)] });
        sandbox.skalPaaBilenApneSok(o.id);
        expect(sandbox.skalPaaBilenHTML(o)).toContain('Dørbeskyttere (bare deler)');
      });
    });

    describe('lager og fakturering', () => {
      const trukket = (o, ...ider) => ider.map((oppskriftId, i) => ({ id: 'h' + i, vareId: oppskriftId === DOR.id ? 'vare_T4' : 'vare_T1', endring: -1, ordreId: o.id, oppskriftId, batchId: 'b' + i }));

      it('før ankomst trekkes ingenting; ved ankomst trekkes dørbeskyttere én gang (idempotent)', async () => {
        const o = ombygg();
        await sandbox.synkProduktliste(o);
        expect(rpcKall('lager_trekk_oppskrift')).toEqual([]);
        o.ordreStatus = 'ikke_paabegynt';
        trekkSvar();
        await sandbox.synkProduktliste(o);
        expect(rpcKall('lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id).sort()).toEqual(['opp_std', DOR.id]);
        expect(rpcKall('lager_trekk_oppskrift').every((k) => k.args.p_ordre_id === o.id)).toBe(true);
        fake.rpc.length = 0;
        await sandbox.synkProduktliste(o);
        expect(rpcKall('lager_trekk_oppskrift')).toEqual([]);
        expect(rpcKall('lager_angre_oppskrift_trekk')).toEqual([]);
      });

      it('ekstra utstyr som kommer til etter ankomst: delene legges tilbake, men bare ved en bevisst handling', async () => {
        const o = ombygg({ ordre_status: 'paabegynt', ...MED_PANORAMA });
        S.lagerhistorikk = trukket(o, 'opp_std', DOR.id);
        await sandbox.synkProduktliste(o);
        expect(rpcKall('lager_angre_oppskrift_trekk')).toEqual([]);
        await sandbox.synkProduktliste(o, { tillatAngre: true });
        expect(rpcKall('lager_angre_oppskrift_trekk').map((k) => k.args.p_oppskrift_id)).toEqual([DOR.id]);
        expect(S.lagerhistorikk.some((h) => h.oppskriftId === DOR.id)).toBe(false); // dørbeskyttere er lagt tilbake; standard ligger der fortsatt
        expect(S.lagerhistorikk.some((h) => h.oppskriftId === 'opp_std')).toBe(true);
      });

      it('fjernet etter ankomst: delene legges tilbake; lagt tilbake (angre): de trekkes på nytt', async () => {
        const o = ombygg({ ordre_status: 'paabegynt' });
        S.lagerhistorikk = trukket(o, 'opp_std', DOR.id);
        rettelseRpc(o);
        trekkSvar();
        await sandbox.produktRettelse(o.id, 'fjern', DOR.id, 'Dørbeskyttere');
        expect(rpcKall('lager_angre_oppskrift_trekk').map((k) => k.args.p_oppskrift_id)).toEqual([DOR.id]);
        expect(S.lagerhistorikk.some((h) => h.oppskriftId === DOR.id)).toBe(false);
        fake.rpc.length = 0;
        await sandbox.produktRettelse(o.id, 'angre', DOR.id, 'Dørbeskyttere');
        expect(rpcKall('lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id)).toEqual([DOR.id]);
      });

      it('lagt til for hånd etter ankomst på en bil med ekstra utstyr: delene trekkes, uten fakturalinje', async () => {
        const o = ombygg({ ordre_status: 'paabegynt', ...MED_PANORAMA });
        S.lagerhistorikk = trukket(o, 'opp_std', 'opp_501');
        rettelseRpc(o);
        trekkSvar();
        await sandbox.produktRettelse(o.id, 'legg_til', DOR.id, 'Dørbeskyttere', '');
        expect(rpcKall('lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id)).toEqual([DOR.id]);
        expect(rpcKall('oppdater_ordre_fiken_linje').filter((k) => !bareNummer(k.args.p_produktnummer))).toEqual([]);
      });

      it('en rettelse som angres rører aldri fakturalinjene med en nøkkel som ikke er et nummer', async () => {
        const o = ombygg({ ...MED_PANORAMA, produkt_rettelser: [rett('legg_til', DOR.id), angreAv(DOR.id)] }); // med ekstra utstyr: ingen rad igjen etter angre
        expect(dorRad(sandbox.beregnSkalPaaBilen(o).rader)).toBeUndefined();
        const kall = [];
        const orig = sandbox.oppdaterFikenLinjeForOppskrift;
        sandbox.oppdaterFikenLinjeForOppskrift = async (n, skalStaa) => { kall.push([n, skalStaa]); };
        try { await sandbox.synkProduktliste(o, { tillatAngre: true }); } finally { sandbox.oppdaterFikenLinjeForOppskrift = orig; }
        expect(kall.filter(([n]) => !bareNummer(n))).toEqual([]);
      });

      it('en rad med bare deler legges aldri på fakturaen, heller ikke når den er lagt til for hånd', async () => {
        const o = ombygg({ ...MED_PANORAMA, produkt_rettelser: [rett('legg_til', DOR.id, { navn: 'Dørbeskyttere' })] });
        const kall = [];
        const orig = sandbox.oppdaterFikenLinjeForOppskrift;
        sandbox.oppdaterFikenLinjeForOppskrift = async (n, skalStaa) => { kall.push([n, skalStaa]); };
        try { await sandbox.synkProduktliste(o, { tillatAngre: true }); } finally { sandbox.oppdaterFikenLinjeForOppskrift = orig; }
        expect(kall.filter(([n]) => !bareNummer(n))).toEqual([]);
        expect(kall.filter(([n, s]) => n === '501' && s === true)).toHaveLength(1); // panorama-tillegget får sin vanlige linje
      });

      it('Fakturering: «Står på bilen, men ikke på fakturaen» tar aldri med dørbeskyttere (ingen fakturalinje å savne)', () => {
        const o = ombygg({ kunde: 'TEST Kunde AS', fiken_linjer: [{ produktnummer: '500', antall: 1 }] });
        expect(dorRad(sandbox.beregnSkalPaaBilen(o).rader)).toBeDefined();
        const { grunner } = sandbox.fakturaSjekk(o);
        expect(grunner.map((g) => g.kode)).not.toContain('liste_mangler_paa_faktura');
        expect(JSON.stringify(grunner)).not.toContain('oppskrift_');
      });
    });
  });

  // ── Rettelser etter den uavhengige gjennomgangen 18.11 ─────────────────────────────────────────────────────────

  describe('spørsmålet gjelder bare KIA EV9 (slug-vernet)', () => {
    it('en annen modell med et produkt 502 og en ombyggingsrad får ikke spørsmålet (bare slug skiller)', () => {
      const gls = bil({ merke: 'Mercedes-Benz', modell: 'GLS', ombygging: { nyttKjoretoy: true } });
      const slug = sandbox.produktlisteModell(gls).slug;
      expect(slug).toBeTruthy();
      expect(slug).not.toBe('kia-ev9');
      S.portalProdukter.push({ portal_id: 'g502', type: 'tillegg', modell_slug: slug, fiken_nummer: '502', nummer_status: 'ok', navn: 'Tillegg for 180 graders stoler', app_rolle: null, velges_nar: [] });
      const { rader, spm180 } = sandbox.beregnSkalPaaBilen(gls);
      expect(sandbox.produktlisteModell(gls).produkter.some((p) => p.fiken_nummer === '502')).toBe(true); // forutsetning: modellen HAR 502 i portalen
      expect(rader.some((r) => !r.fjernet && r.rolle === 'ombygging')).toBe(true); // ... og en ombyggingsrad
      expect(spm180).toBeNull();
      const html = sandbox.skalPaaBilenHTML(gls);
      expect(html).not.toContain(SP180);
      expect(html).not.toContain('180 graders stoler:');
    });
  });

  describe('180-svaret «Nei» mot en sjekkliste som sier 180', () => {
    const varselOm = (o) => sandbox.beregnSkalPaaBilen(o).varsler.filter((v) => /180/.test(v));
    const SJEKK = { utstyr_sjekkliste: [{ punkt: 'Tillegg for 180 graders stoler', ok: true }] };

    it('Nei (rettelse) mens sjekklista er huket av gir et varsel med råd om «Endre», også i kortet', () => {
      const o = ombygg({ ...SJEKK, produkt_rettelser: [rett('fjern', '502')] });
      const v = varselOm(o);
      expect(v).toHaveLength(1);
      expect(v[0]).toMatch(/Sjekklista sier «Tillegg for 180 graders stoler».*Nei.*standarddelene.*502.*ikke på fakturaen.*Endre/);
      expect(sandbox.skalPaaBilenHTML(o)).toContain('⚠ Sjekklista sier «Tillegg for 180 graders stoler»');
      // den eldre teksten i sjekklista teller også, og varselet siterer den
      const gammel = ombygg({ utstyr_sjekkliste: [{ punkt: '4-seter bak 180', ok: true }], produkt_rettelser: [rett('fjern', '502')] });
      expect(varselOm(gammel)[0]).toContain('«4-seter bak 180»');
    });

    it('ingen motsigelse, ingen varsel: nei uten sjekkliste, ja med sjekkliste, angre, sjekkliste uten svar, punkt ikke huket av', () => {
      expect(varselOm(ombygg({ produkt_rettelser: [rett('fjern', '502')] }))).toEqual([]);
      expect(varselOm(ombygg({ ...SJEKK, produkt_rettelser: [rett('legg_til', '502')] }))).toEqual([]);
      expect(varselOm(ombygg({ ...SJEKK, produkt_rettelser: [rett('fjern', '502'), angreAv('502')] }))).toEqual([]);
      expect(varselOm(ombygg(SJEKK))).toEqual([]);
      expect(varselOm(ombygg({ utstyr_sjekkliste: [{ punkt: 'Tillegg for 180 graders stoler', ok: false }], produkt_rettelser: [rett('fjern', '502')] }))).toEqual([]);
    });

    it('selve utfallet er uendret: svaret går fortsatt foran sjekklista (standarddelene, 502 ikke på bilen)', () => {
      const { rader, spm180 } = sandbox.beregnSkalPaaBilen(ombygg({ ...SJEKK, produkt_rettelser: [rett('fjern', '502')] }));
      expect(spm180).toMatchObject({ svar: 'nei', kilde: 'rettelse' });
      expect(rader.find((r) => r.nr === '500').oppskrift.id).toBe('opp_std');
      expect(rader.find((r) => r.nr === '502').fjernet).toBe(true);
    });
  });

  describe('dørbeskyttere og «kun ekstrautstyr»', () => {
    const HAND_500 = rett('legg_til', '500', { navn: 'Standard ombygging' });

    it('selv med Standard ombygging lagt til for hånd gir en kun-ordre ingen dørbeskyttere av seg selv', () => {
      const { rader } = sandbox.beregnSkalPaaBilen(bil({ kun_ekstrautstyr: true, produkt_rettelser: [HAND_500] }));
      expect(rader.find((r) => r.nr === '500')).toMatchObject({ kilde: 'manuell', rolle: 'ombygging', fjernet: false }); // forutsetning: ombyggingsraden finnes
      expect(dorRad(rader)).toBeUndefined();
      // samme ordre uten kun-flagget: regelen gir raden (så det er flagget som skiller)
      expect(dorRad(sandbox.beregnSkalPaaBilen(bil({ produkt_rettelser: [HAND_500] })).rader)).toMatchObject({ kilde: 'deler', fjernet: false });
    });

    it('... men en ansatt kan legge dem til for hånd på en kun-ordre, og angre tar dem bort igjen', () => {
      const med = bil({ kun_ekstrautstyr: true, produkt_rettelser: [HAND_500, rett('legg_til', DOR.id, { navn: 'Dørbeskyttere' })] });
      expect(dorRad(sandbox.beregnSkalPaaBilen(med).rader)).toMatchObject({ kilde: 'deler', manuell: true, fjernet: false });
      med.produktRettelser.push(angreAv(DOR.id));
      expect(dorRad(sandbox.beregnSkalPaaBilen(med).rader)).toBeUndefined();
    });

    it('lager: en kun-ordre med ombyggingen lagt til for hånd trekker ikke dørbeskyttere ved ankomst', async () => {
      const o = bil({ kun_ekstrautstyr: true, ordre_status: 'ikke_paabegynt', produkt_rettelser: [HAND_500] });
      trekkSvar();
      await sandbox.synkProduktliste(o);
      expect(rpcKall('lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id)).not.toContain(DOR.id);
    });
  });

  describe('dørbeskyttere når portalens produktliste ikke er lastet', () => {
    it('ingen dørbeskyttere av seg selv (tvil hindrer), ingen trekk, men håndtilføyelse virker; lastes lista, kommer de', async () => {
      S.portalProdukter = []; // loadFromSupabase setter [] når portal_produkter ikke lot seg hente
      const o = ombygg({ ordre_status: 'ikke_paabegynt' });
      expect(dorRad(sandbox.beregnSkalPaaBilen(o).rader)).toBeUndefined();
      expect(() => sandbox.skalPaaBilenHTML(o)).not.toThrow();
      trekkSvar();
      await sandbox.synkProduktliste(o);
      expect(rpcKall('lager_trekk_oppskrift').map((k) => k.args.p_oppskrift_id)).not.toContain(DOR.id);
      const hand = ombygg({ produkt_rettelser: [rett('legg_til', DOR.id, { navn: 'Dørbeskyttere' })] });
      expect(dorRad(sandbox.beregnSkalPaaBilen(hand).rader)).toMatchObject({ kilde: 'deler', manuell: true });
      S.portalProdukter = PRODUKTER.map((p) => ({ ...p }));
      expect(dorRad(sandbox.beregnSkalPaaBilen(o).rader)).toMatchObject({ kilde: 'deler', fjernet: false });
    });
  });

  describe('«Rett»-menyen for vanlige rader (alle modeller)', () => {
    const id = 'ord_TEST_SPB_MENY2';
    const med = (apneNr, over) => {
      sandbox.skalPaaBilenVeksleRett(id, apneNr);
      try { return sandbox.skalPaaBilenHTML(ombygg({ id, ...over })); } finally { sandbox.skalPaaBilenVeksleRett(id, apneNr); }
    };

    it('aktiv sjekklisterad: «Fjern fra bilen» (fjern, uten navn-argument), ingen «Angre»', () => {
      const html = med('501', MED_PANORAMA);
      expect(html).toContain(`produktRettelse('${id}','fjern','501')">Fjern fra bilen`);
      expect(html).not.toContain('Angre (ta bort igjen)');
      expect(html).not.toContain('Legg tilbake');
    });

    it('fjernet sjekklisterad: «Legg tilbake» er angre (ikke legg_til), uten navn-argument', () => {
      const html = med('501', { ...MED_PANORAMA, produkt_rettelser: [rett('fjern', '501')] });
      expect(html).toContain(`produktRettelse('${id}','angre','501')">Legg tilbake`);
      expect(html).not.toContain('Fjern fra bilen');
      expect(html).not.toContain(`'legg_til','501'`);
    });

    it('manuelt lagt til rad: «Fjern fra bilen» og «Angre (ta bort igjen)» (angre), uten navn-argument', () => {
      const html = med('503', { produkt_rettelser: [rett('legg_til', '503', { navn: 'Heldekkende gulv' })] });
      expect(html).toContain(`produktRettelse('${id}','fjern','503')">Fjern fra bilen`);
      expect(html).toContain(`produktRettelse('${id}','angre','503')">Angre (ta bort igjen)`);
    });

    it('ombyggingsraden rettes med boksene (ingen Fjern), og en bestilt rad har forklaringen om rabatten', () => {
      const ombyggingsrad = med('500', {});
      expect(ombyggingsrad).toContain('Ombyggingen endres med Nytt/Brukt/Lafinto/Personbil-boksene over.');
      expect(ombyggingsrad).not.toContain('Fjern fra bilen');
      const bestilt = med('503', { portal_linjer: [{ produktnummer: '500', navn: 'Standard ombygging' }, { produktnummer: '503', navn: 'Heldekkende gulv' }] });
      expect(bestilt).toContain(`produktRettelse('${id}','fjern','503')">Fjern fra bilen`);
      expect(bestilt).toContain('Linjen i Fakturering har bestillingens rabatt');
    });
  });

  describe('portalstyrte verdier i onclick (backslash, apostrof, linjeskift) og id-attributter', () => {
    // Kjører HVER onclick/oninput slik nettleseren ville (HTML-dekodet, kompilert og kjørt), med stubber for funksjonene den kan kalle.
    // En verdi som bryter ut av JS-strengen gir enten SyntaxError eller kjører koden (alert).
    const dekod = (s) => s.replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const kjorOnclicks = (html) => {
      const kall = [], alerts = [], feil = [];
      const ctx = vm.createContext({
        produktRettelse: (...a) => kall.push(['produktRettelse', ...a]),
        skalPaaBilenVeksleRett: (...a) => kall.push(['veksleRett', ...a]),
        skalPaaBilenApneSok: (...a) => kall.push(['apneSok', ...a]),
        skalPaaBilenSok: (...a) => kall.push(['sok', ...a]),
        skalPaaBilenLukkSok: () => {},
        alert: (x) => alerts.push(x),
      });
      let antall = 0;
      for (const m of html.matchAll(/ on(?:click|input)="([^"]*)"/g)) {
        antall++;
        const kode = dekod(m[1]).replace(/this\.value/g, "'x'");
        try { vm.runInContext(kode, ctx); } catch (e) { feil.push(`${e.name}: ${e.message} :: ${kode.slice(0, 110)}`); }
      }
      return { kall, alerts, feil, antall };
    };
    const FARLIGE = ['Slutter med bakslash \\', "\\');alert(1);//", 'Linje\nskift\r\nto', `it's "q" & <b>x</b> \\\\ '`, "a'b\\'c"];
    const sammenSlaatt = (s) => s.replace(/[\r\n\u2028\u2029]+/g, ' '); // linjeskift i en verdi blir ett mellomrom (en rå linjeskift er en SyntaksError i en JS-streng)

    it.each(FARLIGE)('spørsmålet (navn og portal-id for 502) og ordre-id: %j kjører riktig og uten kode utenfra', (farlig) => {
      S.portalProdukter = PRODUKTER.map((p) => (p.portal_id === 't502' ? { ...p, navn: farlig, portal_id: farlig } : { ...p }));
      const id = "ord_X\\'" + 'q';
      const html = sandbox.skalPaaBilenHTML(ombygg({ id }));
      const { kall, alerts, feil, antall } = kjorOnclicks(html);
      expect(antall).toBeGreaterThan(2);
      expect(feil).toEqual([]);
      expect(alerts).toEqual([]);
      const forventet = sammenSlaatt(farlig);
      expect(kall).toContainEqual(['produktRettelse', id, 'legg_til', '502', forventet, forventet]);
      expect(kall).toContainEqual(['produktRettelse', id, 'fjern', '502', forventet, forventet]);
      // besvart: «Endre»
      const besvart = kjorOnclicks(sandbox.skalPaaBilenHTML(ombygg({ id, produkt_rettelser: [rett('legg_til', '502')] })));
      expect(besvart.feil).toEqual([]);
      expect(besvart.alerts).toEqual([]);
      expect(besvart.kall).toContainEqual(['produktRettelse', id, 'fjern', '502', forventet, forventet]);
    });

    it.each(FARLIGE)('«+ Legg til utstyr»-treff (nummer, navn og portal-id): %j', (farlig) => {
      S.portalProdukter = PRODUKTER.map((p) => (p.portal_id === 'v503' ? { ...p, navn: 'Heldekkende ' + farlig, portal_id: farlig } : { ...p }));
      const id = 'ord_TEST_SPB_TREFF';
      const o = ombygg({ id });
      sandbox.skalPaaBilenApneSok(id);
      try {
        sandbox.skalPaaBilenSok(id, '503');
        const { kall, alerts, feil } = kjorOnclicks(sandbox.skalPaaBilenHTML(o));
        expect(feil).toEqual([]);
        expect(alerts).toEqual([]);
        expect(kall).toContainEqual(['produktRettelse', id, 'legg_til', '503', sammenSlaatt('Heldekkende ' + farlig), sammenSlaatt(farlig)]);
      } finally { sandbox.skalPaaBilenLukkSok(); }
    });

    it('produktnummer fra en bestilling (r.nr) i «Rett»-menyen: også med bakstrek og apostrof', () => {
      const id = 'ord_TEST_SPB_NR';
      const nrFarlig = "5'0\\";
      const o = ombygg({ id, portal_linjer: [{ produktnummer: '500', navn: 'Standard ombygging' }, { produktnummer: nrFarlig, navn: 'Rar linje' }] });
      sandbox.skalPaaBilenVeksleRett(id, nrFarlig);
      try {
        const { kall, alerts, feil } = kjorOnclicks(sandbox.skalPaaBilenHTML(o));
        expect(feil).toEqual([]);
        expect(alerts).toEqual([]);
        expect(kall).toContainEqual(['produktRettelse', id, 'fjern', nrFarlig]);
        expect(kall).toContainEqual(['veksleRett', id, nrFarlig]);
      } finally { sandbox.skalPaaBilenVeksleRett(id, nrFarlig); }
    });

    it('portal-id og ordre-id er escapet i både onclick og id-attributtet (ubesvart og besvart spørsmål)', () => {
      S.portalProdukter = PRODUKTER.map((p) => (p.portal_id === 't502' ? { ...p, portal_id: "t5'02<img src=x onerror=alert(1)>" } : { ...p }));
      const id = 'ord_"<i>x';
      for (const over of [{}, { produkt_rettelser: [rett('legg_til', '502')] }]) {
        const html = sandbox.skalPaaBilenHTML(ombygg({ id, ...over }));
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<i>');
        expect(html).toContain('id="spm180_ord_&quot;&lt;i>x"');
        expect(html).toContain("t5\\'02&lt;img src=x onerror=alert(1)>");
        expect(html).toContain("produktRettelse('ord_&quot;&lt;i>x',");
      }
    });
  });

  describe('rester fra en gammel klient: fakturalinje med en oppskrifts-id', () => {
    const REST = { produktnummer: DOR.id, antall: 1 };

    it('synkProduktliste fjerner linjen (bare den) via oppdater_ordre_fiken_linje, uten å røre vanlige linjer', async () => {
      const o = ombygg({ fiken_linjer: [{ produktnummer: '500', antall: 1 }, REST] });
      await sandbox.synkProduktliste(o);
      expect(rpcKall('oppdater_ordre_fiken_linje').map((k) => [k.args.p_produktnummer, k.args.p_linje])).toEqual([[DOR.id, null]]);
    });

    it('ingen rester: ingen ekstra kall; og alle slike linjer fjernes (flere oppskrifts-id-er)', async () => {
      await sandbox.synkProduktliste(ombygg({ fiken_linjer: [{ produktnummer: '500', antall: 1 }] }));
      expect(rpcKall('oppdater_ordre_fiken_linje')).toEqual([]);
      await sandbox.synkProduktliste(ombygg({ fiken_linjer: [REST, { produktnummer: 'oppskrift_1790236543999', antall: 1 }] }));
      expect(rpcKall('oppdater_ordre_fiken_linje').map((k) => k.args.p_produktnummer).sort()).toEqual([DOR.id, 'oppskrift_1790236543999']);
    });

    it('Fakturering: en slik linje gir en RØD grunn (kladden lages ikke), og fakturerViaFiken stopper før Fiken kalles', async () => {
      const o = ombygg({ kunde: 'TEST Kunde AS', fiken_linjer: [{ produktnummer: '500', antall: 1 }, REST] });
      const sjekk = sandbox.fakturaSjekk(o);
      expect(sjekk.niva).toBe('rod');
      expect(sjekk.grunner.find((g) => g.kode === 'oppskrift_id_paa_faktura').tekst).toContain(DOR.id);
      const toast = [];
      let kalt = 0;
      const orig = sandbox.kallFikenFakturer;
      sandbox.visToast = (t) => toast.push(t);
      sandbox.kallFikenFakturer = async () => { kalt++; return 'ok'; };
      try { await sandbox.fakturerViaFiken(o.id); } finally { sandbox.kallFikenFakturer = orig; }
      expect(kalt).toBe(0);
      expect(toast.join(' ')).toContain('oppskrifts-id');
      // uten slik linje: ingen slik grunn
      const ren = ombygg({ kunde: 'TEST Kunde AS', fiken_linjer: [{ produktnummer: '500', antall: 1 }] });
      expect(sandbox.fakturaSjekk(ren).grunner.map((g) => g.kode)).not.toContain('oppskrift_id_paa_faktura');
    });
  });
});
