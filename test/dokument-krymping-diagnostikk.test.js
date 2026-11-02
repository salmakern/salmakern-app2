import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Diagnostikk (2026-11-02): ansatte meldte at dokumenter "forsvinner" på skjermen, men er tilbake
// etter F5. Årsaken er ikke funnet, så dokumentKrympingSjekk() (core.js) observerer symptomet:
// krymper lista på skjermen med minst 2 uten at appen selv fjernet så mange, spørres databasen,
// og BARE hvis databasen har flere enn skjermen viser sendes én Sentry-melding (uten navn,
// URL-er eller chassis).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const les = (f) => readFileSync(path.resolve(__dirname, '../js', f), 'utf8').replace(/\r\n/g, '\n');
const coreKode = les('core.js');
const diverseKode = les('ordre-diverse.js');

function nyttMiljo({ dbAntall = 5, dbSvar = null, medSentry = true } = {}) {
  const sentry = [];
  const dbKall = [];
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp, Proxy,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, location: { hostname: 'localhost' } },
    navigator: { onLine: true },
    document: {
      addEventListener() {}, getElementById() { return null; }, visibilityState: 'visible',
      createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; },
      body: { appendChild() {} }, head: { appendChild() {} },
    },
    location: { hostname: 'localhost' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: undefined,
  };
  if (medSentry) sandbox.window.Sentry = { captureMessage: (msg, ctx) => sentry.push({ msg, ctx }) };
  vm.createContext(sandbox);
  vm.runInContext(coreKode, sandbox, { filename: 'core.js' });
  // let/const på toppnivå er ikke synlige på sandbox-objektet (se CLAUDE.md om vm-særtrekk) - små hjelpere i SAMME context.
  vm.runInContext('function __S(){return S;} function __logg(){return dokLoggListe;} function __maks(){return DOK_LOGG_MAKS;}', sandbox);
  vm.runInContext(`db = { from: (t) => ({ select: (k) => ({ eq: (c, v) => ({ maybeSingle: () => { __dbKall.push([t, k, c, v]); return Promise.resolve(__dbSvar()); } }) }) }) };`, Object.assign(sandbox, {
    __dbKall: dbKall,
    __dbSvar: () => dbSvar || { data: { dokumenter: Array.from({ length: dbAntall }, (_, i) => ({ navn: 'GEHEIMT-NAVN-' + i + '.pdf', url: 'https://x/hemmelig-' + i })) }, error: null },
  }));
  return { sandbox, sentry, dbKall };
}

const ordre = (id, n) => ({ id, dokumenter: Array.from({ length: n }, (_, i) => ({ navn: 'GEHEIMT-NAVN-' + i + '.pdf', url: 'https://x/hemmelig-' + i })) });

describe('dokumentKrympingSjekk', () => {
  it('første tegning er bare et utgangspunkt: ingen spørring, ingen melding', async () => {
    const { sandbox, sentry, dbKall } = nyttMiljo();
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    expect(dbKall).toEqual([]);
    expect(sentry).toEqual([]);
  });

  it('en kollega eller du fjerner ETT dokument: ingen spørring, ingen melding', async () => {
    const { sandbox, sentry, dbKall } = nyttMiljo();
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    await sandbox.dokumentKrympingSjekk(ordre('o1', 4));
    expect(dbKall).toEqual([]);
    expect(sentry).toEqual([]);
  });

  it('lista går fra 5 til 0 og databasen HAR dem: én Sentry-melding med antall og logg, uten navn/URL', async () => {
    const { sandbox, sentry, dbKall } = nyttMiljo({ dbAntall: 5 });
    sandbox.__S().ordrer.push(ordre('o1', 5));
    sandbox.dokLogg('rt_update', { id: 'o1', fra: 5, til: 0, harDok: true });
    await sandbox.dokumentKrympingSjekk(sandbox.__S().ordrer[0]);
    await sandbox.dokumentKrympingSjekk(ordre('o1', 0)); // et nytt objekt, som etter en utskifting
    expect(dbKall).toEqual([['ordrer', 'dokumenter', 'id', 'o1']]);
    expect(sentry).toHaveLength(1);
    const { msg, ctx } = sentry[0];
    expect(msg).toMatch(/krympet på skjermen/);
    expect(ctx.level).toBe('error');
    expect(ctx.extra).toMatchObject({ ordreId: 'o1', antallForrige: 5, antallPaaSkjerm: 0, antallIDatabasen: 5, objektUtskiftet: true, synlig: 'visible', online: true });
    expect(ctx.extra.logg.some((e) => e.type === 'rt_update')).toBe(true);
    const alt = JSON.stringify(sentry);
    expect(alt).not.toContain('GEHEIMT-NAVN');
    expect(alt).not.toContain('hemmelig');
  });

  it('databasen er ENIG i krympingen (en kollega slettet flere): ingen Sentry-melding', async () => {
    const { sandbox, sentry, dbKall } = nyttMiljo({ dbAntall: 1 });
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    await sandbox.dokumentKrympingSjekk(ordre('o1', 1));
    expect(dbKall).toHaveLength(1); // spurte, fikk bekreftet krympingen
    expect(sentry).toEqual([]);
  });

  it('appen fjerner selv flere (dokumentTapBevisst) innenfor det som er meldt: ingen spørring', async () => {
    const { sandbox, sentry, dbKall } = nyttMiljo();
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    sandbox.dokumentTapBevisst(['o1'], 5);
    await sandbox.dokumentKrympingSjekk(ordre('o1', 0));
    expect(dbKall).toEqual([]);
    expect(sentry).toEqual([]);
  });

  it('"slett ett tok alle": sletting meldte ETT, men 5 forsvant - det er et avvik og meldes', async () => {
    const { sandbox, sentry } = nyttMiljo({ dbAntall: 5 });
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    sandbox.dokumentTapBevisst(['o1'], 1); // slettDokument: ett dokument
    await sandbox.dokumentKrympingSjekk(ordre('o1', 0));
    expect(sentry).toHaveLength(1);
    expect(sentry[0].ctx.extra).toMatchObject({ antallForrige: 5, antallPaaSkjerm: 0, antallIDatabasen: 5 });
  });

  it('melder maks én gang i minuttet per ordre (ikke spam)', async () => {
    const { sandbox, sentry } = nyttMiljo({ dbAntall: 5 });
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    await sandbox.dokumentKrympingSjekk(ordre('o1', 0));
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    await sandbox.dokumentKrympingSjekk(ordre('o1', 0));
    expect(sentry).toHaveLength(1);
  });

  it('feil/offline mot databasen: ingen melding og ingen krasj', async () => {
    const { sandbox, sentry } = nyttMiljo({ dbSvar: { data: null, error: { message: 'offline' } } });
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    await sandbox.dokumentKrympingSjekk(ordre('o1', 0));
    expect(sentry).toEqual([]);
  });

  it('uten Sentry lastet (adblocker/offline) kastes ingenting', async () => {
    const { sandbox } = nyttMiljo({ medSentry: false, dbAntall: 5 });
    await sandbox.dokumentKrympingSjekk(ordre('o1', 5));
    await expect(sandbox.dokumentKrympingSjekk(ordre('o1', 0))).resolves.toBeUndefined();
  });
});

describe('dokLogg', () => {
  it('holder bare de siste hendelsene (ringbuffer)', () => {
    const { sandbox } = nyttMiljo();
    for (let i = 0; i < 100; i++) sandbox.dokLogg('x', { i });
    expect(sandbox.__logg().length).toBe(sandbox.__maks());
    expect(sandbox.__logg()[sandbox.__logg().length - 1].i).toBe(99);
  });
});

describe('kobling i appen (kildekode-vakter)', () => {
  it('dokumenterListeHTML kaller sjekken, og slettDokument melder ETT tapt dokument per ordre', () => {
    expect(diverseKode).toMatch(/function dokumenterListeHTML\(o\) \{\n  const dok = o\.dokumenter\|\|\[\];\n  dokumentKrympingSjekk\(o\);/);
    expect(diverseKode).toContain('dokumentTapBevisst(beroerte.map(m => m.id), 1);');
  });

  it('Realtime-handleren logger oppdateringer for ordrer', () => {
    expect(coreKode).toContain("dokLogg('rt_update'");
    expect(coreKode).toContain("dokLogg('full_innlasting'");
  });
});
