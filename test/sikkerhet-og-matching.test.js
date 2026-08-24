import { describe, it, expect } from 'vitest';
import { loadScript } from './helpers/load-script.js';

describe('esc (HTML-escaping mot XSS)', () => {
  const { esc } = loadScript('ordre-detalj.js');

  it('lar vanlig tekst stå uendret', () => {
    expect(esc('Skien')).toBe('Skien');
    expect(esc('21.08 - 11:30 Skien')).toBe('21.08 - 11:30 Skien');
  });

  it('nøytraliserer et forsøk på å injisere en tag', () => {
    const resultat = esc('<img src=x onerror=alert(1)>');
    expect(resultat).not.toContain('<img');
    expect(resultat).toContain('&lt;img');
  });

  it('nøytraliserer et forsøk på å bryte ut av et HTML-attributt (anførselstegn)', () => {
    const resultat = esc('x" onmouseover="alert(1)');
    expect(resultat).not.toContain('"');
    expect(resultat).toContain('&quot;');
  });

  it('escaper & slik at entiteter ikke dobbel-tolkes', () => {
    expect(esc('Skinn & Lær')).toBe('Skinn &amp; Lær');
  });

  it('tåler tomt/manglende input uten å kaste feil', () => {
    expect(esc('')).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(null)).toBe('');
  });
});

describe('samsvarerChassis (case-uavhengig chassis-sammenligning)', () => {
  // admin-ark.js binder en event-listener på toppnivå (utenfor enhver funksjon)
  // for å huske manuelt endret tabellstørrelse - trenger derfor minimale
  // document/window-stubber selv om samsvarerChassis() selv ikke rører DOM-en.
  const { samsvarerChassis } = loadScript('admin-ark.js', {
    window: { addEventListener() {} },
    document: { addEventListener() {} }
  });

  it('matcher identiske chassisnummer', () => {
    expect(samsvarerChassis('WBA12345', 'WBA12345')).toBe(true);
  });

  it('matcher uavhengig av store/små bokstaver', () => {
    // Regresjonstest for feilen fikset tidligere i dag: admin-ark matchet
    // ikke chassis mot ordre hvis en av dem var skrevet med små bokstaver.
    expect(samsvarerChassis('wba12345', 'WBA12345')).toBe(true);
    expect(samsvarerChassis('WBA12345', 'wba12345')).toBe(true);
  });

  it('matcher uavhengig av mellomrom rundt verdien', () => {
    expect(samsvarerChassis('  WBA12345  ', 'WBA12345')).toBe(true);
  });

  it('matcher ikke forskjellige chassisnummer', () => {
    expect(samsvarerChassis('WBA12345', 'WBA99999')).toBe(false);
  });

  it('returnerer false for tomme/manglende verdier i stedet for å kaste feil', () => {
    expect(samsvarerChassis('', 'WBA12345')).toBe(false);
    expect(samsvarerChassis(null, 'WBA12345')).toBe(false);
    expect(samsvarerChassis(undefined, undefined)).toBe(false);
  });
});
