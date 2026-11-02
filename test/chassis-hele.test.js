import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Henrik 2026-11-02 (med skjermbilde fra iPhone): chassis.nr på ordrekortet i "Ordre"-lista ble
// avkortet fra venstre ("…8156T6077262") fordi statusdropdownen skulle stå ved siden av. Nå skal
// HELE nummeret alltid vises: aldri avkortet (ingen RTL/ellipsis-knepet) og aldri delt midt i
// nummeret (white-space:nowrap), og raden bryter heller slik at statusdropdownen havner under.
// Selve utseendet er kontrollert i nettleseren på 393, 360 og 320 px; testene under vokter at
// den gamle avkortingen ikke kommer tilbake.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const detalj = les('js/ordre-detalj.js');
const liste = les('js/oversikt-kalender.js');

describe('chassis.nr vises helt (ikke avkortet) i ordrekortet og ordredetaljen', () => {
  it('den gamle avkortingsstilen (CHASSIS_TRUNKER_STIL, RTL + ellipsis) finnes ikke lenger', () => {
    for (const kilde of [detalj, liste]) {
      expect(kilde).not.toContain('CHASSIS_TRUNKER_STIL');
      expect(kilde).not.toContain('direction:rtl');
    }
  });

  it('CHASSIS_HEL_STIL er white-space:nowrap uten overflow/ellipsis', () => {
    const m = detalj.match(/const CHASSIS_HEL_STIL = '([^']*)';/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('white-space:nowrap');
    expect(m[1]).not.toMatch(/overflow|ellipsis/);
  });

  it('ordrekortet i lista bruker CHASSIS_HEL_STIL på begge chassis-visningene (med og uten reg.nr)', () => {
    expect((liste.match(/CHASSIS_HEL_STIL/g) || []).length).toBe(2);
  });

  it('raden kan bryte (flex-wrap:wrap) og venstrekolonnen har flex:1 1 0 uten overflow:hidden/min-width:0, så nummerets bredde utløser bruddet', () => {
    expect(liste).toMatch(/display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:8px 12px/);
    expect(liste).toMatch(/onclick="openOrdre\('\$\{o\.id\}'\)" style="cursor:pointer;flex:1 1 0"/);
    expect(detalj).toMatch(/<div class="row" style="flex-wrap:wrap;align-items:center;gap:8px 12px">\n\s*<div style="flex:1 1 0">/);
  });

  it('et langt kundenavn kan ikke presse kortet bredere (egen avkorting som ikke teller i bredden)', () => {
    expect(liste).toMatch(/white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:0;min-width:100%">\$\{esc\(o\.kunde\)\}/);
  });
});

// Henrik 2026-11-02 (skjermbilde av ordredetaljen): «Vedtak» skal stå ved siden av «Aktiv» i headeren i stedet for under,
// så toppen blir lavere (mye ubrukt plass). Statusknappen står over, og PORTAL-merket under raden som før.
describe('ordredetaljen: Vedtak står på samme rad som Aktiv', () => {
  it('Aktiv-pillen og Vedtak-avkrysningen ligger i samme rad (egen flex-rad), mellom statusknappen og PORTAL-merket', () => {
    const rad = detalj.match(/\$\{statusDropdown\(o\.id, o\.ordreStatus, 'font-size:13px[^\n]*\n([\s\S]*?)\$\{portalBadgeHTML\(o, true\)\}/);
    expect(rad).not.toBeNull();
    const blokk = rad[1];
    expect(blokk).toMatch(/^\s*<div style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:5px 12px">/);
    expect(blokk).toContain('class="pill ${o.godkjent');
    expect(blokk).toContain('toggleGodkjentBiltilsyn');
    // pillen kommer før avkrysningen i samme rad, og raden lukkes før PORTAL-merket
    expect(blokk.indexOf('class="pill')).toBeLessThan(blokk.indexOf('toggleGodkjentBiltilsyn'));
    expect(blokk.trim().endsWith('</div>')).toBe(true);
  });
});
