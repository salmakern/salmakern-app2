import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// 2026-11-02: timer_entries ble lastet med .limit(300) mens tabellen har 351 rader (lagerhistorikk .limit(500) mot 944), og
// Supabase kutter dessuten stille ved 1000. De eldste radene manglet i hver klient, så månedsoversikt/årsstatistikk regnet på
// ufullstendige data uten feilmelding. hentAlleRader() henter i sider til siste side er kortere enn sidestørrelsen.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const core = readFileSync(path.resolve(__dirname, '../js/core.js'), 'utf8').replace(/\r\n/g, '\n');

function miljo() {
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp, Proxy,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: { addEventListener() {}, getElementById() { return null; }, createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; }, body: { appendChild() {} }, head: { appendChild() {} } },
    location: { hostname: 'localhost' }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(core, sandbox, { filename: 'core.js' });
  return sandbox;
}

// Falsk spørring over `n` rader som respekterer .range(fra, til) (til er inklusiv, som i PostgREST).
function fakeSporring(rader, { feilPaaSide } = {}) {
  const kall = [];
  const lag = () => ({
    range(fra, til) {
      kall.push([fra, til]);
      if (feilPaaSide !== undefined && kall.length === feilPaaSide) return Promise.resolve({ data: null, error: { message: 'nett' } });
      return Promise.resolve({ data: rader.slice(fra, til + 1), error: null });
    },
  });
  return { lag, kall };
}
const rader = (n) => Array.from({ length: n }, (_, i) => ({ id: 'r' + i }));

describe('hentAlleRader', () => {
  it('351 rader (mer enn gamle .limit(300)) kommer alle med, i én side', async () => {
    const m = miljo(); const f = fakeSporring(rader(351));
    const r = await m.hentAlleRader(f.lag);
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(351);
    expect(f.kall).toEqual([[0, 999]]);
  });
  it('2500 rader hentes i tre sider uten tap eller duplikater', async () => {
    const m = miljo(); const f = fakeSporring(rader(2500));
    const r = await m.hentAlleRader(f.lag);
    expect(r.data).toHaveLength(2500);
    expect(new Set(r.data.map((x) => x.id)).size).toBe(2500);
    expect(f.kall).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('akkurat full side (1000 rader) henter en ekstra side for å bekrefte at det ikke finnes flere', async () => {
    const m = miljo(); const f = fakeSporring(rader(1000));
    const r = await m.hentAlleRader(f.lag);
    expect(r.data).toHaveLength(1000);
    expect(f.kall).toEqual([[0, 999], [1000, 1999]]);
  });
  it('tom tabell gir tom liste uten feil', async () => {
    const m = miljo();
    const r = await m.hentAlleRader(fakeSporring([]).lag);
    expect(r).toEqual({ data: [], error: null });
  });
  it('en feil midt i hentingen gir feilen tilbake (aldri en stille, delvis liste)', async () => {
    const m = miljo(); const f = fakeSporring(rader(2500), { feilPaaSide: 2 });
    const r = await m.hentAlleRader(f.lag);
    expect(r.data).toBeNull();
    expect(r.error.message).toBe('nett');
  });
  it('liten sidestørrelse virker likt', async () => {
    const m = miljo(); const f = fakeSporring(rader(7));
    expect((await m.hentAlleRader(f.lag, 3)).data).toHaveLength(7);
    expect(f.kall).toEqual([[0, 2], [3, 5], [6, 8]]);
  });
});

describe('vakt: loadFromSupabase henter de store tabellene uten gamle .limit()', () => {
  it('timer_entries, lagerhistorikk, ordrer og admin_ark går via hentAlleRader, og ingen .limit(300)/(500) gjenstår', () => {
    // kommentarene forklarer de gamle grensene, så bare kodelinjer sjekkes
    const kode = core.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(kode).not.toMatch(/\.limit\(300\)/);
    expect(kode).not.toMatch(/\.limit\(500\)/);
    for (const t of ['ordrer', 'timer_entries', 'lagerhistorikk', 'admin_ark']) {
      expect(kode).toContain("hentAlleRader(() => db.from('" + t + "')");
    }
  });
});
