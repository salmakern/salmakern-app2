// Trinn 3 av «Én produktliste»: «Skal på bilen» (js/skal-paa-bilen.js), kjørt i hele appen (test/helpers/app-harness.js) med falsk database.
// Syntetiske TEST-data: KIA EV9 med Standard ombygging 500, Takluke 501 («velges når» Panorama glasstak), 180-stoler 502 og to oppskrifter
// for ombyggingen (vanlig og «500, 502» med 180-brakettene), som i den ekte databasen 17.11.
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
