import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Edge-funksjonene krever den innloggede ansattes token (se edgeFetch() i js/core.js). Et kall
// som går rett via fetch() med bare den offentlige nøkkelen ville slutte å virke når håndhevingen
// slås på - og lett glippe forbi i en ny funksjon. Denne testen feiler derfor hvis noen js/*.js
// nevner /functions/v1/ (eller bruker supabase-js sin functions.invoke) utenom selve edgeFetch.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsDir = path.resolve(__dirname, '../js');
const filer = readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();
const les = (f) => readFileSync(path.join(jsDir, f), 'utf8').replace(/\r\n/g, '\n');

// Selve edgeFetch-funksjonen i core.js, fra «async function edgeFetch» til neste funksjon på toppnivå.
function edgeFetchKropp(kilde) {
  const start = kilde.indexOf('async function edgeFetch(');
  if (start < 0) return '';
  const slutt = kilde.indexOf('\n}\n', start);
  return kilde.slice(start, slutt + 3);
}

describe('alle kall til edge-funksjonene går via edgeFetch()', () => {
  it('edgeFetch finnes i core.js og er stedet som bygger /functions/v1/-adressen', () => {
    const kropp = edgeFetchKropp(les('core.js'));
    expect(kropp).toContain('/functions/v1/');
    expect(kropp).toContain("headers.set('Authorization', 'Bearer ' + token)");
  });

  it.each(filer)('%s: ingen direkte /functions/v1/-kall eller functions.invoke utenfor edgeFetch', (fil) => {
    let kilde = les(fil);
    if (fil === 'core.js') kilde = kilde.replace(edgeFetchKropp(kilde), '');
    // Kommentarer får nevne stien (forklaringer) - kun kode teller. Fjerner //-linjer og /* */-blokker.
    const kode = kilde.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    const treff = kode.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => /functions\/v1|functions\.invoke|\.functions\b/.test(l));
    expect(treff, `${fil} kaller en edge-funksjon uten edgeFetch():\n` + treff.map(t => `  linje ca. ${t.i}: ${t.l.trim()}`).join('\n')).toEqual([]);
  });

  it('salmakern.html har ingen egne skript som kaller edge-funksjoner', () => {
    const html = readFileSync(path.resolve(__dirname, '../salmakern.html'), 'utf8');
    expect(html).not.toMatch(/functions\/v1|functions\.invoke/);
  });
});
