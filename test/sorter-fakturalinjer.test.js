import { describe, it, expect } from 'vitest';
import { loadScript } from './helpers/load-script.js';

// Henrik 2026-11-02: fakturalinjene i ordren skal sorteres etter produktnummer, både i
// Fakturering-kortet (fikenLinjerHTML) og i fakturaen som sendes til Fiken.

const { sorterFikenLinjer, fikenLinjerHTML } = loadScript('ordre-detalj.js', {
  document: { getElementById: () => null, addEventListener: () => {} },
});

const nr = (linjer) => linjer.map((l) => l.produktnummer);

describe('sorterFikenLinjer', () => {
  it('sorterer rene tall som tall (21 før 100, ikke tekstlig)', () => {
    const ut = sorterFikenLinjer([{ produktnummer: '100' }, { produktnummer: '21' }, { produktnummer: '3' }]);
    expect(nr(ut)).toEqual(['3', '21', '100']);
  });

  it('legger linjer uten produktnummer sist (nylagt, ikke utfylt)', () => {
    const ut = sorterFikenLinjer([{ produktnummer: '' }, { produktnummer: '50' }, { produktnummer: undefined }, { produktnummer: '7' }]);
    expect(nr(ut)).toEqual(['7', '50', '', undefined]);
  });

  it('er stabil: like produktnumre beholder rekkefølgen', () => {
    const a = { produktnummer: '21', antall: 1, id: 'a' };
    const b = { produktnummer: '21', antall: 2, id: 'b' };
    expect(sorterFikenLinjer([a, b]).map((l) => l.id)).toEqual(['a', 'b']);
    expect(sorterFikenLinjer([b, a]).map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('håndterer ikke-numeriske og tallverdi-produktnumre samlet uten å krasje', () => {
    const ut = sorterFikenLinjer([{ produktnummer: 'B-2' }, { produktnummer: '10' }, { produktnummer: 'A-1' }, { produktnummer: '9' }]);
    expect(ut).toHaveLength(4);
    // Tallene holder seg riktig sortert innbyrdes, og tekstene innbyrdes, uansett hvor de havner.
    expect(nr(ut).filter((n) => /^\d+$/.test(n))).toEqual(['9', '10']);
    expect(nr(ut).filter((n) => !/^\d+$/.test(n))).toEqual(['A-1', 'B-2']);
  });

  it('endrer ikke originalen, og tåler null/undefined', () => {
    const original = [{ produktnummer: '9' }, { produktnummer: '1' }];
    const ut = sorterFikenLinjer(original);
    expect(nr(original)).toEqual(['9', '1']);
    expect(ut).not.toBe(original);
    expect(sorterFikenLinjer(undefined)).toEqual([]);
    expect(sorterFikenLinjer(null)).toEqual([]);
  });
});

describe('fikenLinjerHTML', () => {
  it('tegner linjene i produktnummer-rekkefølge, og kobler knappene til riktig linje-id', () => {
    const o = {
      id: 'ord_1',
      fikenLinjer: [
        { id: 'fl_c', produktnummer: '300', antall: 1 },
        { id: 'fl_a', produktnummer: '20', antall: 1 },
        { id: 'fl_b', produktnummer: '1000', antall: 1 },
      ],
    };
    const html = fikenLinjerHTML(o);
    const verdier = [...html.matchAll(/placeholder="Produktnr\."/g)].length;
    expect(verdier).toBe(3);
    const rekkefolge = [...html.matchAll(/value="(\d+)" placeholder="Produktnr\."/g)].map((m) => m[1]);
    expect(rekkefolge).toEqual(['20', '300', '1000']);
    // Hver linje peker fortsatt på sin egen id (ikke posisjon) når den vises sortert.
    const idRekkefolge = [...html.matchAll(/settFikenLinje\('ord_1','(fl_\w)','produktnummer'/g)].map((m) => m[1]);
    expect(idRekkefolge).toEqual(['fl_a', 'fl_c', 'fl_b']);
    // Lagret rekkefølge er urørt.
    expect(o.fikenLinjer.map((l) => l.id)).toEqual(['fl_c', 'fl_a', 'fl_b']);
  });
});
