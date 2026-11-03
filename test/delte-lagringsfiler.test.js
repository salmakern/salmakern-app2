import { describe, it, expect, beforeEach } from 'vitest';
import { lastApp } from './helpers/app-harness.js';

// Revisjon 2026-11-02: en fil i Storage kan pekes på fra flere steder (en Vegvesen-fil generert for en hel flåte står i dokumentlista til alle
// medlemmene, en forhandlers fullmakt er EN fil som kopieres inn i hver ordre). Tidligere slettet «slett dokument», «erstatt dokument» og
// «slett ordre» filen fordi EN ordre slapp den, og de andre fikk ødelagte lenker. Testene vokter at en delt fil aldri slettes.

const app = lastApp();
const { sandbox, S } = app;
const BASE = 'https://x.supabase.co/storage/v1/object/public/ordre-dokumenter/';
const dok = (sti, navn = 'Fil.pdf') => ({ navn, url: BASE + sti });

function fakeDb() {
  const fjernet = []; const rpc = []; const lister = {};
  const db = {
    storage: { from: (bucket) => ({
      remove: (stier) => { fjernet.push([bucket, ...stier]); return Promise.resolve({ error: null }); },
      list: (mappe) => Promise.resolve({ data: lister[bucket + ':' + mappe] || [], error: null }),
      getPublicUrl: (sti) => ({ data: { publicUrl: BASE + sti } }),
    }) },
    rpc: (navn, args) => { rpc.push([navn, args]); return Promise.resolve({ data: { dokumenter: [], forrige: null }, error: null }); },
  };
  return { db, fjernet, rpc, lister };
}

beforeEach(() => { S.ordrer = []; S.kontakter = []; app.settMe({ id: 1, navn: 'TEST - Admin', rolle: 'admin' }); });

describe('storageFilBrukesAvAndre', () => {
  it('en fil bare denne ordren peker på kan slettes', () => {
    S.ordrer = [{ id: 'o1', dokumenter: [dok('o1/a.pdf')] }, { id: 'o2', dokumenter: [dok('o2/b.pdf')] }];
    expect(sandbox.storageFilBrukesAvAndre(BASE + 'o1/a.pdf', ['o1'])).toBe(false);
  });
  it('en fil en annen ordre også peker på (flåtedokument) slettes ikke', () => {
    S.ordrer = [{ id: 'o1', dokumenter: [dok('o1/a.pdf')] }, { id: 'o2', dokumenter: [dok('o1/a.pdf')] }];
    expect(sandbox.storageFilBrukesAvAndre(BASE + 'o1/a.pdf', ['o1'])).toBe(true);
  });
  it('ordrene som selv mister lenka (hele flåten) teller ikke som «andre»', () => {
    S.ordrer = [{ id: 'o1', dokumenter: [dok('o1/a.pdf')] }, { id: 'o2', dokumenter: [dok('o1/a.pdf')] }];
    expect(sandbox.storageFilBrukesAvAndre(BASE + 'o1/a.pdf', ['o1', 'o2'])).toBe(false);
  });
  it('en forhandlers fullmakt (forhandlere/...) slettes aldri fra en ordre', () => {
    S.ordrer = [{ id: 'o1', dokumenter: [dok('forhandlere/12/fullmakt.pdf')] }];
    expect(sandbox.storageFilBrukesAvAndre(BASE + 'forhandlere/12/fullmakt.pdf', ['o1'])).toBe(true);
  });
  it('en fil kontakten har som fullmakt slettes ikke', () => {
    S.kontakter = [{ navn: 'Forhandler', fullmaktUrl: BASE + 'o9/full.pdf' }];
    S.ordrer = [{ id: 'o9', dokumenter: [dok('o9/full.pdf')] }];
    expect(sandbox.storageFilBrukesAvAndre(BASE + 'o9/full.pdf', ['o9'])).toBe(true);
  });
  it('URL-koding og vanlig tekst regnes som samme fil (æ, mellomrom)', () => {
    S.ordrer = [{ id: 'o2', dokumenter: [dok('o1/Egenerkl%C3%A6ring%20123.pdf')] }];
    expect(sandbox.storageFilBrukesAvAndre(BASE + 'o1/Egenerklæring 123.pdf', ['o1'])).toBe(true);
    expect(sandbox.storageFilBrukesAvAndre('o1/Egenerklæring 123.pdf', ['o1'])).toBe(true);
  });
  it('tom/ukjent verdi tolkes som «i bruk» (ikke slett ved tvil), og tåler ordre uten dokumentliste', () => {
    S.ordrer = [{ id: 'o2' }, { id: 'o3', dokumenter: null }];
    expect(sandbox.storageFilBrukesAvAndre('', ['o1'])).toBe(true);
    expect(sandbox.storageFilBrukesAvAndre(null, ['o1'])).toBe(true);
    expect(sandbox.storageFilBrukesAvAndre(BASE + 'o1/a.pdf', ['o1'])).toBe(false);
  });
});

describe('slettDokument', () => {
  it('en fil bare denne ordren har: lenka fjernes via RPC og filen slettes (etter RPC-en)', async () => {
    const { db, fjernet, rpc } = fakeDb(); app.settDb(db);
    S.ordrer = [{ id: 'o1', dokumenter: [dok('o1/a.pdf', 'a.pdf')], endringer: [] }];
    await sandbox.slettDokument('o1', 0);
    expect(rpc.filter((r) => r[0] === 'oppdater_ordre_dokument')).toHaveLength(1);
    expect(fjernet).toEqual([['ordre-dokumenter', 'o1/a.pdf']]);
  });
  it('en fil en ANNEN ordre også har (utenfor flåten): lenka fjernes, men filen beholdes', async () => {
    const { db, fjernet, rpc } = fakeDb(); app.settDb(db);
    S.ordrer = [
      { id: 'o1', dokumenter: [dok('felles/f.pdf', 'f.pdf')], endringer: [] },
      { id: 'o2', dokumenter: [dok('felles/f.pdf', 'f.pdf')], endringer: [] },
    ];
    await sandbox.slettDokument('o1', 0);
    expect(rpc.filter((r) => r[0] === 'oppdater_ordre_dokument')).toHaveLength(1);
    expect(fjernet).toEqual([]);
  });
  it('forhandlerfullmakt slettet fra en ordre: filen beholdes', async () => {
    const { db, fjernet } = fakeDb(); app.settDb(db);
    S.ordrer = [{ id: 'o1', dokumenter: [dok('forhandlere/3/f.pdf', 'Fullmakt.pdf')], endringer: [] }];
    await sandbox.slettDokument('o1', 0);
    expect(fjernet).toEqual([]);
  });
});

describe('slettOrdreStorageFiler (ordre slettes for godt)', () => {
  it('filer under ordrens mappe slettes, men en fil en annen ordre fortsatt peker på beholdes', async () => {
    const { db, fjernet, lister } = fakeDb(); app.settDb(db);
    lister['ordre-dokumenter:o1'] = [{ name: 'eget.pdf' }, { name: 'delt.pdf' }];
    lister['bilder:o1'] = [{ name: 'bilde.jpg' }];
    S.ordrer = [{ id: 'o2', dokumenter: [dok('o1/delt.pdf')] }];
    await sandbox.slettOrdreStorageFiler('o1');
    expect(fjernet).toContainEqual(['bilder', 'o1/bilde.jpg']);
    expect(fjernet).toContainEqual(['ordre-dokumenter', 'o1/eget.pdf']);
    expect(fjernet.flat()).not.toContain('o1/delt.pdf');
  });
  it('bilder slettes alltid (de deles ikke mellom ordrer)', async () => {
    const { db, fjernet, lister } = fakeDb(); app.settDb(db);
    lister['bilder:o1'] = [{ name: 'a.jpg' }, { name: 'b.jpg' }];
    S.ordrer = [];
    await sandbox.slettOrdreStorageFiler('o1');
    expect(fjernet).toEqual([['bilder', 'o1/a.jpg', 'o1/b.jpg']]);
  });
});

describe('autoFyllForhandlerFullmakt skriver atomisk', () => {
  it('bruker oppdater_ordre_dokument (ett dokument), aldri en oppdatering av hele dokumenter-kolonnen', async () => {
    const { db, rpc } = fakeDb();
    const oppdateringer = [];
    db.from = (t) => ({ update: (r) => { oppdateringer.push([t, r]); return { eq: () => Promise.resolve({ error: null }) }; } });
    app.settDb(db);
    S.kontakter = [{ type: 'Forhandler', navn: 'Test Forhandler', fullmaktUrl: BASE + 'forhandlere/3/f.pdf', fullmaktNavn: 'Fullmakt.pdf' }];
    S.ordrer = [{ id: 'o1', kunde: 'Test Forhandler', dokumenter: [dok('o1/annet.pdf', 'annet.pdf')], endringer: [], fullmakt: 'har' }];
    sandbox.autoFyllForhandlerFullmakt('o1');
    await Promise.resolve();
    expect(oppdateringer).toEqual([]);
    const dokRpc = rpc.filter((r) => r[0] === 'oppdater_ordre_dokument');
    expect(dokRpc).toHaveLength(1);
    expect(dokRpc[0][1]).toMatchObject({ p_ordre_id: 'o1', p_navn: 'Fullmakt.pdf' });
    expect(dokRpc[0][1].p_dokument.url).toBe(BASE + 'forhandlere/3/f.pdf');
  });
});
