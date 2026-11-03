import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';

// 2026-11-02: en ordre med vekter = {} (kolonnens default) tok ned Ordre-lista og Mer-fanen for ALLE. Eieren: «det er for mye
// viktig data i appen til at dette kan skje». Denne testen lukker FEILKLASSEN, ikke bare den ene kolonnen:
//  1) Den bygger en ordre slik databasen lager den når bare kolonne-defaultene brukes (SQL-funksjoner, edge-funksjoner,
//     migrasjoner og manuelle rader går utenom appens save()), ut fra et øyeblikksbilde av de FAKTISKE kolonnene
//     (test/fixtures/ordrer-kolonner.json, hentet fra information_schema; nattens QA sammenligner det med databasen).
//  2) Den setter så HVER kolonne, én om gangen, til hver verdi databasen tillater (NULL der kolonnen er nullable, tomt objekt,
//     tom liste, tom tekst), og kjører alle ordrevisningene. Ingen kombinasjon skal kaste eller logge en feil.
// Kalibrert: på koden fra før rettelsen (c6cedaf) kaster samme sele på «bare defaults»-raden i renderOrdreList og renderMer.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fasit = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/ordrer-kolonner.json'), 'utf8'));
const KOLONNER = fasit.kolonner;

const FULL_VEKTER = { totalvekt: { a: '', e: '', v: '' }, vogntog: { a: '', e: '', v: '' }, foraksel: { a: '', e: '', v: '' }, bakaksel: { a: '', e: '', v: '' } };

// Tolker kolonne-defaulten slik Postgres ville ga den. Ukjent default = testen feiler høyt, så en ny type default blir sett.
function defaultVerdi(k) {
  const d = k.default;
  if (d == null) {
    if (k.kolonne === 'id') return 'ord_TESTRAD';
    if (k.nullable) return null;
    throw new Error('NOT NULL-kolonnen ' + k.kolonne + ' mangler default - oppdater testen');
  }
  if (d === 'now()') return '2026-11-02T10:00:00+00:00';
  if (d === 'true') return true;
  if (d === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(d)) return Number(d);
  const tekst = d.match(/^'((?:[^']|'')*)'::(text|character varying)$/);
  if (tekst) return tekst[1].replace(/''/g, "'");
  const json = d.match(/^'(.*)'::jsonb?$/);
  if (json) return JSON.parse(json[1]);
  if (/^(public\.)?vekter_normalisert\(/.test(d)) return structuredClone(FULL_VEKTER);
  throw new Error('Ukjent kolonne-default for ' + k.kolonne + ': ' + d + ' - oppdater defaultVerdi() i testen');
}

// En leveranse (ordre uten bil, 2026-11-03) er en vanlig ordre-rad med ordretype = 'leveranse' og sine egne felt i jsonb-kolonnen `leveranse`. Alle bil-felt står på
// kolonne-defaultene (tomme), akkurat som for en leveranse opprettet i appen. Hver kolonne fuzzes for BEGGE typer.
const LEVERANSE_RAD = { ordretype: 'leveranse', ordre_status: 'under_arbeid', kunde: 'TEST - Kunde',
  leveranse: { merking: 'TEST-merking', adresse: 'Veien 1', postnr: '3734', sted: 'Skien', kontaktTlf: '12345678', fraktselskap: 'TEST-selskap', kolli: '2 pakker', onsketHentedato: '2026-11-10', sporing: '', sendtDato: '', fraktAuto: true } };
const TYPER = ['bil', 'leveranse'];
const defaultRad = (type = 'bil') => {
  const rad = Object.fromEntries(KOLONNER.map((k) => [k.kolonne, defaultVerdi(k)]));
  return type === 'leveranse' ? { ...rad, ...structuredClone(LEVERANSE_RAD) } : rad;
};

// Verdiene databasen faktisk tillater for en kolonne (ut over defaulten).
function varianter(k) {
  const v = [];
  if (k.nullable) v.push(['NULL', null]);
  if (k.type === 'jsonb') { v.push(['{}', {}]); v.push(['[]', []]); }
  if (k.type === 'text' || k.type === 'character varying') v.push(["''", '']);
  return v;
}

// Alle visninger som tegner ordrer. Parametere som trengs er felles og enkle; en ukjent funksjon hoppes over (og telles under).
const VISNINGER = [
  'renderOversikt', 'renderArkiv', 'renderMer', 'renderOrdreList', 'renderWeek', 'renderOrdreRapport', 'renderDetaljertOrdrerapport',
  'renderAarsStatistikk', 'renderFlaterListe', 'renderMaterialbehov', 'renderGlobalLavLagerVarsel', 'renderAdminHelsesjekk',
];
const LES_FUNKSJONER = ['tvangsflyt', 'tvangsflytBarHTML', 'tvangsflytBoksHTML'];

const app = lastApp();
// KJENT TESTMILJØ-SÆRTREKK (2026-11-03, årsak ikke funnet): avsluttes en vitest-fil mens `me` i appen er admin, dør worker-prosessen ved nedstenging («Worker exited unexpectedly»,
// minuttlange hang) selv om alle tester er grønne. Samme kode kjørt rett i Node (se scratchpad-skriptene) avslutter normalt. Derfor settes `me` tilbake til en vanlig ansatt
// etter hver kjøring (kjorAlle) og etter hver test som setter admin. Ikke fjern det uten å kjøre hele filen.

// Kjører alle visninger mot en ordre-rad. Returnerer en liste med feilbeskrivelser (tom = trygt).
function kjorAlle(rad, status, rolle = 'admin') {
  const feil = [];
  // Innlogget som admin (ser ALLE seksjoner: fakturering, kjøreseddel, bil-effektivitet, godkjenning) eller vanlig ansatt (ser mindre). Begge må tåle raden.
  app.settMe({ id: 1, navn: 'TEST - Bruker', rolle });
  let o;
  try { o = app.sandbox.dbToOrdre({ ...rad, status: status ?? rad.status }); }
  catch (e) { return ['dbToOrdre kastet: ' + e.message]; }
  app.S.ordrer = [o];
  app.S.flater = [];
  app.settAktivOrdre(null);
  for (const fn of VISNINGER) {
    if (typeof app.sandbox[fn] !== 'function') { feil.push(fn + ' finnes ikke (testen er utdatert)'); continue; }
    app.consoleFeil.length = 0;
    try { app.kjor(fn + '()'); } catch (e) { feil.push(fn + ' kastet: ' + e.message); continue; }
    if (app.consoleFeil.length) feil.push(fn + ' logget feil: ' + app.consoleFeil[0]);
  }
  for (const fn of LES_FUNKSJONER) {
    try { app.sandbox[fn](o); } catch (e) { feil.push(fn + ' kastet: ' + e.message); }
  }
  // Ordredetaljen (åpnes fra lista), og Realtime-banen med den samme raden som «gammel» og «ny».
  app.consoleFeil.length = 0;
  try { app.sandbox.openOrdre(o.id); } catch (e) { feil.push('openOrdre kastet: ' + e.message); }
  if (app.consoleFeil.length) feil.push('openOrdre logget feil: ' + app.consoleFeil[0]);
  // buildOrdreDetail fanger egne feil og skriver dem som tekst i detaljvisningen (ingen kast, ingen console.error), så det må sjekkes her.
  const detaljHtml = String(app.sandbox.document.getElementById('ordreDetail').innerHTML || '');
  const detaljFeil = detaljHtml.match(/Feil ved lasting av ordre: ([^<]*)/);
  if (detaljFeil) feil.push('ordredetaljen viser feil: ' + detaljFeil[1]);
  app.settAktivOrdre(null);
  try { app.sandbox.dbToOrdreFraRealtime(o, rad); } catch (e) { feil.push('dbToOrdreFraRealtime kastet: ' + e.message); }
  app.settMe({ id: 1, navn: 'TEST - Bruker', rolle: 'ansatt' }); // se kommentar under «Kjent testmiljø-særtrekk»
  return feil;
}

describe('oppsettet', () => {
  it('hele appen lastes uten feil i testmiljøet, og ordrevisningene finnes', () => {
    expect(app.lasteFeil).toEqual([]);
    for (const fn of [...VISNINGER, ...LES_FUNKSJONER, 'openOrdre', 'dbToOrdre', 'dbToOrdreFraRealtime']) {
      expect(typeof app.sandbox[fn], fn).toBe('function');
    }
  });

  it('øyeblikksbildet av ordrer-kolonnene er komplett nok til å være en fasit (id, vekter, utstyr, ombygging, dokumenter finnes)', () => {
    const navn = KOLONNER.map((k) => k.kolonne);
    for (const k of ['id', 'vekter', 'utstyr', 'ombygging', 'drivstoff', 'dokumenter', 'fiken_linjer', 'status', 'ordre_status']) expect(navn).toContain(k);
    expect(KOLONNER.length).toBeGreaterThan(60);
  });
});

for (const type of TYPER) {
  describe(`[${type}] en ordre slik databasen lager den når BARE kolonne-defaultene brukes`, () => {
    it('alle visninger tåler den (aktiv), som admin og som vanlig ansatt', () => {
      expect(kjorAlle(defaultRad(type), 'aktiv')).toEqual([]);
      expect(kjorAlle(defaultRad(type), 'aktiv', 'ansatt')).toEqual([]);
    });

    it('alle visninger tåler den (arkivert)', () => {
      expect(kjorAlle(defaultRad(type), 'arkivert')).toEqual([]);
    });

    it('en ordre med DE GAMLE defaultene (vekter = {}, fra før 2026-11-02) tåles også', () => {
      expect(kjorAlle({ ...defaultRad(type), vekter: {} }, 'aktiv')).toEqual([]);
    });
  });

  describe(`[${type}] hver kolonne, én om gangen, satt til hver verdi databasen tillater`, () => {
    const tilfeller = [];
    for (const k of KOLONNER) {
      if (k.kolonne === 'id') continue;
      for (const [navn, verdi] of varianter(k)) tilfeller.push({ k, navn, verdi });
    }

    it('det finnes mange tilfeller (testen tester faktisk noe)', () => {
      expect(tilfeller.length).toBeGreaterThan(60);
    });

    it('ingen kombinasjon av kolonne og tom/NULL-verdi får en visning til å kaste eller logge feil', () => {
      const funn = [];
      for (const t of tilfeller) {
        const rad = defaultRad(type);
        rad[t.k.kolonne] = t.verdi;
        for (const status of ['aktiv', 'arkivert']) {
          for (const rolle of ['admin', 'ansatt']) {
            const feil = kjorAlle(rad, status, rolle);
            if (feil.length) funn.push(`${t.k.kolonne} = ${t.navn} (status ${status}, ${rolle}): ${feil.join(' | ')}`);
          }
        }
      }
      expect(funn).toEqual([]);
    });
  });
}

// Leveranse-spesifikke former: feltene i jsonb-kolonnen med feil type, og fraktstatus (bestilt/ikke) - ingen visning skal kaste.
describe('[leveranse] uventet innhold i leveranse-kolonnen og fraktfeltene', () => {
  const former = [
    {}, [], 'tekst', 5, { merking: 5, adresse: null, postnr: [], sted: {}, fraktAuto: 'ja' },
    { merking: 'X', fraktselskap: 'Finnes ikke i Kontakter', adresse: '', fraktAuto: false },
    { merking: 'a'.repeat(2000), kolli: 'b'.repeat(2000) }, { __proto__: null, merking: 'X' },
    // pakker (vekt/mål) og fraktpris: feil type, tull og ekstreme verdier
    { kolliListe: {} }, { kolliListe: 'x' }, { kolliListe: [null, 5, 'x', [], { antall: 'x', vekt: -1, lengde: NaN, bredde: {}, hoyde: [] }] },
    { kolliListe: Array.from({ length: 200 }, () => ({ antall: 1e9, vekt: 1e9 })) }, { fraktPris: 'abc', fraktProduktnr: {} }, { fraktPris: -1, fraktProduktnr: [] }, { fraktPris: 1e308 },
  ];
  it('alle visninger tåler hver form for kolonnen leveranse', () => {
    const funn = [];
    for (const f of former) {
      const feil = kjorAlle({ ...defaultRad('leveranse'), leveranse: f }, 'aktiv');
      if (feil.length) funn.push(JSON.stringify(f).slice(0, 80) + ': ' + feil.join(' | '));
    }
    expect(funn).toEqual([]);
  });
  it('en leveranse med fraktbestilling sendt (frakt_bestilt_*) og med ugyldig tidspunkt tåles', () => {
    for (const at of ['2026-11-03T10:00:00+00:00', 'ikke-en-dato', '']) {
      expect(kjorAlle({ ...defaultRad('leveranse'), frakt_bestilt_at: at, frakt_bestilt_av: 'TEST', frakt_bestilt_til: 'x@y.z' }, 'aktiv')).toEqual([]);
    }
  });
  it('alle ordrestatuser (også de som ikke hører til typen) tåles på begge typer', () => {
    for (const type of TYPER) {
      for (const st of ['paa_vei', 'ikke_paabegynt', 'paabegynt', 'hentet', 'under_arbeid', 'klar_sending', 'sendt', 'ukjent', '']) {
        expect(kjorAlle({ ...defaultRad(type), ordre_status: st }, 'aktiv')).toEqual([]);
      }
    }
  });
});

describe('[leveranse] selve visningene bruker leveransens egen tegning (ikke bil-kortet)', () => {
  it('ordrekortet og detaljen viser merking, LEVERANSE og fraktfelt, og ingen bil-seksjoner', () => {
    const rad = defaultRad('leveranse');
    expect(kjorAlle(rad, 'aktiv')).toEqual([]);
    app.S.ordrer = [app.sandbox.dbToOrdre(rad)];
    app.kjor('renderOrdreList()');
    const kort = String(app.sandbox.document.getElementById('ordreListeResultat').innerHTML);
    expect(kort).toContain('LEVERANSE');
    expect(kort).toContain('TEST-merking');
    expect(kort).not.toContain('tvangsflyt'.toUpperCase());
    app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' }); // Fakturering-kortet er bare for admin
    app.sandbox.openOrdre(rad.id);
    const detalj = String(app.sandbox.document.getElementById('ordreDetail').innerHTML);
    expect(detalj).toContain('Kunde og merking');
    expect(detalj).toContain('Veien 1');
    expect(detalj).toContain('Fakturering');
    expect(detalj).not.toContain('Vekter (kg)');
    expect(detalj).not.toContain('Bilder – Ankomst');
    app.settAktivOrdre(null);
    app.settMe({ id: 1, navn: 'TEST - Bruker', rolle: 'ansatt' }); // aldri avslutt en testfil som admin (se kjorAlle)
  });
});
