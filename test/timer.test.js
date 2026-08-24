import { describe, it, expect } from 'vitest';
import { loadScript } from './helpers/load-script.js';

// timer.js sine DOM-avhengige funksjoner (initTimerPage, updateClock osv.)
// kalles aldri her - de rene beregningsfunksjonene lastes bare inn i en
// isolert context uten document/window, akkurat som en vanlig Node-modul.
const { beregnNettoMinutter, beregnManuellMinutter, beregnOvertid, erHelg } = loadScript('timer.js');

describe('beregnNettoMinutter (pauseregel for automatisk klokke)', () => {
  it('trekker ikke fra pause under 8 timer', () => {
    expect(beregnNettoMinutter(240)).toEqual({ pause: 0, netto: 240 });
  });
  it('trekker ikke fra pause for en kort økt', () => {
    expect(beregnNettoMinutter(20)).toEqual({ pause: 0, netto: 20 });
  });
  it('trekker fra 30 min pause ved nøyaktig 8 timer (480 min)', () => {
    expect(beregnNettoMinutter(480)).toEqual({ pause: 30, netto: 450 });
  });
  it('trekker fra 30 min pause over 8 timer', () => {
    expect(beregnNettoMinutter(510)).toEqual({ pause: 30, netto: 480 });
  });
  it('går aldri under 0 netto minutter', () => {
    expect(beregnNettoMinutter(0).netto).toBe(0);
  });
});

describe('beregnManuellMinutter (manuell timeregistrering)', () => {
  // Regresjonstest for feilen fikset 2026-08-24: manuell registrering trakk
  // FØR alltid fra 30 min pause uansett vaktlengde - en 4-timers halv dag ble
  // registrert som 3,5t, og en økt under 30 min ble registrert som 0 minutter.
  it('full arbeidsdag (07:30-15:30, 8t) gir 450 min etter pause', () => {
    expect(beregnManuellMinutter('07:30', '15:30').mins).toBe(450);
  });
  it('halv dag (07:30-11:30, 4t) skal IKKE miste 30 min pause', () => {
    expect(beregnManuellMinutter('07:30', '11:30').mins).toBe(240);
  });
  it('kort økt (09:00-09:20, 20 min) skal IKKE bli 0', () => {
    expect(beregnManuellMinutter('09:00', '09:20').mins).toBe(20);
  });
  it('gir samme resultat som beregnNettoMinutter for samme rå-minutter', () => {
    const manuell = beregnManuellMinutter('08:00', '16:30'); // 8,5t
    const auto = beregnNettoMinutter(510);
    expect(manuell.mins).toBe(auto.netto);
    expect(manuell.pause).toBe(auto.pause);
  });
});

describe('erHelg', () => {
  it('kjenner igjen lørdag og søndag', () => {
    expect(erHelg('2026-08-22')).toBe(true); // lørdag
    expect(erHelg('2026-08-23')).toBe(true); // søndag
  });
  it('kjenner igjen en hverdag', () => {
    expect(erHelg('2026-08-24')).toBe(false); // mandag
  });
});

describe('beregnOvertid', () => {
  it('all tid på helg regnes som 100% overtid', () => {
    expect(beregnOvertid(300, '2026-08-22')).toEqual({ normal: 0, ot50: 0, ot100: 300 });
  });
  it('under 7,5 timer på hverdag er alt normaltid', () => {
    expect(beregnOvertid(400, '2026-08-24')).toEqual({ normal: 400, ot50: 0, ot100: 0 });
  });
  it('nøyaktig 7,5 timer (450 min) er alt normaltid, ingen overtid', () => {
    expect(beregnOvertid(450, '2026-08-24')).toEqual({ normal: 450, ot50: 0, ot100: 0 });
  });
  it('7,5-11,5 timer gir 50% overtid på resten', () => {
    // 450 normal + 120 min (2t) 50%-overtid = 570 min totalt
    expect(beregnOvertid(570, '2026-08-24')).toEqual({ normal: 450, ot50: 120, ot100: 0 });
  });
  it('over 11,5 timer gir 100% overtid på resten', () => {
    // 450 normal + 240 (maks 50%) + 60 min (1t) 100%-overtid = 750 min totalt
    expect(beregnOvertid(750, '2026-08-24')).toEqual({ normal: 450, ot50: 240, ot100: 60 });
  });
});
