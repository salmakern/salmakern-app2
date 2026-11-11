import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { lastApp } from './helpers/app-harness.js';

// Ordre-lapp på Leitz Icon (Henrik 2026-11-11): utskriftsstasjonen skriver ut en 60 x 25 mm lapp med QR for hver ny bil-ordre, én gang per ordre.
// Ingen ekte skriver: skrivUtHtml byttes ut med en spion, og QR-en leses tilbake med jsQR (samme skanner som appen).

const app = lastApp();
const { sandbox, S } = app;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../' + f), 'utf8').replace(/\r\n/g, '\n');
vm.runInContext(les('js/vendor/qrcode.js'), sandbox, { filename: 'qrcode.js' });
vm.runInContext(les('js/vendor/jsQR.js'), sandbox, { filename: 'jsQR.js' });

let lager;
let utskrifter;
const vent = () => new Promise((r) => setImmediate(r));
const ordre = (ms, ekstra = {}) => ({ id: 'ord_' + ms, chassis: 'WDB12345678901234', regnr: '', kunde: 'Kunde AS', merke: 'Mercedes', modell: 'Vito', status: 'aktiv', ordretype: 'bil', ...ekstra });

beforeEach(() => {
  lager = new Map();
  sandbox.localStorage = { getItem: (k) => (lager.has(k) ? lager.get(k) : null), setItem: (k, v) => lager.set(k, String(v)), removeItem: (k) => lager.delete(k) };
  utskrifter = [];
  sandbox.skrivUtHtml = (html) => utskrifter.push(html);
  S.ordrer = [];
  app.settMe({ id: 2, navn: 'Ansatt', rolle: 'ansatt' });
  vm.runInContext('_ordreLappKo = [];', sandbox);
});

function lesQr(tekst, px = 4, stille = 4) {
  const m = sandbox.qrMatrise(tekst);
  const side = (m.n + 2 * stille) * px;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) {
    if (!m.mork(r, c)) continue;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) { const i = (((r + stille) * px + y) * side + (c + stille) * px + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  }
  return sandbox.jsQR(data, side, side)?.data;
}

describe('ordre-lapp: innhold', () => {
  it('QR-koden åpner ordren i appen og leses tilbake', () => {
    expect(lesQr(sandbox.ordreLappUrl('ord_1762851234567'))).toBe('https://salmaker.as/salmakern.html?ordre=ord_1762851234567');
    expect(lesQr(sandbox.ordreLappUrl('ord_1762851234567_ab12cd'))).toBe('https://salmaker.as/salmakern.html?ordre=ord_1762851234567_ab12cd');
  });
  it('tidspunktet leses ut av id-en fra appen og fra portalen', () => {
    expect(sandbox.ordreLappIdMs('ord_1762851234567')).toBe(1762851234567);
    expect(sandbox.ordreLappIdMs('ord_1762851234567_ab12cd')).toBe(1762851234567);
    expect(sandbox.ordreLappIdMs('noe_annet')).toBe(null);
    expect(sandbox.ordreLappIdMs(null)).toBe(null);
  });
  it('lappen har hele chassis.nr, kunde, merke/modell og 60 x 25 mm side', () => {
    const html = sandbox.byggOrdreLappDokument([ordre(1762851234567, { regnr: 'EL12345' })]);
    expect(html).toContain('@page{size:25mm 60mm;margin:0}'); // stående, som driverens «Continuous - 1"»
    expect(html).toContain('rotate(90deg)');
    expect(html).toContain('WDB12345678901234');
    expect(html).toContain('Kunde AS');
    expect(html).toContain('Mercedes Vito · EL12345 · ');
    expect(html).toContain('<svg');
  });
  it('uten chassis står reg.nr som hovedlinje, og fritekst escapes', () => {
    const html = sandbox.ordreLappHTML(ordre(1762851234567, { chassis: '', regnr: 'AB12345', kunde: '<img src=x onerror=alert(1)>' }));
    expect(html).toContain('>AB12345<');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
  it('17 tegn chassis får skrift som rommes på tekstfeltet (ca. 34 mm)', () => {
    const mm = sandbox.ordreLappSkriftMm('WDB12345678901234');
    expect(17 * 0.68 * mm).toBeLessThanOrEqual(34.01);
    expect(sandbox.ordreLappSkriftMm('AB12345')).toBe(3.4);
  });
});

describe('ordre-lapp: utskriftsstasjon', () => {
  it('skriver ingenting når stasjonen er av (standard på alle enheter)', async () => {
    sandbox.ordreLappNyOrdre(ordre(Date.now()));
    sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(0);
  });
  it('når den slås på, skrives ingen eksisterende ordre ut, men en ny ordre skrives ut én gang', async () => {
    S.ordrer = [ordre(Date.now() - 1000)];
    sandbox.settOrdreLappStasjon(true);
    sandbox.ordreLappTaIgjen(); sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(0);

    const ny = ordre(Date.now() + 5, { chassis: 'TESTWXYZ000000005' });
    S.ordrer.push(ny);
    sandbox.ordreLappNyOrdre(ny);
    sandbox.ordreLappNyOrdre(ny); // to Realtime-hendelser / to faner
    sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(1);
    expect(utskrifter[0]).toContain('TESTWXYZ000000005');
    expect(utskrifter[0]).not.toContain('WDB12345678901234');

    sandbox.ordreLappNyOrdre(ny); sandbox.ordreLappTaIgjen(); sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(1);
  });
  it('flere nye ordrer tett etter hverandre blir én utskriftsjobb med én side per ordre', async () => {
    sandbox.settOrdreLappStasjon(true);
    const a = ordre(Date.now() + 10), b = ordre(Date.now() + 20, { chassis: 'TESTWXYZ000000002' });
    S.ordrer.push(a, b);
    sandbox.ordreLappNyOrdre(a); sandbox.ordreLappNyOrdre(b);
    sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(1);
    expect(utskrifter[0].match(/class="lapp"/g)).toHaveLength(2);
  });
  it('leveranser, arkiverte ordrer og ordrer fra før stasjonen ble slått på får ingen lapp', async () => {
    sandbox.settOrdreLappStasjon(true);
    const fra = Date.now();
    sandbox.ordreLappNyOrdre(ordre(fra + 10, { ordretype: 'leveranse' }));
    sandbox.ordreLappNyOrdre(ordre(fra + 11, { status: 'arkivert' }));
    sandbox.ordreLappNyOrdre(ordre(fra - 60000));
    sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(0);
  });
  it('ta igjen: en ordre som kom mens PC-en sov skrives ut etter innlasting (bare innlogget)', async () => {
    sandbox.settOrdreLappStasjon(true);
    const ny = ordre(Date.now() + 30);
    S.ordrer.push(ny);
    app.settMe(null);
    sandbox.ordreLappTaIgjen(); sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(0);
    app.settMe({ id: 2, navn: 'Ansatt', rolle: 'ansatt' });
    sandbox.ordreLappTaIgjen(); sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(1);
  });
  it('bruker den ferskeste lokale utgaven av ordren (kunde kan komme i en oppdatering rett etter)', async () => {
    sandbox.settOrdreLappStasjon(true);
    const ny = ordre(Date.now() + 40, { kunde: '' });
    sandbox.ordreLappNyOrdre(ny);
    S.ordrer.push({ ...ny, kunde: 'Oppdatert Kunde AS' });
    sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter[0]).toContain('Oppdatert Kunde AS');
  });
  it('slått av igjen: ingen flere lapper', async () => {
    sandbox.settOrdreLappStasjon(true);
    sandbox.settOrdreLappStasjon(false);
    sandbox.ordreLappNyOrdre(ordre(Date.now() + 50));
    sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(0);
  });
  it('blokkert lagring (Edge sporingsforebygging) krasjer ikke og slår ikke stasjonen på', async () => {
    sandbox.localStorage = { getItem() { throw new Error('blokkert'); }, setItem() { throw new Error('blokkert'); }, removeItem() { throw new Error('blokkert'); } };
    expect(() => sandbox.settOrdreLappStasjon(true)).not.toThrow();
    expect(sandbox.ordreLappStasjonFra()).toBe(0);
  });
  it('Realtime-INSERT på ordrer kaller utskriftsstasjonen', () => {
    expect(les('js/core.js')).toMatch(/eventType==='INSERT'\) \{\n.*S\.ordrer\.push\(dbToOrdre\(p\.new\)\).*\n.*\n\s*if \(typeof ordreLappNyOrdre === 'function'\)/);
  });
});

describe('ordre-lapp: skanning inne i appen (iPhone åpner kamera-QR i Safari)', () => {
  it('leser ordre-id ut av lappens lenke, og avviser alt annet', () => {
    expect(sandbox.ordreIdFraTekst('https://salmaker.as/salmakern.html?ordre=ord_1762851234567')).toBe('ord_1762851234567');
    expect(sandbox.ordreIdFraTekst('salmaker.as/salmakern.html?ordre=ord_1762851234567_ab12cd')).toBe('ord_1762851234567_ab12cd');
    expect(sandbox.ordreIdFraTekst('https://salmaker.as/salmakern.html?h=A1')).toBe('');
    expect(sandbox.ordreIdFraTekst("https://x/?ordre=ord_1');alert(1)//")).toBe('');
    expect(sandbox.ordreIdFraTekst('https://x/?ordre=%E0%A4%A')).toBe('');
    expect(sandbox.ordreIdFraTekst(null)).toBe('');
  });
  it('en skannet lapp (QR lest tilbake med jsQR) åpner ordren, også en arkivert', () => {
    const apnet = [];
    const gammel = sandbox.openOrdre;
    sandbox.openOrdre = (id, fraArkiv) => apnet.push([id, fraArkiv]);
    try {
      S.ordrer = [ordre(1762851234567), ordre(1762851234999, { status: 'arkivert' })];
      expect(sandbox.behandleSkannet(lesQr(sandbox.ordreLappUrl('ord_1762851234567')))).toBe(true);
      expect(sandbox.behandleSkannet(lesQr(sandbox.ordreLappUrl('ord_1762851234999')))).toBe(true);
      expect(apnet).toEqual([['ord_1762851234567', false], ['ord_1762851234999', true]]);
      expect(sandbox.behandleSkannet(sandbox.ordreLappUrl('ord_1700000000000'))).toBe(false); // ukjent/slettet ordre: kameraet fortsetter
      expect(apnet).toHaveLength(2);
    } finally { sandbox.openOrdre = gammel; }
  });
  it('Skann-knappen står på Ordre-siden', () => {
    expect(les('salmakern.html')).toMatch(/onclick="apneSkannModal\(\)"[^>]*>📷 Skann<\/button>\s*<button class="btn" onclick="apneNyLeveranseModal\(\)"/);
  });
});

describe('ordre-lapp: «🖨 Lapp» på ordren (eldre ordrer og ny lapp)', () => {
  it('vises bare der stasjonen er på, og ikke for leveranser', () => {
    expect(sandbox.ordreLappKnappHTML(ordre(1762851234567))).toBe('');
    sandbox.settOrdreLappStasjon(true);
    expect(sandbox.ordreLappKnappHTML(ordre(1762851234567))).toContain("skrivUtOrdreLappFor('ord_1762851234567')");
    expect(sandbox.ordreLappKnappHTML(ordre(1762851234567, { ordretype: 'leveranse' }))).toBe('');
  });
  it('skriver ut en eldre ordre og merker den, så den automatiske utskriften ikke tar den igjen', async () => {
    sandbox.settOrdreLappStasjon(true);
    const gammel = ordre(Date.now() + 70, { chassis: 'TESTWXYZ000000007' });
    S.ordrer = [gammel];
    sandbox.skrivUtOrdreLappFor(gammel.id); await vent();
    expect(utskrifter).toHaveLength(1);
    expect(utskrifter[0]).toContain('TESTWXYZ000000007');
    sandbox.ordreLappNyOrdre(gammel); sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(1);
    sandbox.skrivUtOrdreLappFor(gammel.id); await vent(); // ny lapp på forespørsel går alltid
    expect(utskrifter).toHaveLength(2);
  });
  it('knappen står i ordredetaljens topprad', () => {
    expect(les('js/ordre-detalj.js')).toContain("${typeof ordreLappKnappHTML === 'function' ? ordreLappKnappHTML(o) : ''}");
  });
});

describe('del-lapp 50 mm (annen PC, merke deler til bilen)', () => {
  it('linjene er merke + modell og hele chassis.nr, med store bokstaver; reg.nr når chassis mangler', () => {
    expect(sandbox.delLappLinjer(ordre(1, { merke: 'Kia', modell: 'EV9', chassis: 'knaae8158v6088145' }))).toEqual(['KIA EV9', 'KNAAE8158V6088145']);
    expect(sandbox.delLappLinjer(ordre(1, { merke: '', modell: '', chassis: '', regnr: 'US15133' }))).toEqual(['US15133']);
    expect(sandbox.delLappLinjer(ordre(1, { merke: '', modell: '', chassis: 'KNAAE8158V6088145', regnr: 'EL12345' }))).toEqual(['EL12345', 'KNAAE8158V6088145']);
  });
  it('dokumentet er stående 50 x 230 mm, uten QR, og fritekst escapes', () => {
    const html = sandbox.byggDelLappDokument([ordre(1, { merke: '<b>x</b>', modell: 'EV9' })]);
    expect(html).toContain('@page{size:50mm 230mm;margin:0}');
    expect(html).toContain('rotate(-90deg)');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<B>');
    expect(html).toContain('&lt;B');
  });
  it('hver linje har sin egen skrift: chassis.nr stort selv med langt modellnavn', () => {
    const html = sandbox.delLappHTML(ordre(1, { merke: 'Mercedes-Benz', modell: 'Sprinter 519 CDI', chassis: 'WDB12345678901234' }));
    const str = [...html.matchAll(/font-size:([\d.]+)mm/g)].map((m) => Number(m[1]));
    expect(str[1]).toBeGreaterThan(str[0]);
    expect(17 * 0.75 * str[1]).toBeLessThanOrEqual(218.01);
  });
  it('lapptypen velges per PC: del-lapp skrives ut uten QR, ordre-lapp er standard', async () => {
    sandbox.settOrdreLappStasjon(true);
    expect(sandbox.ordreLappType()).toBe('ordre');
    sandbox.settOrdreLappType('del');
    expect(sandbox.ordreLappType()).toBe('del');
    const ny = ordre(Date.now() + 90, { merke: 'KIA', modell: 'EV9' });
    S.ordrer = [ny];
    sandbox.ordreLappNyOrdre(ny); sandbox.ordreLappTomKo(); await vent();
    expect(utskrifter).toHaveLength(1);
    expect(utskrifter[0]).toContain('Del-lapp');
    expect(utskrifter[0]).toContain('KIA EV9');
    expect(utskrifter[0]).not.toContain('<svg');
    sandbox.settOrdreLappType('noe rart');
    expect(sandbox.ordreLappType()).toBe('ordre');
  });
});
