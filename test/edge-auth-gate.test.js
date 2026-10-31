// Innloggingssjekken i edge-funksjonene (fiken-fakturer og send-frakt-epost 2026-10-29, vegvesen-oppslag og send-push 2026-10-31).
// Blokken mellom «EDGE-AUTH-GATE BEGIN/END» skal være BYTE-LIK i alle funksjonene (én regel, ett sted å rette), og den
// skal oppføre seg likt uansett hvilken funksjon den ligger i. TILLATTE_ROLLER (utenfor blokken) velger hvem som faktisk
// slipper gjennom: bare admin for fiken-fakturer/send-frakt-epost, alle ansatte for vegvesen-oppslag (hvem som helst
// kan slå opp et reg.nr i ordre-detalj) og send-push (klient-varslene kommer fra enhver ansatt).
// send-push har i tillegg SERVER-til-server-kall som aldri har en ansatt-sesjon (triggeren «ordre-push» sender service_role-
// nøkkelen), så den har en liten ekstra blokk «SERVER-KALLER BEGIN/END» UTENFOR den delte blokken: server-kall slippes gjennom
// som egen kategori, alt annet går til den delte gaten. Den delte blokken er dermed fortsatt byte-lik overalt, og de tre andre
// funksjonene skal aldri ha en server-kaller-blokk (en admin-funksjon skal ikke kunne kalles med service-nøkkelen via denne veien).
// Funksjonene kjører i Deno og kan ikke lastes direkte her, så testen trekker ut selve blokken, legger den i en
// midlertidig .ts-modul (Vite fjerner typene) og kjører den mot falske Deno/fetch. Hele funksjonene (A/B mot
// originalene) er testet manuelt - se supabase/README.md, «send-push: innloggingssjekk».
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNKSJONER = ['fiken-fakturer', 'send-frakt-epost', 'vegvesen-oppslag', 'send-push'];
const TILLATTE_ROLLER_PER_FN = {
  'fiken-fakturer': ['admin'],
  'send-frakt-epost': ['admin'],
  'vegvesen-oppslag': ['admin', 'godkjenner', 'ansatt', 'verneombud'],
  'send-push': ['admin', 'godkjenner', 'ansatt', 'verneombud'],
};
// Funksjonen handleren kaller først (send-push går via sendPushGate, som delegerer til den delte gaten).
const GATEKALL_PER_FN = { 'send-push': 'sendPushGate' };
// Linjeskift normaliseres: Windows-utsjekk (autocrlf) gir CRLF, Linux-CI gir LF - det er innholdet som skal være likt.
const kilde = (fn) => readFileSync(path.resolve(__dirname, `../supabase/functions/${fn}/index.ts`), 'utf8').replace(/\r\n/g, '\n');
const blokk = (src) => src.match(/\/\/ ── EDGE-AUTH-GATE BEGIN[\s\S]*?\/\/ ── EDGE-AUTH-GATE END ──/)?.[0] ?? null;
const serverBlokk = (src) => src.match(/\/\/ ── SERVER-KALLER BEGIN[\s\S]*?\/\/ ── SERVER-KALLER END ──/)?.[0] ?? null;

describe('innloggingssjekk i edge-funksjonene: oppsett', () => {
  it('blokken finnes og er byte-lik i alle funksjonene', () => {
    const blokker = FUNKSJONER.map((fn) => blokk(kilde(fn)));
    expect(blokker[0]).toBeTruthy();
    for (const b of blokker) expect(b).toBe(blokker[0]);
  });

  it.each(FUNKSJONER)('%s: FN og TILLATTE_ROLLER står før blokken, og sjekken er første handling i handleren', (fn) => {
    const src = kilde(fn);
    const start = src.indexOf('EDGE-AUTH-GATE BEGIN');
    expect(src.indexOf(`const FN = '${fn}'`)).toBeGreaterThan(-1);
    expect(src.indexOf(`const FN = '${fn}'`)).toBeLessThan(start);
    const rollerLiteral = `[${TILLATTE_ROLLER_PER_FN[fn].map((r) => `'${r}'`).join(', ')}]`;
    expect(src).toContain(`const TILLATTE_ROLLER = ${rollerLiteral}`);
    expect(src.indexOf('const TILLATTE_ROLLER')).toBeLessThan(start);
    const gatekall = GATEKALL_PER_FN[fn] ?? 'innloggingsgate';
    expect(src).toMatch(new RegExp(`Deno\\.serve\\(async \\(req\\) => \\{[\\s\\S]*?try \\{\\s*const avvist = await ${gatekall}\\(req\\)`));
  });

  it('send-push: server-kaller-blokken ligger etter den delte blokken, og bare der', () => {
    const src = kilde('send-push');
    expect(serverBlokk(src)).toBeTruthy();
    expect(src.indexOf('SERVER-KALLER BEGIN')).toBeGreaterThan(src.indexOf('EDGE-AUTH-GATE END'));
    for (const fn of FUNKSJONER.filter((f) => f !== 'send-push')) {
      // (De bruker gjerne service_role-nøkkelen til sin egen databaseklient - det er kallerens token som aldri skal sammenlignes mot den.)
      expect(kilde(fn)).not.toContain('SERVER-KALLER');
      expect(kilde(fn)).not.toContain('erServerKall');
    }
  });

  it('send-push: server-kall er bare service_role-nøkkelen - aldri den offentlige nøkkelen eller anon-nøkkelen', () => {
    // Kommentarene nevner den offentlige nøkkelen (som advarsel); selve koden skal ikke røre den.
    const kode = serverBlokk(kilde('send-push')).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(kode).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    expect(kode).not.toMatch(/publishable|SUPABASE_ANON_KEY|apikey/);
  });
});

describe('innloggingssjekk: oppførsel (blokken kjørt mot falsk Deno og fetch)', () => {
  const TOK = {
    admin: 'eyJhbGciOiJIUzI1NiJ9.eyJhZG1pbiI6MX0.sig_admin_aaaaaaaa',
    godkjenner: 'eyJhbGciOiJIUzI1NiJ9.eyJnb2RrIjoxfQ.sig_godk_aaaaaaaaa',
    gjest: 'eyJhbGciOiJIUzI1NiJ9.eyJnamVzdCI6MX0.sig_gjest_aaaaaaaaa',
    anon: 'eyJhbGciOiJIUzI1NiJ9.eyJhbm9uIjoxfQ.sig_anon_aaaaaaaaaa',
    utlopt: 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.sig_utlopt_aaaaaaaa',
    db500: 'eyJhbGciOiJIUzI1NiJ9.eyJkYjUiOjF9.sig_db500_aaaaaaaaa',
    kaster: 'eyJhbGciOiJIUzI1NiJ9.eyJrYXN0IjoxfQ.sig_kaster_aaaaaaaa',
  };
  const tmpFiler = [];
  afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

  // Laster blokken med gitt miljø; gir { gate, kall, logger }. Standard er den delte blokken alene (fn «test-fn», bare admin);
  // med { fn: 'send-push' } lastes send-push sin egen kildekode (delt blokk + server-kaller-blokk) og gate = sendPushGate.
  async function last(env, { fn = 'test-fn' } = {}) {
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
      if (tok === TOK.gjest) return json([{ id: 11, rolle: 'gjest' }]);
      if (tok === TOK.anon) return json([]);
      if (tok === TOK.utlopt) return json({ code: 'PGRST303', message: 'JWT expired' }, 401);
      if (tok === TOK.db500) return json({ message: 'boom' }, 500);
      if (tok === TOK.kaster) throw new TypeError('fetch failed');
      return json({ code: 'PGRST301' }, 401);
    };
    console.log = (...a) => { logger.push(a.join(' ')); };
    const fil = path.resolve(__dirname, `_gate_tmp_${Math.random().toString(36).slice(2)}.ts`);
    tmpFiler.push(fil);
    const erSendPush = fn === 'send-push';
    const roller = JSON.stringify(erSendPush ? TILLATTE_ROLLER_PER_FN['send-push'] : ['admin']).replace(/"/g, "'");
    const kildeFn = erSendPush ? 'send-push' : 'fiken-fakturer';
    const ekstra = erSendPush ? `\n${serverBlokk(kilde('send-push'))}` : '';
    const eksport = erSendPush ? 'sendPushGate' : 'innloggingsgate';
    writeFileSync(fil, `const FN = '${fn}'\nconst TILLATTE_ROLLER = ${roller}\n${blokk(kilde(kildeFn))}${ekstra}\nexport { ${eksport} as gate }\n`);
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(fil).href);
      return { gate: mod.gate, kall, logger };
    } finally {
      console.log = logOrig;
    }
  }
  const mkReq = (headers = {}) => new Request('https://x.supabase.co/functions/v1/test-fn', { method: 'POST', headers, body: '{}' });
  const BASE = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'ANON-ENV-KEY' };
  const med = async (env, headers, opts) => {
    const { gate, kall, logger } = await last(env, opts);
    const logOrig = console.log;
    console.log = (...a) => { logger.push(a.join(' ')); };
    try {
      return {
        avvist: await gate(mkReq(headers)),
        kall,
        logg: logger.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.edge_auth === 1),
        loggTekst: logger.join('|'),
      };
    } finally { console.log = logOrig; }
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

  describe('send-push: server-kall med service_role-nøkkelen er en egen gyldig kategori', () => {
    const SERVICE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig_service_aaaaaaa';
    const OFFENTLIG = 'sb_publishable_46JAdcBUbQYS8NbDwP';
    const ENV = { ...BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE };
    const SP = { fn: 'send-push' };
    const sp = (env, headers) => med(env, headers, SP);

    it('service_role-nøkkelen slippes gjennom UTEN oppslag i myk modus, håndhevet modus og med *, og logges som server', async () => {
      for (const [enforce, haandhevet] of [['', false], ['send-push', true], ['*', true], ['fiken-fakturer', false]]) {
        const r = await sp({ ...ENV, EDGE_AUTH_ENFORCE: enforce }, { authorization: `Bearer ${SERVICE}`, apikey: 'KALLERS-APIKEY' });
        expect(r.avvist).toBeNull();
        expect(r.kall.length).toBe(0);
        expect(r.logg).toMatchObject({ edge_auth: 1, fn: 'send-push', via: 'server', grunn: 'service_role', rolle: '', ansatt_id: null, haandhevet });
      }
    });

    it('«Bearer»-prefikset er ikke versalfølsomt, men resten av nøkkelen må være eksakt lik', async () => {
      const r = await sp({ ...ENV, EDGE_AUTH_ENFORCE: 'send-push' }, { authorization: `bearer ${SERVICE}` });
      expect(r.avvist).toBeNull();
      expect(r.logg.via).toBe('server');
      const feil = await sp({ ...ENV, EDGE_AUTH_ENFORCE: 'send-push' }, { authorization: `Bearer ${SERVICE.toUpperCase()}` });
      expect(feil.logg.via).not.toBe('server');
    });

    it('logglinjen for server-kall inneholder aldri nøkkelen eller apikey-headeren', async () => {
      const r = await sp({ ...ENV, EDGE_AUTH_ENFORCE: 'send-push' }, { authorization: `Bearer ${SERVICE}`, apikey: 'KALLERS-APIKEY' });
      expect(r.loggTekst).not.toContain(SERVICE);
      expect(r.loggTekst).not.toContain('KALLERS-APIKEY');
      expect(r.loggTekst).not.toContain('ANON-ENV-KEY');
      expect(r.loggTekst).not.toContain(SERVICE.split('.')[2]);
    });

    it('nesten-lik nøkkel (ett tegn feil, avkortet, forlenget, annen nøkkel) er IKKE server-kall: går til ansatt-sjekken og avvises når håndhevet', async () => {
      const nesten = [
        SERVICE.replace(/a$/, 'b'),
        SERVICE.slice(0, -1),
        `${SERVICE}x`,
        SERVICE.replace('eyJyb2xlIjoic2VydmljZV9yb2xlIn0', 'eyJyb2xlIjoiYW5vbiJ9'),
      ];
      for (const tok of nesten) {
        const r = await sp({ ...ENV, EDGE_AUTH_ENFORCE: 'send-push' }, { authorization: `Bearer ${tok}` });
        expect(r.logg.via).toBe('ingen');
        expect(r.avvist.status).toBe(401);
        expect(r.kall.length).toBe(1);
        expect(r.kall[0].auth).toBe(`Bearer ${tok}`);
      }
    });

    it('en annen nøkkel hvis SHA-256 begynner likt som service-nøkkelens er likevel IKKE server-kall (hele sammendraget sammenlignes, ikke bare starten)', async () => {
      const { createHash } = await import('node:crypto');
      const hash = (s) => createHash('sha256').update(s).digest();
      const start = hash(SERVICE).subarray(0, 2);
      let kandidat = null;
      for (let i = 0; i < 2_000_000 && !kandidat; i++) {
        const k = `${SERVICE.slice(0, -1)}${i}`;
        if (k !== SERVICE && hash(k).subarray(0, 2).equals(start)) kandidat = k;
      }
      expect(kandidat).toBeTruthy();
      const r = await sp({ ...ENV, EDGE_AUTH_ENFORCE: 'send-push' }, { authorization: `Bearer ${kandidat}` });
      expect(r.logg.via).not.toBe('server');
      expect(r.avvist.status).toBe(401);
    });

    it('den offentlige nøkkelen (som cron-jobbene sender i dag) er aldri et server-kall: 401 når håndhevet, og ingen oppslag', async () => {
      for (const env of [ENV, { ...BASE }, { ...BASE, SUPABASE_SERVICE_ROLE_KEY: '' }]) {
        const r = await sp({ ...env, EDGE_AUTH_ENFORCE: 'send-push' }, { authorization: `Bearer ${OFFENTLIG}`, apikey: OFFENTLIG });
        expect(r.avvist.status).toBe(401);
        expect(r.logg.via).toBe('ingen');
        expect(r.kall.length).toBe(0);
      }
    });

    it('manglende eller tom header er aldri et server-kall, heller ikke når service-nøkkelen mangler i miljøet (tom == tom teller ikke)', async () => {
      for (const env of [ENV, { ...BASE }, { ...BASE, SUPABASE_SERVICE_ROLE_KEY: '' }]) {
        for (const hdr of [{}, { authorization: '' }, { authorization: 'Bearer ' }, { authorization: 'Bearer    ' }]) {
          const r = await sp({ ...env, EDGE_AUTH_ENFORCE: 'send-push' }, hdr);
          expect(r.avvist.status).toBe(401);
          expect(r.logg.via).toBe('ingen');
        }
      }
    });

    it('ansatte: alle kjente roller slipper gjennom når håndhevet, ukjent rolle gir 403, ugyldig 401, feil i sjekken 503', async () => {
      const env = { ...ENV, EDGE_AUTH_ENFORCE: 'send-push' };
      expect((await sp(env, { authorization: `Bearer ${TOK.admin}` })).avvist).toBeNull();
      expect((await sp(env, { authorization: `Bearer ${TOK.godkjenner}` })).avvist).toBeNull();
      expect((await sp(env, { authorization: `Bearer ${TOK.gjest}` })).avvist.status).toBe(403);
      expect((await sp(env, { authorization: `Bearer ${TOK.anon}` })).avvist.status).toBe(401);
      expect((await sp(env, { authorization: `Bearer ${TOK.utlopt}` })).avvist.status).toBe(401);
      expect((await sp(env, { authorization: `Bearer ${TOK.db500}` })).avvist.status).toBe(503);
      expect((await sp(env, { authorization: `Bearer ${TOK.kaster}` })).avvist.status).toBe(503);
    });

    it('myk modus: alt slippes gjennom og logges som før (bare server-kall får via: server)', async () => {
      for (const [hdr, via] of [
        [{ authorization: `Bearer ${OFFENTLIG}` }, 'ingen'],
        [{}, 'ingen'],
        [{ authorization: `Bearer ${TOK.admin}` }, 'ansatt'],
        [{ authorization: `Bearer ${TOK.godkjenner}` }, 'ansatt'],
        [{ authorization: `Bearer ${TOK.gjest}` }, 'ikke_tillatt_rolle'],
        [{ authorization: `Bearer ${TOK.db500}` }, 'ukjent'],
        [{ authorization: `Bearer ${SERVICE}` }, 'server'],
      ]) {
        const r = await sp({ ...ENV }, hdr);
        expect(r.avvist).toBeNull();
        expect(r.logg.via).toBe(via);
        expect(r.logg.haandhevet).toBe(false);
      }
    });
  });
});
