// «Hent selgere fra portalen» viser navn og grunn for forhandlere som trenger et manuelt blikk (Henrik 2026-11-18: «vis navnet»).
import { describe, it, expect } from 'vitest';
import { loadScript } from './helpers/load-script.js';

function last(svar) {
  const toaster = [];
  const ctx = loadScript('ansatte-utstyr.js', {
    window: {}, document: { getElementById: () => null, addEventListener: () => {} },
    me: { rolle: 'admin' },
    edgeFetch: async () => ({ ok: true, json: async () => svar }),
    visToast: (m, t, ms) => toaster.push({ m, t, ms }),
  });
  return { ctx, toaster };
}

describe('Hent selgere fra portalen: avvik med navn', () => {
  it('lager én linje per forhandler med kjent status, ignorerer vanlige rader', () => {
    const { ctx } = last({});
    const linjer = ctx.selgerSynkAvvik([
      { forhandler: 'TEST Bil AS', opprettet: 0, konflikt: 0 },
      { forhandler: 'TEST Auto AS', status: 'navn_stemmer_ikke' },
      { forhandler: 'TEST Ny AS', status: 'ukjent_kontakt_id' },
      { forhandler: 'TEST Motor AS', status: 'samme_navn_annen_epost' },
      { forhandler: 'TEST Rart AS', status: 'noe_ukjent' },
      null,
    ]);
    expect(linjer).toEqual([
      'TEST Auto AS: navnet i portalen er ulikt navnet i Kontakter',
      'TEST Ny AS: finnes i portalen, men er ikke koblet til en kontakt i appen',
      'TEST Motor AS: en selger har samme navn, men annen e-post i appen',
    ]);
    expect(ctx.selgerSynkAvvik(undefined)).toEqual([]);
  });

  it('viser navn og grunn i meldingen, og lar den stå lenger', async () => {
    const { ctx, toaster } = last({ ok: true, antallForhandlere: 72, ukjentKontaktId: 1, navnMismatch: 0,
      rapport: [{ forhandler: 'TEST Ny AS', status: 'ukjent_kontakt_id' }] });
    await ctx.hentSelgereFraPortalen();
    expect(toaster).toHaveLength(1);
    expect(toaster[0].m).toBe('72 forhandlere sjekket, 1 trenger et manuelt blikk:\nTEST Ny AS: finnes i portalen, men er ikke koblet til en kontakt i appen');
    expect(toaster[0].ms).toBe(20000);
  });

  it('uten avvik er meldingen som før', async () => {
    const { ctx, toaster } = last({ ok: true, antallForhandlere: 72, rapport: [{ forhandler: 'TEST Bil AS', koblet: 2 }] });
    await ctx.hentSelgereFraPortalen();
    expect(toaster[0].m).toBe('72 forhandlere sjekket, 2 koblet');
    expect(toaster[0].ms).toBeUndefined();
  });
});
