// Innloggingssjekken i edge-funksjonene (fiken-fakturer og send-frakt-epost, innført 2026-10-29).
// Blokken mellom «EDGE-AUTH-GATE BEGIN/END» skal være BYTE-LIK i begge funksjonene (én regel, ett sted å rette), og den
// skal oppføre seg likt uansett hvilken funksjon den ligger i. Funksjonene kjører i Deno og kan ikke lastes direkte her,
// så testen trekker ut selve blokken, legger den i en midlertidig .ts-modul (Vite fjerner typene) og kjører den mot falske
// Deno/fetch. Hele funksjonene (A/B mot originalene) er testet manuelt - se supabase/README.md, «Edge-funksjoner låses».
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJONER = ['fiken-fakturer', 'send-frakt-epost'];
// Linjeskift normaliseres: Windows-utsjekk (autocrlf) gir CRLF, Linux-CI gir LF - det er innholdet som skal være likt.
const kilde = (fn) => readFileSync(path.resolve(__dirname, `../supabase/functions/${fn}/index.ts`), 'utf8').replace(/\r\n/g, '\n');
const blokk = (src) => src.match(/\/\/ ── EDGE-AUTH-GATE BEGIN[\s\S]*?\/\/ ── EDGE-AUTH-GATE END ──/)?.[0] ?? null;

describe('innloggingssjekk i edge-funksjonene: oppsett', () => {
  it('blokken finnes og er byte-lik i begge funksjonene', () => {
    const [a, b] = FUNKSJONER.map((fn) => blokk(kilde(fn)));
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it.each(FUNKSJONER)('%s: FN og TILLATTE_ROLLER (bare admin) står før blokken, og sjekken er første handling i handleren', (fn) => {
    const src = kilde(fn);
    const start = src.indexOf('EDGE-AUTH-GATE BEGIN');
    expect(src.indexOf(`const FN = '${fn}'`)).toBeGreaterThan(-1);
    expect(src.indexOf(`const FN = '${fn}'`)).toBeLessThan(start);
    expect(src).toMatch(/const TILLATTE_ROLLER = \['admin'\]/);
    expect(src.indexOf('const TILLATTE_ROLLER')).toBeLessThan(start);
    expect(src).toMatch(/Deno\.serve\(async \(req\) => \{[\s\S]*?try \{\s*const avvist = await innloggingsgate\(req\)/);
  });
});

describe('innloggingssjekk: oppførsel (blokken kjørt mot falsk Deno og fetch)', () => {
  const TOK = {
    admin: 'eyJhbGciOiJIUzI1NiJ9.eyJhZG1pbiI6MX0.sig_admin_aaaaaaaa',
    godkjenner: 'eyJhbGciOiJIUzI1NiJ9.eyJnb2RrIjoxfQ.sig_godk_aaaaaaaaa',
    anon: 'eyJhbGciOiJIUzI1NiJ9.eyJhbm9uIjoxfQ.sig_anon_aaaaaaaaaa',
    utlopt: 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.sig_utlopt_aaaaaaaa',
    db500: 'eyJhbGciOiJIUzI1NiJ9.eyJkYjUiOjF9.sig_db500_aaaaaaaaa',
    kaster: 'eyJhbGciOiJIUzI1NiJ9.eyJrYXN0IjoxfQ.sig_kaster_aaaaaaaa',
  };
  const tmpFiler = [];
  afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

  // Laster blokken med gitt miljø; gir { gate, kall, logger }.
  async function last(env) {
    const kall = [];
    const logger = [];
    const logOrig = console.log;
    globalThis.Deno = { env: { get: (k) => env[k] } };
    globalThis.fetch = async (url, init = {}) => {
      const h = new Headers(init.headers || {});
      kall.push({ url: String(url), method: init.method, auth: h.get('authorization'), apikey: h.get('apikey'), body: init.body, signal: !!init.signal });
      const tok = (h.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
      if (tok === TOK.admin) return json([{ id: 7, rolle: 'admin' }]);
      if (tok === TOK.godkjenner) return json([{ id: 9, rolle: 'godkjenner' }]);
      if (tok === TOK.anon) return json([]);
      if (tok === TOK.utlopt) return json({ code: 'PGRST303', message: 'JWT expired' }, 401);
      if (tok === TOK.db500) return json({ message: 'boom' }, 500);
      if (tok === TOK.kaster) throw new TypeError('fetch failed');
      return json({ code: 'PGRST301' }, 401);
    };
    console.log = (...a) => { logger.push(a.join(' ')); };
    const fil = path.resolve(__dirname, `_gate_tmp_${Math.random().toString(36).slice(2)}.ts`);
    tmpFiler.push(fil);
    writeFileSync(fil, `const FN = 'test-fn'\nconst TILLATTE_ROLLER = ['admin']\n${blokk(kilde('fiken-fakturer'))}\nexport { innloggingsgate }\n`);
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(fil).href);
      return { gate: mod.innloggingsgate, kall, logger };
    } finally {
      console.log = logOrig;
    }
  }
  const mkReq = (headers = {}) => new Request('https://x.supabase.co/functions/v1/test-fn', { method: 'POST', headers, body: '{}' });
  const BASE = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'ANON-ENV-KEY' };
  const med = async (env, headers) => {
    const { gate, kall, logger } = await last(env);
    const logOrig = console.log;
    console.log = (...a) => { logger.push(a.join(' ')); };
    try { return { avvist: await gate(mkReq(headers)), kall, logg: logger.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.edge_auth === 1) }; }
    finally { console.log = logOrig; }
  };

  it('myk modus slipper ALLE gjennom, men logger utfallet', async () => {
    for (const [hdr, via] of [
      [{ authorization: 'Bearer sb_publishable_46JAdcBUbQYS8NbDwP' }, 'ingen'],
      [{}, 'ingen'],
      [{ authorization: `Bearer ${TOK.admin}` }, 'ansatt'],
      [{ authorization: `Bearer ${TOK.godkjenner}` }, 'ikke_tillatt_rolle'],
      [{ authorization: `Bearer ${TOK.utlopt}` }, 'ingen'],
      [{ authorization: `Bearer ${TOK.db500}` }, 'ukjent'],
      [{ authorization: `Bearer ${TOK.kaster}` }, 'ukjent'],
    ]) {
      const r = await med({ ...BASE }, hdr);
      expect(r.avvist).toBeNull();
      expect(r.logg.via).toBe(via);
      expect(r.logg.haandhevet).toBe(false);
    }
  });

  it('håndhevet: bare gyldig admin slipper gjennom; resten får 401/403/503', async () => {
    const env = { ...BASE, EDGE_AUTH_ENFORCE: 'test-fn' };
    expect((await med(env, { authorization: `Bearer ${TOK.admin}` })).avvist).toBeNull();
    expect((await med(env, { authorization: 'Bearer sb_publishable_46JAdcBUbQYS8NbDwP' })).avvist.status).toBe(401);
    expect((await med(env, {})).avvist.status).toBe(401);
    expect((await med(env, { authorization: `Bearer ${TOK.anon}` })).avvist.status).toBe(401);
    expect((await med(env, { authorization: `Bearer ${TOK.utlopt}` })).avvist.status).toBe(401);
    expect((await med(env, { authorization: `Bearer ${TOK.godkjenner}` })).avvist.status).toBe(403);
    expect((await med(env, { authorization: `Bearer ${TOK.db500}` })).avvist.status).toBe(503);
    expect((await med(env, { authorization: `Bearer ${TOK.kaster}` })).avvist.status).toBe(503);
  });

  it('håndheving gjelder bare funksjonen som er navngitt (eller *)', async () => {
    const legacy = { authorization: 'Bearer sb_publishable_46JAdcBUbQYS8NbDwP' };
    expect((await med({ ...BASE, EDGE_AUTH_ENFORCE: 'send-push, fiken-produkter' }, legacy)).avvist).toBeNull();
    expect((await med({ ...BASE, EDGE_AUTH_ENFORCE: 'send-push, *' }, legacy)).avvist.status).toBe(401);
    expect((await med({ ...BASE, EDGE_AUTH_ENFORCE: '' }, legacy)).avvist).toBeNull();
  });

  it('oppslaget går mot current_ansatt med kallerens token; ikke-JWT gir aldri oppslag', async () => {
    const r = await med({ ...BASE }, { authorization: `Bearer ${TOK.admin}`, apikey: 'KALLERS-APIKEY' });
    const k = r.kall.find((x) => x.url.endsWith('/rest/v1/rpc/current_ansatt'));
    expect(k).toMatchObject({ method: 'POST', auth: `Bearer ${TOK.admin}`, apikey: 'ANON-ENV-KEY', body: '{}', signal: true });
    for (const bad of ['Bearer sb_publishable_x', 'Bearer ' + 'a.b.c'.padEnd(5000, 'x'), 'Bearer aaaaaaaa.bbbbbbbb.cccc dddd']) {
      const x = await med({ ...BASE }, { authorization: bad });
      expect(x.kall.length).toBe(0);
    }
  });

  it('logglinjen inneholder aldri tokens eller nøkler', async () => {
    const { gate, logger } = await last({ ...BASE });
    const logOrig = console.log;
    console.log = (...a) => { logger.push(a.join(' ')); };
    try { await gate(mkReq({ authorization: `Bearer ${TOK.admin}`, apikey: 'KALLERS-APIKEY' })); } finally { console.log = logOrig; }
    const t = logger.join('|');
    expect(t).not.toContain(TOK.admin);
    expect(t).not.toContain('KALLERS-APIKEY');
    expect(t).not.toContain('ANON-ENV-KEY');
  });
});
