// fiken-opprett-kontaktperson (ny edge-funksjon, s90-...-fiken-kontaktperson): oppretter en
// kontaktperson hos riktig Fiken-kunde når en selger fra Forhandlerportalen (ny eller en av de
// ca. 270 eksisterende) mangler en tilsvarende kontaktperson i Fiken. Dekker:
//  - validering (ordreId/navn/epost)
//  - kundematching: fiken_kunde_alias FØRST, ellers organisasjonsnummer HVIS nøyaktig ett treff
//    (0 eller flere treff: avvis og vis en tydelig liste, ikke gjett)
//  - idempotens (finnes kontaktpersonen fra før, opprett ikke en dublett)
//  - selve opprettelsen (POST med name+email, Location-header tolket til contactPersonId)
// Samme grunnteknikk som fiken-fakturer-rabatt.test.js: kildekoden leses rått, jsr:-importen
// erstattes med en lokal shim-modul FØR en temp-fil skrives og dynamisk importeres, Deno/fetch
// stubbes globalt. Ekte Fiken/Supabase er ikke tilgjengelig herfra og kalles ALDRI av denne
// testen.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kildeRaa = readFileSync(
  path.resolve(__dirname, '../supabase/functions/fiken-opprett-kontaktperson/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const IMPORT_LINJE = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
if (!kildeRaa.includes(IMPORT_LINJE)) {
  throw new Error('fiken-opprett-kontaktperson.test.js: fant ikke forventet import-linje å erstatte - oppdater testen');
}

const SLUG = 'telemark-salmakerverksted';
const ORDRE_ID = 'ord_test_kp1';
const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhZG1pbiI6MX0.sig_admin_aaaaaaaa';

function fakeSupabaseKlient(svar) {
  const upsertKall = [];
  return {
    upsertKall,
    from(tabell) {
      return {
        select() {
          return {
            eq(kolonne, verdi) {
              return {
                maybeSingle: async () => {
                  if (tabell === 'ordrer') return svar.ordrer ?? { data: null, error: null };
                  if (tabell === 'fiken_kunde_alias') return svar.alias ?? { data: null, error: null };
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        upsert(payload, opts) {
          upsertKall.push({ tabell, payload, opts });
          return Promise.resolve({ error: svar._upsertFeil ?? null });
        },
      };
    },
  };
}

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

// svar: { ordrer: {data,error}, alias: {data,error} } til den falske Supabase-klienten.
// kunder: Fiken sin kundeliste (brukt for org.nr-fallback). kontakt: svaret fra GET /contacts/:id
// (contactPerson-lista) - default ingen kontaktpersoner. postOk/postLocation styrer POST-svaret.
async function last({ svar = {}, kunder = [], kontakt = { contactId: 555, name: 'Fiken Testkunde AS', contactPerson: [] }, kontaktOk = true, postOk = true, postLocation = `https://api.fiken.no/api/v2/companies/${SLUG}/contacts/555/contactPerson/42` } = {}) {
  const postKall = [];
  globalThis.Deno = {
    env: {
      get: (k) => ({
        FIKEN_API_KEY: 'fake-key',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
      }[k]),
    },
  };
  let handler;
  globalThis.Deno.serve = (fn) => { handler = fn; };

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    const json = (b, s = 200, headers = {}) => new Response(JSON.stringify(b), { status: s, headers });
    if (u === 'https://x.supabase.co/rest/v1/rpc/current_ansatt' && method === 'POST') {
      const tok = (new Headers(init.headers || {})).get('authorization') || '';
      if (tok === `Bearer ${ADMIN_TOKEN}`) return json([{ id: 7, rolle: 'admin' }]);
      return json({ code: 'PGRST301' }, 401);
    }
    if (u === 'https://api.fiken.no/api/v2/companies' && method === 'GET') {
      return json([{ slug: SLUG }]);
    }
    if (u.startsWith(`https://api.fiken.no/api/v2/companies/${SLUG}/contacts?customer=true`) && method === 'GET') {
      return json(kunder, 200, { 'Fiken-Api-Page-Count': '1' });
    }
    const kontaktMatch = u.match(new RegExp(`^https://api\\.fiken\\.no/api/v2/companies/${SLUG}/contacts/(\\d+)$`));
    if (kontaktMatch && method === 'GET') {
      if (!kontaktOk) return json({ message: 'Fiken nede' }, 502);
      return json(kontakt);
    }
    const cpMatch = u.match(new RegExp(`^https://api\\.fiken\\.no/api/v2/companies/${SLUG}/contacts/(\\d+)/contactPerson$`));
    if (cpMatch && method === 'POST') {
      postKall.push({ contactId: Number(cpMatch[1]), body: JSON.parse(init.body) });
      if (!postOk) return json({ message: 'Fiken avviste' }, 502);
      return json({}, 201, postLocation ? { Location: postLocation } : {});
    }
    throw new Error(`Uventet fetch-kall i testen: ${method} ${u}`);
  };

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const shimFil = path.resolve(__dirname, `_fiken_kp_fake_supabase_${suffix}.mjs`);
  const hovedFil = path.resolve(__dirname, `_fiken_kp_tmp_${suffix}.ts`);
  tmpFiler.push(shimFil, hovedFil);

  writeFileSync(shimFil, 'export function createClient() { return globalThis.__FAKE_SUPABASE_FACTORY__(); }\n');
  let klientInstans;
  globalThis.__FAKE_SUPABASE_FACTORY__ = () => { klientInstans = fakeSupabaseKlient(svar); return klientInstans; };

  const tilpasset = kildeRaa.replace(IMPORT_LINJE, `import { createClient } from './${path.basename(shimFil)}'`);
  writeFileSync(hovedFil, tilpasset);
  await import(/* @vite-ignore */ pathToFileURL(hovedFil).href);

  return {
    postKall,
    get upsertKall() { return klientInstans?.upsertKall ?? []; },
    kall: (body, headers = { authorization: `Bearer ${ADMIN_TOKEN}` }) =>
      handler(new Request('https://x.supabase.co/functions/v1/fiken-opprett-kontaktperson', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })),
  };
}

const BODY_OK = { ordreId: ORDRE_ID, navn: 'TEST Selger', epost: 'selger@test.no' };
const ORDRE_MED_ALIAS = { data: { kunde: 'TEST Kunde AS', forhandler_orgnr: null }, error: null };
const ALIAS_FUNNET = { data: { fiken_contact_id: 555, fiken_navn: 'Fiken Testkunde AS' }, error: null };

describe('fiken-opprett-kontaktperson: validering', () => {
  it('mangler ordreId: 400', async () => {
    const { kall } = await last();
    const res = await kall({ navn: 'X', epost: 'x@test.no' });
    expect(res.status).toBe(400);
  });
  it('tomt/for langt/kontrolltegn i navn: 400', async () => {
    const { kall } = await last();
    expect((await kall({ ...BODY_OK, navn: '' })).status).toBe(400);
    expect((await kall({ ...BODY_OK, navn: 'x'.repeat(201) })).status).toBe(400);
    expect((await kall({ ...BODY_OK, navn: 'Ola\nNordmann' })).status).toBe(400);
  });
  it('manglende/ugyldig e-post: 400, Fiken kalles aldri', async () => {
    const { kall } = await last({ svar: { ordrer: ORDRE_MED_ALIAS, alias: ALIAS_FUNNET } });
    expect((await kall({ ...BODY_OK, epost: '' })).status).toBe(400);
    expect((await kall({ ...BODY_OK, epost: 'ikke-en-epost' })).status).toBe(400);
    expect((await kall({ ...BODY_OK, epost: 'uten-krøllalfa.no' })).status).toBe(400);
  });
  it('ordren finnes ikke: 404', async () => {
    const { kall } = await last({ svar: { ordrer: { data: null, error: null } } });
    expect((await kall(BODY_OK)).status).toBe(404);
  });
  it('ordren mangler kundenavn: 400', async () => {
    const { kall } = await last({ svar: { ordrer: { data: { kunde: '', forhandler_orgnr: null }, error: null } } });
    expect((await kall(BODY_OK)).status).toBe(400);
  });
});

describe('fiken-opprett-kontaktperson: kundematching', () => {
  it('kjent alias brukes direkte - henter ikke kundelisten fra Fiken i det hele tatt', async () => {
    // upsertKall er en getter som først fylles inne i selve kall()-et (createClient() kalles i
    // handleren) - destrukturer den derfor ALDRI før kall() er ferdig (se merknaden ved
    // fiken-fakturer-rabatt.test.js sin eqKall-getter for samme fallgruve).
    const t = await last({ svar: { ordrer: ORDRE_MED_ALIAS, alias: ALIAS_FUNNET } });
    const res = await t.kall(BODY_OK);
    expect(res.status).toBe(201);
    expect((await res.json())).toMatchObject({ created: true, contactId: 555, contactPersonId: 42 });
    expect(t.upsertKall.filter((u) => u.tabell === 'fiken_kunde_alias')).toHaveLength(0); // ingen ny alias lagret - fantes alt
  });

  it('ingen alias og intet org.nr på ordren: 422, tydelig beskjed, ingen Fiken-skriving', async () => {
    const { kall, postKall } = await last({ svar: { ordrer: { data: { kunde: 'TEST Kunde AS', forhandler_orgnr: null }, error: null } } });
    const res = await kall(BODY_OK);
    expect(res.status).toBe(422);
    const svar = await res.json();
    expect(svar.created).toBe(false);
    expect(svar.reason).toMatch(/organisasjonsnummer|org\.nr/i);
    expect(postKall).toHaveLength(0);
  });

  it('ingen alias, org.nr finnes men gir 0 treff: 422 med tom kandidatliste - IKKE en gjetning', async () => {
    const { kall, postKall } = await last({
      svar: { ordrer: { data: { kunde: 'TEST Kunde AS', forhandler_orgnr: '999 888 777' }, error: null } },
      kunder: [{ contactId: 1, name: 'Et annet firma', organizationNumber: '111222333' }],
    });
    const res = await kall(BODY_OK);
    expect(res.status).toBe(422);
    const svar = await res.json();
    expect(svar.created).toBe(false);
    expect(svar.kandidater).toEqual([]);
    expect(postKall).toHaveLength(0);
  });

  it('ingen alias, org.nr gir FLERE treff: 409 med en tydelig kandidatliste, ingen gjetning', async () => {
    const { kall, postKall } = await last({
      svar: { ordrer: { data: { kunde: 'TEST Kunde AS', forhandler_orgnr: '999888777' }, error: null } },
      kunder: [
        { contactId: 10, name: 'TEST Kunde AS avd. Oslo', organizationNumber: '999888777' },
        { contactId: 11, name: 'TEST Kunde AS avd. Bergen', organizationNumber: '999 888 777' }, // mellomrom skal ignoreres ved sammenligning
      ],
    });
    const res = await kall(BODY_OK);
    expect(res.status).toBe(409);
    const svar = await res.json();
    expect(svar.created).toBe(false);
    expect(svar.kandidater.map((k) => k.contactId).sort()).toEqual([10, 11]);
    expect(postKall).toHaveLength(0);
  });

  it('ingen alias, org.nr gir NØYAKTIG ett treff (mellomrom i org.nr ignoreres): finner kunden OG lagrer en ny alias for neste gang', async () => {
    const t = await last({
      svar: { ordrer: { data: { kunde: 'TEST Kunde AS', forhandler_orgnr: '999 888 777' }, error: null } },
      kunder: [
        { contactId: 1, name: 'Et annet firma', organizationNumber: '111222333' },
        { contactId: 555, name: 'Fiken Testkunde AS', organizationNumber: '999888777' },
      ],
      kontakt: { contactId: 555, name: 'Fiken Testkunde AS', contactPerson: [] },
    });
    const res = await t.kall(BODY_OK);
    expect(res.status).toBe(201);
    expect((await res.json())).toMatchObject({ created: true, contactId: 555 });
    const alias = t.upsertKall.find((u) => u.tabell === 'fiken_kunde_alias');
    expect(alias.payload).toMatchObject({ alias: 'TEST Kunde AS', fiken_contact_id: 555, fiken_navn: 'Fiken Testkunde AS' });
    expect(alias.opts).toEqual({ onConflict: 'alias' });
  });
});

describe('fiken-opprett-kontaktperson: idempotens og selve opprettelsen', () => {
  it('kontaktpersonen finnes allerede (case-uavhengig navnematch): created:false, 200, ingen POST (ingen dublett)', async () => {
    const { kall, postKall } = await last({
      svar: { ordrer: ORDRE_MED_ALIAS, alias: ALIAS_FUNNET },
      kontakt: { contactId: 555, name: 'Fiken Testkunde AS', contactPerson: [{ contactPersonId: 7, name: 'test selger', email: 'gammel@test.no' }] },
    });
    const res = await kall(BODY_OK);
    expect(res.status).toBe(200);
    const svar = await res.json();
    expect(svar.created).toBe(false);
    expect(svar.contactPersonId).toBe(7);
    expect(svar.reason).toMatch(/finnes allerede/);
    expect(postKall).toHaveLength(0);
  });

  it('kontaktpersonen finnes ikke: POST med name+email, Location-header tolket til contactPersonId', async () => {
    const { kall, postKall } = await last({ svar: { ordrer: ORDRE_MED_ALIAS, alias: ALIAS_FUNNET } });
    const res = await kall(BODY_OK);
    expect(res.status).toBe(201);
    const svar = await res.json();
    expect(svar).toMatchObject({ created: true, contactId: 555, contactPersonId: 42, navn: 'TEST Selger', epost: 'selger@test.no', fikenKundeNavn: 'Fiken Testkunde AS' });
    expect(postKall).toHaveLength(1);
    expect(postKall[0]).toMatchObject({ contactId: 555, body: { name: 'TEST Selger', email: 'selger@test.no' } });
  });

  it('Fiken svarer uten/med en uparsérbar Location-header: fortsatt created:true, men contactPersonId null', async () => {
    const { kall } = await last({ svar: { ordrer: ORDRE_MED_ALIAS, alias: ALIAS_FUNNET }, postLocation: null });
    const svar = await (await kall(BODY_OK)).json();
    expect(svar.created).toBe(true);
    expect(svar.contactPersonId).toBeNull();
  });

  it('Fiken avviser GET på kontakten: 502, ingen POST', async () => {
    const { kall, postKall } = await last({ svar: { ordrer: ORDRE_MED_ALIAS, alias: ALIAS_FUNNET }, kontaktOk: false });
    expect((await kall(BODY_OK)).status).toBe(502);
    expect(postKall).toHaveLength(0);
  });

  it('Fiken avviser selve POST-en: 502 med Fikens feiltekst', async () => {
    const { kall } = await last({ svar: { ordrer: ORDRE_MED_ALIAS, alias: ALIAS_FUNNET }, postOk: false });
    const res = await kall(BODY_OK);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Fiken avviste/);
  });
});

describe('fiken-opprett-kontaktperson: innloggingsgate', () => {
  it('uten gyldig admin-token i myk modus (standard): slipper likevel gjennom (ingen EDGE_AUTH_ENFORCE satt i testen)', async () => {
    const { kall } = await last({ svar: { ordrer: ORDRE_MED_ALIAS, alias: ALIAS_FUNNET } });
    const res = await kall(BODY_OK, {});
    expect(res.status).toBe(201); // myk modus: ingen håndheving uten EDGE_AUTH_ENFORCE i miljøet
  });
});
