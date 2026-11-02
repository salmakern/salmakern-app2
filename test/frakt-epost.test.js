// Edge-funksjonen send-frakt-epost (supabase/functions/send-frakt-epost): e-postene fra Admin-arket.
// Henrik 2026-11-02: når man bestiller frakt og velger dato for når bilen kan hentes, skal e-posten til fraktselskapet
// si at bilen er klar for å bli hentet fra den datoen. Testen kjører HELE funksjonen mot falsk Deno og falsk fetch
// (kildefilen kopieres til en midlertidig .ts-modul, samme teknikk som edge-auth-gate.test.js og portal-bestilling.test.js),
// så ingen ekte e-post sendes og Resend aldri kalles.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(path.resolve(__dirname, '../supabase/functions/send-frakt-epost/index.ts'), 'utf8').replace(/\r\n/g, '\n');

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

// Laster funksjonen og gir tilbake en klient som kaller håndtereren og samler det som ville gått til Resend.
async function lastFunksjon() {
  const resend = [];
  let handler = null;
  const logOrig = console.log;
  const env = { RESEND_API_KEY: 'TEST-NOKKEL-IKKE-EKTE', FRAKT_EPOST_AVSENDER: 'post@salmaker.test', FRAKT_EPOST_BCC: 'bcc@salmaker.test' };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/')) { resend.push(JSON.parse(init.body)); return new Response('{"id":"test"}', { status: 200 }); }
    return new Response('', { status: 404 }); // logoen hentes ikke i testen (signaturen utelater den)
  };
  console.log = () => {};
  const fil = path.resolve(__dirname, `_frakt_tmp_${Math.random().toString(36).slice(2)}.ts`);
  tmpFiler.push(fil);
  writeFileSync(fil, kilde);
  try { await import(/* @vite-ignore */ pathToFileURL(fil).href); } finally { console.log = logOrig; }
  const kall = async (payload) => {
    const res = await handler(new Request('https://x.supabase.co/functions/v1/send-frakt-epost', { method: 'POST', body: JSON.stringify(payload) }));
    return { status: res.status, tekst: await res.text() };
  };
  return { kall, resend };
}

const BESTILLING = {
  type: 'bestilling', fraktselskapEpost: 'frakt@selskap.test', kontaktpersonEpost: 'kontakt@forhandler.test',
  forhandler: 'TEST Forhandler', kontaktperson: 'TEST Kontakt', chassisNr: 'TESTWXYZ0000000A1', avsenderNavn: 'TEST Avsender',
};

describe('bestilling av frakt: henteklar-dato i e-posten', () => {
  it('med dato: «Bilen er klar for å bli hentet fra DD.MM.YYYY» står i både HTML og ren tekst, og resten er som før', async () => {
    const { kall, resend } = await lastFunksjon();
    const r = await kall({ ...BESTILLING, dato: '2026-11-15' });
    expect(r.status).toBe(200);
    expect(resend).toHaveLength(1);
    const m = resend[0];
    expect(m.html).toContain('Bilen er klar for å bli hentet fra 15.11.2026.');
    expect(m.text).toContain('Bilen er klar for å bli hentet fra 15.11.2026.');
    // uendret innhold og mottakere
    for (const del of ['TEST Forhandler', 'TEST Kontakt', 'TESTWXYZ0000000A1']) { expect(m.html).toContain(del); expect(m.text).toContain(del); }
    expect(m.subject).toBe('Bestilling av frakt - TESTWXYZ0000000A1');
    expect(m.to).toEqual(['frakt@selskap.test']);
    expect(m.cc).toEqual(['kontakt@forhandler.test']);
    expect(m.bcc).toEqual(['bcc@salmaker.test']);
  });

  it('datolinjen står mellom bilopplysningene og signaturen i ren tekst', async () => {
    const { kall, resend } = await lastFunksjon();
    await kall({ ...BESTILLING, dato: '2026-01-05' });
    const t = resend[0].text;
    expect(t.indexOf('Chassis.nr: TESTWXYZ0000000A1')).toBeLessThan(t.indexOf('klar for å bli hentet fra 05.01.2026'));
    expect(t.indexOf('klar for å bli hentet fra 05.01.2026')).toBeLessThan(t.indexOf('Med vennlig hilsen'));
  });

  it('uten dato (eller tom streng) er e-posten helt som før: ingen datolinje', async () => {
    for (const dato of [undefined, '', null]) {
      const { kall, resend } = await lastFunksjon();
      const r = await kall({ ...BESTILLING, dato });
      expect(r.status).toBe(200);
      expect(resend[0].html).not.toContain('klar for å bli hentet');
      expect(resend[0].text).not.toContain('klar for å bli hentet');
    }
  });

  it('en dato i feil format (eller et forsøk på å lure inn HTML) gir ingen datolinje og havner aldri i e-posten', async () => {
    for (const dato of ['15.11.2026', '2026-11-15<script>alert(1)</script>', '2026-1-5', 'i morgen', 20261115, {}, ['2026-11-15']]) {
      const { kall, resend } = await lastFunksjon();
      const r = await kall({ ...BESTILLING, dato });
      expect(r.status).toBe(200);
      expect(resend[0].html).not.toContain('klar for å bli hentet');
      expect(resend[0].html).not.toContain('<script>');
      expect(resend[0].text).not.toContain('klar for å bli hentet');
    }
  });

  it('mangler e-post for fraktselskapet: 400 og ingenting sendes (som før)', async () => {
    const { kall, resend } = await lastFunksjon();
    const r = await kall({ ...BESTILLING, fraktselskapEpost: '', dato: '2026-11-15' });
    expect(r.status).toBe(400);
    expect(resend).toHaveLength(0);
  });
});

describe('uendret: varselet «klar for henting» (Hente selv) bruker samme datoformatering', () => {
  it('med dato: «klar for å bli hentet fra DD.MM.YYYY. Som avtalt henter dere selv.»', async () => {
    const { kall, resend } = await lastFunksjon();
    const r = await kall({ type: 'klar_for_henting', kontaktpersonEpost: 'kontakt@forhandler.test', chassisNr: 'TESTWXYZ0000000A1', dato: '2026-11-15', avsenderNavn: 'TEST' });
    expect(r.status).toBe(200);
    expect(resend[0].text).toContain('er klar for å bli hentet fra 15.11.2026. Som avtalt henter dere selv.');
    expect(resend[0].to).toEqual(['kontakt@forhandler.test']);
  });

  it('uten dato: ingen «fra»-setning', async () => {
    const { kall, resend } = await lastFunksjon();
    await kall({ type: 'klar_for_henting', kontaktpersonEpost: 'kontakt@forhandler.test', chassisNr: 'TESTWXYZ0000000A1', avsenderNavn: 'TEST' });
    expect(resend[0].text).toContain('er klar for å bli hentet. Som avtalt henter dere selv.');
    expect(resend[0].text).not.toContain(' fra ');
  });
});

describe('klienten sender datoen med (js/admin-ark.js)', () => {
  const klient = readFileSync(path.resolve(__dirname, '../js/admin-ark.js'), 'utf8').replace(/\r\n/g, '\n');
  it('bestillingen til fraktselskapet har dato med, og dialogen sier ikke lenger at datoen bare brukes internt', () => {
    expect(klient).toMatch(/type:'bestilling'[\s\S]{0,300}chassisNr, dato: dato \|\| undefined, avsenderNavn/);
    expect(klient).not.toContain('Datoen brukes kun internt');
    expect(klient).toContain('Bilen er klar for å bli hentet fra');
  });
});
