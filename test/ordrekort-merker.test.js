import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lastApp } from './helpers/app-harness.js';
import { vanligRad, settOppTilstand, frysTid, medOpptak } from './helpers/kun-visning-scenarier.js';

// Ordrekortene, «Alternativ 3: konsolidering uten skjuling» (Henrik 2026-11-25, designgjennomgangen av «badge-suppa», Henger igjen hrqzan51zwe7fxbvm5ct):
//   - ÉN kortbygger (ordreKortHTML) for Ordre-lista, Oversikt «Aktive» og «Ventende», og SAMME utvalg av merker på alle tre (før manglet COC/Fullmakt,
//     hengerfeste og tvangsflyt-stolpen på Oversikt).
//   - ÉN pille-komponent (statusPill) med faste toner for alle merkene.
//   - Kanten er ALLTID statusfargen (før overstyrt av prioritert = gul, som ikke kunne skilles fra «Ikke veid», og av bestilt frakt = lilla).
//   - Prioritert = ★ foran tittelen, bestilt frakt = vanlig pille (ingen hjørnemerker), og en dempet glød (pulseGlowKort) når noen er meldt på.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = lastApp();
const { sandbox, S } = app;
afterAll(() => { app.settMe({ id: 2, navn: 'TEST - Ansatt', rolle: 'ansatt' }); }); // se CLAUDE.md (leveranse, «Test»)

const ID_A = 'ord_1700000000100', ID_V = 'ord_1700000000101';
function oppsett(over = {}, rolle = 'admin') {
  frysTid(app);
  settOppTilstand(app);
  app.settMe({ id: 9, navn: 'TEST - ' + rolle, rolle });
  app.settAktivOrdre(null);
  const felles = {
    prioritert: true, bestilt_frakt: true, hente_klar_dato: '2026-11-21', portal_bestilling_id: 'pb_1', coc: 'etterspurt', fullmakt: 'har_ikke', ...over,
  };
  S.ordrer = [
    sandbox.dbToOrdre(vanligRad({ id: ID_A, chassis: 'TESTWXYZ0000000A1', ordre_status: 'ikke_veid', ...felles })),
    sandbox.dbToOrdre(vanligRad({ id: ID_V, chassis: 'TESTWXYZ0000000A2', ordre_status: 'ikke_paabegynt', flate_id: null, ...felles })),
  ];
}
// Ett kort per ordre fra hver liste (testriggens DOM er stubber; medOpptak samler innerHTML).
function kortene() {
  const liste = medOpptak(app, () => sandbox.renderOrdreList()).ordreListeResultat;
  const ov = medOpptak(app, () => sandbox.renderOversikt());
  return { liste, aktiv: ov.activeList, venter: ov.pendingList };
}
const kortFor = (html, id) => {
  // kortene står etter hverandre; del på ytterste <div ... style="position:relative
  const deler = html.split(/(?=<div(?: class="drag-card" onpointerdown="dragOrdreStart\(event,'[^']+'\)")? style="position:relative;background:#18181b)/);
  return deler.find((d) => d.includes(id)) || '';
};

beforeEach(() => oppsett());

describe('samme merker i alle tre listene', () => {
  it('Ordre-lista, Oversikt «Aktive» og «Ventende» viser COC, Fullmakt, flåte, PORTAL, bestilt frakt, «utstyr ikke bekreftet», hengerfeste og tvangsflyt', () => {
    const { liste, aktiv, venter } = kortene();
    const kort = { liste: kortFor(liste, ID_A), aktiv: kortFor(aktiv, ID_A), venterListe: kortFor(liste, ID_V), venter: kortFor(venter, ID_V) };
    for (const [navn, k] of Object.entries(kort)) {
      expect(k, navn).not.toBe('');
      for (const s of ['COC: Etterspurt', 'Fullmakt: Mangler', 'PORTAL · IKKE BEKREFTET', 'HENTEKLAR 21.11.2026', '⚠ Utstyr ikke bekreftet', '>Hengerfeste<', 'Tvangsflyt', 'av 7 krav', 'settHengerfesteBestilt', 'settHengerfesteMontert']) {
        expect(k, `${navn}: ${s}`).toContain(s);
      }
    }
    expect(kort.liste).toContain('Flåte TEST-FLÅTE-1');
    expect(kort.aktiv).toContain('Flåte TEST-FLÅTE-1');
    expect(kort.venter).toContain('Ingen flåte');
  });

  it('pille-raden er lik (byte for byte) på Ordre-lista og Oversikt for samme ordre', () => {
    const { liste, aktiv, venter } = kortene();
    const rad = (k) => (k.match(/<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">[\s\S]*?<\/div>/) || [''])[0];
    expect(rad(kortFor(liste, ID_A))).not.toBe('');
    expect(rad(kortFor(aktiv, ID_A))).toBe(rad(kortFor(liste, ID_A)));
    expect(rad(kortFor(venter, ID_V))).toBe(rad(kortFor(liste, ID_V)));
  });

  it('alle merkene går gjennom statusPill (ingen egne inline-farger igjen på kortet)', () => {
    const { liste, aktiv, venter } = kortene();
    for (const k of [kortFor(liste, ID_A), kortFor(aktiv, ID_A), kortFor(venter, ID_V)]) {
      const rad = k.match(/<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">([\s\S]*?)<\/div>/)[1];
      const spans = rad.match(/<span[^>]*>/g);
      expect(spans.length).toBe(rad.match(/class="pill (ok|bad|warn|info|neutral|special) status-pill"/g).length);
      expect(rad).not.toMatch(/style=/);
    }
  });

  it('Vedtak/Fakturert står bare i Ordre-lista (uendret plassering), og bare for admin', () => {
    const { liste, aktiv, venter } = kortene();
    expect(kortFor(liste, ID_A)).toContain('toggleGodkjentBiltilsyn');
    expect(kortFor(liste, ID_A)).toContain('toggleFakturert');
    for (const k of [aktiv, venter]) { expect(k).not.toContain('toggleGodkjentBiltilsyn'); expect(k).not.toContain('toggleFakturert'); }
    oppsett({}, 'ansatt');
    expect(kortene().liste).not.toContain('toggleFakturert');
  });

  it('Oversikt-kortene er fortsatt drabare, Ventende har Åpne/Flytt, Ordre-lista har kalenderlinja', () => {
    const { liste, aktiv, venter } = kortene();
    expect(kortFor(aktiv, ID_A)).toContain(`onpointerdown="dragOrdreStart(event,'${ID_A}')"`);
    expect(kortFor(venter, ID_V)).toContain(`onpointerdown="dragOrdreStart(event,'${ID_V}')"`);
    expect(kortFor(venter, ID_V)).toContain(`openFlytt('${ID_V}')`);
    expect(kortFor(liste, ID_A)).not.toContain('dragOrdreStart');
    expect(kortFor(liste, ID_A)).toContain('Ikke i kalender');
    expect(kortFor(liste, ID_A)).toContain('>Drivstoff<');
  });
});

describe('kant, prioritert og bestilt frakt', () => {
  it('kanten er statusfargen også når ordren er prioritert og har bestilt frakt (ingen gul/lilla overstyring)', () => {
    const { liste, aktiv, venter } = kortene();
    const ikkeVeid = sandbox.statusInfo('ikke_veid').border, ikkePaab = sandbox.statusInfo('ikke_paabegynt').border;
    expect(kortFor(liste, ID_A)).toContain(`border:1px solid ${ikkeVeid};border-radius:18px`);
    expect(kortFor(aktiv, ID_A)).toContain(`border:1px solid ${ikkeVeid};border-radius:18px`);
    expect(kortFor(venter, ID_V)).toContain(`border:1px solid ${ikkePaab};border-radius:18px`);
    expect(kortFor(venter, ID_V)).not.toContain('border:1px solid #a78bfa');
  });

  it('ingen hjørnemerker: «PRIORITERT» og «BESTILT FRAKT» er ikke lenger absolutt-posisjonert', () => {
    const { liste, aktiv, venter } = kortene();
    for (const k of [liste, aktiv, venter]) {
      expect(k).not.toContain('position:absolute');
      expect(k).not.toContain('>PRIORITERT<');
    }
  });

  it('prioritert gir ★ foran tittelen i alle tre, og ikke uten prioritert', () => {
    let { liste, aktiv, venter } = kortene();
    expect(kortFor(liste, ID_A)).toMatch(/<b style="font-size:16px[^"]*"><span title="Prioritert"[^>]*>★<\/span>AB12345<\/b>/);
    expect(kortFor(aktiv, ID_A)).toMatch(/<b style="cursor:pointer" onclick="[^"]*"><span title="Prioritert"[^>]*>★<\/span>/);
    expect(kortFor(venter, ID_V)).toMatch(/<b><span title="Prioritert"[^>]*>★<\/span>/);
    oppsett({ prioritert: false });
    ({ liste, aktiv, venter } = kortene());
    for (const k of [liste, aktiv, venter]) expect(k).not.toContain('★');
  });

  it('prioritert uten reg.nr: stjernen står foran chassis.nr', () => {
    oppsett({ regnr: '' });
    expect(kortFor(kortene().liste, ID_A)).toMatch(/<div style="margin-top:1px"><span title="Prioritert"[^>]*>★<\/span><span style="white-space:nowrap/);
  });

  it('bestilt frakt er en lilla pille (special), og forsvinner når bilen er hentet', () => {
    expect(sandbox.bestiltFraktBadgeHTML(S.ordrer[0])).toContain('class="pill special status-pill"');
    oppsett({ hente_klar_dato: null });
    expect(kortFor(kortene().liste, ID_A)).toContain('>BESTILT FRAKT<');
    S.ordrer[0].ordreStatus = 'hentet';
    expect(sandbox.bestiltFraktBadgeHTML(S.ordrer[0])).toBe('');
  });
});

describe('glød', () => {
  it('kortene bruker den dempede pulseGlowKort når noen er meldt på, og ingen glød ellers', () => {
    let { liste, aktiv, venter } = kortene();
    for (const k of [liste, aktiv, venter]) { expect(k).toContain('animation:pulseGlowKort 3s'); expect(k).not.toContain('animation:pulseGlow 3s'); }
    oppsett({ ansatte_signert: [] });
    ({ liste, aktiv, venter } = kortene());
    for (const k of [liste, aktiv, venter]) expect(k).not.toContain('pulseGlow');
  });
  it('pulseGlowKort er svakere enn pulseGlow, og pulseGlow (lønnsklokka) er urørt', () => {
    const html = readFileSync(path.join(__dirname, '../salmakern.html'), 'utf8');
    expect(html).toContain('@keyframes pulseGlow{0%,100%{box-shadow:0 0 26px rgba(34,197,94,.22)}50%{box-shadow:0 0 40px rgba(34,197,94,.38)}}');
    expect(html).toContain('@keyframes pulseGlowKort{0%,100%{box-shadow:0 0 12px rgba(34,197,94,.11)}50%{box-shadow:0 0 20px rgba(34,197,94,.2)}}');
  });
});

describe('statusPill og tonene', () => {
  it('faste toner, ukjent tone blir neutral, og tekst/title escapes', () => {
    for (const t of ['ok', 'bad', 'warn', 'info', 'neutral', 'special']) expect(sandbox.statusPill('X', t)).toBe(`<span class="pill ${t} status-pill">X</span>`);
    expect(sandbox.statusPill('X', 'rosa')).toBe('<span class="pill neutral status-pill">X</span>');
    expect(sandbox.statusPill('<b>"x"</b> & y', 'ok', { title: 'a"<b>' })).toBe('<span class="pill ok status-pill" title="a&quot;&lt;b&gt;">&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y</span>');
    expect(sandbox.statusPill(null, 'ok')).toBe('<span class="pill ok status-pill"></span>');
  });
  it('alle seks tonene og størrelsen finnes i CSS-en', () => {
    const html = readFileSync(path.join(__dirname, '../salmakern.html'), 'utf8');
    for (const t of ['ok', 'bad', 'warn', 'info', 'neutral', 'special']) expect(html).toMatch(new RegExp(`\\.pill\\.${t}\\{[^}]*color:`));
    expect(html).toMatch(/\.pill\.status-pill\{[^}]*font-size:10\.5px/);
  });
  it('COC/Fullmakt: Har = ok, Etterspurt = warn, Har ikke (og tom) = bad, samme toner som resten', () => {
    expect(sandbox.dokStatusPillHTML('COC', 'har')).toBe('<span class="pill ok status-pill">COC: OK</span>');
    expect(sandbox.dokStatusPillHTML('COC', 'etterspurt')).toBe('<span class="pill warn status-pill">COC: Etterspurt</span>');
    expect(sandbox.dokStatusPillHTML('Fullmakt', 'har_ikke')).toBe('<span class="pill bad status-pill">Fullmakt: Mangler</span>');
    expect(sandbox.dokStatusPillHTML('Fullmakt', '')).toBe('<span class="pill bad status-pill">Fullmakt: Mangler</span>');
  });
  it('flåte: info med nummer, neutral uten; e-post og portal: warn før bekreftelse, special etter; kun ekstrautstyr: special', () => {
    expect(sandbox.flateKortHTML(S.ordrer[0])).toBe('<span class="pill info status-pill">Flåte TEST-FLÅTE-1</span>');
    expect(sandbox.flateKortHTML(S.ordrer[1])).toBe('<span class="pill neutral status-pill">Ingen flåte</span>');
    expect(sandbox.portalBadgeHTML({ epostBestillingId: 'e1' })).toContain('class="pill warn status-pill"');
    expect(sandbox.portalBadgeHTML({ epostBestillingId: 'e1', epostBekreftetAt: 'x' })).toContain('class="pill special status-pill"');
    expect(sandbox.kunEkstrautstyrBadgeHTML({ kunEkstrautstyr: true, ordretype: 'bil' })).toContain('class="pill special status-pill"');
  });
});

describe('«kun ekstrautstyr» på kortene', () => {
  it('merket står i pille-raden én gang per kort, stolpen viser «0 av 1 krav», og COC/Fullmakt/flåte/hengerfeste/bestilt-frakt-reglene er uendret', () => {
    oppsett({ kun_ekstrautstyr: true, prioritert: false, ordre_status: 'paabegynt', ombygging: { nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false } });
    S.ordrer[0].ordreStatus = 'paabegynt';
    const { liste, aktiv } = kortene();
    for (const k of [kortFor(liste, ID_A), kortFor(aktiv, ID_A)]) {
      expect((k.match(/KUN EKSTRAUTSTYR/g) || []).length).toBe(1);
      expect(k).toContain('0 av 1 krav');
      for (const s of ['COC:', 'Fullmakt:', 'Flåte', 'flåte', '>Hengerfeste<', 'settHengerfeste']) expect(k, s).not.toContain(s);
    }
  });
});

describe('kildeteksten', () => {
  const kode = readFileSync(path.join(__dirname, '../js/oversikt-kalender.js'), 'utf8');
  it('alle tre listene bruker ordreKortHTML, og ingen gammel hjørnemerke-/kantoverstyring finnes igjen', () => {
    for (const k of ['liste', 'aktiv', 'venter']) expect(kode).toContain(`ordreKortHTML(o, '${k}')`);
    expect(kode).not.toContain('BESTILT_FRAKT_BADGE_FARGE');
    expect(kode).not.toMatch(/o\.prioritert\?'#facc15'/);
    expect(kode).not.toContain('top:-9px');
  });
});
