import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// s08-048 (Henrik 30.10/31.10 kveld): leggTilPortalUtstyrLinjer() (js/lager.js) - kalt når
// en portal-ordre bekreftes (portalBekreftOrdre, js/ordre-diverse.js), fyller «Skal ha
// etter visning» og fiken_linjer fra ordrens o.portalLinjer (produktnummer/navn/
// rabatt_prosent, satt av portal_koble_bestilling via dbToOrdre - se
// supabase/migrations/20261031170000_portal_bestilling_linjer.sql).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kode = readFileSync(path.resolve(__dirname, '../js/lager.js'), 'utf8');

function nyttMiljo(ordre) {
  const rpcKall = [];
  const consoleFeil = [];
  const toaster = [];
  let rpcSvar = (produktnummer) => ({ data: { fikenLinjer: [...(ordre.fikenLinjer || []), { produktnummer, antall: 1 }] }, error: null });
  const sandbox = {
    console: { log() {}, error: (...a) => consoleFeil.push(a), warn() {}, info() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    document: { getElementById: () => null, addEventListener: () => {} },
    S: { ordrer: [ordre] },
    db: { rpc: (navn, args) => { rpcKall.push([navn, args]); return Promise.resolve(rpcSvar(args.p_produktnummer)); } },
    su: (id, felt, val) => { const o = sandbox.S.ordrer.find((x) => x.id === id); o.utstyr[felt] = val; },
    planleggLocalSpeiling: () => {},
    visToast: (...a) => toaster.push(a),
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox, { filename: 'lager.js' });
  return { sandbox, rpcKall, consoleFeil, toaster, settRpcSvar: (fn) => { rpcSvar = fn; } };
}

function nyOrdre(overrides = {}) {
  return { id: 'ord_1', utstyr: { skalHa: '' }, fikenLinjer: [], portalLinjer: null, ...overrides };
}

describe('leggTilPortalUtstyrLinjer', () => {
  it('ingen portalLinjer: gjør ingenting (ingen RPC, skalHa urørt)', async () => {
    const o = nyOrdre();
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall).toEqual([]);
    expect(o.utstyr.skalHa).toBe('');
  });

  it('tom portalLinjer-liste: gjør ingenting', async () => {
    const o = nyOrdre({ portalLinjer: [] });
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall).toEqual([]);
  });

  it('to linjer: begge navn i skalHa, begge produktnummer i fiken_linjer MED rabatten frosset', async () => {
    const o = nyOrdre({ portalLinjer: [
      { produktnummer: '501', navn: 'Takluke', rabatt_prosent: 10 },
      { produktnummer: '502', navn: '6-seter svingbare', rabatt_prosent: 15 },
    ] });
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(o.utstyr.skalHa.split('\n')).toEqual(['Takluke', '6-seter svingbare']);
    expect(rpcKall).toEqual([
      ['oppdater_ordre_fiken_linje', { p_ordre_id: 'ord_1', p_produktnummer: '501', p_linje: { produktnummer: '501', antall: 1, rabatt: 10 } }],
      ['oppdater_ordre_fiken_linje', { p_ordre_id: 'ord_1', p_produktnummer: '502', p_linje: { produktnummer: '502', antall: 1, rabatt: 15 } }],
    ]);
    expect(o.fikenLinjer.map((l) => l.produktnummer)).toEqual(['501', '502']);
  });

  // Rettet 2026-11-20: før ble en linje uten rabatt_prosent låst til rabatt 0, som hoppet over
  // både kundens vanlige sats og NULL-sperren i fiken-fakturer. Nå sendes linjen UTEN rabatt-nøkkel.
  it('mangler rabatt_prosent: linjen sendes UTEN rabatt-nøkkel (ikke låst til 0 %)', async () => {
    const o = nyOrdre({ portalLinjer: [{ produktnummer: '503', navn: 'Heldekkende gulv' }] });
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(rpcKall[0][1].p_linje, 'rabatt')).toBe(false);
    expect({ ...rpcKall[0][1].p_linje }).toEqual({ produktnummer: '503', antall: 1 });
  });

  it('rabatt_prosent som ikke er et endelig tall (tekst, NaN, uendelig): ingen rabatt-nøkkel', async () => {
    const o = nyOrdre({ portalLinjer: [
      { produktnummer: '503', navn: 'A', rabatt_prosent: '15' },
      { produktnummer: '504', navn: 'B', rabatt_prosent: NaN },
      { produktnummer: '505', navn: 'C', rabatt_prosent: Infinity },
      { produktnummer: '506', navn: 'D', rabatt_prosent: null },
    ] });
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall).toHaveLength(4);
    for (const [, args] of rpcKall) expect(Object.prototype.hasOwnProperty.call(args.p_linje, 'rabatt')).toBe(false);
  });

  it('rabatt_prosent er et tall (også 0): frosset på linjen som før', async () => {
    const o = nyOrdre({ portalLinjer: [
      { produktnummer: '503', navn: 'A', rabatt_prosent: 15 },
      { produktnummer: '504', navn: 'B', rabatt_prosent: 0 },
    ] });
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall[0][1].p_linje.rabatt).toBe(15);
    expect(rpcKall[1][1].p_linje.rabatt).toBe(0);
  });

  it('linje uten produktnummer eller uten navn: hoppes helt over (ingen RPC, ingen skalHa-tekst)', async () => {
    const o = nyOrdre({ portalLinjer: [
      { produktnummer: '', navn: 'Uten nummer', rabatt_prosent: 5 },
      { produktnummer: '504', navn: '', rabatt_prosent: 5 },
      { produktnummer: '505', navn: 'Gyldig linje', rabatt_prosent: 5 },
    ] });
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall).toHaveLength(1);
    expect(rpcKall[0][1].p_produktnummer).toBe('505');
    expect(o.utstyr.skalHa).toBe('Gyldig linje');
  });

  it('idempotent: kalt to ganger legger ikke til samme linje to ganger (verken i skalHa eller fiken_linjer)', async () => {
    const o = nyOrdre({ portalLinjer: [{ produktnummer: '501', navn: 'Takluke', rabatt_prosent: 10 }] });
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall).toHaveLength(1);
    expect(o.utstyr.skalHa.split('\n')).toEqual(['Takluke']);
    expect(o.fikenLinjer).toHaveLength(1);
  });

  it('produktnummer som allerede finnes i fiken_linjer (f.eks. lagt til manuelt før bekreftelse): hopper over RPC-kallet, men legger fortsatt til skalHa-teksten', async () => {
    const o = nyOrdre({ fikenLinjer: [{ produktnummer: '501', antall: 1 }], portalLinjer: [{ produktnummer: '501', navn: 'Takluke', rabatt_prosent: 10 }] });
    const { sandbox, rpcKall } = nyttMiljo(o);
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall).toEqual([]);
    expect(o.utstyr.skalHa).toBe('Takluke');
  });

  it('RPC-feil på én linje: logges OG vises som toast til den ansatte, men de andre linjene legges til likevel', async () => {
    const o = nyOrdre({ portalLinjer: [
      { produktnummer: '501', navn: 'Takluke', rabatt_prosent: 10 },
      { produktnummer: '502', navn: '6-seter svingbare', rabatt_prosent: 15 },
    ] });
    const { sandbox, rpcKall, consoleFeil, toaster, settRpcSvar } = nyttMiljo(o);
    settRpcSvar((produktnummer) => produktnummer === '501'
      ? { data: null, error: { message: 'nettverksfeil' } }
      : { data: { fikenLinjer: [...o.fikenLinjer, { produktnummer, antall: 1 }] }, error: null });
    await sandbox.leggTilPortalUtstyrLinjer('ord_1');
    expect(rpcKall).toHaveLength(2);
    expect(consoleFeil).toHaveLength(1);
    expect(toaster).toHaveLength(1);
    expect(toaster[0][0]).toMatch(/501/);
    expect(o.utstyr.skalHa.split('\n')).toEqual(['Takluke', '6-seter svingbare']);
    expect(o.fikenLinjer.map((l) => l.produktnummer)).toEqual(['502']);
  });

  it('ukjent ordre-id: gjør ingenting (kaster ikke)', async () => {
    const o = nyOrdre();
    const { sandbox, rpcKall } = nyttMiljo(o);
    await expect(sandbox.leggTilPortalUtstyrLinjer('finnes_ikke')).resolves.toBeUndefined();
    expect(rpcKall).toEqual([]);
  });
});
