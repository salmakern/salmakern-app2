// Sammenligner kolonnene på public.ordrer i den ekte databasen med øyeblikksbildet test/fixtures/ordrer-kolonner.json,
// som test/ordre-uventet-radform.test.js bygger «ordre slik databasen lager den» fra. Skrivebeskyttet (kun SELECT mot
// information_schema). Avvik = databasen har endret seg (ny kolonne, annen default, nullable) uten at testen er sett over:
// kjør `npm run sjekk-kolonner -- --skriv` for å oppdatere øyeblikksbildet, og deretter `npm test` (ordre-uventet-radform
// vil da vise om en visning ikke tåler den nye formen). Bakgrunn: 2026-11-02, en ny ordre med vekter = {} tok ned Ordre-lista.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const rot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureSti = join(rot, 'test/fixtures/ordrer-kolonner.json');
const skriv = process.argv.includes('--skriv');

const sql = `select column_name, data_type, udt_name, column_default, is_nullable
from information_schema.columns where table_schema='public' and table_name='ordrer' order by ordinal_position;`;
const sqlFil = join(mkdtempSync(join(tmpdir(), 'ordrer-kol-')), 'q.sql');
writeFileSync(sqlFil, sql);

let ut;
try {
  ut = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', 'qoqpenbfdxeduylxirwk', '--read-only', '--file', sqlFil],
    { cwd: rot, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 10_000_000 });
} catch (e) {
  console.error('Kunne ikke lese databasen (er supabase-CLI innlogget?):', e.message.split('\n')[0]);
  process.exit(2);
}
const json = JSON.parse(ut.slice(ut.indexOf('{'), ut.lastIndexOf('}') + 1));
const live = json.rows.map((r) => ({ kolonne: r.column_name, type: r.data_type, udt: r.udt_name, default: r.column_default, nullable: r.is_nullable === 'YES' }));

if (skriv) {
  const dato = new Date().toISOString().slice(0, 10);
  writeFileSync(fixtureSti, JSON.stringify({ hentet: dato, kilde: 'information_schema.columns for public.ordrer (read-only)', kolonner: live }, null, 1) + '\n');
  console.log(`Oppdatert ${fixtureSti} (${live.length} kolonner). Kjør nå npm test.`);
  process.exit(0);
}

const fasit = JSON.parse(readFileSync(fixtureSti, 'utf8')).kolonner;
const kart = (l) => new Map(l.map((k) => [k.kolonne, k]));
const a = kart(fasit); const b = kart(live);
const avvik = [];
for (const [navn, k] of b) {
  if (!a.has(navn)) { avvik.push(`NY kolonne i databasen: ${navn} (${k.type}, default ${k.default}, nullable ${k.nullable})`); continue; }
  const f = a.get(navn);
  for (const felt of ['type', 'default', 'nullable']) {
    if (f[felt] !== k[felt]) avvik.push(`ENDRET ${navn}.${felt}: ${JSON.stringify(f[felt])} -> ${JSON.stringify(k[felt])}`);
  }
}
for (const navn of a.keys()) if (!b.has(navn)) avvik.push(`KOLONNE FJERNET fra databasen: ${navn}`);

if (avvik.length) {
  console.log(`AVVIK (${avvik.length}) mellom databasen og test/fixtures/ordrer-kolonner.json:`);
  avvik.forEach((x) => console.log(' - ' + x));
  console.log('Kjør `npm run sjekk-kolonner -- --skriv` og deretter `npm test`.');
  process.exit(1);
}
console.log(`OK: ${live.length} kolonner på ordrer er identiske med øyeblikksbildet.`);
