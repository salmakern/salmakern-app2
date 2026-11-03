// send-frakt-epost, type «leveranse_bestilling» (2026-11-03): fraktbestilling for en LEVERANSE (ordre uten bil). Hele funksjonen kjøres mot falsk Deno og en falsk database
// (PostgREST) med radvis claim-semantikk, så ingen ekte e-post sendes (Resend kalles aldri) og ingen ekte rad røres. Det som vokter: samme bestilling går aldri ut to
// ganger (også ved to samtidige kall), mottakeren kommer fra Kontakter (ikke fra klienten), og en mislykket sending frigir claimet så den kan prøves på nytt.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(path.resolve(__dirname, '../supabase/functions/send-frakt-epost/index.ts'), 'utf8').replace(/\r\n/g, '\n');
const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* borte */ } } });

const JWT = 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc';
const leveransen = (ekstra = {}) => ({
  id: 'ord_TESTLEV1', ordretype: 'leveranse', status: 'aktiv', ordre_status: 'klar_sending', kunde: 'TEST Kunde AS', eier: 'TEST Kontakt', regnr: '', chassis: '',
  leveranse: { merking: 'TEST-merking', adresse: 'Veien 1', postnr: '3734', sted: 'Skien', kontaktTlf: '12345678', fraktselskap: 'TEST Frakt', kolli: '2 pakker', onsketHentedato: '2026-11-15', fraktAuto: true },
  frakt_bestilt_at: null, frakt_bestilt_av: null, frakt_bestilt_til: null, ...ekstra,
});
const KONTAKTER = [{ type: 'Fraktselskap', navn: 'TEST Frakt', epost: 'frakt@selskap.test, ekstra@selskap.test' }, { type: 'Forhandler', navn: 'TEST Kunde AS', epost: 'kunde@test.test' }];

async function lastFunksjon({ ordre = [leveransen()], kontakter = KONTAKTER, resendOk = true, rolle = 'admin' } = {}) {
  const resend = []; const rest = []; let handler = null;
  const rader = new Map(ordre.map((o) => [o.id, structuredClone(o)]));
  const env = { RESEND_API_KEY: 'TEST-NOKKEL-IKKE-EKTE', FRAKT_EPOST_AVSENDER: 'post@salmaker.test', FRAKT_EPOST_BCC: 'bcc@salmaker.test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const metode = init.method || 'GET';
    if (u.host === 'api.resend.com') {
      if (!resendOk) return new Response('{"message":"feil"}', { status: 500 });
      resend.push(JSON.parse(init.body)); return new Response('{"id":"test"}', { status: 200 });
    }
    if (u.pathname === '/rest/v1/rpc/current_ansatt') return new Response(JSON.stringify([{ id: 1, rolle }]), { status: 200 });
    if (u.pathname === '/rest/v1/innstillinger') { rest.push(['GET', 'innstillinger']); return new Response(JSON.stringify([{ kontakter }]), { status: 200 }); }
    if (u.pathname === '/rest/v1/ordrer') {
      await Promise.resolve(); // slipp mikrooppgaver gjennom, så to samtidige kall faktisk veves inn i hverandre
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const rad = rader.get(id);
      if (metode === 'GET') { rest.push(['GET', 'ordrer']); return new Response(JSON.stringify(rad ? [structuredClone(rad)] : []), { status: 200 }); }
      if (metode === 'PATCH') {
        const f = u.searchParams.get('frakt_bestilt_at');
        const treff = rad && (f === null || (f === 'is.null' && rad.frakt_bestilt_at === null) || (f?.startsWith('eq.') && rad.frakt_bestilt_at === decodeURIComponent(f.slice(3))));
        rest.push(['PATCH', f ?? 'uten-filter']);
        if (!treff) return new Response('[]', { status: 200 });
        Object.assign(rad, JSON.parse(init.body));
        return new Response(JSON.stringify([structuredClone(rad)]), { status: 200 });
      }
    }
    return new Response('', { status: 404 });
  };
  const logOrig = console.log; console.log = () => {};
  const fil = path.resolve(__dirname, `_frakt_lev_tmp_${Math.random().toString(36).slice(2)}.ts`); tmpFiler.push(fil); writeFileSync(fil, kilde);
  try { await import(/* @vite-ignore */ pathToFileURL(fil).href); } finally { console.log = logOrig; }
  const kall = async (payload, headers = { authorization: 'Bearer ' + JWT }) => {
    const res = await handler(new Request('https://x.supabase.co/functions/v1/send-frakt-epost', { method: 'POST', headers, body: JSON.stringify(payload) }));
    const tekst = await res.text(); let json = null; try { json = JSON.parse(tekst); } catch { /* ren tekst */ }
    return { status: res.status, tekst, json };
  };
  return { kall, resend, rest, rader };
}
const BEST = { type: 'leveranse_bestilling', ordreId: 'ord_TESTLEV1', avsenderNavn: 'TEST Avsender' };

describe('leveranse_bestilling: vellykket bestilling', () => {
  it('sender e-post til fraktselskapets adresser fra Kontakter (ikke fra klienten), med innhold fra databasen, og claimer bestillingen', async () => {
    const { kall, resend, rader } = await lastFunksjon();
    const r = await kall({ ...BEST, fraktselskapEpost: 'ond@angriper.test', kontaktpersonEpost: 'kontakt@forhandler.test' });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(resend).toHaveLength(1);
    const m = resend[0];
    expect(m.to).toEqual(['frakt@selskap.test', 'ekstra@selskap.test']); // alltid fra Kontakter
    expect(JSON.stringify(m)).not.toContain('angriper');                  // klientens fraktselskapEpost ignoreres helt
    expect(m.cc).toEqual(['kontakt@forhandler.test']);
    expect(m.bcc).toEqual(['bcc@salmaker.test']);
    expect(m.subject).toBe('Bestilling av frakt - TEST-merking');
    for (const del of ['TEST-merking', 'TEST Kunde AS', 'TEST Kontakt', 'Veien 1, 3734 Skien', '12345678', '2 pakker', 'Bataljonvegen 25', '15.11.2026', 'TEST Avsender']) {
      expect(m.html).toContain(del); expect(m.text).toContain(del);
    }
    expect(rader.get('ord_TESTLEV1')).toMatchObject({ frakt_bestilt_av: 'TEST Avsender', frakt_bestilt_til: 'frakt@selskap.test, ekstra@selskap.test' });
    expect(rader.get('ord_TESTLEV1').frakt_bestilt_at).toBe(r.json.bestiltAt);
  });

  it('uten hentedato og uten kontaktperson-e-post: ingen datolinje og ingen cc', async () => {
    const { kall, resend } = await lastFunksjon({ ordre: [leveransen({ leveranse: { ...leveransen().leveranse, onsketHentedato: '' } })] });
    expect((await kall(BEST)).status).toBe(200);
    expect(resend[0].html).not.toContain('klar for å bli hentet');
    expect(resend[0].cc).toBeUndefined();
  });

  it('reg.nr og chassis tas med når de finnes, og merkingen faller tilbake til dem i emnet', async () => {
    const { kall, resend } = await lastFunksjon({ ordre: [leveransen({ regnr: 'AB12345', chassis: 'TESTLEV0000000001', leveranse: { ...leveransen().leveranse, merking: '' } })] });
    expect((await kall(BEST)).status).toBe(200);
    expect(resend[0].subject).toBe('Bestilling av frakt - AB12345');
    expect(resend[0].text).toContain('Reg.nr: AB12345');
    expect(resend[0].text).toContain('Chassis.nr: TESTLEV0000000001');
  });

  it('alt fra databasen escapes i HTML (ingen HTML-injeksjon via merking, adresse eller kunde)', async () => {
    const l = { ...leveransen().leveranse, merking: '<script>alert(1)</script>', adresse: '<img src=x onerror=1>' };
    const { kall, resend } = await lastFunksjon({ ordre: [leveransen({ kunde: '<b>Kunde</b>', leveranse: l })] });
    expect((await kall(BEST)).status).toBe(200);
    expect(resend[0].html).not.toContain('<script>');
    expect(resend[0].html).not.toContain('<img src=x');
    expect(resend[0].html).not.toContain('<b>Kunde</b>');
    expect(resend[0].html).toContain('&lt;script&gt;');
  });
});

describe('leveranse_bestilling: aldri to bestillinger', () => {
  it('står ikke i «Klar til sending»: 409 og ingenting sendes eller claimes', async () => {
    for (const st of ['under_arbeid', 'sendt', 'ikke_paabegynt']) {
      const { kall, resend, rader } = await lastFunksjon({ ordre: [leveransen({ ordre_status: st })] });
      expect((await kall(BEST)).status).toBe(409);
      expect(resend).toHaveLength(0);
      expect(rader.get('ord_TESTLEV1').frakt_bestilt_at).toBeNull();
    }
  });

  it('allerede bestilt: 409 og ingen ny e-post', async () => {
    const { kall, resend } = await lastFunksjon({ ordre: [leveransen({ frakt_bestilt_at: '2026-11-03T08:00:00.000Z', frakt_bestilt_av: 'Noen' })] });
    const r = await kall(BEST);
    expect(r.status).toBe(409);
    expect(resend).toHaveLength(0);
  });

  it('TO SAMTIDIGE kall: nøyaktig én e-post sendes, ett kall får 200 og det andre 409', async () => {
    const { kall, resend } = await lastFunksjon();
    const [a, b] = await Promise.all([kall(BEST), kall(BEST)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(resend).toHaveLength(1);
  });

  it('FEM samtidige kall: fortsatt nøyaktig én e-post', async () => {
    const { kall, resend } = await lastFunksjon();
    const alle = await Promise.all([1, 2, 3, 4, 5].map(() => kall(BEST)));
    expect(alle.filter((r) => r.status === 200)).toHaveLength(1);
    expect(alle.filter((r) => r.status === 409)).toHaveLength(4);
    expect(resend).toHaveLength(1);
  });
});

describe('leveranse_bestilling: mislykket sending frigir claimet', () => {
  it('Resend feiler: 502, claimet er frigitt (frakt_bestilt_at tom igjen), og et nytt forsøk går gjennom', async () => {
    const feil = await lastFunksjon({ resendOk: false });
    const r = await feil.kall(BEST);
    expect(r.status).toBe(502);
    expect(feil.rader.get('ord_TESTLEV1').frakt_bestilt_at).toBeNull();
    // samme rad, ny funksjon med fungerende Resend: bestillingen kan tas
    const ok = await lastFunksjon({ ordre: [feil.rader.get('ord_TESTLEV1')] });
    expect((await ok.kall(BEST)).status).toBe(200);
    expect(ok.resend).toHaveLength(1);
  });
});

describe('leveranse_bestilling: krav før noe sendes (400/404, aldri e-post, aldri claim)', () => {
  const uten = async (ordre, kontakter = KONTAKTER, payload = BEST) => {
    const f = await lastFunksjon({ ordre, kontakter }); const r = await f.kall(payload);
    expect(f.resend).toHaveLength(0);
    for (const rad of f.rader.values()) expect(rad.frakt_bestilt_at).toBeNull();
    return r;
  };
  const med = (l) => [leveransen({ leveranse: { ...leveransen().leveranse, ...l } })];

  it('mangler leveringsadresse, eller både postnr og sted', async () => {
    expect((await uten(med({ adresse: '' }))).status).toBe(400);
    expect((await uten(med({ postnr: '', sted: '' }))).status).toBe(400);
  });
  it('fraktselskap ikke valgt, «Hente selv» eller «Levering av oss» bestilles ikke på e-post', async () => {
    for (const f of ['', 'Hente selv', 'Levering av oss']) expect((await uten(med({ fraktselskap: f }))).status).toBe(400);
  });
  it('fraktselskapet finnes ikke i Kontakter, har ingen e-post eller en ugyldig e-post', async () => {
    expect((await uten(med({ fraktselskap: 'Ukjent' }))).status).toBe(400);
    expect((await uten(med({}), [{ type: 'Fraktselskap', navn: 'TEST Frakt', epost: '' }])).status).toBe(400);
    expect((await uten(med({}), [{ type: 'Fraktselskap', navn: 'TEST Frakt', epost: 'ikke-en-epost' }])).status).toBe(400);
    expect((await uten(med({}), [{ type: 'Forhandler', navn: 'TEST Frakt', epost: 'a@b.test' }])).status).toBe(400); // feil kontakttype
  });
  it('ingen kunde', async () => { expect((await uten([leveransen({ kunde: '' })])).status).toBe(400); });
  it('en bil-ordre kan ikke bestilles som leveranse, en arkivert leveranse heller ikke', async () => {
    expect((await uten([leveransen({ ordretype: 'bil' })])).status).toBe(400);
    expect((await uten([leveransen({ status: 'arkivert' })])).status).toBe(400);
  });
  it('ukjent ordre gir 404, ugyldig id gir 400', async () => {
    expect((await uten([], KONTAKTER, { ...BEST, ordreId: 'ord_FINNES_IKKE' })).status).toBe(404);
    for (const id of ['', 'a', '../x', 'ord;drop', 'x'.repeat(200), 123, null]) expect((await uten([leveransen()], KONTAKTER, { ...BEST, ordreId: id })).status).toBe(400);
  });
  it('ugyldig e-post for kontaktpersonen (cc) avvises', async () => {
    expect((await uten([leveransen()], KONTAKTER, { ...BEST, kontaktpersonEpost: 'ikke-gyldig, a@b.test' })).status).toBe(400);
  });
  it('kolonnen leveranse med feil form ({}, tekst, liste) gir 400 i stedet for kast', async () => {
    for (const l of [{}, 'tekst', [], null]) expect((await uten([leveransen({ leveranse: l })])).status).toBe(400);
  });
});

describe('leveranse_bestilling: send på nytt (bare admin)', () => {
  const alleredeBestilt = () => leveransen({ ordre_status: 'sendt', frakt_bestilt_at: '2026-11-03T08:00:00.000Z', frakt_bestilt_av: 'Forrige', frakt_bestilt_til: 'gammel@selskap.test' });

  it('admin kan sende på nytt selv om en er sendt (og uavhengig av status)', async () => {
    const { kall, resend, rader } = await lastFunksjon({ ordre: [alleredeBestilt()] });
    const r = await kall({ ...BEST, paaNytt: true });
    expect(r.status).toBe(200);
    expect(resend).toHaveLength(1);
    expect(rader.get('ord_TESTLEV1').frakt_bestilt_at).toBe(r.json.bestiltAt);
    expect(rader.get('ord_TESTLEV1').frakt_bestilt_av).toBe('TEST Avsender');
  });

  it('en vanlig ansatt får 403 og ingenting sendes', async () => {
    const { kall, resend, rader } = await lastFunksjon({ ordre: [alleredeBestilt()], rolle: 'ansatt' });
    expect((await kall({ ...BEST, paaNytt: true })).status).toBe(403);
    expect(resend).toHaveLength(0);
    expect(rader.get('ord_TESTLEV1').frakt_bestilt_av).toBe('Forrige');
  });

  it('uten innlogging (ingen token) får «på nytt» 403', async () => {
    const { kall, resend } = await lastFunksjon({ ordre: [alleredeBestilt()] });
    expect((await kall({ ...BEST, paaNytt: true }, {})).status).toBe(403);
    expect(resend).toHaveLength(0);
  });

  it('feiler sendingen ved «på nytt», gjenopprettes den FORRIGE bestillingen (ikke tomt)', async () => {
    const { kall, rader } = await lastFunksjon({ ordre: [alleredeBestilt()], resendOk: false });
    expect((await kall({ ...BEST, paaNytt: true })).status).toBe(502);
    expect(rader.get('ord_TESTLEV1')).toMatchObject({ frakt_bestilt_at: '2026-11-03T08:00:00.000Z', frakt_bestilt_av: 'Forrige', frakt_bestilt_til: 'gammel@selskap.test' });
  });

  it('paaNytt må være nøyaktig true (strengen «true» eller 1 gir vanlig oppførsel: allerede bestilt = 409)', async () => {
    for (const v of ['true', 1, 'ja']) {
      const { kall, resend } = await lastFunksjon({ ordre: [alleredeBestilt()] });
      expect((await kall({ ...BEST, paaNytt: v })).status).toBe(409);
      expect(resend).toHaveLength(0);
    }
  });
});
