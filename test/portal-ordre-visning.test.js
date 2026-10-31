import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Ordre fra Forhandlerportalen i appen: PORTAL-merket, filteret og Bekreft/Avvis (G5/G6, 2026-10-30).
// Testen laster core.js (som offline-ko.test.js) og så den nye seksjonen nederst i ordre-diverse.js («BESTILLING FRA FORHANDLERPORTALEN») i SAMME vm-context,
// med falsk db/DOM, og kjører de ekte funksjonene. Selve databasefunksjonene har egen test: supabase/tester/portal_bekreft_avvis_TEST_body.sql.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../js', f), 'utf8').replace(/\r\n/g, '\n');
const coreKode = les('core.js');
const diverseKode = les('ordre-diverse.js');
const detaljKode = les('ordre-detalj.js');
const seksjon = diverseKode.slice(diverseKode.lastIndexOf('\n', diverseKode.indexOf('// BESTILLING FRA FORHANDLERPORTALEN: Bekreft / Avvis (G6)')) + 1);
const escKilde = detaljKode.match(/^function esc\(s\)\{[^\n]*\}$/m)[0];

function nyttMiljo({ rolle = 'ansatt', kontakter = [], rpc, bekreftSvar = true } = {}) {
  const logg = { toast: [], rpc: [], render: 0, detalj: 0, autoMal: [], portalLinjer: [], speiling: 0, tilbake: 0, confirm: [], logChange: [] };
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    document: {
      addEventListener() {}, getElementById() { return null; },
      createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; },
      body: { appendChild() {} }, head: { appendChild() {} },
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() { /* kjør aldri automatisk */ }, clearTimeout() {}, fetch: undefined,
    confirm: (t) => { logg.confirm.push(t); return bekreftSvar; },
  };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  vm.runInContext(escKilde, sandbox);
  // Falske hjelpere som ligger i andre filer i appen (resten av appen er ikke med i testen).
  sandbox.visToast = (m, t) => { logg.toast.push([m, t]); };
  sandbox.planleggRenderAll = () => { logg.render++; };
  sandbox.buildOrdreDetail = () => { logg.detalj++; };
  sandbox.autoVelgUtstyrMal = (id) => { logg.autoMal.push(id); };
  sandbox.leggTilPortalUtstyrLinjer = (id) => { logg.portalLinjer.push(id); };
  sandbox.planleggLocalSpeiling = () => { logg.speiling++; };
  sandbox.tilbakeOrdreList = () => { logg.tilbake++; };
  sandbox.ordreLabel = (o) => o.regnr || ('Chassis: ' + o.chassis);
  // Speiler js/admin-ark.js adminArkFinnKontaktEpost: først toppnivå-kontakter (navn), så kontaktpersoner NØSTET under forhandlere.
  sandbox.adminArkFinnKontaktEpost = (navn) => {
    const treff = kontakter.find((k) => k.navn === navn);
    if (treff) return treff.epost || '';
    const nostet = kontakter.filter((k) => k.type === 'Forhandler').flatMap((k) => k.kontaktpersoner || []).find((p) => p.navn === navn);
    return (nostet && nostet.epost) || '';
  };
  vm.runInContext(seksjon, sandbox, { filename: 'ordre-diverse.js (G6)' });
  vm.runInContext(`
    function _setS(v){ S = v; } function _getS(){ return S; }
    function _setMe(v){ me = v; } function _setDb(v){ db = v; }
    function _setAktiv(v){ activeOrdreId = v; }
    function _ignorer(){ return ignorerRealtimeFor; }
  `, sandbox);
  sandbox._setMe({ id: 7, navn: 'Test Ansatt', rolle });
  sandbox._setDb({ rpc: (navn, args) => { logg.rpc.push([navn, args]); return Promise.resolve(rpc ? rpc(navn, args) : { data: null, error: { message: 'ikke satt opp' } }); } });
  return { sandbox, logg };
}

const portalOrdre = (over = {}) => ({
  id: 'ord_1788100000000_abc123', regnr: '', chassis: 'TESTWXYZ000000001', kunde: 'AK Auto AS', eier: 'Andreas Kåsa', status: 'aktiv', ordreStatus: 'paa_vei',
  endringer: [{ av: 'Forhandlerportalen', tid: '30.10.2026, 19:00:00', txt: 'Opprettet fra Forhandlerportalen (bestilling B-2026-0001 fra Ola). Ikke bekreftet ennå.' }],
  portalBestillingId: 'cm9testbestilling0001', portalBekreftetAt: null, portalBekreftetAv: '', ...over,
});

describe('dbToOrdre / ordreToDb: portal-kolonnene leses, men skrives ALDRI av appens lagring', () => {
  it('dbToOrdre leser de fem kolonnene (inkl. portal_modell_slug s09-012 steg 2 og portal_linjer s08-048), og vanlige ordre får null/tomt', () => {
    const { sandbox } = nyttMiljo();
    const linjer = [{ produktnummer: '501', navn: 'Takluke', rabatt_prosent: 10 }];
    const p = sandbox.dbToOrdre({ id: 'a', portal_bestilling_id: 'cm9x', portal_bekreftet_at: '2026-10-30T18:00:00Z', portal_bekreftet_av: 'Ola', portal_modell_slug: 'kia-ev9', portal_linjer: linjer });
    expect(p).toMatchObject({ portalBestillingId: 'cm9x', portalBekreftetAt: '2026-10-30T18:00:00Z', portalBekreftetAv: 'Ola', portalModellSlug: 'kia-ev9', portalLinjer: linjer });
    const v = sandbox.dbToOrdre({ id: 'b' });
    expect(v).toMatchObject({ portalBestillingId: null, portalBekreftetAt: null, portalBekreftetAv: '', portalModellSlug: null, portalLinjer: null });
  });

  it('ordreToDb sender ALDRI portal_*-kolonnene (en ansatt som lagrer et annet felt kan ikke nullstille bekreftelsen)', () => {
    const { sandbox } = nyttMiljo();
    const rad = sandbox.ordreToDb({ ...sandbox.dbToOrdre({ id: 'a', portal_bestilling_id: 'cm9x', portal_bekreftet_at: '2026-10-30T18:00:00Z', portal_bekreftet_av: 'Ola' }), vekter: {}, drivstoff: {}, utstyr: {} });
    expect(Object.keys(rad).filter((k) => /portal/i.test(k))).toEqual([]);
  });
});

describe('PORTAL-merket', () => {
  it('ingen merke på vanlige ordre; amber «IKKE BEKREFTET» før bekreftelse; blå «PORTAL» etter', () => {
    const { sandbox } = nyttMiljo();
    expect(sandbox.portalBadgeHTML({})).toBe('');
    expect(sandbox.portalBadgeHTML({ portalBestillingId: null })).toBe('');
    const ub = sandbox.portalBadgeHTML(portalOrdre());
    expect(ub).toContain('PORTAL · IKKE BEKREFTET');
    expect(ub).toContain('#fbbf24');
    const bek = sandbox.portalBadgeHTML(portalOrdre({ portalBekreftetAt: '2026-10-30T18:00:00Z', portalBekreftetAv: 'Ola "Sjefen" <b>' }));
    expect(bek).toContain('>PORTAL<');
    expect(bek).not.toContain('IKKE BEKREFTET');
    expect(bek).toContain('#93c5fd');
    expect(bek).not.toContain('<b>');            // navnet i title-attributtet er escapet
    expect(bek).toContain('&quot;Sjefen&quot;');
  });

  it('kort merke (ordredetaljens smale høyrekolonne): bare «PORTAL», men fargen viser fortsatt bekreftet/ikke', () => {
    const { sandbox } = nyttMiljo();
    const ub = sandbox.portalBadgeHTML(portalOrdre(), true);
    expect(ub).toContain('>PORTAL<');
    expect(ub).not.toContain('IKKE BEKREFTET');
    expect(ub).toContain('#fbbf24');
    const bek = sandbox.portalBadgeHTML(portalOrdre({ portalBekreftetAt: 'x' }), true);
    expect(bek).toContain('#93c5fd');
    expect(sandbox.portalBadgeHTML({}, true)).toBe('');
  });

  it('erUbekreftetPortalOrdre: bare portal-ordre uten bekreftelse', () => {
    const { sandbox } = nyttMiljo();
    expect(sandbox.erUbekreftetPortalOrdre(portalOrdre())).toBe(true);
    expect(sandbox.erUbekreftetPortalOrdre(portalOrdre({ portalBekreftetAt: 'x' }))).toBe(false);
    expect(sandbox.erUbekreftetPortalOrdre({})).toBe(false);
  });
});

describe('banneret i ordredetaljen', () => {
  it('vises bare for en aktiv, ubekreftet portal-ordre', () => {
    const { sandbox } = nyttMiljo();
    expect(sandbox.portalBekreftBannerHTML({ id: 'a', status: 'aktiv', endringer: [] })).toBe('');
    expect(sandbox.portalBekreftBannerHTML(portalOrdre({ portalBekreftetAt: 'x' }))).toBe('');
    expect(sandbox.portalBekreftBannerHTML(portalOrdre({ status: 'arkivert' }))).toBe('');
    const html = sandbox.portalBekreftBannerHTML(portalOrdre());
    expect(html).toContain('ikke bekreftet');
    expect(html).toContain('portalBekreftOrdre(\'ord_1788100000000_abc123\')');
    expect(html).toContain('Opprettet fra Forhandlerportalen');
  });

  it('«Avvis og slett» vises bare for administrator og godkjenner', () => {
    for (const [rolle, skalViseAvvis] of [['admin', true], ['godkjenner', true], ['ansatt', false]]) {
      const { sandbox } = nyttMiljo({ rolle, kontakter: [{ navn: 'Andreas Kåsa', epost: 'a@example.test' }] });
      const html = sandbox.portalBekreftBannerHTML(portalOrdre());
      expect(html.includes('portalAvvisOrdre('), rolle).toBe(skalViseAvvis);
      expect(html.includes('portalBekreftOrdre('), rolle).toBe(true);
    }
  });

  it('teksten forteller hva man kan gjøre: admin/godkjenner kan avvise, andre må be en administrator', () => {
    for (const [rolle, forventet, ikke] of [['admin', 'avvis og slett ordren', 'be en administrator'], ['godkjenner', 'avvis og slett ordren', 'be en administrator'], ['ansatt', 'be en administrator avvise', 'avvis og slett ordren']]) {
      const { sandbox } = nyttMiljo({ rolle });
      const html = sandbox.portalBekreftBannerHTML(portalOrdre());
      expect(html, rolle).toContain(forventet);
      expect(html, rolle).not.toContain(ikke);
    }
  });

  it('kontaktperson NØSTET under en forhandler i Kontakter regnes som funnet (ingen falsk advarsel)', () => {
    const { sandbox } = nyttMiljo({ kontakter: [{ navn: 'AK Auto AS', type: 'Forhandler', kontaktpersoner: [{ navn: 'Andreas Kåsa', epost: 'a@example.test' }] }] });
    expect(sandbox.portalBekreftBannerHTML(portalOrdre())).not.toContain('Fant ingen e-postadresse');
  });

  it('advarer når kontaktpersonen mangler eller ikke har e-post i Kontakter, og er stille når alt finnes', () => {
    let { sandbox } = nyttMiljo({ kontakter: [{ navn: 'Andreas Kåsa', epost: 'a@example.test' }] });
    expect(sandbox.portalBekreftBannerHTML(portalOrdre())).not.toContain('Fant ingen e-postadresse');
    expect(sandbox.portalBekreftBannerHTML(portalOrdre())).not.toContain('Ingen kontaktperson');
    ({ sandbox } = nyttMiljo({ kontakter: [] }));
    expect(sandbox.portalBekreftBannerHTML(portalOrdre())).toContain('Fant ingen e-postadresse til «Andreas Kåsa»');
    expect(sandbox.portalBekreftBannerHTML(portalOrdre({ eier: '' }))).toContain('Ingen kontaktperson er satt');
  });

  it('fritekst i banneret escapes (navn med anførselstegn og <)', () => {
    const { sandbox } = nyttMiljo({ kontakter: [] });
    const html = sandbox.portalBekreftBannerHTML(portalOrdre({ eier: 'Ola "<img src=x onerror=1>"', endringer: [{ av: 'Forhandlerportalen', txt: 'Fra <script>x</script> "Selger"' }] }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script>');
  });
});

describe('Bekreft', () => {
  let m;
  const okSvar = { data: { kode: 'ok', portal_bekreftet_at: '2026-10-30T18:30:00Z', portal_bekreftet_av: 'Test Ansatt', endringer: [{ av: 'Forhandlerportalen', tid: 't', txt: 'Opprettet' }, { av: 'Test Ansatt', tid: 't2', txt: 'Bekreftet som bestilling fra Forhandlerportalen' }] }, error: null };
  beforeEach(() => {
    m = nyttMiljo({ rpc: () => okSvar });
    m.sandbox._setS({ ordrer: [portalOrdre()] });
    m.sandbox._setAktiv('ord_1788100000000_abc123');
  });

  it('kaller portal_bekreft_ordre med ordre-id, oppdaterer ordren lokalt fra svaret, velger utstyrsmal og tegner på nytt', async () => {
    await m.sandbox.portalBekreftOrdre('ord_1788100000000_abc123');
    expect(m.logg.rpc).toEqual([['portal_bekreft_ordre', { p_ordre_id: 'ord_1788100000000_abc123' }]]);
    const o = m.sandbox._getS().ordrer[0];
    expect(o.portalBekreftetAt).toBe('2026-10-30T18:30:00Z');
    expect(o.portalBekreftetAv).toBe('Test Ansatt');
    expect(o.endringer).toHaveLength(2);
    expect(m.logg.toast).toEqual([['Bestillingen er bekreftet', 'ok']]);
    expect(m.logg.autoMal).toEqual(['ord_1788100000000_abc123']);
    expect(m.logg.portalLinjer).toEqual(['ord_1788100000000_abc123']);
    expect(m.logg.render).toBe(1);
    expect(m.logg.detalj).toBe(1);
  });

  it('merker ordren i ignorerRealtimeFor før kallet (eget Realtime-ekko re-rendrer ikke siden)', async () => {
    let sett = null;
    m.sandbox._setDb({ rpc: () => { sett = m.sandbox._ignorer().has('ord_1788100000000_abc123'); return Promise.resolve(okSvar); } });
    await m.sandbox.portalBekreftOrdre('ord_1788100000000_abc123');
    expect(sett).toBe(true);
  });

  it('allerede_bekreftet (f.eks. svaret på første forsøk gikk tapt): ærlig melding, og utstyrsmalen velges likevel (autoVelgUtstyrMal gjør ingenting hvis den allerede er valgt)', async () => {
    m.sandbox._setDb({ rpc: () => Promise.resolve({ data: { kode: 'allerede_bekreftet', portal_bekreftet_at: '2026-10-30T18:00:00Z', portal_bekreftet_av: 'Kollega', endringer: [] }, error: null }) });
    await m.sandbox.portalBekreftOrdre('ord_1788100000000_abc123');
    expect(m.logg.toast).toEqual([['Bestillingen var allerede bekreftet', 'ok']]);
    expect(m.logg.autoMal).toEqual(['ord_1788100000000_abc123']);
    expect(m.sandbox._getS().ordrer[0].portalBekreftetAv).toBe('Kollega');
  });

  it('databasefeil: norsk melding, ordren er uendret, ingen utstyrsmal, ekko-markeringen fjernes', async () => {
    for (const [kode, tekst] of [['IKKE_INNLOGGET', 'innlogget'], ['ORDRE_FINNES_IKKE', 'finnes ikke lenger'], ['IKKE_PORTAL_ORDRE', 'ikke en ordre fra Forhandlerportalen'], ['noe uventet', 'Noe gikk galt']]) {
      m = nyttMiljo({ rpc: () => ({ data: null, error: { message: kode } }) });
      m.sandbox._setS({ ordrer: [portalOrdre()] });
      m.sandbox._setAktiv('ord_1788100000000_abc123');
      await m.sandbox.portalBekreftOrdre('ord_1788100000000_abc123');
      expect(m.logg.toast[0][1], kode).toBe('feil');
      expect(m.logg.toast[0][0], kode).toContain(tekst);
      if (kode === 'ORDRE_FINNES_IKKE') {
        // ordren er borte i databasen: fjernes også lokalt, og du sendes tilbake til lista (Oppdater ville ikke hjulpet)
        expect(m.sandbox._getS().ordrer, kode).toHaveLength(0);
        expect(m.logg.tilbake, kode).toBe(1);
      } else {
        expect(m.sandbox._getS().ordrer[0].portalBekreftetAt, kode).toBeNull();
        expect(m.logg.tilbake, kode).toBe(0);
      }
      expect(m.logg.autoMal, kode).toEqual([]);
      expect(m.sandbox._ignorer().has('ord_1788100000000_abc123'), kode).toBe(false);
    }
  });

  it('kastet unntak (nettfeil) gir norsk melding og lar knappen virke igjen', async () => {
    m.sandbox._setDb({ rpc: () => Promise.reject(new TypeError('Failed to fetch')) });
    await m.sandbox.portalBekreftOrdre('ord_1788100000000_abc123');
    expect(m.logg.toast[0][0]).toContain('nettforbindelsen');
    m.sandbox._setDb({ rpc: () => Promise.resolve(okSvar) });
    await m.sandbox.portalBekreftOrdre('ord_1788100000000_abc123');
    expect(m.sandbox._getS().ordrer[0].portalBekreftetAt).toBe('2026-10-30T18:30:00Z');
  });

  it('dobbeltklikk: bare ÉN kall til databasen', async () => {
    const a = m.sandbox.portalBekreftOrdre('ord_1788100000000_abc123');
    const b = m.sandbox.portalBekreftOrdre('ord_1788100000000_abc123');
    await Promise.all([a, b]);
    expect(m.logg.rpc).toHaveLength(1);
    expect(m.logg.autoMal).toHaveLength(1);
    expect(m.logg.toast.some(([t, type]) => type === 'feil' && t.includes('pågår'))).toBe(true);
  });

  it('ukjent ordre-id gjør ingenting', async () => {
    await m.sandbox.portalBekreftOrdre('finnes_ikke');
    expect(m.logg.rpc).toHaveLength(0);
  });
});

describe('Avvis og slett', () => {
  it('avbrutt dialog: databasen kalles ikke og ordren står', async () => {
    const m = nyttMiljo({ rolle: 'admin', bekreftSvar: false, rpc: () => ({ data: { kode: 'ok' }, error: null }) });
    m.sandbox._setS({ ordrer: [portalOrdre()] });
    await m.sandbox.portalAvvisOrdre('ord_1788100000000_abc123');
    expect(m.logg.confirm).toHaveLength(1);
    expect(m.logg.rpc).toHaveLength(0);
    expect(m.sandbox._getS().ordrer).toHaveLength(1);
  });

  it('bekreftet dialog: portal_avvis_ordre kalles, ordren fjernes lokalt, og listen vises', async () => {
    const m = nyttMiljo({ rolle: 'godkjenner', rpc: () => ({ data: { kode: 'ok' }, error: null }) });
    m.sandbox._setS({ ordrer: [portalOrdre(), portalOrdre({ id: 'ord_annen' })] });
    m.sandbox._setAktiv('ord_1788100000000_abc123');
    await m.sandbox.portalAvvisOrdre('ord_1788100000000_abc123');
    expect(m.logg.rpc).toEqual([['portal_avvis_ordre', { p_ordre_id: 'ord_1788100000000_abc123' }]]);
    expect(m.sandbox._getS().ordrer.map((o) => o.id)).toEqual(['ord_annen']);
    expect(m.logg.tilbake).toBe(1);
    expect(m.logg.toast).toEqual([['Bestillingen er avvist og ordren slettet', 'ok']]);
    expect(m.logg.confirm[0]).toContain('Dette kan ikke angres');
  });

  it('har brukeren gått til en ANNEN ordre mens kallet pågikk, fjernes den avviste ordren uten å kaste henne ut av den ordren hun står på', async () => {
    const m = nyttMiljo({ rolle: 'admin', rpc: () => ({ data: { kode: 'ok' }, error: null }) });
    m.sandbox._setS({ ordrer: [portalOrdre(), portalOrdre({ id: 'ord_annen' })] });
    m.sandbox._setAktiv('ord_annen');
    await m.sandbox.portalAvvisOrdre('ord_1788100000000_abc123');
    expect(m.sandbox._getS().ordrer.map((o) => o.id)).toEqual(['ord_annen']);
    expect(m.logg.tilbake).toBe(0);
  });

  it('avvis mens en annen portal-handling pågår: beskjed, ingen dialog og ingen databasekall', async () => {
    let slipp;
    const m = nyttMiljo({ rolle: 'admin', rpc: () => new Promise((r) => { slipp = r; }) });
    m.sandbox._setS({ ordrer: [portalOrdre(), portalOrdre({ id: 'ord_annen' })] });
    const bekreft = m.sandbox.portalBekreftOrdre('ord_annen');
    await m.sandbox.portalAvvisOrdre('ord_1788100000000_abc123');
    expect(m.logg.confirm).toHaveLength(0);
    expect(m.logg.rpc).toHaveLength(1);
    expect(m.logg.toast.some(([t]) => t.includes('pågår'))).toBe(true);
    slipp({ data: { kode: 'ok', endringer: [] }, error: null });
    await bekreft;
  });

  it('IKKE_URORT og IKKE_TILLATT: forklaring på norsk, ordren står, ingen navigering', async () => {
    for (const [kode, tekst] of [['IKKE_URORT', 'endret etter at den ble opprettet'], ['IKKE_TILLATT', 'administrator og godkjenner'], ['ALLEREDE_BEKREFTET', 'allerede bekreftet']]) {
      const m = nyttMiljo({ rolle: 'admin', rpc: () => ({ data: null, error: { message: kode } }) });
      m.sandbox._setS({ ordrer: [portalOrdre()] });
      await m.sandbox.portalAvvisOrdre('ord_1788100000000_abc123');
      expect(m.logg.toast[0][0], kode).toContain(tekst);
      expect(m.sandbox._getS().ordrer, kode).toHaveLength(1);
      expect(m.logg.tilbake, kode).toBe(0);
    }
  });
});

describe('Filter og oppsett (kildetekst)', () => {
  it('filteret «Fra portal, ikke bekreftet» finnes i HTML og er koblet inn i ordrelista', () => {
    const html = readFileSync(path.resolve(__dirname, '../salmakern.html'), 'utf8');
    expect(html).toMatch(/<option value="portal_ubekreftet">Fra portal, ikke bekreftet \(0\)<\/option>/);
    const liste = les('oversikt-kalender.js');
    // hele filtergrenen (en endring som fjerner den eller bytter den ut, skal feile her)
    // (portal-grenen først, og den vanlige status-sammenligningen sist; «Bestilt frakt»-grenen ligger mellom, se sorter-ordre-bestilt-frakt.test.js)
    expect(liste).toContain("if (statusFilter === 'portal_ubekreftet') { if (!erUbekreftetPortalOrdre(o)) return false; }");
    expect(liste).toContain("else if (statusFilter && o.ordreStatus !== statusFilter) return false;");
    // merket står på alle tre korttypene (Ordre-lista, Oversikt aktive, Oversikt ventende)
    expect(liste.match(/portalBadgeHTML\(o\)/g).length).toBe(3);
  });

  it('banneret og merket er koblet inn i ordredetaljen', () => {
    expect(detaljKode).toContain('${portalBekreftBannerHTML(o)}');
    expect(detaljKode).toContain('${portalBadgeHTML(o, true)}');
  });

  it('autoVelgUtstyrMal sender ordre-id til hjelperne (Bekreft kjører etter en await: brukeren kan ha gått til en annen ordre)', () => {
    const lager = les('lager.js');
    expect(lager).toContain('function oppdaterSkalHaForOppskrift(oppskriftNavn, skalStaa, ordreId = activeOrdreId)');
    expect(lager).toContain('async function oppdaterFikenLinjeForOppskrift(produktnummer, skalStaa, ordreId = activeOrdreId)');
    const utstyr = les('ansatte-utstyr.js');
    const start = utstyr.indexOf('function autoVelgUtstyrMal(');
    const kropp = utstyr.slice(start, utstyr.indexOf('\n}\n', start));
    expect(kropp).toContain('oppdaterSkalHaForOppskrift(FIKEN_PRODUKTNUMMER_IKKE_PANORAMA, true, ordreId)');
    expect(kropp).toContain('oppdaterFikenLinjeForOppskrift(FIKEN_PRODUKTNUMMER_PANORAMA, false, ordreId)');
  });

  it('sw.js har fått ny CACHE-versjon (åpne PWA-er henter den nye koden)', () => {
    const sw = readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');
    expect(sw).toMatch(/const CACHE = 'salmakern-v(1[5-9]|[2-9]\d)'/);
  });
});
