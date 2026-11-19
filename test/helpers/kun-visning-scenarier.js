// Felles scenarier for «Kun ekstrautstyr: enklere ordre» (Henrik 2026-11-19). Bygger HTML-referanser for VANLIGE bil-ordrer og leveranser (alt som ikke
// skal endres av «kun ekstrautstyr»-visningen) ved å kjøre den ekte appen i testriggen (test/helpers/app-harness.js).
//
// Fixturen test/fixtures/kun-visning-referanse-vanlig.json er laget av DENNE fila mot koden på origin/main 8f6f52d (FØR visningen ble endret), og
// test/kun-ekstrautstyr-visning.test.js bygger de samme referansene mot den nye koden og krever byte-lik HTML. Fila bruker bare funksjoner som fantes
// før endringen, så den kan kjøres mot gammel kode (se «Slik lages fixturen på nytt» i testens topp). Klokka er fryst (frysTid) og alle tidspunkt i
// dataene er bygd i lokal tid, så HTML-en er lik i alle tidssoner (kontrollert i Europe/Oslo, UTC og America/Los_Angeles). Normaliseringen er bevisst
// minimal: bare ting som ikke kan være like fra gang til gang (tilfeldige fakturalinje-id-er).

export const ID_VANLIG = 'ord_1700000000000';
export const ID_ENKEL = 'ord_1700000000001';
export const ID_KLAR = 'ord_1700000000002';
export const ID_LEVERANSE = 'ord_1700000000003';
export const ID_NY = 'ord_1700000000004';
export const ID_FLAATE_PRIMAER = 'ord_1700000000005';

const BILDE = (side, i) => `https://eksempel.test/storage/v1/object/public/bilder/TEST/${side}_${i}.jpg`;

export function vanligRad(over = {}) {
  return {
    id: ID_VANLIG, status: 'aktiv', ordre_status: 'paabegynt', ordretype: 'bil',
    regnr: 'AB12345', chassis: 'TESTWXYZ0000000V1', kunde: 'TEST Forhandler AS', eier: 'TEST Kontaktperson',
    merke: 'KIA', modell: 'EV9', type: 'GT-Line', variant: 'AWD', versjon: '7-seter', farge: 'Hvit', ankomstdato: '2026-11-10',
    created_at: '2023-11-14T22:13:20Z',
    vekter: { totalvekt: { a: '3000', e: '3010', v: '3005' }, vogntog: { a: '5000', e: '5000', v: '' }, foraksel: { a: '1500', e: '1500', v: '1490' }, bakaksel: { a: '1500', e: '1510', v: '1515' } },
    drivstoff: { totalpris: '1000', satsId: 'sats1' },
    utstyr: { har: '', skalHa: '501\nGummimatte', forhandlerNr: '12345', hengerfeste: 'hengerfeste', hengerfesteMontert: 'ikke_montert', hengerfesteBestilt: 'ikke_bestilt', skalHaBekreftet: false },
    bilder_ankomst: [BILDE('a', 0), BILDE('a', 1), null, null, null, null],
    bilder_levering: [BILDE('l', 0), null, null, null, null, null],
    bilder_avstand_skader: [BILDE('s', 0), null, null],
    bilder_manglende_deler: [BILDE('m', 0), BILDE('m', 1)],
    ansatte_signert: [{ id: 1, navn: 'TEST - Admin', tid: '08:00' }],
    endringer: [{ av: 'TEST - Admin', tid: '10.11.2026, 08:00:00', txt: 'Ordre opprettet' }, { av: 'TEST - Admin', tid: '10.11.2026, 08:05:00', txt: 'TEST - Admin meldt på' }],
    utstyr_sjekkliste: [{ punkt: 'Panorama glasstak', ok: true }, { punkt: 'Gummimatte', ok: false }],
    utstyr_mal_navn: 'TEST EV9-mal', flate_id: 'flate_1',
    dokumenter: [{ navn: 'Fullmakt.pdf', url: 'https://eksempel.test/storage/v1/object/public/ordre-dokumenter/TEST/Fullmakt.pdf', lastetOppAv: 'TEST', dato: '2026-11-01T10:00:00Z' }],
    coc: 'har', fullmakt: 'har', typegodkjenning: 'e4*2018/858*00178*04', egenvekt_coc: '2500', forhandler_orgnr: '984993188',
    tid_biltilsynet: '2026-11-20', tid_biltilsynet_tid: '10:00', tid_biltilsynet_sted: 'Skien',
    diagnose: true, diagnose_av: 'TEST - Admin',
    fiken_linjer: [{ id: 'fl_a', produktnummer: '500', antall: 1 }, { id: 'fl_b', produktnummer: '21', antall: 1, belop: 800 }],
    notater: 'TEST notat', ombygging: { nyttKjoretoy: true, bruktKjoretoy: false, lafinto: false, personbil: false },
    ordre_timer_sessions: [{ id: 's1', ansattId: 1, ansattNavn: 'TEST - Admin', start: new Date(2026, 10, 10, 9, 0, 0).getTime(), stopp: new Date(2026, 10, 10, 11, 0, 0).getTime() }], // lokal tid: samme tekst i alle tidssoner
    ...over,
  };
}

// Setter opp tilstanden alle scenariene bygger på. Kalles én gang per app (nullstiller det som scenariene leser).
export function settOppTilstand(app) {
  const { S, sandbox } = app;
  S.ordrer = []; S.ansatte = []; S.lagerOppskrifter = []; S.lagerhistorikk = []; S.lagervarer = []; S.adminArk = []; S.utstyrMaler = [];
  S.kontakter = [{ id: 'k1', type: 'Forhandler', navn: 'TEST Forhandler AS', orgnr: '984993188', forhandlerNr: '12345', kontaktpersoner: [{ navn: 'TEST Kontaktperson' }] }];
  S.drivstoffSatser = [{ id: 'sats1', navn: 'TEST sats', type: 'kr_rabatt', verdi: 100 }];
  S.flater = [{ id: 'flate_1', flatenummer: 'TEST-FLÅTE-1', primaerOrdreId: ID_VANLIG }];
  S.portalProdukter = [];
  void sandbox;
}

// Samler innerHTML fra alle elementer appen skrev til mens `fn` kjørte (testriggens DOM er stubber; getElementById lager dem ved behov).
export function medOpptak(app, fn) {
  const doc = app.sandbox.document;
  const orig = doc.getElementById;
  const sett = new Map();
  doc.getElementById = (id) => { const el = orig(id); sett.set(id, el); return el; };
  try { fn(); } finally { doc.getElementById = orig; }
  return Object.fromEntries([...sett.entries()].filter(([, el]) => el && typeof el.innerHTML === 'string' && el.innerHTML).sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, el]) => [id, el.innerHTML]));
}

const NORMALISER = [
  [/fl_\d{10,}_[a-z0-9]{5}/g, 'fl_NORMALISERT'], // nyFikenLinjeId(): tidsstempel + tilfeldig
];
export function normaliser(tekst) {
  return NORMALISER.reduce((t, [re, ut]) => t.replace(re, ut), String(tekst));
}

function laOrdre(app, rad) {
  const o = app.sandbox.dbToOrdre(rad);
  app.S.ordrer.push(o);
  return o;
}

// Fryser klokka i appen (kalenderen tegner «nå»-streken og uken ut fra dagens dato og klokkeslett). Lokal tid, så resultatet ikke avhenger av tidssonen.
export function frysTid(app, aar = 2026, maaned = 10, dag = 19, time = 10) {
  const fast = new Date(aar, maaned, dag, time, 0, 0).getTime();
  class FastDate extends Date {
    constructor(...a) { if (a.length === 0) super(fast); else super(...a); }
    static now() { return fast; }
  }
  app.sandbox.Date = FastDate;
}

// Bygger alle referansene. Rekkefølgen og navnene er en del av fixturen: legg til nye helt til slutt.
export function byggReferanser(app) {
  const { sandbox, S } = app;
  const ut = {};
  frysTid(app);
  settOppTilstand(app);
  const detalj = (navn, rolle, o) => {
    app.settMe({ id: 1, navn: 'TEST - ' + rolle, rolle });
    app.settAktivOrdre(o.id);
    ut[navn] = medOpptak(app, () => sandbox.buildOrdreDetail());
  };

  const vanlig = laOrdre(app, vanligRad());
  const enkel = laOrdre(app, { id: ID_ENKEL, status: 'aktiv', ordre_status: 'ikke_paabegynt', chassis: 'TESTWXYZ0000000V2', created_at: '2023-11-14T22:13:20Z' });
  const klar = laOrdre(app, vanligRad({ id: ID_KLAR, chassis: 'TESTWXYZ0000000V3', ordre_status: 'klar_henting', godkjent: true, godkjenner_navn: 'TEST - Admin', flate_id: null, fakturert: false, diagnose: false }));
  const ny = laOrdre(app, vanligRad({ id: ID_NY, chassis: 'TESTWXYZ0000000V4', created_at: '2026-11-18T08:00:00Z', ordre_status: 'ikke_paabegynt', flate_id: null }));
  const lev = laOrdre(app, {
    id: ID_LEVERANSE, status: 'aktiv', ordre_status: 'under_arbeid', ordretype: 'leveranse', kunde: 'TEST Kunde AS', eier: 'TEST Kontakt',
    leveranse: { merking: 'TEST-pakke', adresse: 'Testveien 1', postnr: '3700', sted: 'Skien', fraktselskap: 'TEST Frakt', kolliListe: [{ antall: 1, vekt: 10, lengde: 50, bredde: 40, hoyde: 30 }] },
    fiken_linjer: [{ id: 'fl_x', produktnummer: '2402', antall: 1 }],
  });
  S.ordrer.forEach((o) => { void o; });

  // 1) Ordredetaljen (hele HTML-en og alle delkortene appen tegner ved siden av)
  detalj('detaljAdmin', 'admin', vanlig);
  detalj('detaljAnsatt', 'ansatt', vanlig);
  detalj('detaljGodkjenner', 'godkjenner', klar);
  detalj('detaljEnkel', 'admin', enkel);
  detalj('detaljNyAdmin', 'admin', ny);
  detalj('detaljLeveranse', 'admin', lev);

  // 2) Statusnedtrekket for en vanlig bil og en leveranse, for hver mulig status
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  ut.statusDropdownBil = app.kjor('STATUSER').map((s) => sandbox.statusDropdown(vanlig.id, s.id));
  ut.statusDropdownBilEkstra = sandbox.statusDropdown(vanlig.id, 'paabegynt', 'font-size:13px', 'ordre-status-dropdown');
  ut.statusDropdownLeveranse = app.kjor('LEVERANSE_STATUSER').map((s) => sandbox.statusDropdown(lev.id, s.id));

  // 3) Fakturalinjer, Tvangsflyt og Skal på bilen
  ut.fikenLinjer = sandbox.fikenLinjerHTML(vanlig);
  ut.fikenLinjerLeveranse = sandbox.fikenLinjerHTML(lev);
  ut.tvangsflyt = sandbox.tvangsflytBoksHTML(vanlig);
  ut.tvangsflytKlar = sandbox.tvangsflytBoksHTML(klar);
  S.portalProdukter = [{ modell_slug: 'kia-ev9', fiken_nummer: '501', navn: 'Takluke', portal_id: 'p501', type: 'tillegg', nummer_status: 'ok', velges_nar: ['Panorama glasstak'] }];
  ut.skalPaaBilen = sandbox.skalPaaBilenHTML(ny);
  ut.skalPaaBilenTom = sandbox.skalPaaBilenHTML(laOrdre(app, vanligRad({ id: 'ord_1700000000006', chassis: 'TESTWXYZ0000000V5', created_at: '2026-11-18T08:00:00Z', utstyr_sjekkliste: [], ombygging: { nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false } })));
  S.portalProdukter = [];

  // 4) Ordre-lista og Oversikt (kortene bruker statusDropdown, drivstoff, hengerfeste m.m.)
  app.settAktivOrdre(null);
  ut.ordreListe = medOpptak(app, () => sandbox.renderOrdreList());
  ut.oversikt = medOpptak(app, () => sandbox.renderOversikt());

  return JSON.parse(normaliser(JSON.stringify(ut)));
}
