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
  return {
    eqKall,
    from(tabell) {
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
async function last({ svar = {}, produkter = ALLE_PRODUKTER, draftOk = true } = {}) {
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
      if (!draftOk) return json({ message: 'Fiken avviste' }, 502);
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
    kall: (body) =>
      handler(new Request('https://x.supabase.co/functions/v1/fiken-fakturer', {
        method: 'POST',
        body: JSON.stringify(body),
      })),
  };
}

function standardBody(linjer, overrides = {}) {
  return { kundeNavn: 'Test Kunde AS', linjer, ...overrides };
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

  it('frosset rabatt gjelder selv med brukRabatt:false (flagget styrer kun kategori-satsene)', async () => {
    const svar = {
      fiken_kunde_alias: { data: { fiken_contact_id: CONTACT_ID }, error: null },
      fiken_kunde_rabatt: { data: { rabatt_ombygging: 50, rabatt_ekstra_utstyr: 50 }, error: null },
    };
    const [l] = await hentLinjer({ svar }, standardBody([linje('100', { rabatt: 12 })], { brukRabatt: false }));
    expect(l.discount).toBe(12);
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
