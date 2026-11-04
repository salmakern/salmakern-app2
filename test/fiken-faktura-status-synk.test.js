// Edge-funksjonen fiken-faktura-status-synk (supabase/functions/fiken-faktura-status-synk):
// FØRSTE steg mot "Fiken gir fakturastatus tilbake" (Henger igjen s90-20261104-5). Testen
// kjører HELE funksjonen mot falsk Deno/fetch/Supabase-klient (samme teknikk som
// fiken-fakturer-rabatt.test.js: kildefilen kopieres til en midlertidig .ts-modul med
// jsr:-importen byttet ut, så ingen ekte kall mot Fiken eller Supabase skjer).
//
// Dekker statuslogikken fra Fikens egen API-spesifikasjon (bekreftet av research 4.11, se
// kommentaren øverst i index.ts): kladd fortsatt der (200) -> "kladd" + uuid lagret; kladd
// borte (404) + kjent uuid -> invoiceDraftUuid-oppslag -> "sendt"/"betalt"/"kladd_borte";
// kladd borte uten kjent uuid -> fall-back på DET LAGREDE fiken_faktura_referanse
// (aldri chassis/regnr regnet ut på nytt, se uavhengig gjennomgang 4.11); flertydige treff
// (mer enn én faktura) -> "ukjent", aldri en gjetning; paginering over flere Fiken-sider;
// allerede "sendt" -> sjekker bare om den er blitt betalt; feilisolasjon per ordre; kun GET
// mot Fiken; feil hemmelighet avvises; kandidat-spørringen ekskluderer faktisk kun "betalt"
// (verifisert ved at den falske databasen faktisk ANVENDER filteret, ikke bare registrerer
// at riktige metoder ble kalt - se terapKandidatFilter).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kilde = readFileSync(
  path.resolve(__dirname, '../supabase/functions/fiken-faktura-status-synk/index.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const IMPORT_LINJE = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
if (!kilde.includes(IMPORT_LINJE)) {
  throw new Error('fiken-faktura-status-synk.test.js: fant ikke forventet import-linje å erstatte - oppdater testen');
}

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

function ordreRad(overrides = {}) {
  return {
    id: 'ord_1', ordretype: 'bil', fakturert: true,
    fiken_kladd_url: 'https://api.fiken.no/api/v2/companies/telemark-salmakerverksted/invoices/drafts/777',
    fiken_kladd_uuid: null, fiken_faktura_referanse: null, fiken_faktura_status: null, fiken_faktura_id: null,
    ...overrides,
  };
}

// Tolker (et lite, men ekte) utvalg av PostgREST-filtre mot de faktiske radene, i stedet for
// bare å registrere at riktige metoder ble kalt - se reviewer-funn 4.11: en test som bare
// sjekker kall-formen kan ikke fange en subtilt feil .or()-streng. Dekker nøyaktig det denne
// funksjonens egen spørring bruker: eq, not(...,'is',null) og or('felt.is.null,felt.neq.verdi').
function terapKandidatFilter(rader, calls) {
  let ut = rader;
  for (const [metode, args] of calls) {
    if (metode === 'eq') { const [kol, val] = args; ut = ut.filter((r) => r[kol] === val); }
    else if (metode === 'not') { const [kol, op, val] = args; if (op === 'is' && val === null) ut = ut.filter((r) => r[kol] != null); }
    else if (metode === 'or') {
      const klausuler = String(args[0]).split(',').map((k) => k.split('.'));
      ut = ut.filter((r) => klausuler.some(([kol, op, verdi]) => {
        if (op === 'is') return verdi === 'null' ? r[kol] == null : r[kol] === verdi;
        if (op === 'eq') return r[kol] === verdi;
        if (op === 'neq') return r[kol] != null && r[kol] !== verdi;
        return false;
      }));
    }
  }
  return ut;
}

function fakeSupabaseKlient({ ordreRader }) {
  const updateKall = [];
  const selectKall = [];
  function lagKjede(tabell) {
    const calls = [];
    const self = {
      select: (...a) => { calls.push(['select', a]); return self; },
      eq: (...a) => { calls.push(['eq', a]); return self; },
      not: (...a) => { calls.push(['not', a]); return self; },
      or: (...a) => { calls.push(['or', a]); return self; },
      order: (...a) => { calls.push(['order', a]); return self; },
      limit: (...a) => { calls.push(['limit', a]); return self; },
      update: (patch) => ({
        eq: async (col, val) => { updateKall.push({ col, val, patch }); return { error: null }; },
      }),
      then: (resolve, reject) => {
        let resultat;
        if (tabell === 'ordrer' && calls.some(([m]) => m === 'select')) {
          selectKall.push(calls);
          resultat = { data: terapKandidatFilter(ordreRader, calls), error: null };
        } else {
          resultat = { data: ordreRader, error: null };
        }
        return Promise.resolve(resultat).then(resolve, reject);
      },
    };
    return self;
  }
  return { from: (tabell) => lagKjede(tabell), updateKall, selectKall };
}

// fikenSvar: (url) => Response | null (null = "uventet kall i testen", kaster tydelig).
async function last({ ordreRader, fikenSvar }) {
  globalThis.Deno = {
    env: {
      get: (k) => ({
        FIKEN_API_KEY: 'fake-fiken-key',
        FIKEN_FAKTURA_STATUS_SYNK_SECRET: 'test-hemmelighet',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
      }[k]),
    },
  };
  let handler;
  globalThis.Deno.serve = (fn) => { handler = fn; };

  const fikenKall = [];
  globalThis.fetch = async (url, init = {}) => {
    fikenKall.push({ url: String(url), method: init.method, headers: init.headers });
    const res = fikenSvar(String(url));
    if (!res) throw new Error(`Uventet Fiken-kall i testen: ${url}`);
    return res;
  };

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const shimFil = path.resolve(__dirname, `_fiken_faktura_status_fake_supabase_${suffix}.mjs`);
  const hovedFil = path.resolve(__dirname, `_fiken_faktura_status_tmp_${suffix}.ts`);
  tmpFiler.push(shimFil, hovedFil);

  let klientInstans;
  writeFileSync(shimFil, 'export function createClient() { return globalThis.__FAKE_SUPABASE_FACTORY__(); }\n');
  globalThis.__FAKE_SUPABASE_FACTORY__ = () => { klientInstans = fakeSupabaseKlient({ ordreRader }); return klientInstans; };

  const tilpasset = kilde.replace(IMPORT_LINJE, `import { createClient } from './${path.basename(shimFil)}'`);
  writeFileSync(hovedFil, tilpasset);
  await import(/* @vite-ignore */ pathToFileURL(hovedFil).href);

  return {
    fikenKall,
    get updateKall() { return klientInstans?.updateKall ?? []; },
    get selectKall() { return klientInstans?.selectKall ?? []; },
    kall: (hemmelighet = 'test-hemmelighet') =>
      handler(new Request('https://x.supabase.co/functions/v1/fiken-faktura-status-synk', {
        method: 'POST',
        headers: { 'x-sync-secret': hemmelighet },
      })),
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('fiken-faktura-status-synk', () => {
  it('avviser med 401 ved feil eller manglende x-sync-secret', async () => {
    const resultat = await last({ ordreRader: [], fikenSvar: () => null });
    const res = await resultat.kall('feil-hemmelighet');
    expect(res.status).toBe(401);
    expect(resultat.fikenKall).toHaveLength(0);
  });

  it('kladden finnes fortsatt (200): status "kladd", uuid lagres', async () => {
    const resultat = await last({
      ordreRader: [ordreRad()],
      fikenSvar: (url) => url.endsWith('/drafts/777') ? json({ draftId: 777, uuid: 'uuid-abc' }) : null,
    });
    const res = await resultat.kall();
    expect(res.status).toBe(200);
    const svar = await res.json();
    expect(svar.resultat.kladd).toBe(1);
    expect(resultat.updateKall[0].patch.fiken_faktura_status).toBe('kladd');
    expect(resultat.updateKall[0].patch.fiken_kladd_uuid).toBe('uuid-abc');
  });

  it('kladden er borte (404), kjent uuid, invoiceDraftUuid finner en IKKE betalt faktura: status "sendt"', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_kladd_uuid: 'uuid-xyz' })],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/777')) return json({}, 404);
        if (url.includes('invoiceDraftUuid=uuid-xyz')) return json([{ invoiceId: 42 }]);
        if (url.endsWith('/invoices/42')) return json({ invoiceId: 42, sale: { settled: false } });
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.sendt).toBe(1);
    expect(resultat.updateKall[0].patch).toMatchObject({ fiken_faktura_status: 'sendt', fiken_faktura_id: 42 });
  });

  it('kladden er borte (404), kjent uuid, fakturaen ER betalt: status "betalt"', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_kladd_uuid: 'uuid-xyz' })],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/777')) return json({}, 404);
        if (url.includes('invoiceDraftUuid=uuid-xyz')) return json([{ invoiceId: 99 }]);
        if (url.endsWith('/invoices/99')) return json({ invoiceId: 99, sale: { settled: true, settledDate: '2026-11-01' } });
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.betalt).toBe(1);
    expect(resultat.updateKall[0].patch.fiken_faktura_status).toBe('betalt');
  });

  it('invoiceDraftUuid-oppslaget går over FLERE Fiken-sider før treffet dukker opp', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_kladd_uuid: 'uuid-flersider' })],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/777')) return json({}, 404);
        if (url.includes('invoiceDraftUuid=uuid-flersider') && url.includes('page=0')) return json([{ invoiceId: 1 }], 200, { 'Fiken-Api-Page-Count': '2' });
        if (url.includes('invoiceDraftUuid=uuid-flersider') && url.includes('page=1')) return json([{ invoiceId: 123 }], 200, { 'Fiken-Api-Page-Count': '2' });
        if (url.endsWith('/invoices/1')) return json({ invoiceId: 1, sale: { settled: false } });
        if (url.endsWith('/invoices/123')) return json({ invoiceId: 123, sale: { settled: false } });
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    // To treff totalt (ett per side) -> tvetydig, skal IKKE gjette på det første.
    expect(svar.resultat.ukjent).toBe(1);
  });

  it('invoiceDraftUuid finner MER ENN ÉN faktura (uventet): status "ukjent", gjetter ikke', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_kladd_uuid: 'uuid-tvetydig' })],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/777')) return json({}, 404);
        if (url.includes('invoiceDraftUuid=uuid-tvetydig')) return json([{ invoiceId: 1 }, { invoiceId: 2 }]);
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.ukjent).toBe(1);
    expect(resultat.updateKall[0].patch.fiken_faktura_status).toBe('ukjent');
    expect(resultat.updateKall[0].patch.fiken_faktura_id).toBeUndefined();
  });

  it('kladden er borte (404), INGEN kjent uuid (historisk): faller tilbake til DET LAGREDE fiken_faktura_referanse og finner fakturaen', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_kladd_uuid: null, fiken_faktura_referanse: 'HISTORISK123' })],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/777')) return json({}, 404);
        if (url.includes('orderReference=HISTORISK123')) return json([{ invoiceId: 7, orderReference: 'HISTORISK123' }]);
        if (url.endsWith('/invoices/7')) return json({ invoiceId: 7, sale: { settled: false } });
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.sendt).toBe(1);
  });

  it('orderReference-fallback finner TO eksakte treff (samme chassis brukt på to ordre): status "ukjent", gjetter ikke', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_kladd_uuid: null, fiken_faktura_referanse: 'DELT-CHASSIS' })],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/777')) return json({}, 404);
        if (url.includes('orderReference=DELT-CHASSIS')) return json([
          { invoiceId: 1, orderReference: 'DELT-CHASSIS' },
          { invoiceId: 2, orderReference: 'DELT-CHASSIS' },
        ]);
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.ukjent).toBe(1);
  });

  it('kladden er borte (404), ingen uuid men en lagret referanse UTEN treff: status "kladd_borte"', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_kladd_uuid: null, fiken_faktura_referanse: 'SLETTET456' })],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/777')) return json({}, 404);
        if (url.includes('orderReference=SLETTET456')) return json([]);
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.kladd_borte).toBe(1);
    expect(resultat.updateKall[0].patch.fiken_faktura_status).toBe('kladd_borte');
  });

  it('kladden er borte (404), VERKEN uuid NOCH lagret referanse: status "ukjent" UTEN noe oppslagskall mot Fiken', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_kladd_uuid: null, fiken_faktura_referanse: null })],
      fikenSvar: (url) => (url.endsWith('/drafts/777') ? json({}, 404) : null),
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.ukjent).toBe(1);
    // Kun selve kladd-GET-et skal ha skjedd - ingen gjetning uten noe å slå opp på.
    expect(resultat.fikenKall).toHaveLength(1);
  });

  it('allerede "sendt" med kjent faktura-id: sjekker bare direkte om den nå er betalt (ingen kladd-GET)', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ fiken_faktura_status: 'sendt', fiken_faktura_id: 55 })],
      fikenSvar: (url) => url.endsWith('/invoices/55') ? json({ invoiceId: 55, sale: { settled: true } }) : null,
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.betalt).toBe(1);
    expect(resultat.fikenKall.some((k) => k.url.includes('/drafts/'))).toBe(false);
  });

  it('en ordre som kaster (Fiken-feil) stopper ikke de andre, og telles som feilet', async () => {
    const resultat = await last({
      ordreRader: [ordreRad({ id: 'ord_feil', fiken_kladd_url: 'https://api.fiken.no/api/v2/companies/telemark-salmakerverksted/invoices/drafts/1' }), ordreRad({ id: 'ord_ok' })],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/1')) return json({}, 500); // kaster (ikke 200/404) i funksjonen
        if (url.endsWith('/drafts/777')) return json({ uuid: 'u1' });
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    expect(svar.resultat.feilet).toBe(1);
    expect(svar.resultat.kladd).toBe(1);
    expect(resultat.updateKall).toHaveLength(1); // kun den vellykkede ble skrevet
  });

  it('kandidat-spørringen henter faktisk IKKE en "betalt"-ordre, men henter en "kladd_borte" på nytt (ekte filtrering, ikke bare kall-form)', async () => {
    const resultat = await last({
      ordreRader: [
        ordreRad({ id: 'ord_betalt', fiken_faktura_status: 'betalt' }),
        ordreRad({ id: 'ord_kladd_borte', fiken_kladd_uuid: null, fiken_faktura_referanse: 'X', fiken_faktura_status: 'kladd_borte' }),
        ordreRad({ id: 'ord_leveranse', ordretype: 'leveranse' }),
        ordreRad({ id: 'ord_ufakturert', fakturert: false }),
      ],
      fikenSvar: (url) => {
        if (url.endsWith('/drafts/777')) return json({}, 404);
        if (url.includes('orderReference=X')) return json([]);
        return null;
      },
    });
    const res = await resultat.kall();
    const svar = await res.json();
    // Eneste raden som faktisk burde vært plukket opp av det ekte filteret er ord_kladd_borte.
    expect(svar.sjekket).toBe(1);
    expect(svar.resultat.kladd_borte).toBe(1);
    expect(resultat.updateKall).toHaveLength(1);
    expect(resultat.updateKall[0].col).toBe('id');
    expect(resultat.updateKall[0].val).toBe('ord_kladd_borte');
  });

  it('kaller Fiken bare med GET (ingen init.method satt noe sted)', async () => {
    const resultat = await last({
      ordreRader: [ordreRad()],
      fikenSvar: (url) => url.endsWith('/drafts/777') ? json({ uuid: 'u' }) : null,
    });
    await resultat.kall();
    expect(resultat.fikenKall.every((k) => !k.method || k.method === 'GET')).toBe(true);
  });
});
