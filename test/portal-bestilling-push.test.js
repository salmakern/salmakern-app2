// Push-varsel til administratorer for bestillinger fra Forhandlerportalen (supabase/functions/portal-bestilling/push.ts, G9).
// byggVarsel og sendPushTilAdmin testes direkte (ingen Deno/web-push: sender og database er falske). Hele håndtereren med push ligger i test/portal-bestilling.test.js.
import { describe, it, expect } from 'vitest';
import { byggVarsel, sendPushTilAdmin, PUSH_STATUSER } from '../supabase/functions/portal-bestilling/push.ts';

const RAD = { forhandler_navn: 'AK Auto AS', merke: 'KIA', modell: 'EV9', ident: 'TESTWXYZ000000001', ident_type: 'CHASSIS', ordre_id: 'ord_1788100000000_abc123' };

describe('byggVarsel', () => {
  it('ny ordre: forhandler · bil · chassis, ikke bekreftet, med lenke til ordren', () => {
    expect(byggVarsel('ny_ordre', RAD)).toEqual({ title: 'Ny bestilling fra portalen', body: 'AK Auto AS · KIA EV9 · TESTWXYZ000000001 (ikke bekreftet)', url: '/salmakern.html?ordre=ord_1788100000000_abc123' });
  });

  it('serienummer i Admin-ark: «serienr», ingen ordrelenke', () => {
    expect(byggVarsel('admin_ark', { ...RAD, ident: 'BU 39953', ident_type: 'SERIENUMMER', ordre_id: null, merke: '', modell: '' }))
      .toEqual({ title: 'Ny serienummer-bestilling fra portalen', body: 'AK Auto AS · serienr BU 39953 - ligger i Admin-ark', url: '/salmakern.html' });
  });

  it('forhandlerens bestillingsnr i Admin-ark: «bestillingsnr» (ikke serienr), egen tittel, ingen ordrelenke', () => {
    expect(byggVarsel('admin_ark', { ...RAD, ident: 'BN-4711/A', ident_type: 'BESTILLINGSNR', ordre_id: null, merke: '', modell: '' }))
      .toEqual({ title: 'Ny bestilling (bestillingsnr) fra portalen', body: 'AK Auto AS · bestillingsnr BN-4711/A - ligger i Admin-ark', url: '/salmakern.html' });
  });

  it('hver avklaring har sin egen korte forklaring', () => {
    const forventet = {
      venter_forhandler: 'forhandleren er ikke koblet til Kontakter',
      venter_modell: 'modellen mangler oversettelse',
      avklaring_chassis: 'chassis.nr må avklares',
      avklaring_annen_forhandler: 'bilen står på en annen forhandler',
      avklaring_tak: 'for mange ubekreftede ordrer hos forhandleren',
    };
    for (const [status, tekst] of Object.entries(forventet)) {
      const v = byggVarsel(status, RAD);
      expect(v.title, status).toBe('Bestilling fra portalen trenger avklaring');
      expect(v.body, status).toBe(`AK Auto AS · KIA EV9 · TESTWXYZ000000001 - ${tekst}`);
      expect(v.url, status).toBe('/salmakern.html');
    }
  });

  it('koblet, avvist, bekreftet og ukjente statuser gir ingen varsel; alle PUSH_STATUSER gir ett', () => {
    for (const s of ['koblet', 'avvist', 'bekreftet', 'noe_nytt', '', 'NY_ORDRE']) expect(byggVarsel(s, RAD), s).toBeNull();
    for (const s of PUSH_STATUSER) expect(byggVarsel(s, RAD), s).not.toBeNull();
  });

  it('manglende felt gir «Ukjent forhandler» og ingen tomme «·»-ledd', () => {
    expect(byggVarsel('venter_forhandler', { ident: 'TESTWXYZ000000001', ident_type: 'CHASSIS' }).body).toBe('Ukjent forhandler · TESTWXYZ000000001 - forhandleren er ikke koblet til Kontakter');
    expect(byggVarsel('ny_ordre', {}).body).toBe('Ukjent forhandler (ikke bekreftet)');
  });

  it('rensing: kontroll- og retningstegn fjernes, mellomrom samles, lange tekster kappes, ugyldig ordre-id gir ingen lenke', () => {
    const v = byggVarsel('ny_ordre', { ...RAD, forhandler_navn: 'Eks\u0000em\n\u202epel   AS' + 'x'.repeat(200), ordre_id: 'ord_1" onclick="x' });
    expect(v.body).not.toMatch(/[\u0000-\u001f\u202e]/);
    expect(v.body.length).toBeLessThan(160);
    expect(v.body).toContain('…');
    expect(v.url).toBe('/salmakern.html');
    expect(byggVarsel('ny_ordre', { ...RAD, ordre_id: 'a'.repeat(65) }).url).toBe('/salmakern.html');
  });
});

// Falsk database: hver sporring besvares av `svar(tabell, q)`.
function fakeDb(svar) {
  const sporringer = [];
  return {
    sporringer,
    from(tabell) {
      const q = { tabell, ops: [], eq: [], is: [] };
      const b = {
        select() { q.ops.push('select'); return b; }, update(v) { q.ops.push('update'); q.verdi = v; return b; }, delete() { q.ops.push('delete'); return b; },
        eq(k, v) { q.eq.push([k, v]); return b; }, is(k, v) { q.is.push([k, v]); return b; }, in(k, v) { q.in = [k, v]; return b; },
        then(ok, nei) { sporringer.push(q); return Promise.resolve().then(() => svar(tabell, q)).then(ok, nei); },
      };
      return b;
    },
  };
}
const ok = (data) => ({ data, error: null });
const SUB = { endpoint: 'https://push.example.test/a', p256dh: 'p', auth: 'a' };
const standard = (over = {}) => (tabell, q) => (over[tabell] ? over[tabell](q) : tabell === 'portal_bestillinger' ? ok([RAD]) : tabell === 'ansatte' ? ok([{ id: 1 }]) : tabell === 'push_abonnement' ? ok([SUB]) : ok([]));
const sender = (logg, feil) => async () => async (sub, melding) => { logg.push([sub, melding]); if (feil) throw feil; };

describe('sendPushTilAdmin', () => {
  it('sender til admin-abonnementene med varsel bygget av raden, og claimer først', async () => {
    const db = fakeDb(standard());
    const sendt = [];
    const r = await sendPushTilAdmin(db, 'cm9testbestilling0001', 'ny_ordre', sender(sendt));
    expect(r).toEqual({ sendt: 1, feilet: 0, fjernet: 0 });
    expect(db.sporringer.map((q) => q.tabell)).toEqual(['portal_bestillinger', 'ansatte', 'push_abonnement']);
    expect(JSON.parse(sendt[0][1]).title).toBe('Ny bestilling fra portalen');
  });

  it('ikke-aktuelle statuser rører ikke databasen og henter ikke engang web-push', async () => {
    const db = fakeDb(standard());
    let hentet = 0;
    const r = await sendPushTilAdmin(db, 'x', 'koblet', async () => { hentet++; return null; });
    expect(r).toMatchObject({ hoppet: 'ikke_aktuell', sendt: 0 });
    expect(db.sporringer).toHaveLength(0);
    expect(hentet).toBe(0);
  });

  it('uten web-push-oppsett: ingen claim', async () => {
    const db = fakeDb(standard());
    const r = await sendPushTilAdmin(db, 'x', 'ny_ordre', async () => null);
    expect(r).toMatchObject({ hoppet: 'ingen_vapid' });
    expect(db.sporringer).toHaveLength(0);
  });

  it('claim-feil og allerede claimet gir ingen sending', async () => {
    const sendt = [];
    let r = await sendPushTilAdmin(fakeDb(standard({ portal_bestillinger: () => ({ data: null, error: { message: 'x' } }) })), 'x', 'ny_ordre', sender(sendt));
    expect(r).toMatchObject({ feil: 'claim', sendt: 0 });
    r = await sendPushTilAdmin(fakeDb(standard({ portal_bestillinger: () => ok([]) })), 'x', 'ny_ordre', sender(sendt));
    expect(r).toMatchObject({ hoppet: 'allerede_sendt' });
    expect(sendt).toHaveLength(0);
  });

  it('ingen admin eller ingen abonnement: ingen sending, og feil ved oppslag gir feilkode', async () => {
    const sendt = [];
    expect(await sendPushTilAdmin(fakeDb(standard({ ansatte: () => ok([]) })), 'x', 'ny_ordre', sender(sendt))).toMatchObject({ hoppet: 'ingen_mottakere' });
    expect(await sendPushTilAdmin(fakeDb(standard({ push_abonnement: () => ok([]) })), 'x', 'ny_ordre', sender(sendt))).toMatchObject({ hoppet: 'ingen_mottakere' });
    expect(await sendPushTilAdmin(fakeDb(standard({ ansatte: () => ({ data: null, error: { message: 'x' } }) })), 'x', 'ny_ordre', sender(sendt))).toMatchObject({ feil: 'adminer' });
    expect(await sendPushTilAdmin(fakeDb(standard({ push_abonnement: () => ({ data: null, error: { message: 'x' } }) })), 'x', 'ny_ordre', sender(sendt))).toMatchObject({ feil: 'abonnement' });
    expect(sendt).toHaveLength(0);
  });

  it('feil ved sending telles; bare 404/410 fjerner abonnementet', async () => {
    for (const [kode, fjernet] of [[404, 1], [410, 1], [500, 0], [undefined, 0]]) {
      const db = fakeDb(standard());
      const r = await sendPushTilAdmin(db, 'x', 'ny_ordre', sender([], Object.assign(new Error('feil'), { statusCode: kode })));
      expect(r, String(kode)).toEqual({ sendt: 0, feilet: 1, fjernet });
      expect(db.sporringer.filter((q) => q.ops.includes('delete')).length, String(kode)).toBe(fjernet);
    }
  });
});
