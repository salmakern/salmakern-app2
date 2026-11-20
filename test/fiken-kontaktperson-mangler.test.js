// Henrik: en selger fra Forhandlerportalen (ny ELLER en av de ca. 270 eksisterende) uten en
// tilsvarende Fiken-kontaktperson skal oppdages og løses VED FAKTURERING, ikke stille hoppes
// over. Dekker klientsiden av løsningen: kallFikenFakturer sin nye needsKontaktperson-gren,
// e-post-forslaget fra S.kontakter (samme oppslag som Admin-ark), opprettFikenKontaktperson()
// (kaller den nye edge-funksjonen fiken-opprett-kontaktperson og prøver fakturering på nytt) og
// fortsettUtenFikenKontaktperson() (unnslippingsluken). Selve edge-funksjonene er dekket av
// test/fiken-fakturer-kontaktperson.test.js og test/fiken-opprett-kontaktperson.test.js - her
// er edgeFetch en ren spion (samme mønster som test/leveranse.test.js sin edgeFake()), så dette
// er IKKE en ende-til-ende-test mot ekte Fiken.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

const app = lastApp();
const { sandbox, S } = app;
const EKTE = { edgeFetch: sandbox.edgeFetch, visToast: sandbox.visToast };
afterEach(() => { Object.assign(sandbox, EKTE); });

function edgeFake(svar) {
  const kall = [];
  sandbox.edgeFetch = async (fn, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    kall.push({ fn, body });
    const s = svar(fn, body, kall.length);
    return { ok: s.status >= 200 && s.status < 300, status: s.status, json: async () => s.json };
  };
  return kall;
}

const KONTAKTER = [{ type: 'Forhandler', navn: 'TEST Kunde AS', orgnr: '999888777', kontaktpersoner: [{ id: 'kp1', navn: 'TEST Selger', epost: 'selger@test.no' }] }];
const nyOrdre = (over = {}) => sandbox.dbToOrdre({
  id: 'ord_TESTKP1', status: 'aktiv', ordre_status: 'klar_henting', chassis: 'TESTWXYZ0000000A1',
  kunde: 'TEST Kunde AS', eier: 'TEST Selger', ...over,
});

beforeEach(() => {
  S.ordrer = []; S.kontakter = structuredClone(KONTAKTER); S.fikenKundeAlias = []; S.fikenKundeRabatt = [];
  app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' });
  app.settAktivOrdre(null);
  sandbox.fikenFaktureringBrukRabatt = true;
});

describe('kallFikenFakturer: needsKontaktperson', () => {
  it('åpner fikenKontaktpersonMangler-modalen med navn, kunde og e-post-forslag fra S.kontakter, og returnerer «needsKontaktperson»', async () => {
    const o = nyOrdre(); S.ordrer = [o];
    const kall = edgeFake(() => ({
      status: 200,
      json: { needsKontaktperson: true, ordreId: o.id, kundeNavn: 'TEST Kunde AS', kontaktpersonNavn: 'TEST Selger', contactId: 555, fikenKundeNavn: 'Fiken Testkunde AS' },
    }));
    const status = await sandbox.kallFikenFakturer(o.id, {});
    expect(status).toBe('needsKontaktperson');
    expect(sandbox.document.getElementById('fikenKpManglerNavn').textContent).toBe('TEST Selger');
    expect(sandbox.document.getElementById('fikenKpManglerKunde').textContent).toBe('Fiken Testkunde AS');
    expect(sandbox.document.getElementById('fikenKpManglerEpost').value).toBe('selger@test.no'); // funnet via adminArkFinnKontaktEpost i S.kontakter
    expect(kall).toHaveLength(1);
    expect(kall[0].fn).toBe('fiken-fakturer');
  });

  it('ingen kjent e-post for selgeren: forslagsfeltet er tomt (admin må skrive den selv)', async () => {
    S.kontakter = [{ type: 'Forhandler', navn: 'TEST Kunde AS', kontaktpersoner: [] }];
    const o = nyOrdre(); S.ordrer = [o];
    edgeFake(() => ({ status: 200, json: { needsKontaktperson: true, ordreId: o.id, kundeNavn: 'TEST Kunde AS', kontaktpersonNavn: 'TEST Selger', contactId: 555 } }));
    await sandbox.kallFikenFakturer(o.id, {});
    expect(sandbox.document.getElementById('fikenKpManglerEpost').value).toBe('');
  });
});

describe('opprettFikenKontaktperson', () => {
  async function apneModal(o) {
    edgeFake(() => ({ status: 200, json: { needsKontaktperson: true, ordreId: o.id, kundeNavn: 'TEST Kunde AS', kontaktpersonNavn: 'TEST Selger', contactId: 555 } }));
    await sandbox.kallFikenFakturer(o.id, {});
  }

  it('tom/ugyldig e-post: viser feil, kaller IKKE edge-funksjonen, modalen lukkes ikke', async () => {
    const o = nyOrdre(); S.ordrer = [o];
    await apneModal(o);
    sandbox.document.getElementById('fikenKpManglerEpost').value = '';
    const kall = edgeFake(() => { throw new Error('skal ikke kalles'); });
    await sandbox.opprettFikenKontaktperson();
    expect(sandbox.document.getElementById('fikenKpManglerErr').textContent).toMatch(/gyldig e-post/);
    expect(kall).toHaveLength(0);

    sandbox.document.getElementById('fikenKpManglerEpost').value = 'ikke-en-epost';
    await sandbox.opprettFikenKontaktperson();
    expect(sandbox.document.getElementById('fikenKpManglerErr').textContent).toMatch(/gyldig e-post/);
    expect(kall).toHaveLength(0);
  });

  it('opprettet: kaller fiken-opprett-kontaktperson med ordreId/navn/epost, lukker modalen og prøver fakturering på nytt', async () => {
    const o = nyOrdre(); S.ordrer = [o];
    await apneModal(o);
    sandbox.document.getElementById('fikenKpManglerEpost').value = 'ny@test.no';
    const toasts = []; sandbox.visToast = (t) => toasts.push(t);
    const kall = edgeFake((fn) => {
      if (fn === 'fiken-opprett-kontaktperson') return { status: 201, json: { created: true, contactId: 555, contactPersonId: 999, navn: 'TEST Selger', epost: 'ny@test.no' } };
      return { status: 201, json: { ok: true, draftUrl: 'https://fiken.test/kladd/1' } }; // andre kall: retry av fiken-fakturer
    });
    await sandbox.opprettFikenKontaktperson();
    expect(kall).toHaveLength(2);
    expect(kall[0]).toMatchObject({ fn: 'fiken-opprett-kontaktperson', body: { ordreId: o.id, navn: 'TEST Selger', epost: 'ny@test.no' } });
    expect(kall[1].fn).toBe('fiken-fakturer');
    expect(o.fakturert).toBe(true); // beviser at retry-kallet faktisk fullførte faktureringen
    expect(toasts.join(' ')).toContain('opprettet i Fiken');
  });

  it('finnes allerede (created:false MED contactPersonId): også gyldig å prøve fakturering på nytt', async () => {
    const o = nyOrdre(); S.ordrer = [o];
    await apneModal(o);
    sandbox.document.getElementById('fikenKpManglerEpost').value = 'ny@test.no';
    const kall = edgeFake((fn) => {
      if (fn === 'fiken-opprett-kontaktperson') return { status: 200, json: { created: false, reason: 'Kontaktperson «TEST Selger» finnes allerede hos TEST Kunde AS i Fiken', contactId: 555, contactPersonId: 42 } };
      return { status: 201, json: { ok: true, draftUrl: 'https://fiken.test/kladd/1' } };
    });
    await sandbox.opprettFikenKontaktperson();
    expect(kall).toHaveLength(2);
    expect(o.fakturert).toBe(true);
  });

  it('kunne ikke slå opp riktig Fiken-kunde (created:false, INGEN contactPersonId): viser feilen, prøver IKKE fakturering på nytt', async () => {
    const o = nyOrdre(); S.ordrer = [o];
    await apneModal(o);
    sandbox.document.getElementById('fikenKpManglerEpost').value = 'ny@test.no';
    const kall = edgeFake((fn) => {
      if (fn === 'fiken-opprett-kontaktperson') return { status: 422, json: { created: false, reason: 'Fant ingen Fiken-kunde med organisasjonsnummer 999888777', kandidater: [] } };
      throw new Error('skal ikke fakturere på nytt');
    });
    await sandbox.opprettFikenKontaktperson();
    expect(kall).toHaveLength(1);
    expect(sandbox.document.getElementById('fikenKpManglerErr').textContent).toMatch(/Fant ingen Fiken-kunde/);
  });

  it('nettverksfeil fra edge-funksjonen: viser feil i modalen, kaster ikke', async () => {
    const o = nyOrdre(); S.ordrer = [o];
    await apneModal(o);
    sandbox.document.getElementById('fikenKpManglerEpost').value = 'ny@test.no';
    sandbox.edgeFetch = async () => { throw new Error('nettverksfeil'); };
    await expect(sandbox.opprettFikenKontaktperson()).resolves.not.toThrow();
    expect(sandbox.document.getElementById('fikenKpManglerErr').textContent).toMatch(/nettverksfeil/);
  });
});

describe('fortsettUtenFikenKontaktperson', () => {
  it('prøver fakturering på nytt med hoppOverKontaktpersonsjekk: true, uten å kalle fiken-opprett-kontaktperson', async () => {
    const o = nyOrdre(); S.ordrer = [o];
    edgeFake(() => ({ status: 200, json: { needsKontaktperson: true, ordreId: o.id, kundeNavn: 'TEST Kunde AS', kontaktpersonNavn: 'TEST Selger', contactId: 555 } }));
    await sandbox.kallFikenFakturer(o.id, {});
    const kall = edgeFake(() => ({ status: 201, json: { ok: true, draftUrl: 'https://fiken.test/kladd/1' } }));
    sandbox.fortsettUtenFikenKontaktperson();
    await new Promise((r) => setTimeout(r, 0));
    expect(kall).toHaveLength(1);
    expect(kall[0].fn).toBe('fiken-fakturer');
    expect(kall[0].body.hoppOverKontaktpersonsjekk).toBe(true);
    expect(o.fakturert).toBe(true);
  });
});
