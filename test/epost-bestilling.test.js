// Trinn 5 av «Én produktliste»: bestilling på e-post (supabase/functions/epost-bestilling: tolk.ts og logikk.ts er rene og lastes direkte).
// ALT her er SYNTETISK: oppdiktede priser, TESTWXYZ-chassis, test@example.no-adresser. Ingen ekte e-post, kunde eller chassis.
import { describe, it, expect } from 'vitest';
import { htmlTilTekst, tallFraTekst, tolkEpost } from '../supabase/functions/epost-bestilling/tolk.ts';
import { avsenderAdresse, finnSelger, finnModell, grunnRolle, navnPasser, tolkTilvalg, vurderRad } from '../supabase/functions/epost-bestilling/logikk.ts';

const P = (nr, navn, ekstra = {}) => ({ portal_id: 'p' + nr, type: 'tillegg', modell_slug: 'kia-ev9', modell_navn: 'KIA EV9', fiken_nummer: nr, nummer_status: 'ok', navn, app_rolle: null, ...ekstra });
const PRODUKTER = [
  P('500', 'Standard ombygging', { type: 'variant', app_rolle: 'ombygging' }),
  P('501', 'Tillegg for panorama glasstak'),
  P('505', 'Heldekkende gulv med lokk, gassfjærer og oppbevaringskasse'),
  P('510', 'Gummimatte heldekkende gulv'),
  P('1600', 'Standard ombygging', { type: 'variant', app_rolle: 'ombygging', modell_slug: 'mercedes-eqv', modell_navn: 'Mercedes EQV' }),
];
const PRISER = [{ produktnummer: '500', pris_kr: 38920 }, { produktnummer: '501', pris_kr: 3000 }, { produktnummer: '505', pris_kr: 12000 }, { produktnummer: '510', pris_kr: 4578 }];
const KONTAKTER = [
  { id: 'k_test_a', navn: 'TEST Forhandler A AS', type: 'Forhandler', kontaktpersoner: [{ navn: 'TEST Selger', epost: 'selger@example.no' }] },
  { id: 'k_test_b', navn: 'TEST Forhandler B AS', type: 'Forhandler', kontaktpersoner: [{ navn: 'TEST Dobbel', epost: 'dobbel@example.no' }] },
  { id: 'k_test_c', navn: 'TEST Forhandler C AS', type: 'Forhandler', kontaktpersoner: [{ navn: 'TEST Dobbel', epost: 'Dobbel@example.no' }] },
  { id: 'k_test_l', navn: 'TEST Leverandør', type: 'Leverandør', kontaktpersoner: [{ navn: 'TEST Lev', epost: 'lev@example.no' }] },
];

// Slik skjermbildene 17.11 viser e-posten (Outlook-videresending, HTML-tabell).
const HTML = `<html><head><style>td{color:red}</style></head><body><p>Fra: Innkjøpsportalen</p>
<table>
<tr><th>Rad</th><th>Art.-nr.</th><th>Beskrivelse</th><th>Mengde</th><th>Pris</th><th>Beløp</th></tr>
<tr><td>1</td><td>KIA EV9 &ndash; ombygning til varebil klasse 2 Pris fra: 38&nbsp;920,00</td><td></td><td>1</td><td>38&nbsp;920,00</td><td>38&nbsp;920,00</td></tr>
<tr><td></td><td colspan="5">Dato kjøretøyet er ventet i Drammen Havn: 02.12.2026</td></tr>
<tr><td></td><td colspan="5">OEM / Bestillingsnummer / Chassis nr: TESTWXYZ000000051</td></tr>
<tr><td></td><td colspan="5">Totalpris inkl. tilvalg (Eks. MVA): 55 498</td></tr>
<tr><td></td><td colspan="5">Totalpris på tilvalg: 16 578</td></tr>
<tr><td></td><td colspan="5">Tilvalg produktn og antall: 505 Heldekkende gulv med lokk, gassfjærer og oppbevaringskasse 510 Gummimatte heldekkende gulv</td></tr>
<tr><td>2</td><td>KIA EV9 – ombygning til varebil klasse 2 Pris fra: 38 920,00</td><td></td><td>1</td><td>38 920,00</td><td>38 920,00</td></tr>
<tr><td></td><td colspan="5">OEM / Bestillingsnummer / Chassis nr: TESTWXYZ000000052</td></tr>
<tr><td></td><td colspan="5">Totalpris inkl. tilvalg (Eks. MVA): 38 920</td></tr>
<tr><td></td><td colspan="5">Totalpris på tilvalg: 0</td></tr>
</table></body></html>`;

const ctx = (over = {}) => ({ produkter: PRODUKTER, fikenPriser: PRISER, avsenderFeil: null, autentiseringFeil: null, ...over });
const rad = (over = {}) => ({ rad: 1, grunnTekst: 'KIA EV9 – ombygning til varebil klasse 2', mengde: 1, pris: 38920, belop: 38920, chassis: 'TESTWXYZ000000051', chassisRaa: null, tilvalgTekst: '501 - Tillegg for panorama glasstak', totalTilvalg: 3000, totalInkl: 41920, ...over });

describe('tolk: tall og HTML', () => {
  it('norske beløp', () => {
    expect(tallFraTekst('38 920,00')).toBe(38920);
    expect(tallFraTekst('16 578')).toBe(16578);
    expect(tallFraTekst('38.920,00')).toBe(38920);
    expect(tallFraTekst('55 498 kr')).toBe(55498);
    expect(tallFraTekst('0')).toBe(0);
    expect(tallFraTekst('ingen')).toBe(null);
  });
  it('HTML blir linjer med celler, uten stil og med entiteter', () => {
    const t = htmlTilTekst('<style>x{}</style><table><tr><td>1</td><td>A&amp;B&nbsp;C</td></tr></table>');
    expect(t).not.toContain('x{}');
    expect(t).toContain('1 | ');
    expect(t).toContain('A&B C');
  });
});

describe('tolk: hele e-posten', () => {
  it('to rader med chassis, summer og tilvalg; datoen leses ikke', () => {
    const { rader, feil } = tolkEpost(htmlTilTekst(HTML));
    expect(feil).toEqual([]);
    expect(rader).toHaveLength(2);
    expect(rader[0]).toMatchObject({ rad: 1, grunnTekst: 'KIA EV9 – ombygning til varebil klasse 2', mengde: 1, pris: 38920, belop: 38920, chassis: 'TESTWXYZ000000051', totalInkl: 55498, totalTilvalg: 16578 });
    expect(rader[0].tilvalgTekst).toBe('505 Heldekkende gulv med lokk, gassfjærer og oppbevaringskasse 510 Gummimatte heldekkende gulv');
    expect(rader[1]).toMatchObject({ rad: 2, chassis: 'TESTWXYZ000000052', totalTilvalg: 0, totalInkl: 38920, tilvalgTekst: '' });
    expect(JSON.stringify(rader)).not.toContain('02.12.2026');
  });
  it('ren tekst med tabulatorer (tekstversjonen av e-posten)', () => {
    const tekst = 'Rad\tArt.-nr.\tBeskrivelse\tMengde\tPris\tBeløp\n1\tKIA EV9 – ombygning til varebil klasse 2\t\t2\t38 920,00\t77 840,00\n\tOEM / Bestillingsnummer / Chassis nr: testwxyz000000053\n\tTotalpris inkl. tilvalg (Eks. MVA): 77 840\n\tTotalpris på tilvalg: 0\n';
    const { rader } = tolkEpost(tekst);
    expect(rader[0]).toMatchObject({ mengde: 2, pris: 38920, belop: 77840, chassis: 'TESTWXYZ000000053' });
  });
  it('et OEM-/bestillingsnummer i stedet for chassis blir ikke chassis', () => {
    const { rader } = tolkEpost('1 | KIA EV9 ombygning | 1 | 38 920 | 38 920\nOEM / Bestillingsnummer / Chassis nr: BEST-12345');
    expect(rader[0].chassis).toBe(null);
    expect(rader[0].chassisRaa).toBe('BEST-12345');
  });
  it('ingen rader gir en feil, ikke en gjetning', () => {
    expect(tolkEpost('Hei, se vedlagt.').feil).toEqual(['ingen_rader']);
  });
});

describe('avsender og forhandler', () => {
  it('leser adressen fra From', () => {
    expect(avsenderAdresse('TEST Selger <Selger@Example.no>')).toBe('selger@example.no');
    expect(avsenderAdresse('selger@example.no')).toBe('selger@example.no');
    expect(avsenderAdresse('ingen adresse')).toBe(null);
  });
  it('én forhandler, ukjent, flere, og bare forhandlere teller', () => {
    expect(finnSelger('selger@example.no', KONTAKTER)).toEqual({ kontakt_id: 'k_test_a', kontakt_navn: 'TEST Forhandler A AS', selger_navn: 'TEST Selger' });
    expect(finnSelger('ukjent@example.no', KONTAKTER).feil).toMatch(/Ukjent avsender/);
    expect(finnSelger('dobbel@example.no', KONTAKTER).feil).toMatch(/flere forhandlere/);
    expect(finnSelger('lev@example.no', KONTAKTER).feil).toMatch(/Ukjent avsender/);
  });
});

describe('modell og tilvalg', () => {
  it('modellen fra teksten, rollen fra ordene', () => {
    expect(finnModell('KIA EV9 – ombygning til varebil klasse 2', PRODUKTER)).toEqual({ slug: 'kia-ev9', navn: 'KIA EV9' });
    expect(finnModell('Ukjent bil ombygning', PRODUKTER)).toBe(null);
    expect(grunnRolle('KIA EV9 personbil')).toBe('personbil');
    expect(grunnRolle('KIA EV9 – ombygning til varebil')).toBe('ombygging');
  });
  it('navn må passe begge veier', () => {
    expect(navnPasser('Gummimatte heldekkende gulv', 'Gummimatte heldekkende gulv')).toBe(true);
    expect(navnPasser('Gummimatte', 'Gummimatte heldekkende gulv')).toBe(false);
  });
  it('flere tilvalg på én linje, med og uten bindestrek', () => {
    const kia = PRODUKTER.filter((p) => p.modell_slug === 'kia-ev9');
    expect(tolkTilvalg('505 Heldekkende gulv med lokk, gassfjærer og oppbevaringskasse 510 Gummimatte heldekkende gulv', kia)).toEqual({ grunner: [], linjer: [
      { produktnummer: '505', navn: 'Heldekkende gulv med lokk, gassfjærer og oppbevaringskasse', antall: 1 },
      { produktnummer: '510', navn: 'Gummimatte heldekkende gulv', antall: 1 }] });
    expect(tolkTilvalg('501 - Tillegg for panorama glasstak', kia).linjer).toEqual([{ produktnummer: '501', navn: 'Tillegg for panorama glasstak', antall: 1 }]);
  });
  it('antall, ukjent nummer og tekst som ikke passer', () => {
    const kia = PRODUKTER.filter((p) => p.modell_slug === 'kia-ev9');
    expect(tolkTilvalg('510 Gummimatte heldekkende gulv x 2', kia).linjer[0].antall).toBe(2);
    expect(tolkTilvalg('599 Noe helt annet', kia).grunner[0]).toMatch(/ikke kjennes igjen/);
    expect(tolkTilvalg('510 Gummimatte heldekkende gulv 599 Takboks', kia).grunner[0]).toMatch(/ikke kjennes igjen/);
    expect(tolkTilvalg('505 Noe annet enn gulvet', kia).grunner.length).toBe(1);
    expect(tolkTilvalg('1600 Standard ombygging', kia).grunner.length).toBe(1); // tilhører en annen modell
  });
});

describe('vurderRad: rett på ordren bare ved sikkert treff', () => {
  it('alt stemmer: sikker, ombyggingen og tilvalget som linjer', () => {
    const v = vurderRad(rad(), ctx());
    expect(v.grunner).toEqual([]);
    expect(v.sikker).toBe(true);
    expect(v.modell_slug).toBe('kia-ev9');
    expect(v.linjer).toEqual([{ produktnummer: '500', navn: 'Standard ombygging', antall: 1 }, { produktnummer: '501', navn: 'Tillegg for panorama glasstak', antall: 1 }]);
  });
  it('e-posten fra skjermbildet (to rader) er sikker', () => {
    const { rader } = tolkEpost(htmlTilTekst(HTML));
    expect(rader.map((r) => vurderRad(r, ctx()).sikker)).toEqual([true, true]);
  });
  it('mengde 2 følger med på ombyggingen', () => {
    const v = vurderRad(rad({ mengde: 2, belop: 77840, tilvalgTekst: '', totalTilvalg: 0, totalInkl: 77840 }), ctx());
    expect(v.sikker).toBe(true);
    expect(v.linjer[0].antall).toBe(2);
  });
  const stopper = (over, c, forventet) => {
    const v = vurderRad(rad(over), ctx(c));
    expect(v.sikker).toBe(false);
    expect(v.grunner.join(' · ')).toMatch(forventet);
  };
  it('hver kontroll stopper', () => {
    stopper({}, { avsenderFeil: 'Ukjent avsender: x' }, /Ukjent avsender/);
    stopper({}, { autentiseringFeil: 'Avsenderen er ikke bekreftet (SPF/DKIM)' }, /SPF/);
    stopper({ chassis: null }, {}, /Chassis.nr mangler/);
    stopper({ grunnTekst: 'Ukjent modell ombygning' }, {}, /Modellen kjennes ikke igjen/);
    stopper({ grunnTekst: 'KIA EV9 personbil' }, {}, /Fant ikke personbil/);
    stopper({ pris: 40000, belop: 40000, totalInkl: 43000 }, {}, /ikke Fiken-prisen/);
    stopper({ totalTilvalg: 4200, totalInkl: 43120 }, {}, /Summen går ikke opp: tilvalgene er 3\s000/);
    stopper({ totalInkl: 50000 }, {}, /Summen går ikke opp/);
    stopper({ tilvalgTekst: '599 Takboks' }, {}, /ikke kjennes igjen/);
    stopper({ tilvalgTekst: '', totalTilvalg: 3000 }, {}, /ingen tilvalg står oppført/);
    stopper({}, { fikenPriser: PRISER.filter((p) => p.produktnummer !== '501') }, /Fiken-pris for alle tilvalgene/);
    stopper({ mengde: 0 }, {}, /Ugyldig mengde/);
  });
});

describe('flyt: hele e-posten fra Resend til lagring (falske avhengigheter)', async () => {
  const { behandleEpost, autentiseringFeil, header } = await import('../supabase/functions/epost-bestilling/flyt.ts');
  const kjør = async (epost) => {
    const lagret = [];
    const r = await behandleEpost('test-email-id-1', {
      hentEpost: async () => epost,
      hentData: async () => ({ produkter: PRODUKTER, fikenPriser: PRISER, kontakter: KONTAKTER }),
      lagre: async (p) => { lagret.push(p); return {}; },
    });
    return { r, p: lagret[0] };
  };
  it('kjent selger og riktig e-post: to sikre rader med forhandleren', async () => {
    const { r, p } = await kjør({ from: 'TEST Selger <selger@example.no>', html: HTML });
    expect(r).toEqual({ utfall: 'lagret', rader: 2, sikre: 2 });
    expect(p).toMatchObject({ melding_id: 'test-email-id-1', avsender: 'selger@example.no', kontakt_id: 'k_test_a', kontakt_navn: 'TEST Forhandler A AS', selger_navn: 'TEST Selger' });
    expect(p.rader.map((x) => x.chassis)).toEqual(['TESTWXYZ000000051', 'TESTWXYZ000000052']);
    expect(p.rader[0].linjer.map((l) => l.produktnummer)).toEqual(['500', '505', '510']);
  });
  it('ukjent selger: alle rader til Innkommende, uten forhandler', async () => {
    const { r, p } = await kjør({ from: 'ukjent@example.no', html: HTML });
    expect(r.sikre).toBe(0);
    expect(p.kontakt_id).toBe(null);
    expect(p.rader[0].grunner[0]).toMatch(/Ukjent avsender/);
  });
  it('e-post uten bestilling gir én rad i Innkommende', async () => {
    const { p } = await kjør({ from: 'selger@example.no', text: 'Hei! Se vedlegg.' });
    expect(p.rader).toHaveLength(1);
    expect(p.rader[0]).toMatchObject({ sikker: false, linjer: [] });
    expect(p.rader[0].grunner[0]).toMatch(/Fant ingen bestilling/);
  });
  it('feilet DMARC stopper; bestått eller manglende kontroll stopper ikke', async () => {
    expect(autentiseringFeil({ 'Authentication-Results': 'mx; dmarc=fail header.from=example.no' })).toMatch(/DMARC/);
    expect(autentiseringFeil([{ name: 'authentication-results', value: 'mx; spf=fail; dkim=none' }])).toMatch(/SPF/);
    expect(autentiseringFeil({ 'authentication-results': 'mx; spf=pass; dkim=pass; dmarc=pass' })).toBe(null);
    expect(autentiseringFeil({})).toBe(null);
    expect(header([{ name: 'X-A', value: '1' }], 'x-a')).toBe('1');
    const { r } = await kjør({ from: 'selger@example.no', html: HTML, headers: { 'authentication-results': 'dmarc=fail' } });
    expect(r.sikre).toBe(0);
  });
  it('ugyldig id eller e-post som ikke finnes: ingenting lagres', async () => {
    const lagret = [];
    const dep = { hentEpost: async () => null, hentData: async () => ({ produkter: [], fikenPriser: [], kontakter: [] }), lagre: async (p) => lagret.push(p) };
    expect((await behandleEpost('ugyldig id!', dep)).utfall).toBe('ugyldig_id');
    expect((await behandleEpost('test-email-id-2', dep)).utfall).toBe('fant_ikke_epost');
    expect(lagret).toEqual([]);
  });
});

describe('signatur (Svix) på Resend-varselet', async () => {
  const { signaturOk } = await import('../supabase/functions/epost-bestilling/signatur.ts');
  const { createHmac } = await import('node:crypto');
  const nokkel = Buffer.from('TEST-hemmelighet-bare-for-test-0123456789');
  const secret = 'whsec_' + nokkel.toString('base64');
  const naa = 1795000000000;
  const ts = String(naa / 1000);
  const body = '{"type":"email.received","data":{"email_id":"test"}}';
  const sig = (b, t = ts, k = nokkel) => 'v1,' + createHmac('sha256', k).update(`msg_test.${t}.${b}`).digest('base64');
  it('riktig signatur godtas, også blant flere', async () => {
    expect(await signaturOk(secret, 'msg_test', ts, body, sig(body), naa)).toBe(true);
    expect(await signaturOk(secret, 'msg_test', ts, body, 'v1,feil ' + sig(body), naa)).toBe(true);
  });
  it('endret innhold, feil nøkkel, gammelt tidsstempel og manglende felt avvises', async () => {
    expect(await signaturOk(secret, 'msg_test', ts, body + ' ', sig(body), naa)).toBe(false);
    expect(await signaturOk(secret, 'msg_test', ts, body, sig(body, ts, Buffer.from('annen')), naa)).toBe(false);
    const gammel = String(naa / 1000 - 600);
    expect(await signaturOk(secret, 'msg_test', gammel, body, sig(body, gammel), naa)).toBe(false);
    expect(await signaturOk(secret, '', ts, body, sig(body), naa)).toBe(false);
    expect(await signaturOk('ikke-whsec', 'msg_test', ts, body, sig(body), naa)).toBe(false);
  });
});
