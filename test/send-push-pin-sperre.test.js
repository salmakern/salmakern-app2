// send-push, type «pin_global_sperre» (samlet PIN-sperre, migrasjon 20261125200000_pin_nodbrems.sql): varsel til admin når den
// automatiske 30-feil-sperren slår inn, og når nødbremsen trekkes/oppheves. Skal BARE godtas som server-kall (riktig x-server-secret),
// og bare gå til aktive admin-kontoer. Hele funksjonen kjøres mot falsk Deno, falsk web-push og falsk Supabase (samme teknikk som
// send-push-leveranse.test.js) - ingenting sendes til noen.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(path.resolve(__dirname, '../supabase/functions/send-push/index.ts'), 'utf8').replace(/\r\n/g, '\n');
const IMPORT_WEBPUSH = "import webpush from 'npm:web-push@3.6.7'";
const IMPORT_SUPABASE = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'";
if (!kilde.includes(IMPORT_WEBPUSH) || !kilde.includes(IMPORT_SUPABASE)) throw new Error('send-push-pin-sperre.test.js: fant ikke forventede importlinjer - oppdater testen');

const HEMMELIGHET = 'h'.repeat(40);
const ADMINER = [{ id: 17, navn: 'Admin En' }, { id: 18, navn: 'Admin To' }];
// Abonnenter: to admin-enheter og en vanlig ansatt (id 50) som aldri skal få sikkerhetsvarsler.
const SUBS = [
  { ansatt_id: 17, endpoint: 'https://push.test/17', p256dh: 'a', auth: 'b' },
  { ansatt_id: 18, endpoint: 'https://push.test/18', p256dh: 'a', auth: 'b' },
  { ansatt_id: 50, endpoint: 'https://push.test/50', p256dh: 'a', auth: 'b' },
];

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* borte */ } } });

async function last({ adminer = ADMINER } = {}) {
  const sendt = []; let handler = null;
  const env = { VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y', VAPID_EMAIL: 'test@example.test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake', SEND_PUSH_SERVER_SECRET: HEMMELIGHET };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  globalThis.fetch = async () => new Response('[]', { status: 200 });
  globalThis.__SENDT__ = sendt;
  globalThis.__SUPABASE__ = () => ({
    from: (tabell) => {
      if (tabell === 'ansatte') {
        const filter = {};
        const q = { select: () => q, eq: (k, v) => { filter[k] = v; return q; }, then: (res) => res({ data: filter.rolle === 'admin' && filter.aktiv === true ? adminer : [], error: null }) };
        return q;
      }
      return { select: async () => ({ data: SUBS, error: null }), delete: () => ({ eq: async () => ({}) }) };
    },
  });
  const suffix = Math.random().toString(36).slice(2);
  const shimWp = path.resolve(__dirname, `_spp_wp_${suffix}.mjs`), shimSb = path.resolve(__dirname, `_spp_sb_${suffix}.mjs`), hoved = path.resolve(__dirname, `_spp_tmp_${suffix}.ts`);
  tmpFiler.push(shimWp, shimSb, hoved);
  writeFileSync(shimWp, 'export default { setVapidDetails() {}, sendNotification: async (s, melding) => { globalThis.__SENDT__.push({ endpoint: s.endpoint, ...JSON.parse(melding) }); } }\n');
  writeFileSync(shimSb, 'export function createClient() { return globalThis.__SUPABASE__(); }\n');
  writeFileSync(hoved, kilde.replace(IMPORT_WEBPUSH, `import webpush from './${path.basename(shimWp)}'`).replace(IMPORT_SUPABASE, `import { createClient } from './${path.basename(shimSb)}'`));
  const logOrig = console.log; console.log = () => {};
  try { await import(/* @vite-ignore */ pathToFileURL(hoved).href); } finally { console.log = logOrig; }
  return {
    sendt,
    kall: async (body, headers = { 'x-server-secret': HEMMELIGHET }) => {
      const logOrig2 = console.log; console.log = () => {};
      try {
        const res = await handler(new Request('https://x.supabase.co/functions/v1/send-push', { method: 'POST', headers, body: JSON.stringify(body) }));
        return { status: res.status, tekst: await res.text() };
      } finally { console.log = logOrig2; }
    },
  };
}

describe('send-push: pin_global_sperre', () => {
  it('automatisk sperre: varsel til ALLE aktive admin-kontoer, aldri til vanlige ansatte', async () => {
    const { kall, sendt } = await last();
    const r = await kall({ type: 'pin_global_sperre', hendelse: 'global_sperre', avId: null });
    expect(r.status).toBe(200);
    expect(sendt.map((s) => s.endpoint).sort()).toEqual(['https://push.test/17', 'https://push.test/18']);
    expect(sendt[0].title).toBe('PIN-innlogging sperret');
    expect(sendt[0].body).toContain('30 feil PIN-forsøk');
    expect(sendt[0].url).toBe('/salmakern.html');
  });

  it('nødbrems trukket: de ANDRE adminene varsles, med navnet på den som trakk', async () => {
    const { kall, sendt } = await last();
    const r = await kall({ type: 'pin_global_sperre', hendelse: 'nodbrems_pa', avId: 17 });
    expect(r.status).toBe(200);
    expect(sendt.map((s) => s.endpoint)).toEqual(['https://push.test/18']);
    expect(sendt[0].title).toBe('Nødbrems trukket');
    expect(sendt[0].body).toContain('(Admin En)');
  });

  it('nødbrems opphevet: samme mottakerregel', async () => {
    const { kall, sendt } = await last();
    await kall({ type: 'pin_global_sperre', hendelse: 'nodbrems_av', avId: 18 });
    expect(sendt.map((s) => s.endpoint)).toEqual(['https://push.test/17']);
    expect(sendt[0].title).toBe('Nødbrems opphevet');
  });

  it('uten server-hemmelighet (en innlogget ansatt som prøver) avvises med 403 og ingenting sendes', async () => {
    for (const headers of [{}, { 'x-server-secret': 'feil'.repeat(10) }, { authorization: 'Bearer eyJ.eyJ.sig' }]) {
      const { kall, sendt } = await last();
      const r = await kall({ type: 'pin_global_sperre', hendelse: 'global_sperre' }, headers);
      expect(r.status).toBe(403);
      expect(sendt).toHaveLength(0);
    }
  });

  it('ukjent hendelse gir 400 og ingenting sendes', async () => {
    const { kall, sendt } = await last();
    const r = await kall({ type: 'pin_global_sperre', hendelse: 'noe_annet' });
    expect(r.status).toBe(400);
    expect(sendt).toHaveLength(0);
  });

  it('ingen admin-mottakere (f.eks. bare den som trakk) gir ALDRI et varsel til alle (tom liste = alle i sendTilAbonnenter)', async () => {
    const { kall, sendt } = await last({ adminer: [{ id: 17, navn: 'Admin En' }] });
    const r = await kall({ type: 'pin_global_sperre', hendelse: 'nodbrems_pa', avId: 17 });
    expect(r.status).toBe(200);
    expect(sendt).toHaveLength(0);
  });
});
