// send-push (2026-11-03): en statusendring på en LEVERANSE (ordre uten bil) skal gi et lesbart varsel («Leveranse X er klar til sending»), ikke «<kunde> er under_arbeid», og en
// bil-ordre skal få nøyaktig samme varsel som før. Hele funksjonen kjøres mot falsk Deno, falsk web-push og falsk Supabase-klient (kildens to importer byttes ut før filen
// skrives, samme teknikk som fiken-fakturer-rabatt.test.js) - ingenting sendes til noen.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(path.resolve(__dirname, '../supabase/functions/send-push/index.ts'), 'utf8').replace(/\r\n/g, '\n');
const IMPORT_WEBPUSH = "import webpush from 'npm:web-push@3.6.7'";
const IMPORT_SUPABASE = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'";
if (!kilde.includes(IMPORT_WEBPUSH) || !kilde.includes(IMPORT_SUPABASE)) throw new Error('send-push-leveranse.test.js: fant ikke forventede importlinjer - oppdater testen');

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* borte */ } } });

async function last() {
  const sendt = []; let handler = null;
  const env = { VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y', VAPID_EMAIL: 'test@example.test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake' };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  globalThis.fetch = async () => new Response('[]', { status: 200 });
  globalThis.__SENDT__ = sendt;
  globalThis.__SUPABASE__ = () => ({
    from: () => ({ select: async () => ({ data: [{ endpoint: 'https://push.test/1', p256dh: 'a', auth: 'b' }], error: null }), delete: () => ({ eq: async () => ({}) }) }),
  });
  const suffix = Math.random().toString(36).slice(2);
  const shimWp = path.resolve(__dirname, `_sp_wp_${suffix}.mjs`), shimSb = path.resolve(__dirname, `_sp_sb_${suffix}.mjs`), hoved = path.resolve(__dirname, `_sp_tmp_${suffix}.ts`);
  tmpFiler.push(shimWp, shimSb, hoved);
  writeFileSync(shimWp, 'export default { setVapidDetails() {}, sendNotification: async (_s, melding) => { globalThis.__SENDT__.push(JSON.parse(melding)); } }\n');
  writeFileSync(shimSb, 'export function createClient() { return globalThis.__SUPABASE__(); }\n');
  writeFileSync(hoved, kilde.replace(IMPORT_WEBPUSH, `import webpush from './${path.basename(shimWp)}'`).replace(IMPORT_SUPABASE, `import { createClient } from './${path.basename(shimSb)}'`));
  const logOrig = console.log; console.log = () => {};
  try { await import(/* @vite-ignore */ pathToFileURL(hoved).href); } finally { console.log = logOrig; }
  return {
    sendt,
    oppdatering: async (record, old_record) => {
      const res = await handler(new Request('https://x.supabase.co/functions/v1/send-push', { method: 'POST', body: JSON.stringify({ type: 'UPDATE', table: 'ordrer', record, old_record }) }));
      return { status: res.status, tekst: await res.text() };
    },
  };
}

const levering = (ordre_status, ekstra = {}) => ({ id: 'ord_L1', ordretype: 'leveranse', ordre_status, kunde: 'TEST Kunde', chassis: '', regnr: '', leveranse: { merking: 'TEST-merking' }, ...ekstra });
const bil = (ordre_status, ekstra = {}) => ({ id: 'ord_B1', ordretype: 'bil', ordre_status, kunde: 'TEST Kunde', chassis: 'TESTWXYZ0000000A1', regnr: 'AB12345', ...ekstra });

describe('send-push: statusendring på en leveranse', () => {
  it('hver leveranse-status gir et lesbart varsel med merkingen, aldri den rå statuskoden', async () => {
    for (const [status, navn] of [['under_arbeid', 'under arbeid'], ['klar_sending', 'klar til sending'], ['sendt', 'sendt']]) {
      const { oppdatering, sendt } = await last();
      const r = await oppdatering(levering(status), levering('ikke_paabegynt'));
      expect(r.status).toBe(200);
      expect(sendt).toHaveLength(1);
      expect(sendt[0].title).toBe('Statusendring');
      expect(sendt[0].body).toBe(`Leveranse TEST-merking er ${navn}`);
      expect(sendt[0].body).not.toContain('_');
    }
  });

  it('uten merking brukes reg.nr, så chassis, så kunde', async () => {
    const a = await last(); await a.oppdatering(levering('sendt', { leveranse: {}, regnr: 'AB12345' }), levering('under_arbeid')); expect(a.sendt[0].body).toBe('Leveranse AB12345 er sendt');
    const b = await last(); await b.oppdatering(levering('sendt', { leveranse: {}, chassis: 'CH1' }), levering('under_arbeid')); expect(b.sendt[0].body).toBe('Leveranse CH1 er sendt');
    const c = await last(); await c.oppdatering(levering('sendt', { leveranse: {} }), levering('under_arbeid')); expect(c.sendt[0].body).toBe('Leveranse TEST Kunde er sendt');
    const d = await last(); await d.oppdatering(levering('sendt', { leveranse: null, kunde: '' }), levering('under_arbeid')); expect(d.sendt[0].body).toBe('Leveranse er sendt');
  });

  it('en oppdatering UTEN statusendring (f.eks. frakt_bestilt_at settes) gir ikke noe varsel', async () => {
    const { oppdatering, sendt } = await last();
    const r = await oppdatering(levering('klar_sending', { frakt_bestilt_at: '2026-11-03T08:00:00Z' }), levering('klar_sending'));
    expect(r.status).toBe(200);
    expect(sendt).toHaveLength(0);
  });
});

describe('send-push: bil-ordrer er uendret', () => {
  it('statusendring på en bil gir samme varsel som før (chassis foran reg.nr), også uten ordretype i raden', async () => {
    const a = await last(); await a.oppdatering(bil('klar_henting'), bil('klar_visning'));
    expect(a.sendt[0].body).toBe('TESTWXYZ0000000A1 er klar for henting');
    const b = await last(); await b.oppdatering({ ...bil('hentet'), ordretype: undefined }, bil('klar_henting'));
    expect(b.sendt[0].body).toBe('TESTWXYZ0000000A1 er hentet');
  });
  it('bil uten chassis/reg.nr/kunde heter fortsatt «Bil»', async () => {
    const { oppdatering, sendt } = await last();
    await oppdatering(bil('paabegynt', { chassis: '', regnr: '', kunde: '' }), bil('ikke_paabegynt'));
    expect(sendt[0].body).toBe('Bil er påbegynt');
  });
});
