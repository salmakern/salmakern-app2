// fiken-fakturer (s08-048, 2026-10-31): dekker KUN den nye "frosset rabatt"-logikken rundt
// line.discount - denne funksjonen har aldri hatt en automatisk test før. Samme grunnteknikk
// som fiken-endre-produkt.test.js (last rå kildetekst, stub Deno/fetch, dynamisk import av en
// temp-fil), men fiken-fakturer importerer i tillegg en ekte Supabase-klient
// (`jsr:@supabase/supabase-js@2`), som verken Node eller Vite kan løse - den importlinjen
// byttes derfor ut med en lokal falsk modul FØR temp-filen skrives, se last().
//
// Testen bryr seg kun om étt felt i POST-kroppen som sendes til Fiken sin
// /invoices/drafts: lines[].discount. Alt annet i funksjonen (kunde-alias, produktoppslag,
// kontaktperson, idempotens via ordreId) mockes med det minimum som trengs for å nå frem
// til linjebyggingen uten å kaste - se BAKGRUNN i oppgaveteksten for selve regelen som
// testes:
//   1) l.rabatt (frosset, satt av portalen) vinner ALLTID over kundens fiken_kunde_rabatt,
//      uansett produktkategori (ombygging/ekstra utstyr) og uansett brukRabatt-flagget.
//   2) Uten l.rabatt: uendret oppførsel - kategori-basert sats fra fiken_kunde_rabatt.
//   3) l.rabatt === 0 gir ingen discount-felt (samme utfall som "ingen rabatt" via
//      kategori-logikken, men via en annen kodevei - begge skal ende likt).
//   4) l.rabatt som ikke er et tall (streng, null, NaN) er IKKE "låst" - faller tilbake til
//      kategori-logikken akkurat som om l.rabatt manglet helt.
//   5) Drivstofflinjer (erOverstyrtBelop, dvs. l.belop satt) skal ALDRI få discount, selv om
//      l.rabatt er satt til et tall > 0 på samme linje.
//
// Reviewer-runde (2026-10-31): fakeSupabaseKlient() sin .eq() ignorerte opprinnelig hvilken
// kolonne/verdi index.ts faktisk spurte om, og svarte med samme kanoniske rad uansett - en
// bug der fiken_kunde_rabatt ble slått opp med feil contactId ville aldri blitt fanget. Nå
// kan svar[tabell] være en funksjon av (kolonne, verdi), eqKall samler hvert .eq()-kall for
// assertions, og en egen test-blokk ("sjekk 5") beviser at riktig contactId faktisk brukes.
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
  // Hvis denne linjen noen gang endres i index.ts uten at testen oppdateres, skal testen
  // feile høyt og tydelig her - ikke stille laste ekte jsr:-import og krasje i dynamisk import.
  throw new Error('fiken-fakturer-rabatt.test.js: fant ikke forventet import-linje å erstatte - oppdater testen');
}

const SLUG = 'telemark-salmakerverksted';
const CONTACT_ID = 555;
// ordreId er obligatorisk siden 5.11 (pengefelle-fiks: linjene leses nå fra ordrer.fiken_linjer
// i databasen, ikke fra body.linjer) - standardBody() setter den alltid, og last().kall() fyller
// automatisk ordrer-mocken med body.linjer sitt innhold med mindre testen selv setter svar.ordrer.
const ORDRE_ID = 'ord_test_1';

// Produkter som "finnes" i den falske Fiken-produktlisten. Navnet er det eneste
// erOmbyggingslinje() ser på (case-uavhengig "ombygg"-match).
const OMBYGGING_PRODUKT = { productId: 100, productNumber: '100', name: 'Standard ombygging', incomeAccount: '3010' };
const UTSTYR_PRODUKT = { productId: 200, productNumber: '200', name: 'Ekstra utstyr - gulvmatte', incomeAccount: '3020' };
const DRIVSTOFF_PRODUKT = { productId: 21, productNumber: '21', name: 'Drivstoff', incomeAccount: '3030' };
const ALLE_PRODUKTER = [OMBYGGING_PRODUKT, UTSTYR_PRODUKT, DRIVSTOFF_PRODUKT];

function linje(produktnummer, ekstra = {}) {
  return { produktnummer, antall: 1, ...ekstra };
}

function fakeSupabaseKlient(svar) {
  // svar: { tabellnavn: { data, error } | (kolonne, verdi) => { data, error } } - dekker
  // akkurat de kallene index.ts faktisk gjør i suksess-løpet uten ordreId:
  // .from(x).select(...).eq(kolonne, verdi).maybeSingle(). Når svar[tabell] er en FUNKSJON
  // kalles den med den FAKTISKE (kolonne, verdi) koden sendte til .eq() - uten dette ville
  // mocken svare likt uansett hva den faktisk ble spurt om (reviewer-funn, sjekk 5: .eq()
  // ignorerte før sine argumenter fullstendig, så en bug som slo opp fiken_kunde_rabatt med
  // feil contactId aldri ville blitt fanget av denne testsuiten). eqKall samler hvert
  // .eq()-kall som (tabell, kolonne, verdi), slik en test kan bevise at riktig id faktisk
  // ble brukt i spørringen - ikke bare at "en" kanonisk rad kom tilbake uansett.
  const eqKall = [];
  let ordrerSelectKall = 0; // deles på tvers av ALLE from('ordrer')-kall i én forespørsel -
  // koden kaller from('ordrer') på nytt for hvert ledd (idempotens-sjekk, reservasjon,
  // eventuell frisk lesing, endelig skriving), så telleren må IKKE nullstilles per from()-kall.
  return {
    eqKall,
    from(tabell) {
      // 'ordrer' har egen, stateful håndtering (under) - dekker den atomiske reservasjonen
      // (s90-20261104-6, "BØR RETTES": claim mot to samtidige kall) som nå ligger rundt selve
      // Fiken-kallet i index.ts. Alle andre tabeller bruker den generiske, statiske mocken.
      if (tabell === 'ordrer') {
        return {
          select() {
            return {
              eq(kolonne, verdi) {
                eqKall.push({ tabell, kolonne, verdi });
                ordrerSelectKall++;
                // Første select() er idempotens-sjekken øverst i index.ts. Et EVENTUELT andre
                // select() skjer bare når reservasjonen lenger ned tapes - svar._ordreEtterTaptKlaim
                // lar en test simulere at en ANNEN, nesten samtidig forespørsel rakk å endre raden
                // mellom disse to lesningene (uten dette ville begge sett nøyaktig samme statiske
                // verdi, og "tapt reservasjon"-grenen kunne aldri testes realistisk).
                if (ordrerSelectKall >= 2 && svar._ordreEtterTaptKlaim !== undefined) {
                  return { maybeSingle: async () => ({ data: svar._ordreEtterTaptKlaim, error: null }) };
                }
                return { maybeSingle: async () => (svar.ordrer ?? { data: null, error: null }) };
              },
            };
          },
          update(payload) {
            return {
              eq() {
                // Alltid 'id' i praksis - selve verdien trengs ikke her siden denne falske
                // "databasen" bare har ÉN ordre-rad i det hele tatt (svar.ordrer.data).
                const videre = {
                  is() {
                    // .is('fiken_kladd_url', null) - selve reservasjonsforsøket. Speiler ekte
                    // Postgres WHERE-semantikk: treffer 0 rader hvis kolonnen allerede har EN
                    // ELLER ANNEN verdi (sentinel eller en ekte URL fra før), ikke bare når
                    // svar._klaimTapes er satt eksplisitt - _klaimTapes dekker i tillegg ren
                    // samtidighet (en ANNEN forespørsel vinner et løp mot akkurat dette kallet,
                    // uten at raden hadde noen synlig forhåndstilstand å teste mot).
                    eqKall.push({ tabell, kolonne: 'fiken_kladd_url', verdi: null, type: 'claim' });
                    const alleredeSatt = svar.ordrer?.data && svar.ordrer.data.fiken_kladd_url !== null;
                    if (svar._klaimTapes || alleredeSatt) return { select: async () => ({ data: [], error: null }) };
                    if (svar.ordrer?.data) Object.assign(svar.ordrer.data, payload);
                    return { select: async () => ({ data: [{ id: 'x' }], error: null }) };
                  },
                  eq(kolonne2, verdi2) {
                    // Frigjøring: .eq('fiken_kladd_url', KLADD_RESERVERT) - skal KUN ha effekt hvis
                    // raden faktisk fortsatt står med akkurat den sentinel-verdien.
                    eqKall.push({ tabell, kolonne: kolonne2, verdi: verdi2, type: 'release' });
                    if (svar.ordrer?.data && svar.ordrer.data.fiken_kladd_url === verdi2) {
                      Object.assign(svar.ordrer.data, payload);
                    }
                    return Promise.resolve({ error: svar._ordrerSkrivefeil ?? null });
                  },
                  then(resolve, reject) {
                    // Den ENDELIGE, ubetingede skrivingen (bare ÉN .eq('id', ...), ingen andre
                    // ledd) - vinnerens siste steg, lagrer den ekte kladd-URL-en.
                    if (svar.ordrer?.data) Object.assign(svar.ordrer.data, payload);
                    return Promise.resolve({ error: svar._ordrerSkrivefeil ?? null }).then(resolve, reject);
                  },
                };
                return videre;
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
              const rad = typeof svarForTabell === 'function'
                ? svarForTabell(kolonne, verdi)
                : (svarForTabell ?? { data: null, error: null });
              return { maybeSingle: async () => rad };
            },
            // Støtter kun fiken_priser sitt .not('kategori','is',null)-kall (kategoriMap i
            // index.ts) - ingen av testene her setter svar.fiken_priser, så standard er en
            // TOM liste (ingen eksplisitte kategorier), som gir nøyaktig samme oppførsel som
            // FØR kategoriMap fantes (ren navnegjetting via erOmbyggingslinje()).
            not: async () => svar.fiken_priser ?? { data: [], error: null },
          };
        },
        upsert: async () => ({ error: null }),
        update() {
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
}

const tmpFiler = [];
afterEach(() => { while (tmpFiler.length) { try { unlinkSync(tmpFiler.pop()); } catch { /* allerede borte */ } } });

// svar: fiken_kunde_alias / fiken_kunde_rabatt-innhold til den falske Supabase-klienten.
// produkter: falsk Fiken-produktliste. draftOk: simuler at Fiken avviser kladden.
// draftTomLocation: Fiken svarer 201 OK, men uten en Location-header (uventet svarform).
// draftKaster: simulerer en nettverksfeil/exception fra selve fetch-kallet (ikke et HTTP-svar
// i det hele tatt) - dekker try/catch-grenen rundt reservasjonen i index.ts.
async function last({ svar = {}, produkter = ALLE_PRODUKTER, draftOk = true, draftTomLocation = false, draftKaster = false } = {}) {
  const draftKall = [];
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
    if (u === 'https://api.fiken.no/api/v2/companies' && method === 'GET') {
      return json([{ slug: SLUG }, { slug: 'et-annet-selskap-samme-nokkel' }]);
    }
    if (u.startsWith(`https://api.fiken.no/api/v2/companies/${SLUG}/products?`) && method === 'GET') {
      return json(produkter, 200, { 'Fiken-Api-Page-Count': '1' });
    }
    if (u === `https://api.fiken.no/api/v2/companies/${SLUG}/invoices/drafts` && method === 'POST') {
      const kropp = JSON.parse(init.body);
      draftKall.push(kropp);
      if (draftKaster) throw new Error('TEST: nettverksfeil mot Fiken');
      // Simulerer at NOE ANNET endret raden midt i Fiken-rundturen (urealistisk i praksis siden
      // reservasjonen eies alene fra claim til release, men beviser at selve SQL-betingelsen på
      // frigjøringen - .eq('fiken_kladd_url', sentinel) - faktisk beskytter mot å overskrive en
      // rad som ikke lenger har sentinel-verdien stående).
      if (svar.ordrer?.data && svar._endreUnderFikenKallTil !== undefined) svar.ordrer.data.fiken_kladd_url = svar._endreUnderFikenKallTil;
      if (!draftOk) return json({ message: 'Fiken avviste' }, 502);
      if (draftTomLocation) return json({ ok: true }, 201); // ingen Location-header
      return json({ ok: true }, 201, {
        Location: `https://api.fiken.no/api/v2/companies/${SLUG}/invoices/drafts/999`,
      });
    }
    throw new Error(`Uventet fetch-kall i testen: ${method} ${u}`);
  };

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const shimFil = path.resolve(__dirname, `_fiken_fakturer_fake_supabase_${suffix}.mjs`);
  const hovedFil = path.resolve(__dirname, `_fiken_fakturer_tmp_${suffix}.ts`);
  tmpFiler.push(shimFil, hovedFil);

  // Shim-modulen erstatter den ekte jsr:-importen. Fabrikken leses fra en global satt rett
  // før import - unngår en felles cache-nøkkel på tvers av tester siden filnavnet (og dermed
  // modul-URL-en) er unikt per kall.
  writeFileSync(shimFil, 'export function createClient() { return globalThis.__FAKE_SUPABASE_FACTORY__(); }\n');
  // Fabrikken oppretter klienten FØRST når den ekte koden faktisk kaller createClient() (inne
  // i handleren) - instansen lagres her slik at testen kan lese eqKall EtTER at kall() er
  // ferdig, uten å destrukturere en "levende" verdi ut for tidlig (den finnes ikke før da).
  let klientInstans;
  globalThis.__FAKE_SUPABASE_FACTORY__ = () => { klientInstans = fakeSupabaseKlient(svar); return klientInstans; };

  const tilpasset = fikenFakturerKilde.replace(IMPORT_LINJE, `import { createClient } from './${path.basename(shimFil)}'`);
  writeFileSync(hovedFil, tilpasset);
  await import(/* @vite-ignore */ pathToFileURL(hovedFil).href);

  return {
    draftKall,
    // eq-kall mot den falske Supabase-klienten ({tabell, kolonne, verdi}) - les ETTER
    // await kall(...), se merknad ved klientInstans over.
    get eqKall() { return klientInstans?.eqKall ?? []; },
    kall: (body) => {
      // Den ekte funksjonen leser ikke lenger body.linjer (rettet 5.11) - linjene kommer fra
      // ordrer.fiken_linjer i databasen. Med mindre testen selv har satt svar.ordrer eksplisitt,
      // bygger vi den falske ordre-raden her fra body.linjer, slik at de aller fleste testene
      // (skrevet for å "sende" linjer via body) fortsetter å virke uendret.
      // svar._manuellOrdre: lar en test sette opp ordrer-mocken selv (for å bevise at body.linjer
      // faktisk IGNORERES av den ekte funksjonen) uten at denne auto-synken overskriver den.
      if (!svar._manuellOrdre && Array.isArray(body.linjer)) {
        svar.ordrer = { data: { fiken_kladd_url: null, fiken_linjer: body.linjer }, error: null };
      }
      return handler(new Request('https://x.supabase.co/functions/v1/fiken-fakturer', {
        method: 'POST',
        body: JSON.stringify(body),
      }));
    },
  };
}

function standardBody(linjer, overrides = {}) {
  return { ordreId: ORDRE_ID, kundeNavn: 'Test Kunde AS', linjer, ...overrides };
}

// Hjelper: kjør ett kall og returner lines[] fra draft-POST-kroppen (kaster hvis kallet feilet,
// så en feil i mock-oppsettet gir en tydelig testfeil i stedet for en stille tom liste).
async function hentLinjer(opts, body) {
  const { kall, draftKall } = await last(opts);
  const res = await kall(body);
  const svar = await res.json();
  if (res.status !== 201 || !svar.ok) {
    throw new Error(`Forventet vellykket kladd, fikk status ${res.status}: ${JSON.stringify(svar)}`);
  }
  expect(draftKall).toHaveLength(1);
  return draftKall[0].lines;
}

describe('fiken-fakturer: frosset rabatt vinner over kundens fiken_kunde_rabatt (fakta 1)', () => {
  it('ombygging-linje med frosset rabatt=10: ignorerer rabatt_ombygging=50 på kunden', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 50, rabatt_ekstra_utstyr: 20 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: 10 })]));
    expect(l.discount).toBe(10);
  });

  it('ekstra-utstyr-linje med frosset rabatt=10: ignorerer rabatt_ekstra_utstyr=70 på kunden', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 5, rabatt_ekstra_utstyr: 70 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('200', { rabatt: 10 })]));
    expect(l.discount).toBe(10);
  });

  it('frosset rabatt gjelder selv uten noen rad i fiken_kunde_rabatt i det hele tatt', async () => {
    const svar = { fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null } }; // ingen fiken_kunde_rabatt-rad
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: 15 })]));
    expect(l.discount).toBe(15);
  });

  it('brukRabatt:false nuller ALLTID rabatten, også på en linje med frosset portal-rabatt (rettet 5.11 - "Bruk kundens avtalte rabatt" gjelder nå hele fakturaen, ikke bare kategori-satsene)', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 50, rabatt_ekstra_utstyr: 50 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: 12 })], { brukRabatt: false }));
    expect(l.discount).toBeUndefined();
  });

  it('to linjer samtidig: hver linje sin EGEN frosset rabatt brukes uavhengig av den andre', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 99, rabatt_ekstra_utstyr: 99 }, error: null },
    };
    const linjer = await hentLinjer({ svar }, standardBody([
      linje('100', { rabatt: 7 }),
      linje('200', { rabatt: 13 }),
    ]));
    expect(linjer[0].discount).toBe(7);
    expect(linjer[1].discount).toBe(13);
  });
});

describe('fiken-fakturer: NULL i fiken_kunde_rabatt blokkerer fakturering i stedet for å anta 0% (rettet 5.11, pengefelle-fiks)', () => {
  it('rabatt_ombygging er NULL (raden finnes, men ombygging er aldri avtalt): 400, ingen kladd opprettet', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: null, rabatt_ekstra_utstyr: 10 }, error: null },
    };
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100')])); // ombygging-produkt, ingen frosset rabatt
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/ombygging-rabatt er ikke satt/);
    expect(draftKall).toHaveLength(0);
  });

  it('rabatt_ekstra_utstyr er NULL: 400 for en ekstra-utstyr-linje, men en ombygging-linje alene (kjent sats) går gjennom', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 20, rabatt_ekstra_utstyr: null }, error: null },
    };
    const { kall } = await last({ svar });
    const res = await kall(standardBody([linje('200')])); // ekstra utstyr
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/rabatt for ekstra utstyr er ikke satt/);

    const [l] = await hentLinjer({ svar }, standardBody([linje('100')])); // bare ombygging - kjent sats
    expect(l.discount).toBe(20);
  });

  it('NULL-kolonnen stopper IKKE en linje som har sin EGEN frosne rabatt (trenger aldri kategori-satsen)', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: null, rabatt_ekstra_utstyr: null }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: 15 })]));
    expect(l.discount).toBe(15);
  });

  it('NULL-kolonnen stopper IKKE en overstyrt-beløp-linje (drivstoff) som aldri bruker kategori-satsen', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: null, rabatt_ekstra_utstyr: null }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('21', { belop: 500 })]));
    expect(l.discount).toBeUndefined();
  });

  it('ingen rad i fiken_kunde_rabatt i det hele tatt (aldri avtalt noe): fortsatt trygt å anta 0%, IKKE blokkert', async () => {
    const svar = { fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null } }; // ingen fiken_kunde_rabatt-rad
    const [l] = await hentLinjer({ svar }, standardBody([linje('100')]));
    expect(l.discount).toBeUndefined();
  });

  it('brukRabatt:false hopper over NULL-sjekken helt (kategori-satsen trengs aldri når rabatten uansett nulles)', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: null, rabatt_ekstra_utstyr: null }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('100')], { brukRabatt: false }));
    expect(l.discount).toBeUndefined();
  });
});

describe('fiken-fakturer: uten frosset rabatt - uendret kategori-basert oppførsel (fakta 2)', () => {
  it('ombygging-linje uten l.rabatt bruker rabatt_ombygging fra kundens rad', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 25, rabatt_ekstra_utstyr: 8 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('100')]));
    expect(l.discount).toBe(25);
  });

  it('ekstra-utstyr-linje uten l.rabatt bruker rabatt_ekstra_utstyr fra kundens rad', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 25, rabatt_ekstra_utstyr: 8 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('200')]));
    expect(l.discount).toBe(8);
  });

  it('ingen rad i fiken_kunde_rabatt: 0% for begge kategorier, ingen discount-felt', async () => {
    const svar = { fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null } };
    const linjer = await hentLinjer({ svar }, standardBody([linje('100'), linje('200')]));
    expect(linjer[0]).not.toHaveProperty('discount');
    expect(linjer[1]).not.toHaveProperty('discount');
  });

  it('brukRabatt:false uten frosset rabatt: nuller ut BEGGE kategori-satsene selv om raden har verdier', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 40, rabatt_ekstra_utstyr: 40 }, error: null },
    };
    const linjer = await hentLinjer({ svar }, standardBody([linje('100'), linje('200')], { brukRabatt: false }));
    expect(linjer[0]).not.toHaveProperty('discount');
    expect(linjer[1]).not.toHaveProperty('discount');
  });
});

describe('fiken-fakturer: frosset rabatt=0 gir ingen discount-felt (fakta 3)', () => {
  // Den andre kodeveien til samme utfall (manglende l.rabatt + kategorisats 0 fordi det ikke
  // finnes noen fiken_kunde_rabatt-rad) er allerede dekket av "ingen rad i fiken_kunde_rabatt"-
  // testen i fakta 2-blokken over - en egen test for akkurat den kombinasjonen her var
  // trivielt sann (ville bestått selv om hele discount-funksjonen ble fjernet) og redundant
  // med den testen, så den er bevisst ikke duplisert.
  it('frosset rabatt=0 (gyldig "ingen rabatt" fra portalen): ingen discount-felt', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      // Satt bevisst høyt for å bevise at det IKKE er denne som gir 0 - frosset rabatt=0 skal
      // vinne over kategorisatsen, akkurat som et hvilket som helst annet tall > 0 ville gjort.
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 60, rabatt_ekstra_utstyr: 60 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: 0 })]));
    expect(l).not.toHaveProperty('discount');
  });

});

describe('fiken-fakturer: l.rabatt som ikke er et gyldig tall er IKKE "låst" (fakta 4)', () => {
  const svar = {
    fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
    fiken_kunde_rabatt: { data: { rabatt_ombygging: 33, rabatt_ekstra_utstyr: 33 }, error: null },
  };

  it('l.rabatt som streng ("10") faller tilbake til kategori-logikken', async () => {
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: '10' })]));
    expect(l.discount).toBe(33); // IKKE 10 - strengen skal ikke telle som "låst"
  });

  it('l.rabatt === null faller tilbake til kategori-logikken', async () => {
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: null })]));
    expect(l.discount).toBe(33);
  });

  it('l.rabatt === NaN faller tilbake til kategori-logikken (typeof "number", men Number.isFinite false)', async () => {
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: NaN })]));
    expect(l.discount).toBe(33);
  });

  it('l.rabatt === Infinity faller også tilbake (typeof "number", men ikke finite)', async () => {
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: Infinity })]));
    expect(l.discount).toBe(33);
  });
});

describe('fiken-fakturer: fiken_kunde_rabatt slås opp med kundens FAKTISKE contactId (reviewer-funn, sjekk 5)', () => {
  // Før denne testen ignorerte fakeSupabaseKlient() sine .eq()-argumenter fullstendig og
  // returnerte alltid samme kanoniske rad uansett hvilken kolonne/verdi index.ts faktisk
  // spurte om - en bug i den ekte koden der fiken_kunde_rabatt ble slått opp med feil
  // contactId (f.eks. kundeNavn, en annen kontakts id, eller undefined) ville ALDRI blitt
  // fanget, siden mocken svarte identisk uansett. Her varierer svaret faktisk per contactId
  // (via en funksjon i stedet for et fast objekt, se fakeSupabaseKlient), og testen
  // bekrefter BÅDE at riktig rabatt-rad brukes OG at .eq() faktisk ble kalt med riktig id -
  // ikke bare at "en" rad kom tilbake.
  const RABATT_PER_CONTACT = {
    111: { rabatt_ombygging: 20, rabatt_ekstra_utstyr: 5 },
    222: { rabatt_ombygging: 45, rabatt_ekstra_utstyr: 60 },
  };
  function svarForContact(contactId) {
    return {
      fiken_kunde_alias: { data: { fiken_contact_id: contactId }, error: null },
      fiken_kunde_rabatt: (kolonne, verdi) => {
        expect(kolonne).toBe('fiken_contact_id');
        return { data: RABATT_PER_CONTACT[verdi] ?? null, error: null };
      },
    };
  }

  it('kontakt 111 får SIN rabatt_ombygging (20), ikke kontakt 222 sin', async () => {
    const api = await last({ svar: svarForContact(111) });
    const res = await api.kall(standardBody([linje('100')]));
    const svar = await res.json();
    expect(res.status).toBe(201);
    expect(svar.ok).toBe(true);
    expect(api.draftKall[0].lines[0].discount).toBe(20);
    expect(api.eqKall).toContainEqual({ tabell: 'fiken_kunde_rabatt', kolonne: 'fiken_contact_id', verdi: 111 });
  });

  it('kontakt 222 får SIN rabatt_ombygging (45), ikke kontakt 111 sin', async () => {
    const api = await last({ svar: svarForContact(222) });
    const res = await api.kall(standardBody([linje('100')]));
    const svar = await res.json();
    expect(res.status).toBe(201);
    expect(svar.ok).toBe(true);
    expect(api.draftKall[0].lines[0].discount).toBe(45);
    expect(api.eqKall).toContainEqual({ tabell: 'fiken_kunde_rabatt', kolonne: 'fiken_contact_id', verdi: 222 });
  });
});

describe('fiken-fakturer: drivstofflinjer (erOverstyrtBelop) får ALDRI discount (fakta 5)', () => {
  it('l.belop satt + l.rabatt satt til et tall > 0 på SAMME linje: ingen discount, men unitPrice er beløpet', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 50, rabatt_ekstra_utstyr: 50 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('21', { belop: 500, rabatt: 20 })]));
    expect(l).not.toHaveProperty('discount');
    expect(l.unitPrice).toBe(50000); // 500 kr i øre - beviser at linjen faktisk ble behandlet
    expect(l.vatType).toBe('high');
  });

  it('l.belop satt uten l.rabatt i det hele tatt: fortsatt ingen discount (uendret fra før)', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 50, rabatt_ekstra_utstyr: 50 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('21', { belop: 350 })]));
    expect(l).not.toHaveProperty('discount');
  });

  it('drivstofflinje med frosset rabatt + en vanlig ombygging-linje med frosset rabatt i samme kall: kun ombygging-linjen får discount', async () => {
    const svar = { fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null } };
    const linjer = await hentLinjer({ svar }, standardBody([
      linje('21', { belop: 400, rabatt: 10 }),
      linje('100', { rabatt: 10 }),
    ]));
    expect(linjer[0]).not.toHaveProperty('discount');
    expect(linjer[1].discount).toBe(10);
  });
});

describe('fiken-fakturer: kjent, akseptert avrundingsforskjell mot portalen (fakta 6, dokumentasjon - ikke en defekt)', () => {
  // Portalen runder i dag rabatten ÉN gang på VARIANT+TILLEGG-summen (f.eks. 333,00 kr),
  // mens denne funksjonen sender SAMME prosentsats på hver enkelt fakturalinje og lar Fiken
  // sin egen fakturering runde PER LINJE. Funksjonen selv runder bare øre-prisen den låser
  // (Math.round(pris*100)) - selve rabatt-rundingen skjer inne i Fiken, utenfor denne koden,
  // så vi kan ikke verifisere Fikens sluttsum herfra. Det denne testen faktisk beviser er at
  // SAMME prosentsats (15) sendes uendret på to linjer med ulike, "runde" kr-beløp - det er
  // nok til at en summering gjort på frittstående linjer (Fiken) kan avvike opptil ca. 1 kr
  // fra en summering gjort på totalen først (portalen). Eksempel som illustrerer avviket (ikke
  // noe denne testen beregner, bare dokumenterer): 333 kr + 222 kr = 555 kr totalt.
  // Portal (rund étt sted): 555 * 0.85 = 471.75 -> 472 kr. Fiken (rund per linje):
  // round(333*0.85) + round(222*0.85) = round(283.05) + round(188.7) = 283 + 189 = 472 kr -
  // i DETTE eksempelet blir de like, men med andre øre-beløp kan de ende opptil 1 kr fra
  // hverandre. Dette er en akseptert konsekvens av arkitekturen (Henrik/Forhandlerportal-
  // teamet), ikke noe å "fikse" i fiken-fakturer.
  it('samme frosset rabatt-prosent sendes uendret på flere linjer med ulike ørebeløp', async () => {
    const svar = { fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null } };
    const linjer = await hentLinjer({ svar }, standardBody([
      linje('100', { rabatt: 15, pris: 333, mva: 'high' }),
      linje('200', { rabatt: 15, pris: 222, mva: 'high' }),
    ]));
    expect(linjer[0].discount).toBe(15);
    expect(linjer[1].discount).toBe(15);
    expect(linjer[0].unitPrice).toBe(33300); // 333 kr i øre, uendret av rabatten (Fiken trekker fra selv)
    expect(linjer[1].unitPrice).toBe(22200);
  });
});

// ── Leveranse (ordre uten bil, 2026-11-03): referansen på fakturaen ─────────────────────────────────────────────────────
// En leveranse kan mangle chassis. Klienten sender da `referanse` (merking, reg.nr og chassis det finnes av) som brukes som Ordrereferanse i Fiken.
// Bil-ordrer sender ingen `referanse` og skal få nøyaktig samme referanse som før.
describe('fiken-fakturer: ordrereferanse (leveranse vs bil)', () => {
  const svar = { fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null } };
  async function hentKladd(body) {
    const { kall, draftKall } = await last({ svar });
    const res = await kall(body);
    expect(res.status).toBe(201);
    expect(draftKall).toHaveLength(1);
    return draftKall[0];
  }

  it('leveranse uten chassis: referansen blir merkingen, og ingen «Ch. nr.»-kommentar på linjen', async () => {
    const kladd = await hentKladd(standardBody([linje('200')], { referanse: 'TEST-merking - AB12345' }));
    expect(kladd.orderReference).toBe('TEST-merking - AB12345');
    expect(kladd.lines[0].comment).toBeUndefined();
  });

  it('leveranse med chassis: `referanse` vinner for ordrereferansen, og «Ch. nr.» står fortsatt på siste linje', async () => {
    const kladd = await hentKladd(standardBody([linje('100'), linje('200')], { chassisNr: 'WVWZZZ1KZ6W123456', referanse: 'Løsning X - WVWZZZ1KZ6W123456' }));
    expect(kladd.orderReference).toBe('Løsning X - WVWZZZ1KZ6W123456');
    expect(kladd.lines[1].comment).toBe('Ch. nr. WVWZZZ1KZ6W123456');
    expect(kladd.lines[0].comment).toBeUndefined();
  });

  it('en lang referanse kappes til 100 tegn', async () => {
    const kladd = await hentKladd(standardBody([linje('200')], { referanse: 'x'.repeat(250) }));
    expect(kladd.orderReference).toHaveLength(100);
  });

  it('en tom eller bare-mellomrom referanse regnes som fraværende (faller tilbake til chassis-regelen)', async () => {
    const a = await hentKladd(standardBody([linje('200')], { referanse: '   ', chassisNr: 'CH1' }));
    expect(a.orderReference).toBe('CH1');
    const b = await hentKladd(standardBody([linje('200')], { referanse: '' }));
    expect(b.orderReference).toBeUndefined();
  });

  it('bil-ordre uten `referanse` er UENDRET: «chassis - regnr», bare chassis, eller ingen referanse', async () => {
    expect((await hentKladd(standardBody([linje('200')], { chassisNr: 'CH1', regnr: 'AB12345' }))).orderReference).toBe('CH1 - AB12345');
    expect((await hentKladd(standardBody([linje('200')], { chassisNr: 'CH1' }))).orderReference).toBe('CH1');
    expect((await hentKladd(standardBody([linje('200')], {}))).orderReference).toBeUndefined();
  });

  it('en referanse som ikke er tekst (tall, objekt) ignoreres', async () => {
    const a = await hentKladd(standardBody([linje('200')], { referanse: 12345, chassisNr: 'CH1' }));
    expect(a.orderReference).toBe('CH1');
    const b = await hentKladd(standardBody([linje('200')], { referanse: { x: 1 } }));
    expect(b.orderReference).toBeUndefined();
  });
});

// ── Fakturalinjene leses fra databasen, ALDRI fra klientens body (pengefelle rettet 5.11) ──────
describe('fiken-fakturer: fakturalinjene leses fra ordrer.fiken_linjer i databasen, body.linjer ignoreres fullstendig', () => {
  it('body.linjer avviker fra databasens fiken_linjer: DATABASENS innhold brukes, body sitt forsøk har ingen effekt', async () => {
    const svar = {
      _manuellOrdre: true, // se kall() i last() - hindrer auto-synk fra body.linjer
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      // Databasen sier: én ekstra-utstyr-linje uten rabatt.
      ordrer: { data: { fiken_kladd_url: null, fiken_linjer: [linje('200')] }, error: null },
    };
    // body prøver å sende en helt annen (og mye billigere/rabattert) ombyggingslinje - en klient
    // som enten er stale eller manipulert utenom appens UI.
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100', { belop: 1, rabatt: 100 })]));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(draftKall).toHaveLength(1);
    expect(draftKall[0].lines).toHaveLength(1);
    expect(draftKall[0].lines[0].productId).toBe(UTSTYR_PRODUKT.productId); // 200, IKKE 100 fra body
    expect(draftKall[0].lines[0].discount).toBeUndefined(); // ingen frosset rabatt på DENNE linjen
  });

  it('mangler ordreId: 400, ingen kladd opprettet (linjene kan ikke slås opp uten en ordre å lese dem fra)', async () => {
    const svar = { fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null } };
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100')], { ordreId: undefined }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Mangler ordreId/);
    expect(draftKall).toHaveLength(0);
  });

  it('ordreId peker på en ordre som ikke finnes: 404, ingen kladd opprettet', async () => {
    const svar = {
      _manuellOrdre: true,
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      ordrer: { data: null, error: null }, // ingen rad for denne ordreId-en
    };
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100')]));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toMatch(/Fant ikke ordren/);
    expect(draftKall).toHaveLength(0);
  });

  it('ordren finnes, men fiken_linjer er tom: 400 "ingen fakturalinjer", uansett hva body.linjer prøver å sende', async () => {
    const svar = {
      _manuellOrdre: true,
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      ordrer: { data: { fiken_kladd_url: null, fiken_linjer: [] }, error: null },
    };
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100'), linje('200')]));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Ordren har ingen fakturalinjer/);
    expect(draftKall).toHaveLength(0);
  });

  it('idempotens uendret: ordren har allerede en kladd-url - returneres direkte, uansett hva body.linjer inneholder', async () => {
    const svar = {
      _manuellOrdre: true,
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      ordrer: { data: { fiken_kladd_url: 'https://api.fiken.no/api/v2/companies/x/invoices/drafts/42', fiken_linjer: [linje('100')] }, error: null },
    };
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('200')]));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, alleredeOpprettet: true, draftUrl: 'https://api.fiken.no/api/v2/companies/x/invoices/drafts/42' });
    expect(draftKall).toHaveLength(0); // ingen NY kladd opprettet
  });
});

// Portalen er FASIT for rabatt når ordren har en kjent forhandler-kontakt (ordrer.forhandler_
// kontakt_id, s08-004) OG den kontakten finnes i portal_kunde_rabatt (hent-rabatter-fra-
// portalen, 5.11) - fase A av rabatt-prosjektet (13.11, Henrik: "fiken må fakturere via
// portalen slik at den henter ... rabatt"). standard->ombygging, ekstrautstyr->ekstra_utstyr.
// rabatt_modulsystem brukes bevisst ikke ennå (ingen Fiken-produkter tagget med den
// kategorien). Alle disse testene bruker _manuellOrdre for å kunne sette forhandler_kontakt_id
// på ordre-mocken (kall() sin auto-synk fra body.linjer setter den aldri).
describe('fiken-fakturer: rabatt fra Forhandlerportalen (portal_kunde_rabatt) overstyrer fiken_kunde_rabatt (fase A, 13.11)', () => {
  function svarMedOrdre({ forhandlerKontaktId, linjer, ekstra = {} }) {
    return {
      _manuellOrdre: true,
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      ordrer: { data: { fiken_kladd_url: null, fiken_linjer: linjer, forhandler_kontakt_id: forhandlerKontaktId ?? null }, error: null },
      ...ekstra,
    };
  }

  it('ordre med forhandler_kontakt_id + treff i portal_kunde_rabatt: bruker portalens rabatt_standard/rabatt_ekstrautstyr, IKKE fiken_kunde_rabatt', async () => {
    const svar = svarMedOrdre({
      forhandlerKontaktId: 'k18',
      linjer: [linje('100'), linje('200')],
      ekstra: {
        portal_kunde_rabatt: { data: { rabatt_standard: 30, rabatt_ekstrautstyr: 15 }, error: null },
        fiken_kunde_rabatt: { data: { rabatt_ombygging: 20, rabatt_ekstra_utstyr: 10 }, error: null }, // bevisst ANNET enn portalen, for å bevise at portalen vinner
      },
    });
    const api = await last({ svar });
    const res = await api.kall(standardBody([linje('100'), linje('200')]));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(api.draftKall[0].lines[0].discount).toBe(30); // ombygging
    expect(api.draftKall[0].lines[1].discount).toBe(15); // ekstra utstyr
    expect(api.eqKall).toContainEqual({ tabell: 'portal_kunde_rabatt', kolonne: 'kontakt_id', verdi: 'k18' });
  });

  it('forhandler_kontakt_id satt, men INGEN rad i portal_kunde_rabatt: faller tilbake til fiken_kunde_rabatt som før', async () => {
    const svar = svarMedOrdre({
      forhandlerKontaktId: 'k_ukjent',
      linjer: [linje('100')],
      ekstra: {
        portal_kunde_rabatt: { data: null, error: null },
        fiken_kunde_rabatt: { data: { rabatt_ombygging: 22, rabatt_ekstra_utstyr: 7 }, error: null },
      },
    });
    const [l] = await hentLinjer({ svar }, standardBody([linje('100')]));
    expect(l.discount).toBe(22);
  });

  it('ordre UTEN forhandler_kontakt_id: helt uendret - leser fiken_kunde_rabatt direkte, spør aldri portal_kunde_rabatt', async () => {
    const svar = svarMedOrdre({
      forhandlerKontaktId: null,
      linjer: [linje('100')],
      ekstra: { fiken_kunde_rabatt: { data: { rabatt_ombygging: 18, rabatt_ekstra_utstyr: 9 }, error: null } },
    });
    const api = await last({ svar });
    const res = await api.kall(standardBody([linje('100')]));
    await res.json();
    expect(api.draftKall[0].lines[0].discount).toBe(18);
    expect(api.eqKall.some((k) => k.tabell === 'portal_kunde_rabatt')).toBe(false);
  });

  it('brukRabatt:false nuller ut rabatten også med et portal-treff', async () => {
    const svar = svarMedOrdre({
      forhandlerKontaktId: 'k18',
      linjer: [linje('100')],
      ekstra: { portal_kunde_rabatt: { data: { rabatt_standard: 30, rabatt_ekstrautstyr: 15 }, error: null } },
    });
    const [l] = await hentLinjer({ svar }, standardBody([linje('100')], { brukRabatt: false }));
    expect(l).not.toHaveProperty('discount');
  });

  it('en linje med sin EGEN frosne rabatt (portal-bestillingens l.rabatt) er uendret - vinner fortsatt over portalens kunde-sats', async () => {
    const svar = svarMedOrdre({
      forhandlerKontaktId: 'k18',
      linjer: [linje('100', { rabatt: 12 })],
      ekstra: { portal_kunde_rabatt: { data: { rabatt_standard: 30, rabatt_ekstrautstyr: 15 }, error: null } },
    });
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: 12 })]));
    expect(l.discount).toBe(12);
  });

  it('portal-raden finnes, men rabatt_standard er NULL (ikke avtalt): 400 med melding om Forhandlerportalen, ikke Fiken-rabatt', async () => {
    const svar = svarMedOrdre({
      forhandlerKontaktId: 'k18',
      linjer: [linje('100')],
      ekstra: { portal_kunde_rabatt: { data: { rabatt_standard: null, rabatt_ekstrautstyr: 15 }, error: null } },
    });
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100')]));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/ikke satt i Forhandlerportalen/);
    expect(draftKall).toHaveLength(0);
  });

  it('rabatt_modulsystem fra portalen leses bevisst ikke og påvirker ingenting (ingen Fiken-produkt er kategorisert som "modulsystem" ennå)', async () => {
    const svar = svarMedOrdre({
      forhandlerKontaktId: 'k18',
      linjer: [linje('100'), linje('200')],
      ekstra: { portal_kunde_rabatt: { data: { rabatt_standard: 30, rabatt_ekstrautstyr: 15, rabatt_modulsystem: null }, error: null } },
    });
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100'), linje('200')]));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201); // modulsystem=null stopper IKKE faktureringen - feltet brukes ikke
    expect(draftKall[0].lines[0].discount).toBe(30);
    expect(draftKall[0].lines[1].discount).toBe(15);
  });
});

// fiken_priser.kategori (migrasjon 20261111200000, Henrik 11.11): en eksplisitt,
// forhåndsbekreftet kategori per produktnummer skal overstyre navnegjetting
// (erOmbyggingslinje) i BEGGE retninger - produktnavnet alene bestemmer ingenting når en
// kategori er satt. Uten noen rad i fiken_priser (ingen av testene over setter svar.fiken_priser)
// er oppførselen uendret ren navnegjetting, som alle testene over allerede beviser.
describe('fiken-fakturer: fiken_priser.kategori overstyrer navnegjetting (migrasjon 20261111200000)', () => {
  it('produkt UTEN "ombygg" i navnet (200, "Ekstra utstyr - gulvmatte"), eksplisitt kategorisert som ombygging: får rabatt_ombygging, ikke rabatt_ekstra_utstyr', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 20, rabatt_ekstra_utstyr: 10 }, error: null },
      fiken_priser: { data: [{ produktnummer: '200', kategori: 'ombygging' }], error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('200')]));
    expect(l.discount).toBe(20);
  });

  it('produkt MED "ombygg" i navnet (100, "Standard ombygging"), eksplisitt kategorisert som ekstra_utstyr: får rabatt_ekstra_utstyr, ikke rabatt_ombygging (motsatt retning - dekker 412-tilfellet "Gummimatte standard ombygging")', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 20, rabatt_ekstra_utstyr: 10 }, error: null },
      fiken_priser: { data: [{ produktnummer: '100', kategori: 'ekstra_utstyr' }], error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('100')]));
    expect(l.discount).toBe(10);
  });

  it('produktnummer UTEN rad i fiken_priser.kategori: faller tilbake til navnegjetting som før (uendret oppførsel)', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 20, rabatt_ekstra_utstyr: 10 }, error: null },
      fiken_priser: { data: [{ produktnummer: '999', kategori: 'ombygging' }], error: null }, // annet produktnummer enn det som faktureres
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('200')])); // "Ekstra utstyr - gulvmatte" - ingen "ombygg" i navnet
    expect(l.discount).toBe(10); // ekstra_utstyr-satsen, som før kategori-kolonnen fantes
  });

  it('en eksplisitt kategori endrer ALDRI en frosset rabatt (l.rabatt vinner fortsatt over alt, se fakta 1 over)', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 20, rabatt_ekstra_utstyr: 10 }, error: null },
      fiken_priser: { data: [{ produktnummer: '200', kategori: 'ombygging' }], error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('200', { rabatt: 5 })]));
    expect(l.discount).toBe(5);
  });
});

// Atomisk reservasjon mot to (nesten) samtidige fakturerings-kall (s90-20261104-6, "BØR
// RETTES"-funn 5.11: "sjekk+skriving i fiken-fakturer har ingen claim mot to samtidige kall").
// Den GAMLE idempotens-sjekken (SELECT fiken_kladd_url, så senere UPDATE) lukker IKKE et ekte
// race: to kall kan begge se null og begge opprette en EKTE kladd i Fiken. Reservasjonen under
// (en betinget UPDATE ... WHERE fiken_kladd_url IS NULL rett FØR selve Fiken-kallet) sikrer at
// bare ÉN vinner - taperen oppretter aldri noen kladd i det hele tatt.
describe('fiken-fakturer: atomisk reservasjon hindrer dobbel kladd ved to (nesten) samtidige kall', () => {
  function svarMedOrdre(over = {}) {
    return {
      _manuellOrdre: true,
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      ordrer: { data: { fiken_kladd_url: null, fiken_linjer: [linje('100')] }, error: null },
      ...over,
    };
  }

  it('normalt kall (ingen konkurranse): reserverer FØR Fiken-kallet, og den endelige skrivingen inneholder den ekte kladd-URL-en', async () => {
    const svar = svarMedOrdre();
    const api = await last({ svar });
    const res = await api.kall(standardBody([linje('100')]));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    const klaimKall = api.eqKall.filter((k) => k.type === 'claim');
    expect(klaimKall).toHaveLength(1); // reservert nøyaktig én gang
    expect(svar.ordrer.data.fiken_kladd_url).toBe('https://api.fiken.no/api/v2/companies/telemark-salmakerverksted/invoices/drafts/999');
  });

  it('reservasjonen tapes, og vinneren har ALT fullført: returnerer vinnerens ekte kladd-URL, oppretter ALDRI en egen kladd', async () => {
    const svar = svarMedOrdre({ _klaimTapes: true, _ordreEtterTaptKlaim: { fiken_kladd_url: 'https://api.fiken.no/api/v2/companies/x/invoices/drafts/777' } });
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100')]));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, alleredeOpprettet: true, draftUrl: 'https://api.fiken.no/api/v2/companies/x/invoices/drafts/777' });
    expect(draftKall).toHaveLength(0); // ALDRI noe Fiken-kall for taperen
  });

  it('reservasjonen tapes, og vinneren er fortsatt MIDT I sitt eget Fiken-kall (sentinel-verdien): 409, ikke en dobbel kladd', async () => {
    const svar = svarMedOrdre({ _klaimTapes: true, _ordreEtterTaptKlaim: { fiken_kladd_url: '_opprettes_' } });
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100')]));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toMatch(/fakturerer allerede/);
    expect(draftKall).toHaveLength(0);
  });

  it('Fiken avviser kladden: reservasjonen frigis igjen (ordren er fri for et nytt forsøk), ikke stående fast med sentinel-verdien', async () => {
    const svar = svarMedOrdre();
    const { kall } = await last({ svar, draftOk: false });
    const res = await kall(standardBody([linje('100')]));
    expect(res.status).toBe(502);
    expect(svar.ordrer.data.fiken_kladd_url).toBeNull(); // frigitt, ikke "_opprettes_"
  });

  it('Fiken svarer OK men uten Location-header: reservasjonen frigis igjen', async () => {
    const svar = svarMedOrdre();
    const { kall } = await last({ svar, draftTomLocation: true });
    const res = await kall(standardBody([linje('100')]));
    expect(res.status).toBe(502);
    expect(svar.ordrer.data.fiken_kladd_url).toBeNull();
  });

  it('en nettverksfeil/exception midt i Fiken-kallet: reservasjonen frigis likevel (try/catch-grenen), ordren låses ikke fast for alltid', async () => {
    const svar = svarMedOrdre();
    const { kall } = await last({ svar, draftKaster: true });
    const res = await kall(standardBody([linje('100')]));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(500);
    expect(svar.ordrer.data.fiken_kladd_url).toBeNull();
  });

  it('en frigjøring treffer KUN raden hvis den fortsatt faktisk har sentinel-verdien (beskytter mot å frigi en rad som ikke lenger har sentinel-verdien stående)', async () => {
    const svar = svarMedOrdre({ _endreUnderFikenKallTil: 'https://fiken.no/en-annen-ekte-kladd' });
    const { kall } = await last({ svar, draftOk: false });
    await kall(standardBody([linje('100')]));
    expect(svar.ordrer.data.fiken_kladd_url).toBe('https://fiken.no/en-annen-ekte-kladd'); // urørt, IKKE nullstilt
  });

  it('ordren står allerede med sentinel-verdien FØR kallet starter (en tidligere reservasjon sto fast): den øverste idempotens-sjekken returnerer den ALDRI som en ekte URL, og klaimforsøket gir 409 i stedet', async () => {
    const svar = svarMedOrdre({ ordrer: { data: { fiken_kladd_url: '_opprettes_', fiken_linjer: [linje('100')] }, error: null } });
    const { kall, draftKall } = await last({ svar });
    const res = await kall(standardBody([linje('100')]));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.error).toMatch(/fakturerer allerede/);
    expect(draftKall).toHaveLength(0); // aldri en kladd mot en allerede fastlåst sentinel
  });
});
