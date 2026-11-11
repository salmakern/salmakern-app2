// Helhetlig regresjonstest for HELE kjeden rundt s08-048/s90-20261031-7 (portal-ordre ->
// Bekreft -> fiken_linjer med frosset rabatt -> faktisk fakturert med riktig rabatt), bedt om
// av Henrik 5.11 (portal-øktas anbefalte steg 1: "bevis kjeden i ekte flyt" FØR mer automatikk
// bygges) etter at en demobestilling i produksjon 4.11 fant to bugger i nøyaktig denne kjeden
// (se commit 5828a1c). Tidligere tester dekker hver funksjon isolert (portal-ordre-
// visning.test.js stubber autoVelgUtstyrMal/leggTilPortalUtstyrLinjer, fiken-ombygging.test.js
// og fiken-fakturer-rabatt.test.js tester hver sin ende) - denne testen kjører de EKTE
// funksjonene i rekkefølge, fra Bekreft til selve Fiken-kladden, mot en FALSK Fiken (ALDRI en
// ekte kladd - en ekte TEST-kladd i Fiken krever Henriks eget, separate ja, se Henger igjen).
//
// To faser i samme vm-context:
//  (1) Klientsiden: laster core.js + ordre-detalj.js + ansatte-utstyr.js + lager.js +
//      ordre-diverse.js i SAMME context (ekte filer, samme rekkefølge som salmakern.html) med
//      en falsk db hvis rpc('oppdater_ordre_fiken_linje', ...) etterligner den EKTE RPC-ens
//      oppførsel (radlås-semantikk: ny linje slår opp pris/mva, eksisterende linje slår
//      sammen felt) - kaller EKTE portalBekreftOrdre(), så EKTE synkroniserOmbyggingFikenLinjer
//      (simulerer en re-rendring/åpning av ordren) og toggler Ombygging-boksen av/på.
//  (2) Serversiden: resultatet (o.fikenLinjer) sendes som `linjer` til EKTE fiken-fakturer
//      (samme shim-teknikk som fiken-fakturer-rabatt.test.js) mot en falsk Fiken, og testen
//      sjekker at den faktiske kladd-kroppen har riktig frosset rabatt på alle tre linjene.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../js', f), 'utf8').replace(/\r\n/g, '\n');

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

// EV9-prisene slik de faktisk ligger i fiken_priser (bekreftet mot produksjon 4.11, se
// Henger igjen s90-20261031-7: 500=51500, 502=1670, 514=20310, alle mva "high").
const FIKEN_PRISER = {
  500: { pris: 51500, mva: 'high' },
  502: { pris: 1670, mva: 'high' },
  514: { pris: 20310, mva: 'high' },
  501: { pris: 2500, mva: 'high' },
};

// Etterligner oppdater_ordre_fiken_linje (migrasjon 20261022150000/20261030220000): radlås-
// semantikk sløyfes (ingen samtidighet i en vm-test), men selve regelen gjenskapes - ny linje
// slår opp pris/mva fra "fiken_priser" KUN når den opprettes, eksisterende linje slår sammen
// (coalesce(eksisterende,'{}') || ny), fjerning ved p_linje === null.
function fakeDb(S) {
  return {
    rpc: async (navn, args) => {
      if (navn !== 'oppdater_ordre_fiken_linje') return { data: null, error: null }; // legg_til_ordre_endring o.l.
      const o = S.ordrer.find((x) => x.id === args.p_ordre_id);
      if (!o) return { data: null, error: { message: 'ORDRE_FINNES_IKKE' } };
      let linjer = o.fikenLinjer || [];
      const idx = linjer.findIndex((l) => l.produktnummer === args.p_produktnummer);
      if (args.p_linje === null) {
        linjer = idx === -1 ? linjer : linjer.filter((_, i) => i !== idx);
      } else {
        let ny = { ...args.p_linje };
        if (idx === -1 && FIKEN_PRISER[ny.produktnummer]) ny = { ...ny, ...FIKEN_PRISER[ny.produktnummer], kilde: 'fiken_priser' };
        linjer = idx === -1 ? [...linjer, ny] : linjer.map((l, i) => (i === idx ? { ...l, ...ny } : l));
      }
      o.fikenLinjer = linjer;
      return { data: { fikenLinjer: linjer }, error: null };
    },
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }), upsert: async () => ({ error: null }) }),
  };
}

function nyttKlientMiljo() {
  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {} },
    document: {
      addEventListener() {}, getElementById() { return null; },
      createElement() { return { style: {}, appendChild() {}, classList: { add() {}, remove() {} } }; },
      head: { appendChild() {} }, body: { appendChild() {} },
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout(fn) { fn(); }, clearTimeout() {},
  };
  vm.createContext(sandbox);
  for (const fil of ['core.js', 'ordre-detalj.js', 'ansatte-utstyr.js', 'lager.js', 'ordre-diverse.js']) {
    vm.runInContext(les(fil), sandbox, { filename: fil });
  }
  vm.runInContext(`
    function _setS(v){ S = v; } function _getS(){ return S; }
    function _setMe(v){ me = v; } function _setDb(v){ db = v; }
    function _setAktiv(v){ activeOrdreId = v; }
  `, sandbox);
  return sandbox;
}

function portalEv9Ordre() {
  return {
    id: 'ord_1', regnr: '', chassis: 'TESTEV9HELHETLIG01', kunde: 'Skagerrak Bilsenter AS', eier: 'Andreas Kåsa',
    status: 'aktiv', ordreStatus: 'paa_vei', merke: 'KIA', modell: 'EV9',
    ombygging: { nyttKjoretoy: false, bruktKjoretoy: false, lafinto: false, personbil: false },
    utstyr: { skalHa: '' }, utstyrMalNavn: null, utstyrSjekkliste: [],
    fikenLinjer: [], endringer: [],
    portalBestillingId: 'cm9helhetlig0001', portalBekreftetAt: null, portalBekreftetAv: '',
    portalModellSlug: null,
    portalLinjer: [
      { produktnummer: '500', navn: 'Standard ombygging', rabatt_prosent: 20 },
      { produktnummer: '502', navn: '6-seter svingbare', rabatt_prosent: 20 },
      { produktnummer: '514', navn: 'Skuffer med heldekkende gulv', rabatt_prosent: 5 },
    ],
  };
}

// ── Fase 2: ekte fiken-fakturer mot falsk Fiken (samme shim-teknikk som fiken-fakturer-rabatt.test.js) ──
const fikenFakturerKilde = readFileSync(path.resolve(__dirname, '../supabase/functions/fiken-fakturer/index.ts'), 'utf8').replace(/\r\n/g, '\n');
const IMPORT_LINJE = "import { createClient } from 'jsr:@supabase/supabase-js@2'";
const SLUG = 'telemark-salmakerverksted';
const CONTACT_ID = 777;

function fakeSupabaseKlientFiken(o) {
  return {
    from(tabell) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  if (tabell === 'fiken_kunde_alias') return { data: { fiken_contact_id: CONTACT_ID }, error: null };
                  // Rettet 5.11 (pengefelle-fiks): fiken-fakturer leser nå linjene fra ordrer.fiken_linjer
                  // i stedet for klientens request-body - send DEN EKTE o.fikenLinjer her, akkurat slik
                  // de ville stått i databasen etter de ekte RPC-kallene over, ikke en kopi i body.
                  if (tabell === 'ordrer') return { data: { fiken_kladd_url: null, fiken_linjer: o.fikenLinjer }, error: null }; // idempotens: ingen kladd fra før
                  return { data: null, error: null }; // fiken_kunde_rabatt - ikke konsultert, alle linjer har frosset rabatt
                },
              };
            },
            // fiken_priser sitt .not('kategori','is',null) (kategoriMap i index.ts) - tom
            // liste her, akkurat som uten denne testens egen fiken_kunde_rabatt-respons:
            // ingen eksplisitte kategorier, ren navnegjetting som før.
            not: async () => ({ data: [], error: null }),
          };
        },
        upsert: async () => ({ error: null }),
        update() { return { eq: async () => ({ error: null }) }; },
      };
    },
  };
}

async function kjorFikenFakturer(body, o) {
  globalThis.Deno = {
    env: { get: (k) => ({ FIKEN_API_KEY: 'fake-key', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key' }[k]) },
  };
  let handler;
  globalThis.Deno.serve = (fn) => { handler = fn; };
  let draftKropp = null;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    const json = (b, s = 200, headers = {}) => new Response(JSON.stringify(b), { status: s, headers });
    if (u === `https://api.fiken.no/api/v2/companies` && method === 'GET') return json([{ slug: SLUG }]);
    if (u.startsWith(`https://api.fiken.no/api/v2/companies/${SLUG}/products?`) && method === 'GET') {
      return json([
        { productId: 500, productNumber: '500', name: 'Standard ombygging', incomeAccount: '3010' },
        { productId: 502, productNumber: '502', name: '6-seter svingbare', incomeAccount: '3010' },
        { productId: 514, productNumber: '514', name: 'Skuffer med heldekkende gulv', incomeAccount: '3010' },
      ], 200, { 'Fiken-Api-Page-Count': '1' });
    }
    if (u === `https://api.fiken.no/api/v2/companies/${SLUG}/contacts/${CONTACT_ID}` && method === 'GET') {
      return json({ contactId: CONTACT_ID, name: 'Skagerrak Bilsenter AS', contactPerson: [] }); // ingen kjent kontaktperson - uendret oppførsel
    }
    if (u === `https://api.fiken.no/api/v2/companies/${SLUG}/invoices/drafts` && method === 'POST') {
      draftKropp = JSON.parse(init.body);
      return json({ ok: true }, 201, { Location: `https://api.fiken.no/api/v2/companies/${SLUG}/invoices/drafts/9001` });
    }
    throw new Error(`Uventet fetch-kall i testen: ${method} ${u}`);
  };

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const shimFil = path.resolve(__dirname, `_helhetlig_fake_supabase_${suffix}.mjs`);
  const hovedFil = path.resolve(__dirname, `_helhetlig_fiken_fakturer_${suffix}.ts`);
  tmpFiler.push(shimFil, hovedFil);
  writeFileSync(shimFil, 'export function createClient() { return globalThis.__FAKE_SUPABASE_FACTORY__(); }\n');
  globalThis.__FAKE_SUPABASE_FACTORY__ = () => fakeSupabaseKlientFiken(o);
  const tilpasset = fikenFakturerKilde.replace(IMPORT_LINJE, `import { createClient } from './${path.basename(shimFil)}'`);
  writeFileSync(hovedFil, tilpasset);
  await import(/* @vite-ignore */ pathToFileURL(hovedFil).href);

  const res = await handler(new Request('https://x.supabase.co/functions/v1/fiken-fakturer', { method: 'POST', body: JSON.stringify(body) }));
  const svar = await res.json();
  return { status: res.status, svar, get draftKropp() { return draftKropp; } };
}

describe('Helhetlig kjede: portal-Bekreft -> åpne ordren -> fakturer mot falsk Fiken', () => {
  it('EV9-ordrens tre portallinjer overlever Bekreft, en re-rendring og av/på-toggling av Ombygging-boksen, og fakturaen får riktig frosset rabatt på alle tre', async () => {
    const klient = nyttKlientMiljo();
    const o = portalEv9Ordre();
    klient._setS({ ordrer: [o], utstyrMaler: [{ navn: 'KIA EV9', biltype: 'kia ev9', punkter: ['Sjekk dekk', 'Panorama glasstak'] }] });
    klient._setMe({ id: 1, navn: 'Test Ansatt', rolle: 'admin' });
    klient._setDb(fakeDb(klient._getS()));
    klient._setAktiv('ord_1');

    // ── Fase 1a: Bekreft (EKTE autoVelgUtstyrMal + EKTE leggTilPortalUtstyrLinjer, ikke stubbet) ──
    await klient.autoVelgUtstyrMal('ord_1');
    await klient.leggTilPortalUtstyrLinjer('ord_1');

    const produktnumre = () => o.fikenLinjer.map((l) => l.produktnummer).sort();
    expect(produktnumre()).toEqual(['500', '502', '514']);
    expect(o.fikenLinjer.find((l) => l.produktnummer === '500').rabatt).toBe(20);
    expect(o.fikenLinjer.find((l) => l.produktnummer === '502').rabatt).toBe(20);
    expect(o.fikenLinjer.find((l) => l.produktnummer === '514').rabatt).toBe(5);
    expect(o.utstyrMalNavn).toBe('KIA EV9');
    // EV9 + et panorama-punkt i malen -> "Ikke 501" lagt til, "501" fjernet (uendret, egen logikk) - ingen av delene skal forstyrre portallinjene.
    expect(produktnumre()).not.toContain('501');

    // ── Fase 1b: åpne ordren på nytt (simulerer buildOrdreDetail -> synkroniserOmbyggingFikenLinjer) ──
    // Dette er NØYAKTIG scenarioet som feilet i produksjon 4.11: Ombygging-boksen er IKKE huket
    // av for en portal-ordre, og denne synken fjernet tidligere linje 500 (med rabatten) igjen.
    expect(o.ombygging.nyttKjoretoy).toBe(false);
    klient.synkroniserOmbyggingFikenLinjer(o);
    expect(produktnumre()).toEqual(['500', '502', '514']);
    expect(o.fikenLinjer.find((l) => l.produktnummer === '500').rabatt).toBe(20);

    // ── Fase 1c: en ansatt huker av og fjerner Ombygging-boksen i etterkant - linjen (med rabatt) skal overleve begge veier ──
    o.ombygging.nyttKjoretoy = true;
    klient.synkroniserOmbyggingFikenLinjer(o);
    expect(produktnumre()).toEqual(['500', '502', '514']);
    o.ombygging.nyttKjoretoy = false;
    klient.synkroniserOmbyggingFikenLinjer(o);
    expect(produktnumre()).toEqual(['500', '502', '514']);
    expect(o.fikenLinjer.find((l) => l.produktnummer === '500').rabatt).toBe(20);

    // ── Fase 2: fakturer (samme kropp kallFikenFakturer faktisk bygger) mot falsk Fiken ──
    const { status, svar, draftKropp } = await kjorFikenFakturer({
      ordreId: o.id, kundeNavn: o.kunde, kontaktpersonNavn: o.eier, chassisNr: o.chassis, regnr: o.regnr || undefined,
      linjer: klient.sorterFikenLinjer(o.fikenLinjer), brukRabatt: true,
    }, o);
    expect(status, JSON.stringify(svar)).toBe(201);
    expect(svar.ok).toBe(true);

    const linjePerProdukt = Object.fromEntries(draftKropp.lines.map((l, i) => [['500', '502', '514'][i], l]));
    expect(draftKropp.lines).toHaveLength(3);
    expect(linjePerProdukt['500'].discount).toBe(20);
    expect(linjePerProdukt['502'].discount).toBe(20);
    expect(linjePerProdukt['514'].discount).toBe(5);
    // Prisene skal være de FROSSNE fra fiken_priser (satt av oppdater_ordre_fiken_linje ved Bekreft), i øre.
    expect(linjePerProdukt['500'].unitPrice).toBe(51500 * 100);
    expect(linjePerProdukt['502'].unitPrice).toBe(1670 * 100);
    expect(linjePerProdukt['514'].unitPrice).toBe(20310 * 100);
  });
});
