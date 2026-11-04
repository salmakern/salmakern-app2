// Edge-funksjonen send-ordre-status-til-portal (supabase/functions/send-ordre-status-til-portal):
// dekker KUN guarden som skal unngå dobbel "klar for henting"-e-post når Admin-ark allerede har
// sendt sin egen (fraktselskap "Hente selv" + bestilt_frakt/frakt_forberedt_at satt).
//
// Rettet 4.11 (funn fra portal-økta, bekreftet mot ekte produksjonsdata: 48 admin_ark-rader har
// "Henter selv" i stedet for eksakt "Hente selv", og noen chassis har flere admin_ark-rader
// arkivert+aktiv samtidig): oppslaget brukte .maybeSingle(), som KASTER en feil ved flere treff -
// det ville veltet HELE kjøringen (alle inntil 100 køede rader), ikke bare den ene raden. Denne
// testen beviser: (1) guarden virker som før når akkurat én ikke-arkivert rad finnes, (2) oppslaget
// filtrerer på ikke-arkivert, og (3) en feilende/kastende admin_ark-spørring IKKE velter resten av
// batchen (fail-open: raden sendes som om guarden ikke slo til).
//
// Samme grunnteknikk som fiken-fakturer-rabatt.test.js: last rå kildetekst, erstatt jsr:-importen
// av createClient med en lokal falsk modul, skriv til en midlertidig .ts-fil, dynamisk import.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(
  path.resolve(__dirname, '../supabase/functions/send-ordre-status-til-portal/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const IMPORT_LINJE = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
if (!kilde.includes(IMPORT_LINJE)) {
  throw new Error('send-ordre-status-til-portal.test.js: fant ikke forventet import-linje å erstatte - oppdater testen');
}

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

function utboksRad(overrides = {}) {
  return {
    id: 1,
    ordre_id: 'o1',
    status: 'klar_henting',
    status_forrige: 'paabegynt',
    forsok: 0,
    opprettet_at: '2026-11-04T08:00:00.000Z',
    ordrer: { portal_bestilling_id: 'pb1', portal_bekreftet_at: '2026-11-01T00:00:00.000Z', chassis: 'ABC123', dato_klar_henting: null },
    ...overrides,
  };
}

// adminArk: (calls) => {data, error} | kaster - calls er [[metode, args], ...] for admin_ark-kjeden.
function fakeSupabaseKlient({ outboxRows, adminArk = () => ({ data: [], error: null }) }) {
  const adminArkCalls = [];
  const updateKall = [];
  function lagKjede(tabell) {
    const calls = [];
    const self = {
      select: (...a) => { calls.push(['select', a]); return self; },
      eq: (...a) => { calls.push(['eq', a]); return self; },
      lt: (...a) => { calls.push(['lt', a]); return self; },
      order: (...a) => { calls.push(['order', a]); return self; },
      limit: (...a) => { calls.push(['limit', a]); return self; },
      ilike: (...a) => { calls.push(['ilike', a]); return self; },
      update: (patch) => ({
        in: async (col, vals) => { updateKall.push({ tabell, patch, col, vals }); return { error: null }; },
        eq: async (col, val) => { updateKall.push({ tabell, patch, col, val }); return { error: null }; },
      }),
      then: (resolve, reject) => {
        if (tabell === 'admin_ark') adminArkCalls.push(calls);
        const resultat = tabell === 'ordre_status_utboks' ? { data: outboxRows, error: null } : adminArk(calls);
        return Promise.resolve(resultat).then(resolve, reject);
      },
    };
    return self;
  }
  return { from: (tabell) => lagKjede(tabell), adminArkCalls, updateKall };
}

async function last({ outboxRows, adminArk, portalSvar = async () => new Response('{}', { status: 200 }) }) {
  globalThis.Deno = {
    env: {
      get: (k) => ({
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
        ORDRE_STATUS_SYNK_SECRET: 'test-hemmelighet',
        SALMAKERN_STATUS_SECRET: 'test-portal-hemmelighet',
      }[k]),
    },
  };
  let handler;
  globalThis.Deno.serve = (fn) => { handler = fn; };

  const portalKall = [];
  globalThis.fetch = async (url, init = {}) => {
    portalKall.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return portalSvar();
  };

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const shimFil = path.resolve(__dirname, `_send_ordre_status_fake_supabase_${suffix}.mjs`);
  const hovedFil = path.resolve(__dirname, `_send_ordre_status_tmp_${suffix}.ts`);
  tmpFiler.push(shimFil, hovedFil);

  let klientInstans;
  writeFileSync(shimFil, 'export function createClient() { return globalThis.__FAKE_SUPABASE_FACTORY__(); }\n');
  globalThis.__FAKE_SUPABASE_FACTORY__ = () => { klientInstans = fakeSupabaseKlient({ outboxRows, adminArk }); return klientInstans; };

  const tilpasset = kilde.replace(IMPORT_LINJE, `import { createClient } from './${path.basename(shimFil)}'`);
  writeFileSync(hovedFil, tilpasset);
  await import(/* @vite-ignore */ pathToFileURL(hovedFil).href);

  return {
    portalKall,
    get adminArkCalls() { return klientInstans?.adminArkCalls ?? []; },
    get updateKall() { return klientInstans?.updateKall ?? []; },
    kall: () =>
      handler(new Request('https://x.supabase.co/functions/v1/send-ordre-status-til-portal', {
        method: 'POST',
        headers: { 'x-sync-secret': 'test-hemmelighet' },
      })),
  };
}

describe('send-ordre-status-til-portal: admin_ark-guarden mot dobbel klar-for-henting-epost', () => {
  it('undertrykker e-post når én ikke-arkivert rad har Hente selv + frakt_forberedt_at', async () => {
    // adminArkCalls/updateKall er gettere mot en klient som opprettes FØRST når handleren faktisk
    // kjører (createClient() kalles inne i den) - leses derfor av `resultat` ETTER await kall(),
    // aldri destrukturert ut tidligere (ville frosset den tomme fallbacken []).
    const resultat = await last({
      outboxRows: [utboksRad()],
      adminArk: () => ({ data: [{ fraktselskap: 'Hente selv', bestilt_frakt: false, frakt_forberedt_at: '2026-11-04T08:00:00.000Z' }], error: null }),
    });
    const res = await resultat.kall();
    expect(res.status).toBe(200);
    expect(resultat.portalKall).toHaveLength(1);
    expect(resultat.portalKall[0].body.send_epost).toBe(false);
    // Oppslaget skal filtrere på ikke-arkivert (samme vilkår som triggeren ordre-frakt-forbered).
    const kjede = resultat.adminArkCalls[0];
    expect(kjede.some(([m, a]) => m === 'eq' && a[0] === 'arkivert' && a[1] === false)).toBe(true);
  });

  it('sender e-post som normalt når admin_ark-fraktselskapet IKKE er eksakt "Hente selv" (f.eks. legacy "Henter selv")', async () => {
    const { kall, portalKall } = await last({
      outboxRows: [utboksRad()],
      adminArk: () => ({ data: [{ fraktselskap: 'Henter selv', bestilt_frakt: true, frakt_forberedt_at: null }], error: null }),
    });
    const res = await kall();
    expect(res.status).toBe(200);
    expect(portalKall[0].body.send_epost).toBe(true);
  });

  it('kaster admin_ark-oppslaget (f.eks. flere rader på samme chassis) velter IKKE batchen - raden sendes med send_epost uendret', async () => {
    const { kall, portalKall } = await last({
      outboxRows: [utboksRad()],
      adminArk: () => { throw new Error('PGRST116: flere rader'); },
    });
    const res = await kall();
    expect(res.status).toBe(200);
    const svar = await res.json();
    expect(svar.ok).toBe(true);
    expect(svar.sendt).toBe(1);
    expect(portalKall).toHaveLength(1);
    expect(portalKall[0].body.send_epost).toBe(true);
  });

  it('flere køede rader: én med kastende admin_ark-oppslag stopper ikke de andre', async () => {
    const rader = [
      utboksRad({ id: 1, ordre_id: 'o1', ordrer: { portal_bestilling_id: 'pb1', portal_bekreftet_at: '2026-11-01T00:00:00.000Z', chassis: 'FEIL-CHASSIS', dato_klar_henting: null } }),
      utboksRad({ id: 2, ordre_id: 'o2', ordrer: { portal_bestilling_id: 'pb2', portal_bekreftet_at: '2026-11-01T00:00:00.000Z', chassis: 'OK-CHASSIS', dato_klar_henting: null } }),
    ];
    const resultat = await last({
      outboxRows: rader,
      adminArk: (calls) => {
        const chassisKall = calls.find(([m]) => m === 'ilike');
        if (chassisKall && chassisKall[1][1] === 'FEIL-CHASSIS') throw new Error('PGRST116: flere rader');
        return { data: [{ fraktselskap: 'Hente selv', bestilt_frakt: true, frakt_forberedt_at: null }], error: null };
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.sendt).toBe(2);
    expect(resultat.portalKall).toHaveLength(2);
    expect(resultat.portalKall.find((k) => k.body.event_id === 'so-1').body.send_epost).toBe(true);
    expect(resultat.portalKall.find((k) => k.body.event_id === 'so-2').body.send_epost).toBe(false);
    expect(resultat.updateKall.some((u) => u.col === 'id' && JSON.stringify(u.vals) === JSON.stringify([1, 2]))).toBe(true);
  });
});
