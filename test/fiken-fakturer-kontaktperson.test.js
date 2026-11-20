// fiken-fakturer: dekker KUN den nye needsKontaktperson-grenen (s90-...-fiken-kontaktperson,
// Henrik: en selger fra Forhandlerportalen - ny ELLER en av de ca. 270 eksisterende - uten en
// tilsvarende Fiken-kontaktperson skal oppdages og løses VED FAKTURERING, ikke stille hoppes
// over). Samme grunnteknikk og falske Supabase-klient som fiken-fakturer-rabatt.test.js (se der
// for den fulle begrunnelsen) - duplisert her fordi testfilene ikke eksporterer sine
// hjelpefunksjoner og testene dekker to ulike, uavhengige egenskaper ved samme funksjon.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fikenFakturerKilde = readFileSync(
  path.resolve(__dirname, '../supabase/functions/fiken-fakturer/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const IMPORT_LINJE = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
if (!fikenFakturerKilde.includes(IMPORT_LINJE)) {
  throw new Error('fiken-fakturer-kontaktperson.test.js: fant ikke forventet import-linje å erstatte - oppdater testen');
}

const SLUG = 'telemark-salmakerverksted';
const CONTACT_ID = 555;
const ORDRE_ID = 'ord_test_kp1';
const OMBYGGING_PRODUKT = { productId: 100, productNumber: '100', name: 'Standard ombygging', incomeAccount: '3010' };
const ALLE_PRODUKTER = [OMBYGGING_PRODUKT];

function linje(produktnummer, ekstra = {}) {
  return { produktnummer, antall: 1, ...ekstra };
}

function fakeSupabaseKlient(svar) {
  const eqKall = [];
  let ordrerSelectKall = 0;
  return {
    eqKall,
    from(tabell) {
      if (tabell === 'ordrer') {
        return {
          select() {
            return {
              eq(kolonne, verdi) {
                eqKall.push({ tabell, kolonne, verdi });
                ordrerSelectKall++;
                return { maybeSingle: async () => (svar.ordrer ?? { data: null, error: null }) };
              },
            };
          },
          update(payload) {
            return {
              eq() {
                return {
                  is() {
                    eqKall.push({ tabell, kolonne: 'fiken_kladd_url', verdi: null, type: 'claim' });
                    const alleredeSatt = svar.ordrer?.data && svar.ordrer.data.fiken_kladd_url !== null;
                    if (alleredeSatt) return { select: async () => ({ data: [], error: null }) };
                    if (svar.ordrer?.data) Object.assign(svar.ordrer.data, payload);
                    return { select: async () => ({ data: [{ id: 'x' }], error: null }) };
                  },
                  eq(kolonne2, verdi2) {
                    eqKall.push({ tabell, kolonne: kolonne2, verdi: verdi2, type: 'release' });
                    if (svar.ordrer?.data && svar.ordrer.data.fiken_kladd_url === verdi2) Object.assign(svar.ordrer.data, payload);
                    return Promise.resolve({ error: null });
                  },
                  then(resolve, reject) {
                    if (svar.ordrer?.data) Object.assign(svar.ordrer.data, payload);
                    return Promise.resolve({ error: null }).then(resolve, reject);
                  },
                };
              },
            };
          },
        };
      }
      return {
        select() {
          return {
            eq(kolonne, verdi) {
              eqKall.push({ tabell, kolonne, verdi });
              const svarForTabell = svar[tabell];
              const rad = typeof svarForTabell === 'function' ? svarForTabell(kolonne, verdi) : (svarForTabell ?? { data: null, error: null });
              return { maybeSingle: async () => rad };
            },
            not: async () => svar.fiken_priser ?? { data: [], error: null },
          };
        },
        upsert: async () => ({ error: null }),
        update() { return { eq: async () => ({ error: null }) }; },
      };
    },
  };
}

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

// kontakt: svaret fra GET /companies/:slug/contacts/:contactId (contactPerson-array m.m.).
// kontaktOk=false simulerer at selve GET-kallet feiler (Fiken nede/feil) - uendret oppførsel da.
async function last({ svar = {}, produkter = ALLE_PRODUKTER, kontakt = { contactId: CONTACT_ID, name: 'Fiken Testkunde AS', contactPerson: [] }, kontaktOk = true } = {}) {
  const draftKall = [];
  const kontaktKall = [];
  globalThis.Deno = {
    env: {
      get: (k) => ({ FIKEN_API_KEY: 'fake-key', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key' }[k]),
    },
  };
  let handler;
  globalThis.Deno.serve = (fn) => { handler = fn; };

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    const json = (b, s = 200, headers = {}) => new Response(JSON.stringify(b), { status: s, headers });
    if (u === 'https://api.fiken.no/api/v2/companies' && method === 'GET') return json([{ slug: SLUG }]);
    if (u.startsWith(`https://api.fiken.no/api/v2/companies/${SLUG}/products?`) && method === 'GET') {
      return json(produkter, 200, { 'Fiken-Api-Page-Count': '1' });
    }
    if (u === `https://api.fiken.no/api/v2/companies/${SLUG}/contacts/${CONTACT_ID}` && method === 'GET') {
      kontaktKall.push(true);
      if (!kontaktOk) return json({ message: 'Fiken nede' }, 502);
      return json(kontakt);
    }
    if (u === `https://api.fiken.no/api/v2/companies/${SLUG}/invoices/drafts` && method === 'POST') {
      const kropp = JSON.parse(init.body);
      draftKall.push(kropp);
      return json({ ok: true }, 201, { Location: `https://api.fiken.no/api/v2/companies/${SLUG}/invoices/drafts/999` });
    }
    throw new Error(`Uventet fetch-kall i testen: ${method} ${u}`);
  };

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const shimFil = path.resolve(__dirname, `_fiken_fakturer_kp_fake_supabase_${suffix}.mjs`);
  const hovedFil = path.resolve(__dirname, `_fiken_fakturer_kp_tmp_${suffix}.ts`);
  tmpFiler.push(shimFil, hovedFil);
  writeFileSync(shimFil, 'export function createClient() { return globalThis.__FAKE_SUPABASE_FACTORY__(); }\n');
  let klientInstans;
  globalThis.__FAKE_SUPABASE_FACTORY__ = () => { klientInstans = fakeSupabaseKlient(svar); return klientInstans; };
  const tilpasset = fikenFakturerKilde.replace(IMPORT_LINJE, `import { createClient } from './${path.basename(shimFil)}'`);
  writeFileSync(hovedFil, tilpasset);
  await import(/* @vite-ignore */ pathToFileURL(hovedFil).href);

  return {
    draftKall,
    kontaktKall,
    get eqKall() { return klientInstans?.eqKall ?? []; },
    kall: (body) => handler(new Request('https://x.supabase.co/functions/v1/fiken-fakturer', { method: 'POST', body: JSON.stringify(body) })),
  };
}

function standardBody(linjer, overrides = {}) {
  return { ordreId: ORDRE_ID, kundeNavn: 'Test Kunde AS', kontaktpersonNavn: 'Ola Nordmann', linjer, ...overrides };
}

const ALIAS_FUNNET = { fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null } };

describe('fiken-fakturer: needsKontaktperson (ny gren)', () => {
  it('kontaktpersonen finnes IKKE hos kunden i Fiken: stopper FØR reservasjonen, ingen kladd-POST, ingen klaim av ordren', async () => {
    const { kall, draftKall, eqKall } = await last({ svar: { ...ALIAS_FUNNET, ordrer: { data: { fiken_kladd_url: null, fiken_linjer: [linje('100')] }, error: null } } });
    const res = await kall(standardBody([linje('100')]));
    expect(res.status).toBe(200);
    const svar = await res.json();
    expect(svar).toMatchObject({ needsKontaktperson: true, ordreId: ORDRE_ID, kundeNavn: 'Test Kunde AS', kontaktpersonNavn: 'Ola Nordmann', contactId: CONTACT_ID, fikenKundeNavn: 'Fiken Testkunde AS' });
    expect(draftKall).toHaveLength(0);
    expect(eqKall.some((e) => e.type === 'claim')).toBe(false); // ordren ble aldri reservert/klaimet
  });

  it('kontaktpersonen finnes (case-uavhengig navnematch): bruker contactPersonId i kladden, ingen needsKontaktperson', async () => {
    const kontakt = { contactId: CONTACT_ID, name: 'Fiken Testkunde AS', contactPerson: [{ contactPersonId: 77, name: 'ola nordmann', email: 'ola@test.no' }] };
    const { kall, draftKall } = await last({ svar: { ...ALIAS_FUNNET, ordrer: { data: { fiken_kladd_url: null, fiken_linjer: [linje('100')] }, error: null } }, kontakt });
    const res = await kall(standardBody([linje('100')]));
    expect(res.status).toBe(201);
    expect((await res.json()).ok).toBe(true);
    expect(draftKall).toHaveLength(1);
    expect(draftKall[0].contactPersonId).toBe(77);
  });

  it('hoppOverKontaktpersonsjekk:true: fakturerer videre UTEN kontaktperson, selv om ingen match finnes', async () => {
    const { kall, draftKall } = await last({ svar: { ...ALIAS_FUNNET, ordrer: { data: { fiken_kladd_url: null, fiken_linjer: [linje('100')] }, error: null } } });
    const res = await kall(standardBody([linje('100')], { hoppOverKontaktpersonsjekk: true }));
    expect(res.status).toBe(201);
    expect(draftKall).toHaveLength(1);
    expect(draftKall[0].contactPersonId).toBeUndefined();
  });

  it('ingen kontaktpersonNavn i det hele tatt: hopper over hele sjekken, fakturerer som før (ingen GET mot /contacts/:id)', async () => {
    const { kall, draftKall, kontaktKall } = await last({ svar: { ...ALIAS_FUNNET, ordrer: { data: { fiken_kladd_url: null, fiken_linjer: [linje('100')] }, error: null } } });
    const res = await kall(standardBody([linje('100')], { kontaktpersonNavn: undefined }));
    expect(res.status).toBe(201);
    expect(draftKall).toHaveLength(1);
    expect(kontaktKall).toHaveLength(0);
  });

  it('GET mot /contacts/:id feiler (Fiken nede): fakturerer videre uten kontaktperson, akkurat som før - stopper ikke på noe vi ikke klarte å bekrefte', async () => {
    const { kall, draftKall } = await last({ svar: { ...ALIAS_FUNNET, ordrer: { data: { fiken_kladd_url: null, fiken_linjer: [linje('100')] }, error: null } }, kontaktOk: false });
    const res = await kall(standardBody([linje('100')]));
    expect(res.status).toBe(201);
    expect(draftKall).toHaveLength(1);
    expect(draftKall[0].contactPersonId).toBeUndefined();
  });

  it('allerede fakturert (idempotens): needsKontaktperson sjekkes ikke i det hele tatt - returnerer bare den lagrede kladd-URL-en', async () => {
    const { kall, draftKall } = await last({ svar: { ...ALIAS_FUNNET, ordrer: { data: { fiken_kladd_url: 'https://fiken.test/kladd/gammel', fiken_linjer: [linje('100')] }, error: null } } });
    const res = await kall(standardBody([linje('100')]));
    expect(res.status).toBe(200);
    const svar = await res.json();
    expect(svar).toMatchObject({ ok: true, draftUrl: 'https://fiken.test/kladd/gammel', alleredeOpprettet: true });
    expect(draftKall).toHaveLength(0);
  });
});
