import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Regresjonstest for feil rapportert av Henrik 2026-09-25: "Rediger navn" på en modell i
// Lager (redigerModellNavn) omdøpte KUN lagervarer.modell - lagerOppskrifter og
// utstyrMaler har hver sin egen, ukoblede "biltype"-tekst for samme modell, og ble
// stående igjen under det gamle navnet. Konkret: omdøpte ID BUZZ i Lager, ni oppskrifter
// forsvant fra "Oppskrifter per modell" fordi de fortsatt lå under det gamle biltype-
// navnet ingen andre steder i appen lenger brukte.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kode = readFileSync(path.resolve(__dirname, '../js/lager.js'), 'utf8');

function nyEnvironment() {
  const fakeTittel = { textContent: '' };
  const fakeListe = { innerHTML: '' };
  const dbKall = [];
  const saveInnstillingerKall = [];
  const alertKall = [];
  let promptSvar = null;

  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    document: {
      addEventListener() {},
      getElementById(id) {
        if (id === 'modellDetaljTittel') return fakeTittel;
        if (id === 'modellKategoriListe') return fakeListe;
        return null;
      },
    },
    window: { addEventListener() {} },
    S: { lagervarer: [], lagerOppskrifter: [], utstyrMaler: [] },
    esc: s => s,
    fmtAntall: n => String(n),
    prompt: () => promptSvar,
    alert: msg => alertKall.push(msg),
    saveInnstillinger: () => saveInnstillingerKall.push(JSON.parse(JSON.stringify(sandbox.S.utstyrMaler))),
    db: {
      from(table) {
        return { upsert: (rows, opts) => { dbKall.push({ table, rows, opts }); return Promise.resolve({ error: null }); } };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox, { filename: 'lager.js' });
  // aktivModell er en `let` på toppnivå i lager.js - usynlig som sandbox-egenskap etter
  // runInContext (se test-notatet i prosjektets CLAUDE.md). Disse hjelpefunksjonene deler
  // toppnivå-scope med kildefilen siden de kjøres i SAMME context rett etterpå, og kan
  // derfor lese/skrive den "usynlige" bindingen redigerModellNavn() faktisk bruker.
  vm.runInContext('function _setAktivModell(v){ aktivModell = v; } function _getAktivModell(){ return aktivModell; }', sandbox, { filename: 'helpers.js' });
  return { env: sandbox, dbKall, saveInnstillingerKall, alertKall, settPrompt: v => { promptSvar = v; } };
}

describe('redigerModellNavn - omdøper lagervarer, lagerOppskrifter OG utstyrMaler samlet', () => {
  let env, dbKall, saveInnstillingerKall, alertKall, settPrompt;
  beforeEach(() => {
    ({ env, dbKall, saveInnstillingerKall, alertKall, settPrompt } = nyEnvironment());
    env.S.lagervarer = [
      { id: 'v1', navn: 'Skrue', modell: 'ID BUZZ', kategori: 'Skruer' },
      { id: 'v2', navn: 'Mutter', modell: 'ID BUZZ', kategori: 'Muttere' },
      { id: 'v3', navn: 'Annen del', modell: 'EV9', kategori: 'X' },
    ];
    env.S.lagerOppskrifter = [
      { id: 'o1', navn: 'Standard (Kort)', biltype: 'ID BUZZ' },
      { id: 'o2', navn: 'Standard (Lang)', biltype: 'ID BUZZ' },
      { id: 'o3', navn: 'EV9-oppskrift', biltype: 'EV9' },
    ];
    env.S.utstyrMaler = [
      { id: 'u1', navn: 'Volkswagen ID BUZZ', biltype: 'ID BUZZ' },
      { id: 'u2', navn: 'KIA EV9', biltype: 'EV9' },
    ];
    env._setAktivModell('ID BUZZ');
    settPrompt('ID. BUZZ');
  });

  it('omdøper modell-feltet på alle lagervarer som har den gamle modellen', () => {
    env.redigerModellNavn();
    expect(env.S.lagervarer.filter(v => v.modell === 'ID. BUZZ').map(v => v.id).sort()).toEqual(['v1', 'v2']);
    expect(env.S.lagervarer.find(v => v.id === 'v3').modell).toBe('EV9'); // urørt
    expect(dbKall).toContainEqual({ table: 'lagervarer', rows: [{ id: 'v1', modell: 'ID. BUZZ' }, { id: 'v2', modell: 'ID. BUZZ' }], opts: { onConflict: 'id' } });
  });

  it('omdøper biltype på matchende lagerOppskrifter (root cause for buggen)', () => {
    env.redigerModellNavn();
    expect(env.S.lagerOppskrifter.filter(o => o.biltype === 'ID. BUZZ').map(o => o.id).sort()).toEqual(['o1', 'o2']);
    expect(env.S.lagerOppskrifter.find(o => o.id === 'o3').biltype).toBe('EV9'); // urørt
    expect(dbKall).toContainEqual({ table: 'lager_oppskrifter', rows: [{ id: 'o1', biltype: 'ID. BUZZ' }, { id: 'o2', biltype: 'ID. BUZZ' }], opts: { onConflict: 'id' } });
  });

  it('omdøper biltype på matchende utstyrMaler og lagrer via saveInnstillinger()', () => {
    env.redigerModellNavn();
    expect(env.S.utstyrMaler.find(m => m.id === 'u1').biltype).toBe('ID. BUZZ');
    expect(env.S.utstyrMaler.find(m => m.id === 'u2').biltype).toBe('EV9'); // urørt
    expect(saveInnstillingerKall.length).toBe(1);
  });

  it('oppdaterer aktivModell og tittelen i DOM til det nye navnet', () => {
    env.redigerModellNavn();
    expect(env._getAktivModell()).toBe('ID. BUZZ');
    expect(env.document.getElementById('modellDetaljTittel').textContent).toBe('ID. BUZZ');
  });

  it('avbryter uten endringer hvis prompt() avbrytes (null)', () => {
    settPrompt(null);
    env.redigerModellNavn();
    expect(env.S.lagervarer.find(v => v.id === 'v1').modell).toBe('ID BUZZ');
    expect(env.S.lagerOppskrifter.find(o => o.id === 'o1').biltype).toBe('ID BUZZ');
    expect(dbKall.length).toBe(0);
  });

  it('avbryter uten endringer hvis nytt navn er tomt/blank', () => {
    settPrompt('   ');
    env.redigerModellNavn();
    expect(env.S.lagervarer.find(v => v.id === 'v1').modell).toBe('ID BUZZ');
    expect(alertKall.length).toBe(1);
    expect(dbKall.length).toBe(0);
  });

  it('gjør ingen lagerOppskrifter/utstyrMaler-kall når ingen av dem matcher den gamle modellen', () => {
    env.S.lagerOppskrifter = [];
    env.S.utstyrMaler = [];
    env.redigerModellNavn();
    expect(dbKall.some(k => k.table === 'lager_oppskrifter')).toBe(false);
    expect(saveInnstillingerKall.length).toBe(0);
  });
});
