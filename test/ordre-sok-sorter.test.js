import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';

// Ordre-siden (Henrik 2026-11-19): «det må være mulig å sortere etter hengerfeste på ordre siden og det må være mulig å søke etter forhandler.nr».
// Sortering «Hengerfeste først» (biler med hengerfeste øverst, den vanlige rekkefølgen innenfor hver gruppe) og søk på utstyr.forhandlerNr i Ordre-lista.

const app = lastApp();
const { sandbox, S } = app;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.resolve(__dirname, '../salmakern.html'), 'utf8').replace(/\r\n/g, '\n');

const el = (id) => sandbox.document.getElementById(id);
const resultat = () => String(el('ordreListeResultat').innerHTML);
const tegn = () => { app.kjor('renderOrdreList()'); return resultat(); };

const UTSTYR = { har: '', skalHa: '', hengerfeste: 'ikke_hengerfeste', hengerfesteMontert: 'ikke_montert', hengerfesteBestilt: 'ikke_bestilt', skalHaBekreftet: false };
const bil = (id, chassis, ankomst, utstyr = {}, ekstra = {}) => sandbox.dbToOrdre({
  id, status: 'aktiv', ordre_status: 'ikke_paabegynt', chassis, regnr: '', kunde: 'TEST Kunde AS', ankomstdato: ankomst, utstyr: { ...UTSTYR, ...utstyr }, ...ekstra,
});
// Plasseringen i den tegnede lista, i rekkefølgen kortene står.
const rekkefolge = (h, chassisListe) => chassisListe.map((c) => [c, h.indexOf(c)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([c]) => c);

const A = 'TESTSORTA0000000A', B = 'TESTSORTB0000000B', C = 'TESTSORTC0000000C', D = 'TESTSORTD0000000D';

beforeEach(() => {
  S.ordrer = []; S.kontakter = []; S.ansatte = [];
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  app.settAktivOrdre(null);
  app.settDb(null);
  el('ordreStatusFilter').value = '';
  el('ordreSok').value = '';
  el('ordreSorterValg').value = '';
});
afterEach(() => { el('ordreSok').value = ''; el('ordreSorterValg').value = ''; el('ordreStatusFilter').value = ''; });

describe('Ordre-siden: sortering «Hengerfeste først»', () => {
  beforeEach(() => {
    // Ankomst stigende: A, B, C, D (samme status, så den vanlige rekkefølgen er A, B, C, D). B og D har hengerfeste.
    S.ordrer = [
      bil('ord_TSORT1', A, '2026-11-01'),
      bil('ord_TSORT2', B, '2026-11-02', { hengerfeste: 'hengerfeste' }),
      bil('ord_TSORT3', C, '2026-11-03'),
      bil('ord_TSORT4', D, '2026-11-04', { hengerfeste: 'hengerfeste' }),
    ];
  });

  it('standard rekkefølge er uendret (A, B, C, D), og nyeste først er uendret (D, C, B, A)', () => {
    expect(rekkefolge(tegn(), [A, B, C, D])).toEqual([A, B, C, D]);
    el('ordreSorterValg').value = 'nyest';
    expect(rekkefolge(tegn(), [A, B, C, D])).toEqual([D, C, B, A]);
  });

  it('«Hengerfeste først»: bilene med hengerfeste øverst (B, D), så resten (A, C), vanlig rekkefølge innenfor hver gruppe', () => {
    el('ordreSorterValg').value = 'hengerfeste';
    expect(rekkefolge(tegn(), [A, B, C, D])).toEqual([B, D, A, C]);
  });

  it('prioritert og status teller fortsatt innenfor gruppen: en prioritert bil uten hengerfeste står øverst blant dem uten, og alle har med hengerfeste foran', () => {
    S.ordrer.find((o) => o.id === 'ord_TSORT3').prioritert = true; // C: uten hengerfeste, prioritert
    S.ordrer.find((o) => o.id === 'ord_TSORT4').prioritert = true; // D: med hengerfeste, prioritert
    el('ordreSorterValg').value = 'hengerfeste';
    expect(rekkefolge(tegn(), [A, B, C, D])).toEqual([D, B, C, A]);
  });

  it('en bil uten utstyr-objekt eller med ukjent hengerfeste-verdi regnes som uten hengerfeste og kaster ikke', () => {
    S.ordrer.push(bil('ord_TSORT5', 'TESTSORTE0000000E', '2026-11-05', { hengerfeste: 'noe-annet' }));
    S.ordrer.find((o) => o.id === 'ord_TSORT1').utstyr = null;
    el('ordreSorterValg').value = 'hengerfeste';
    const h = tegn();
    expect(h).not.toContain('Ordren kan ikke vises');
    expect(rekkefolge(h, [A, B, C, D, 'TESTSORTE0000000E'])).toEqual([B, D, A, C, 'TESTSORTE0000000E']);
  });

  it('sorteringen virker sammen med søk og statusfilter (bare treff vises, fortsatt med hengerfeste først)', () => {
    el('ordreSorterValg').value = 'hengerfeste';
    el('ordreSok').value = 'testsort';
    expect(rekkefolge(tegn(), [A, B, C, D])).toEqual([B, D, A, C]);
    el('ordreSok').value = 'testsortc';
    expect(rekkefolge(tegn(), [A, B, C, D])).toEqual([C]);
  });

  it('en «kun ekstrautstyr»-ordre regnes ikke med hengerfeste (hengerfeste vises ikke for den): den står i vanlig rekkefølge blant dem uten, ikke øverst', () => {
    // K er merket «kun ekstrautstyr» etter at hengerfeste var valgt: verdien står igjen i dataene, men kortet og ordredetaljen skjuler den (funnet i den uavhengige gjennomgangen 19.11).
    const K = 'TESTSORTK0000000K';
    S.ordrer = [
      bil('ord_TSORT1', A, '2026-11-01'),
      bil('ord_TSORT2', B, '2026-11-02', { hengerfeste: 'hengerfeste' }),
      bil('ord_TSORT6', K, '2026-11-03', { hengerfeste: 'hengerfeste' }, { kun_ekstrautstyr: true }),
    ];
    expect(sandbox.hengerfesteKortHTML(S.ordrer[2])).toBe(''); // ikke vist for en kun-ordre
    el('ordreSorterValg').value = '';
    expect(rekkefolge(tegn(), [A, B, K])).toEqual([A, B, K]);
    el('ordreSorterValg').value = 'hengerfeste';
    expect(rekkefolge(tegn(), [A, B, K])).toEqual([B, A, K]);
  });

  it('kontroll: den samme ordren uten kun-flagget og med hengerfeste står blant dem med hengerfeste', () => {
    const K = 'TESTSORTK0000000K';
    S.ordrer = [
      bil('ord_TSORT1', A, '2026-11-01'),
      bil('ord_TSORT2', B, '2026-11-02', { hengerfeste: 'hengerfeste' }),
      bil('ord_TSORT6', K, '2026-11-03', { hengerfeste: 'hengerfeste' }),
    ];
    el('ordreSorterValg').value = 'hengerfeste';
    expect(rekkefolge(tegn(), [A, B, K])).toEqual([B, K, A]);
  });

  it('valget finnes i nedtrekket i salmakern.html', () => {
    const sorter = html.slice(html.indexOf('id="ordreSorterValg"'));
    expect(sorter.slice(0, sorter.indexOf('</select>'))).toContain('<option value="hengerfeste">Hengerfeste først</option>');
  });
});

describe('Ordre-siden: søk på forhandler.nr', () => {
  beforeEach(() => {
    S.ordrer = [
      bil('ord_TSOK1', A, '2026-11-01', { forhandlerNr: 'F-4711' }),
      bil('ord_TSOK2', B, '2026-11-02', { forhandlerNr: '88220' }),
      bil('ord_TSOK3', C, '2026-11-03'),
    ];
  });

  it('treffer hele og deler av forhandler.nr, uavhengig av store/små bokstaver, og bare ordren med nummeret', () => {
    for (const sok of ['F-4711', 'f-4711', '4711', ' f-47 ']) {
      el('ordreSok').value = sok;
      expect(rekkefolge(tegn(), [A, B, C]), 'søk: «' + sok + '»').toEqual([A]);
    }
    el('ordreSok').value = '88220';
    expect(rekkefolge(tegn(), [A, B, C])).toEqual([B]);
  });

  it('søk uten treff på forhandler.nr gir «Ingen ordrer matcher søket»', () => {
    el('ordreSok').value = '99999';
    const h = tegn();
    expect(h).toContain('Ingen ordrer matcher søket');
    expect(rekkefolge(h, [A, B, C])).toEqual([]);
  });

  it('en ordre uten forhandler.nr treffes ikke av tomt-lignende søk, og de eksisterende søkefeltene virker fortsatt (kunde, chassis)', () => {
    el('ordreSok').value = 'test kunde';
    expect(rekkefolge(tegn(), [A, B, C])).toEqual([A, B, C]);
    el('ordreSok').value = 'testsortb';
    expect(rekkefolge(tegn(), [A, B, C])).toEqual([B]);
  });

  it('et tall (ikke tekst) i forhandler.nr fra databasen kaster ikke og lista blir ikke blank', () => {
    S.ordrer.find((o) => o.id === 'ord_TSOK2').utstyr.forhandlerNr = 88220; // rå JSON kan ha et tall
    el('ordreSok').value = '8822';
    const h = tegn();
    expect(h).not.toContain('Ordren kan ikke vises');
    expect(rekkefolge(h, [A, B, C])).toEqual([B]);
  });

  it('feltet står i søketeksten i salmakern.html', () => {
    expect(html).toMatch(/id="ordreSok"[^>]*placeholder="[^"]*forhandler\.nr/);
  });
});
