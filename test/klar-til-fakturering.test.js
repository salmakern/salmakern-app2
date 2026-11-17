// "Klar til fakturering" (s90-20261104-5 steg 2, avtalt rekkefølge for fakturering/lager,
// 5.11): ren lesevisning på Oversikt (admin-only) som viser grønn/gul/rød per ordre fra
// fakturaSjekk(o) - se test/fiken-ombygging.test.js for selve fakturaSjekk-logikken. Denne
// testen dekker RENDERINGEN (kortet/lista) mot den fulle app-harnessen (samme mønster som
// "Ordreklokker som har gått lenge" i test/ordreklokke-opprydding.test.js): admin-only,
// sortering (rød først), feilisolasjon per ordre, og at den IKKE gjør noe automatisk (ren
// visning - ingen knapp som fakturerer eller sender noe herfra).
import { describe, it, expect } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

function nyOrdre(overrides = {}) {
  return {
    id: 'ord_1', ordretype: 'bil', status: 'aktiv', ordreStatus: 'klar_henting',
    chassis: 'TESTWXYZ000000099', regnr: '', kunde: 'Test Kunde AS',
    merke: 'KIA', modell: 'EV9', ombygging: { nyttKjoretoy: false, bruktKjoretoy: false },
    fikenLinjer: [{ produktnummer: '502', antall: 1, pris: 1670, mva: 'high', rabatt: 20 }],
    fakturert: false,
    ...overrides,
  };
}

describe('Oversikt: «Klar til fakturering» (admin, ren lesevisning)', () => {
  it('skjult for en vanlig ansatt', () => {
    const { sandbox, settMe, S } = lastApp();
    settMe({ id: 1, navn: 'Test', rolle: 'ansatt' });
    S.ordrer = [nyOrdre()];
    sandbox.renderKlarTilFakturering();
    expect(sandbox.document.getElementById('klarTilFaktureringKort').style.display).toBe('none');
  });

  it('skjuler seg selv (tom liste) når ingen ordre venter på fakturering', () => {
    const { sandbox, settMe, S } = lastApp();
    settMe({ id: 1, navn: 'Admin', rolle: 'admin' });
    S.ordrer = [nyOrdre({ fakturert: true })]; // allerede fakturert - ikke en kandidat
    sandbox.renderKlarTilFakturering();
    expect(sandbox.document.getElementById('klarTilFaktureringKort').style.display).toBe('block');
    expect(sandbox.document.getElementById('klarTilFaktureringListe').innerHTML).toMatch(/Ingen ordre venter/);
  });

  it('kort lenke (trinn 4, valg A): antall per farge og en knapp til siden Fakturering, ingen liste', () => {
    const { sandbox, settMe, S } = lastApp();
    settMe({ id: 1, navn: 'Admin', rolle: 'admin' });
    S.ordrer = [
      nyOrdre({ id: 'ord_gronn', chassis: 'GRONN0000000001' }),
      nyOrdre({ id: 'ord_rod', chassis: 'ROD00000000001', fikenLinjer: [] }), // ingen linjer -> rød
    ];
    sandbox.renderKlarTilFakturering();
    const html = sandbox.document.getElementById('klarTilFaktureringListe').innerHTML;
    expect(html).toContain('1 klare');
    expect(html).toContain('1 stopper');
    expect(html).toContain("showPage('fakturering'");
    expect(html).not.toContain('openOrdre(');
  });

  it('en "hentet" ordre som ikke er fakturert telles med (gul: ikke avstemt)', () => {
    const { sandbox, settMe, S } = lastApp();
    settMe({ id: 1, navn: 'Admin', rolle: 'admin' });
    S.ordrer = [nyOrdre({ ordreStatus: 'hentet' })];
    sandbox.renderKlarTilFakturering();
    expect(sandbox.document.getElementById('klarTilFaktureringListe').innerHTML).toContain('1 sjekk selv');
  });

  it('en leveranse tas ikke med (egen fakturerings-/arkiveringsflyt)', () => {
    const { sandbox, settMe, S } = lastApp();
    settMe({ id: 1, navn: 'Admin', rolle: 'admin' });
    S.ordrer = [nyOrdre({ id: 'ord_lev', ordretype: 'leveranse', chassis: '' })];
    sandbox.renderKlarTilFakturering();
    expect(sandbox.document.getElementById('klarTilFaktureringListe').innerHTML).toMatch(/Ingen ordre venter/);
  });

  it('en ordre som kaster i fakturaSjekk blanker ikke resten av lista (feilisolasjon)', () => {
    const { sandbox, settMe, S } = lastApp();
    settMe({ id: 1, navn: 'Admin', rolle: 'admin' });
    S.ordrer = [nyOrdre({ id: 'ord_rar', fikenLinjer: 'ikke en liste' }), nyOrdre({ id: 'ord_ok' })];
    expect(() => sandbox.renderKlarTilFakturering()).not.toThrow();
    const html = sandbox.document.getElementById('klarTilFaktureringListe').innerHTML;
    expect(html).toContain('sjekk selv');
    expect(html).toContain("showPage('fakturering'");
  });

  it('ren lesevisning: gjør aldri noe skrivende selv - ingen db-kall trigget av selve renderingen', () => {
    const { sandbox, settMe, settDb, S } = lastApp();
    const kall = [];
    settDb({ from: (t) => { kall.push(t); return { select: () => ({ eq: () => ({}) }) }; }, rpc: (n) => { kall.push(n); return Promise.resolve({ data: null, error: null }); } });
    settMe({ id: 1, navn: 'Admin', rolle: 'admin' });
    S.ordrer = [nyOrdre(), nyOrdre({ id: 'ord_2', fikenLinjer: [] })];
    sandbox.renderKlarTilFakturering();
    expect(kall).toEqual([]);
  });
});
