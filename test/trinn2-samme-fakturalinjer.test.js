// BEVIS for trinn 2 av «Én produktliste»: ombyggingslinjene på fakturaen blir NØYAKTIG de samme som før, for alle tenkelige ordre.
// Den gamle koden (js/ordre-detalj.js fra main 120d5ce, før trinn 2) og den nye kjøres side om side i hver sin vm-context mot samme
// ordre, og fikenLinjer etter synkroniserOmbyggingFikenLinjer() må være like. Den nye får portalens FAKTISKE roller slik de ble skrevet
// 17.11 (test/fixtures/portal-produkt-roller-2026-11-17.json). Alle ordre er syntetiske: hver modell (fritekst og portal-slug fra
// portal_modell_kobling), hver kombinasjon av Nytt/Brukt/Lafinto/Personbil, og fakturalinjer som tom, med gammel linje, med rabattlinje
// og med et annet produkt fra før. Ingen ekte data.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (p) => readFileSync(path.resolve(__dirname, p), 'utf8');
const GAMMEL = les('fixtures/ordre-detalj-for-trinn2.js');
const NY = les('../js/ordre-detalj.js');
const LAGER = les('../js/lager.js');
const ROLLER = JSON.parse(les('fixtures/portal-produkt-roller-2026-11-17.json'));
const KOBLING = [...les('../supabase/migrations/20261030220000_portal_modell_kobling_seed.sql').matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*'([^']+)'/g)]
  .map(([, slug, merke, modell]) => ({ portal_modell_slug: slug, merke, modell }));

function miljo(kode, roller) {
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    document: { addEventListener() {}, getElementById() { return null; } }, window: { addEventListener() {} },
    S: { ordrer: [], fikenKundeAlias: [], fikenKundeRabatt: [], portalModellKobling: KOBLING, portalProduktRoller: roller },
    activeOrdreId: null, me: null, save() {}, planleggLocalSpeiling() {}, db: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox);
  vm.runInContext(LAGER, sandbox);
  return sandbox;
}
const gammel = miljo(GAMMEL, undefined);
const ny = miljo(NY, ROLLER);

const BILER = [
  ...[['KIA', 'EV9'], ['Land Rover', 'Discovery 5'], ['Land Rover', 'Defender 110'], ['Mercedes-Benz', 'Geländewagen'], ['Mercedes-Benz', 'GLS'],
    ['Mercedes-Benz', 'Vito'], ['Mercedes-Benz', 'EQV'], ['Mercedes-Benz', 'V-Klasse'], ['VW', 'ID.Buzz'], ['KGM', 'Rexton'],
    ['Toyota', 'Land Cruiser 150'], ['Toyota', 'Land Cruiser 250'], ['Dodge', 'Durango'], ['Toyota', 'Yaris'], ['', '']].map(([merke, modell]) => ({ merke, modell, slug: undefined })),
  ...KOBLING.map((k) => ({ merke: 'skrivefeil', modell: 'skrivefeil', slug: k.portal_modell_slug })),
];
const BOKSER = [];
for (let i = 0; i < 16; i++) BOKSER.push({ nyttKjoretoy: !!(i & 1), bruktKjoretoy: !!(i & 2), lafinto: !!(i & 4), personbil: !!(i & 8) });
const START = [[], [{ produktnummer: '503', antall: 1 }], [{ produktnummer: '500', antall: 1 }], [{ produktnummer: '2400', antall: 1, rabatt: 20 }],
  [{ produktnummer: '524', antall: 1 }, { produktnummer: '2401', antall: 1 }], [{ produktnummer: '1600', antall: 2 }]];

function kjør(env, bil, bokser, start) {
  const o = { id: 'ord_TEST', merke: bil.merke, modell: bil.modell, portalModellSlug: bil.slug, ombygging: { ...bokser }, fikenLinjer: JSON.parse(JSON.stringify(start)) };
  env.S.ordrer = [o];
  env.activeOrdreId = o.id;
  env.synkroniserOmbyggingFikenLinjer(o);
  env.synkroniserOmbyggingFikenLinjer(o); // to ganger: må være stabil
  return JSON.stringify(o.fikenLinjer);
}

// Den ENESTE tilsiktede forskjellen etter trinn 2 (Henrik 2026-11-20, «Rexton dobbel ombygging»): står den ene Rexton-varianten
// (2400/2401) med FROSSET rabatt, legges den andre aldri til ved siden av. Den gamle koden la den til (to varianter av samme
// ombygging på én faktura). Et avvik godtas bare når den nye lista er nøyaktig den gamle UTEN den ufrosne andre varianten.
function tilsiktetRextonAvvik(gammelJson, nyJson) {
  const g = JSON.parse(gammelJson), n = JSON.parse(nyJson);
  const nr = (l) => String(l.produktnummer);
  const frosset = (x) => g.some((l) => nr(l) === x && typeof l.rabatt === 'number');
  if (!g.some((l) => nr(l) === '2400') || !g.some((l) => nr(l) === '2401')) return false;
  const vinner = frosset('2400') ? '2400' : frosset('2401') ? '2401' : null;
  if (!vinner) return false;
  const taper = vinner === '2400' ? '2401' : '2400';
  return JSON.stringify(g.filter((l) => !(nr(l) === taper && typeof l.rabatt !== 'number'))) === nyJson && !n.some((l) => nr(l) === taper);
}

describe('trinn 2: samme fakturalinjer som før for alle ordre', () => {
  it(`${BILER.length} biler x ${BOKSER.length} avkrysninger x ${START.length} utgangstilstander gir identiske linjer`, () => {
    let antall = 0, tilsiktet = 0;
    const avvik = [];
    for (const bil of BILER) for (const b of BOKSER) for (const s of START) {
      antall++;
      const a = kjør(gammel, bil, b, s), n = kjør(ny, bil, b, s);
      if (a === n) continue;
      if (tilsiktetRextonAvvik(a, n)) { tilsiktet++; continue; }
      avvik.push({ bil, b, s, gammel: a, ny: n });
    }
    expect(antall).toBeGreaterThan(2500);
    expect(avvik.slice(0, 3)).toEqual([]);
    expect(tilsiktet).toBeGreaterThan(0); // Rexton med frosset 2400 og Lafinto huket av finnes i matrisen
  });

  it('og «mangler Fiken-modell»-varselet og faktura-sjekken gir samme svar', () => {
    for (const bil of BILER) {
      const o = { merke: bil.merke, modell: bil.modell, portalModellSlug: bil.slug };
      const kanG = gammel.kanoniskMerkeModell(o), kanN = ny.kanoniskMerkeModell(o);
      expect(!!ny.finnFikenOmbyggingModell(kanN.merke, kanN.modell, o.portalModellSlug), JSON.stringify(bil)).toBe(!!gammel.finnFikenOmbyggingModell(kanG.merke, kanG.modell));
    }
  });

  it('kontroll: testen fanger en forskjell (portalen med et annet nummer gir avvik på en ny ordre)', () => {
    const endret = miljo(NY, ROLLER.map((r) => (r.modell_slug === 'kia-ev9' && r.app_rolle === 'ombygging' ? { ...r, fiken_nummer: '599' } : r)));
    const bil = { merke: 'KIA', modell: 'EV9' };
    expect(kjør(endret, bil, BOKSER[1], [])).not.toBe(kjør(gammel, bil, BOKSER[1], []));
  });
});
