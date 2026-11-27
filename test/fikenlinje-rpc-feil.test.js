import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// s90-20261104-6 (kritiker-gjennomgang 5.11, «svelgede linje-RPC-feil som kan gi avvik mellom skjerm og faktisk kladde»):
// skrivingene av fakturalinjer (oppdater_ordre_fiken_linje / _ved_id) logget en feil bare i konsollen. Manuell redigering i
// Fakturering-kortet endret den lokale lista FØR kallet, så en avvist skriving ga en linje på skjermen som aldri ble lagret
// (eller fjernet en linje på skjermen som fortsatt lå i databasen og ville blitt fakturert), og «Legg frakt på fakturaen» sa
// «lagt på fakturaen» uansett. Nå: feilen vises (toast), og skjermen viser det databasen faktisk har.

function lagDb(svar) {
  const kall = [];
  return {
    kall,
    db: {
      rpc: (navn, args) => { kall.push({ navn, args }); return Promise.resolve(svar(navn, args)); },
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }), select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    },
  };
}
const FEIL = () => ({ data: null, error: { message: 'Failed to fetch' } });

describe('fakturalinjer: en avvist skriving vises og skjermen lyver ikke', () => {
  let app, o, html, toasts;
  beforeEach(() => {
    app = lastApp();
    app.kjor('var __toasts = []; visToast = function (m, t) { __toasts.push({ m: m, t: t || "feil" }); };');
    toasts = () => app.kjor('__toasts');
    o = {
      id: 'ord_1', merke: 'KIA', modell: 'EV9', ordretype: 'bil', ombygging: {}, utstyr: {}, endringer: [],
      fikenLinjer: [{ id: 'fl_a', produktnummer: '500', antall: 1 }, { id: 'fl_b', produktnummer: '501', antall: 2 }],
    };
    app.S.ordrer = [o];
    app.settMe({ id: 1, navn: 'TEST', rolle: 'ansatt' });
    html = () => app.sandbox.document.getElementById('fikenLinjer_ord_1').innerHTML;
  });
  afterEach(() => app.settMe({ id: 1, navn: 'TEST', rolle: 'ansatt' }));

  it('«+ Legg til linje» som feiler: ingen ny linje lokalt eller på skjermen, og en feilmelding', async () => {
    const { db } = lagDb(FEIL); app.settDb(db);
    await app.kjor("leggTilFikenLinje('ord_1')");
    expect(o.fikenLinjer.map(l => l.id)).toEqual(['fl_a', 'fl_b']);
    expect((html().match(/placeholder="Produktnr\."/g) || []).length).toBe(2);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].t).toBe('feil');
    expect(toasts()[0].m).toMatch(/IKKE lagret/);
    expect(toasts()[0].m).toMatch(/Failed to fetch/);
  });

  it('«+ Legg til linje» som lykkes: linjene fra databasen vises, ingen feilmelding', async () => {
    const { db } = lagDb((navn, a) => ({ data: { fikenLinjer: [...o.fikenLinjer.filter(l => l.id !== a.p_linje_id), a.p_linje] }, error: null }));
    app.settDb(db);
    await app.kjor("leggTilFikenLinje('ord_1')");
    expect(o.fikenLinjer).toHaveLength(3);
    expect((html().match(/placeholder="Produktnr\."/g) || []).length).toBe(3);
    expect(toasts()).toHaveLength(0);
  });

  it('fjerne en linje som feiler: linjen står igjen (den ville blitt fakturert) på samme plass, og feilmeldingen nevner produktnummeret', async () => {
    const { db, kall } = lagDb(FEIL); app.settDb(db);
    await app.kjor("fjernFikenLinje('ord_1','fl_a')");
    expect(kall[0]).toMatchObject({ navn: 'oppdater_ordre_fiken_linje_ved_id', args: { p_linje_id: 'fl_a', p_linje: null } });
    expect(o.fikenLinjer.map(l => l.id)).toEqual(['fl_a', 'fl_b']);
    expect(html()).toContain('value="500"');
    expect(toasts()[0].m).toMatch(/Fakturalinjen 500 ble IKKE lagret/);
  });

  it('fjerne en linje som lykkes: linjen er borte', async () => {
    const b = o.fikenLinjer[1];
    const { db } = lagDb(() => ({ data: { fikenLinjer: [b] }, error: null })); app.settDb(db);
    await app.kjor("fjernFikenLinje('ord_1','fl_a')");
    expect(o.fikenLinjer.map(l => l.id)).toEqual(['fl_b']);
    expect(html()).not.toContain('value="500"');
    expect(toasts()).toHaveLength(0);
  });

  it('endre antall som feiler: den gamle verdien settes tilbake og vises', async () => {
    const { db } = lagDb(FEIL); app.settDb(db);
    await app.kjor("settFikenLinje('ord_1','fl_b','antall','7')");
    expect(o.fikenLinjer[1].antall).toBe(2);
    expect(html()).toContain('value="2"');
    expect(html()).not.toContain('value="7"');
    expect(toasts()).toHaveLength(1);
  });

  it('endre produktnummer som avvises av databasen: det gamle nummeret står, meldingen nevner det nye', async () => {
    const { db } = lagDb(() => ({ data: null, error: { message: 'UGYLDIG_PRODUKTNUMMER' } })); app.settDb(db);
    await app.kjor("settFikenLinje('ord_1','fl_a','produktnummer','oppskrift_1790236543257')");
    expect(o.fikenLinjer[0].produktnummer).toBe('500');
    expect(html()).toContain('value="500"');
    expect(html()).not.toContain('oppskrift_1790236543257');
    expect(toasts()[0].m).toMatch(/oppskrift_1790236543257 ble IKKE lagret \(UGYLDIG_PRODUKTNUMMER\)/);
  });

  it('endre beløp på en linje uten beløp som feiler: feltet fjernes igjen (ikke satt til undefined/0)', async () => {
    const { db } = lagDb(FEIL); app.settDb(db);
    await app.kjor("settFikenLinje('ord_1','fl_a','belop','99')");
    expect(Object.prototype.hasOwnProperty.call(o.fikenLinjer[0], 'belop')).toBe(false);
  });

  it('endre antall som lykkes: ingen tilbakerulling', async () => {
    const { db } = lagDb((n, a) => ({ data: { fikenLinjer: [o.fikenLinjer[0], a.p_linje] }, error: null })); app.settDb(db);
    await app.kjor("settFikenLinje('ord_1','fl_b','antall','7')");
    expect(o.fikenLinjer[1].antall).toBe(7);
    expect(toasts()).toHaveLength(0);
  });

  it('automatisk linje (oppdaterFikenLinjeForOppskrift) som feiler: ingen linje lagt til, feilmelding, gir false', async () => {
    const { db } = lagDb(FEIL); app.settDb(db);
    const res = await app.kjor("oppdaterFikenLinjeForOppskrift('502', true, 'ord_1')");
    expect(res).toBe(false);
    expect(o.fikenLinjer.map(l => l.produktnummer)).toEqual(['500', '501']);
    expect(html()).not.toContain('value="502"');
    expect(toasts()[0].m).toMatch(/Fakturalinjen 502 ble IKKE lagret/);
  });

  it('automatisk fjerning som feiler: linjen står fortsatt på skjermen', async () => {
    const { db } = lagDb(FEIL); app.settDb(db);
    await app.kjor("oppdaterFikenLinjeForOppskrift('501', false, 'ord_1')");
    expect(o.fikenLinjer.map(l => l.produktnummer)).toEqual(['500', '501']);
    expect(html()).toContain('value="501"');
    expect(toasts()).toHaveLength(1);
  });

  it('automatisk linje som lykkes: ingen feilmelding (uendret oppførsel)', async () => {
    const { db } = lagDb((n, a) => ({ data: { fikenLinjer: [...o.fikenLinjer, { id: 'fl_c', ...a.p_linje }] }, error: null })); app.settDb(db);
    await app.kjor("oppdaterFikenLinjeForOppskrift('502', true, 'ord_1')");
    expect(o.fikenLinjer.map(l => l.produktnummer)).toEqual(['500', '501', '502']);
    expect(toasts()).toHaveLength(0);
  });

  it('samme feil på hvert render (f.eks. uten nett) gir bare ÉN melding per linje innen 15 s, men en ny linje får sin egen', async () => {
    const { db } = lagDb(FEIL); app.settDb(db);
    await app.kjor("oppdaterFikenLinjeForOppskrift('502', true, 'ord_1')");
    await app.kjor("oppdaterFikenLinjeForOppskrift('502', true, 'ord_1')");
    await app.kjor("oppdaterFikenLinjeForOppskrift('502', true, 'ord_1')");
    expect(toasts()).toHaveLength(1);
    await app.kjor("oppdaterFikenLinjeForOppskrift('503', true, 'ord_1')");
    expect(toasts()).toHaveLength(2);
  });

  it('«Hent drivstoff» (oppdaterOrdreFikenLinje) som feiler: feilmelding, ingen linje, gir false', async () => {
    const { db } = lagDb(FEIL); app.settDb(db);
    const res = await app.kjor("oppdaterOrdreFikenLinje(S.ordrer[0], '21', { produktnummer: '21', antall: 1, belop: 500 })");
    expect(res).toBe(false);
    expect(o.fikenLinjer.some(l => l.produktnummer === '21')).toBe(false);
    expect(toasts()[0].m).toMatch(/Fakturalinjen 21 ble IKKE lagret/);
  });

  it('«Legg frakt på fakturaen» som feiler: sier IKKE «lagt på fakturaen» og skriver ingen logglinje', async () => {
    o.ordretype = 'leveranse';
    o.leveranse = { fraktPris: 450, fraktProduktnr: '60', kolliListe: [] };
    app.settMe({ id: 1, navn: 'TEST', rolle: 'admin' });
    const { db } = lagDb(FEIL); app.settDb(db);
    await app.kjor("leggFraktPaaFaktura('ord_1')");
    expect(toasts().some(t => t.t === 'ok')).toBe(false);
    expect(toasts().some(t => /IKKE lagret/.test(t.m))).toBe(true);
    expect((o.endringer || []).some(e => /Frakt lagt på fakturaen/.test(JSON.stringify(e)))).toBe(false);
    expect(o.fikenLinjer.some(l => l.produktnummer === '60')).toBe(false);
  });

  it('«Legg frakt på fakturaen» som lykkes: sier fortsatt «lagt på fakturaen»', async () => {
    o.ordretype = 'leveranse';
    o.leveranse = { fraktPris: 450, fraktProduktnr: '60', kolliListe: [] };
    app.settMe({ id: 1, navn: 'TEST', rolle: 'admin' });
    const { db } = lagDb((n, a) => ({ data: { fikenLinjer: [...o.fikenLinjer, a.p_linje] }, error: null })); app.settDb(db);
    await app.kjor("leggFraktPaaFaktura('ord_1')");
    expect(toasts().some(t => t.t === 'ok' && /lagt på fakturaen/.test(t.m))).toBe(true);
  });
});
