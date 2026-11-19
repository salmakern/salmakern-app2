// Scenarier for «Kun ekstrautstyr: rydd de andre stedene» (Henrik 2026-11-19, «Ja, rydd alle»). Bygger HTML for stedene UTENFOR ordredetaljen som viste de skjulte tingene
// (variant, farge, type, drivstoff, biltilsynssted, utstyrssjekklista, vekter, dokumenter m.m.): Arkiv-lista, kalenderkortene og Oversikt-kortene, Ordre-lista,
// kundehistorikken og PDF-rapporten. Den ekte appen kjøres i testriggen (test/helpers/app-harness.js), og klokka er fryst (frysTid), så HTML-en er lik i alle tidssoner.
//
// Fixturen test/fixtures/kun-rydd-referanse-vanlig.json er laget av DENNE fila mot koden på origin/main 9fef219 (FØR stedene ble ryddet), og test/kun-ekstrautstyr-rydd.test.js
// bygger de samme referansene mot den nye koden og krever byte-lik HTML for vanlige bil-ordrer og leveranser. Fila bruker bare funksjoner som fantes før endringen.
// Slik lages fixturen på nytt (bare hvis en vanlig ordre bevisst skal se annerledes ut): sjekk ut koden som skal være fasit i en mappe UTENFOR arbeidstreet
// (`git archive <commit> | tar -x -C <mappe>`), kjør `byggRyddReferanser(lastApp(<mappe>))` herfra og skriv resultatet med JSON.stringify(ref, null, 1).

import { vanligRad, medOpptak, frysTid, settOppTilstand, normaliser } from './kun-visning-scenarier.js';

export const R_AKTIV = 'ord_1700000000100';
export const R_VENTER = 'ord_1700000000101';
export const R_ARKIVERT = 'ord_1700000000102';
export const R_ARKIVERT_FAKT = 'ord_1700000000103';
export const R_LEVERANSE = 'ord_1700000000104';
export const R_SMALT_1 = 'ord_1700000000105';
export const R_SMALT_2 = 'ord_1700000000106';
export const KUNDE = 'TEST Forhandler AS';

// Radene i databaseform. Hver rad har sin egen biltilsynssted/farge/variant/type, så en test kan se hvilken som er (ikke) tegnet.
export function ryddRader() {
  const ingenOmbygging = { nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false };
  return [
    vanligRad({ id: R_AKTIV, regnr: 'AB10001', chassis: 'TESTWXYZ0000000R1', ordre_status: 'paabegynt', kalender_dato: '2026-11-19', kalender_tid: '10:00', tid_biltilsynet_sted: 'Skien', farge: 'Hvit', type: 'GT-Line', variant: 'AWD' }),
    vanligRad({ id: R_VENTER, regnr: 'AB10002', chassis: 'TESTWXYZ0000000R2', ordre_status: 'ikke_paabegynt', kalender_dato: '2026-11-18', kalender_tid: '11:00', tid_biltilsynet_sted: 'Drammen', farge: 'Sort', type: 'Earth', variant: 'RWD', flate_id: null }),
    vanligRad({ id: R_ARKIVERT, regnr: 'AB10003', chassis: 'TESTWXYZ0000000R3', status: 'arkivert', ordre_status: 'hentet', godkjent: true, godkjenner_navn: 'TEST - Admin', fakturert: false, ankomstdato: '2026-09-02', farge: 'Sort', type: 'Arkivtype', variant: 'Arkivvariant', flate_id: null, kalender_dato: null, tid_biltilsynet_sted: 'Tønsberg' }),
    vanligRad({ id: R_ARKIVERT_FAKT, regnr: 'AB10004', chassis: 'TESTWXYZ0000000R4', status: 'arkivert', ordre_status: 'hentet', godkjent: true, godkjenner_navn: 'TEST - Admin', fakturert: true, ankomstdato: '2026-08-02', farge: '', type: '', variant: '', drivstoff: {}, flate_id: null, kalender_dato: null }),
    {
      id: R_LEVERANSE, status: 'aktiv', ordre_status: 'under_arbeid', ordretype: 'leveranse', kunde: KUNDE, eier: 'TEST Kontakt', farge: 'Rød', type: 'LEVTYPE', variant: 'LEVVARIANT',
      kalender_dato: '2026-11-19', kalender_tid: '13:00', tid_biltilsynet_sted: 'Skien', drivstoff: { totalpris: '500', satsId: 'sats1' },
      leveranse: { merking: 'TEST-pakke', adresse: 'Testveien 1', postnr: '3700', sted: 'Skien', fraktselskap: 'TEST Frakt', kolliListe: [{ antall: 1, vekt: 10, lengde: 50, bredde: 40, hoyde: 30 }] },
      fiken_linjer: [{ id: 'fl_x', produktnummer: '2402', antall: 1 }], created_at: '2023-11-14T22:13:20Z',
    },
    // To biler samtidig i kalenderen: de smale kortene har egen kode (sted vises ikke), og de skal også være uendret.
    vanligRad({ id: R_SMALT_1, regnr: 'AB10005', chassis: 'TESTWXYZ0000000R5', ordre_status: 'paabegynt', kalender_dato: '2026-11-20', kalender_tid: '14:00', tid_biltilsynet_sted: 'Notodden', farge: 'Grå', flate_id: null, ombygging: ingenOmbygging }),
    vanligRad({ id: R_SMALT_2, regnr: 'AB10006', chassis: 'TESTWXYZ0000000R6', ordre_status: 'paabegynt', kalender_dato: '2026-11-20', kalender_tid: '14:00', tid_biltilsynet_sted: 'Arendal', farge: 'Blå', flate_id: null, ombygging: ingenOmbygging }),
  ];
}

// En falsk utskriftsrute som fanger HTML-en genPDFSkriv skriver.
export function fangPdf(app, id) {
  const o = app.S.ordrer.find((x) => x.id === id);
  const vindu = { html: '', document: { images: [], write(h) { vindu.html += h; }, close() {} }, focus() {}, print() {} };
  app.sandbox.genPDFSkriv(o, vindu);
  return vindu.html;
}

// Tegner alle stedene mot S.ordrer slik de står nå. `pdf` er id-ene PDF-en tegnes for.
export function tegnSteder(app, { pdf = [], historikkFor = KUNDE } = {}) {
  const { sandbox } = app;
  const ut = {};
  for (const rolle of ['admin', 'ansatt']) {
    app.settMe({ id: 1, navn: 'TEST - ' + rolle, rolle });
    app.settAktivOrdre(null);
    ut['ordreListe_' + rolle] = medOpptak(app, () => sandbox.renderOrdreList());
    ut['oversikt_' + rolle] = medOpptak(app, () => sandbox.renderOversikt());
    ut['arkivAktiv_' + rolle] = medOpptak(app, () => sandbox.settArkivFane('aktiv'));
    ut['arkivFerdig_' + rolle] = medOpptak(app, () => sandbox.settArkivFane('ferdig'));
  }
  sandbox.settArkivFane('aktiv');
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  ut.kundeHistorikk = medOpptak(app, () => sandbox.visKundeHistorikk(historikkFor));
  for (const id of pdf) ut['pdf_' + id] = fangPdf(app, id);
  return ut;
}

export function byggRyddReferanser(app, rader = ryddRader()) {
  frysTid(app);
  settOppTilstand(app);
  const { S, sandbox } = app;
  S.ordrer = rader.map((r) => sandbox.dbToOrdre(r));
  S.flater = [{ id: 'flate_1', flatenummer: 'TEST-FLÅTE-1', primaerOrdreId: R_AKTIV }];
  S.moter = []; S.fravaer = [];
  const ut = tegnSteder(app, { pdf: [R_AKTIV, R_VENTER, R_ARKIVERT, R_ARKIVERT_FAKT, R_LEVERANSE] });
  return JSON.parse(normaliser(JSON.stringify(ut)));
}
