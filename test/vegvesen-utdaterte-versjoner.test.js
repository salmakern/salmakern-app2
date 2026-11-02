import { describe, it, expect } from 'vitest';
import { loadScript } from './helpers/load-script.js';

// Reell hendelse 2026-11-02: flåte 26 ble omdøpt til 25, og Vegvesen-dokumentene ble generert
// på nytt under et nytt filnavn ("Egenerklæring-25.pdf"). Lagringen erstatter bare en linje
// med SAMME navn, så alle fire ordrene fikk både "-26" og "-25" (dobbelt opp), og "Skriv ut"
// tok første treff (det gamle settet). vegvesenFjernAndreVersjonerAvType() fjerner nå andre
// versjoner av samme type når et nytt dokument lagres, og "Skriv ut" velger nyeste per type.

const BASE = 'https://x.supabase.co/storage/v1/object/public/ordre-dokumenter/';
const dok = (navn, dato = '2026-10-12T11:45:45.000Z', sti = `o1/${navn}`) => ({ navn, url: BASE + sti, lastetOppAv: 'T', dato });

// Etterligner oppdater_ordre_dokument (supabase/migrations/20261022120000/130000): erstatter
// linjen med samme navn, ellers legger til; p_dokument=null sletter linjen med det navnet.
function nyttMiljo(ordrer, { rpcFeilForNavn = null } = {}) {
  const logg = { rpc: [], fjernet: [], opplastet: [], logChange: [], toast: [] };
  const sandbox = loadScript('vegvesen-dokumenter.js', {
    S: { ordrer, flater: [] },
    me: { navn: 'Tester' },
    visToast: (m) => logg.toast.push(m),
    logChange: (o, t) => logg.logChange.push([o.id, t]),
    planleggLocalSpeiling: () => {},
    dokLogg: () => {}, dokumentTapBevisst: () => {}, // diagnostikk i core.js
    dokumenterListeHTML: () => '',
    document: { getElementById: () => null },
    Blob,
    db: {
      storage: {
        from: () => ({
          upload: async (sti) => { logg.opplastet.push(sti); return { error: null }; },
          getPublicUrl: (sti) => ({ data: { publicUrl: BASE + sti } }),
          remove: async (stier) => { logg.fjernet.push(...stier); return { error: null }; },
        }),
      },
      rpc: async (navn, args) => {
        logg.rpc.push([navn, args.p_ordre_id, args.p_navn, args.p_dokument === null ? 'slett' : 'sett']);
        if (rpcFeilForNavn && args.p_navn === rpcFeilForNavn && args.p_dokument === null) return { data: null, error: { message: 'feil' } };
        const o = ordrer.find((x) => x.id === args.p_ordre_id);
        const liste = [...(o.dokumenter || [])];
        const idx = liste.map((d) => d.navn).lastIndexOf(args.p_navn);
        const forrige = idx >= 0 ? liste[idx] : null;
        if (args.p_dokument === null) { if (idx >= 0) liste.splice(idx, 1); }
        else if (idx >= 0) liste[idx] = args.p_dokument;
        else liste.push(args.p_dokument);
        o.dokumenter = liste; // databasen er sannheten; klienten leser svaret under
        return { data: { dokumenter: liste, forrige }, error: null };
      },
    },
  });
  return { sandbox, logg };
}

// Fem dokumenter i flåtenummer 26 + ett manuelt opplastet, delt av alle ordrene (samme URL).
const sett26 = () => [
  dok('Egenerklæring-26.pdf', undefined, 'f/Egenerklaering-26.pdf'),
  dok('Vektfordeling-26.pdf', undefined, 'f/Vektfordeling-26.pdf'),
  dok('Fabrikantattest-26.pdf', undefined, 'f/Fabrikantattest-26.pdf'),
  dok('Melding om registrering-26.pdf', undefined, 'f/Melding-26.pdf'),
  dok('Kjøretøyliste-26.pdf', undefined, 'f/Kjoretoyliste-26.pdf'),
  dok('Godkjenningsattest_ABC.PDF', '2026-10-19T08:41:42.927Z', 'o1/Godkjenningsattest_ABC.PDF'),
];

describe('flåte omdøpt: nytt filnavn erstatter samme type, ikke dobbelt opp', () => {
  it('fjerner Egenerklæring-26 og beholder -25 på alle ordrene, rører ikke andre typer eller manuelle filer', async () => {
    const ordrer = [{ id: 'o1', dokumenter: sett26() }, { id: 'o2', dokumenter: sett26() }];
    const { sandbox, logg } = nyttMiljo(ordrer);
    const ok = await sandbox.vegvesenLagreGenerertDokumentFlere(['o1', 'o2'], 'Egenerklæring-25.pdf', new Uint8Array([1, 2, 3]));
    expect(ok).toBe(true);
    for (const o of ordrer) {
      const navn = o.dokumenter.map((d) => d.navn);
      expect(navn.filter((n) => n.startsWith('Egenerklæring-'))).toEqual(['Egenerklæring-25.pdf']);
      expect(navn).toContain('Vektfordeling-26.pdf'); // andre typer er urørt til de selv regenereres
      expect(navn).toContain('Godkjenningsattest_ABC.PDF'); // manuell opplasting er urørt
    }
    // Den delte, utdaterte filen slettes ÉN gang (ikke én gang per ordre).
    expect(logg.fjernet).toEqual(['f/Egenerklaering-26.pdf']);
  });

  it('en hel regenerering av alle fem typer gir nøyaktig ett sett igjen (ingen dobbelt opp)', async () => {
    const ordrer = [{ id: 'o1', dokumenter: sett26() }, { id: 'o2', dokumenter: sett26() }];
    const { sandbox } = nyttMiljo(ordrer);
    for (const t of ['Egenerklæring', 'Melding om registrering', 'Vektfordeling', 'Fabrikantattest', 'Kjøretøyliste']) {
      expect(await sandbox.vegvesenLagreGenerertDokumentFlere(['o1', 'o2'], `${t}-25.pdf`, new Uint8Array([1]))).toBe(true);
    }
    for (const o of ordrer) {
      const navn = o.dokumenter.map((d) => d.navn).sort();
      expect(navn).toEqual([
        'Egenerklæring-25.pdf', 'Fabrikantattest-25.pdf', 'Godkjenningsattest_ABC.PDF',
        'Kjøretøyliste-25.pdf', 'Melding om registrering-25.pdf', 'Vektfordeling-25.pdf',
      ]);
    }
  });

  it('enkelt-ordre-varianten (chassis-navn -> flåtenavn) rydder på samme måte', async () => {
    const o = { id: 'o1', dokumenter: [dok('Fabrikantattest-ABC123.pdf', undefined, 'o1/Fab-ABC123.pdf')] };
    const { sandbox, logg } = nyttMiljo([o]);
    expect(await sandbox.vegvesenLagreGenerertDokument('o1', 'Fabrikantattest-25.pdf', new Uint8Array([1]))).toBe(true);
    expect(o.dokumenter.map((d) => d.navn)).toEqual(['Fabrikantattest-25.pdf']);
    expect(logg.fjernet).toEqual(['o1/Fab-ABC123.pdf']);
    expect(logg.logChange.some(([, t]) => /Fjernet utdatert versjon/.test(t))).toBe(true);
  });

  it('samme navn som før: erstattes som tidligere, uten ekstra slette-kall', async () => {
    const o = { id: 'o1', dokumenter: [dok('Egenerklæring-25.pdf', undefined, 'o1/gammel.pdf')] };
    const { sandbox, logg } = nyttMiljo([o]);
    await sandbox.vegvesenLagreGenerertDokument('o1', 'Egenerklæring-25.pdf', new Uint8Array([1]));
    expect(logg.rpc.filter((r) => r[3] === 'slett')).toEqual([]);
    expect(o.dokumenter).toHaveLength(1);
  });
});

describe('vern mot å ødelegge lenker', () => {
  it('sletter ikke filen hvis en ordre utenfor settet (f.eks. flyttet ut av flåten) fortsatt peker på den', async () => {
    const delt = 'f/Egenerklaering-26.pdf';
    const ordrer = [
      { id: 'o1', dokumenter: [dok('Egenerklæring-26.pdf', undefined, delt)] },
      { id: 'o2', dokumenter: [dok('Egenerklæring-26.pdf', undefined, delt)] },
      { id: 'o3', dokumenter: [dok('Egenerklæring-26.pdf', undefined, delt)] }, // ikke med i genereringen
    ];
    const { sandbox, logg } = nyttMiljo(ordrer);
    await sandbox.vegvesenLagreGenerertDokumentFlere(['o1', 'o2'], 'Egenerklæring-25.pdf', new Uint8Array([1]));
    expect(ordrer[0].dokumenter.map((d) => d.navn)).toEqual(['Egenerklæring-25.pdf']);
    expect(ordrer[1].dokumenter.map((d) => d.navn)).toEqual(['Egenerklæring-25.pdf']);
    expect(ordrer[2].dokumenter.map((d) => d.navn)).toEqual(['Egenerklæring-26.pdf']);
    expect(logg.fjernet).toEqual([]);
  });

  it('feiler databasefjerningen, beholdes filen (ingen hengende lenke) og lagringen av det nye dokumentet lykkes likevel', async () => {
    const o = { id: 'o1', dokumenter: [dok('Egenerklæring-26.pdf', undefined, 'o1/gammel.pdf')] };
    const { sandbox, logg } = nyttMiljo([o], { rpcFeilForNavn: 'Egenerklæring-26.pdf' });
    const ok = await sandbox.vegvesenLagreGenerertDokument('o1', 'Egenerklæring-25.pdf', new Uint8Array([1]));
    expect(ok).toBe(true);
    expect(logg.fjernet).toEqual([]);
    expect(o.dokumenter.map((d) => d.navn).sort()).toEqual(['Egenerklæring-25.pdf', 'Egenerklæring-26.pdf']);
  });

  it('rører ingenting for et filnavn som ikke er en Vegvesen-dokumenttype', async () => {
    const o = { id: 'o1', dokumenter: [dok('Egenerklæring-26.pdf')] };
    const { sandbox, logg } = nyttMiljo([o]);
    await sandbox.vegvesenFjernAndreVersjonerAvType(['o1'], 'Noe-annet.pdf');
    expect(logg.rpc).toEqual([]);
  });
});

describe('vegvesenSkrivUt - nyeste dokument per type', () => {
  it('skriver ut det nyeste av to sett, ikke det første i lista', async () => {
    const hentet = [];
    const o = {
      id: 'o1',
      dokumenter: [
        dok('Egenerklæring-26.pdf', '2026-10-12T11:45:45.000Z', 'gammel/egen'),
        dok('Vektfordeling-26.pdf', '2026-10-12T11:45:47.000Z', 'gammel/vekt'),
        dok('Egenerklæring-25.pdf', '2026-11-02T08:40:48.000Z', 'ny/egen'),
        dok('Vektfordeling-25.pdf', '2026-11-02T08:40:49.000Z', 'ny/vekt'),
      ],
    };
    const vindu = { document: { write() {} }, close() {}, location: {} };
    const { sandbox } = nyttMiljo([o]);
    sandbox.window = { open: () => vindu };
    sandbox.fetch = async (url) => { hentet.push(url.replace(BASE, '')); return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }; };
    sandbox.PDFLib = {
      PDFDocument: {
        create: async () => ({ copyPages: async () => [], addPage() {}, save: async () => new Uint8Array() }),
        load: async () => ({ getPageIndices: () => [] }),
      },
    };
    sandbox.URL = { createObjectURL: () => 'blob:x' };
    await sandbox.vegvesenSkrivUt('o1');
    expect(hentet).toEqual(['ny/egen', 'ny/vekt']);
  });
});
