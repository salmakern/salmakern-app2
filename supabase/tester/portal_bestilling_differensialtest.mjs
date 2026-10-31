// Differensialtest: edge-funksjonens validering (supabase/functions/portal-bestilling/logikk.ts) mot Postgres-funksjonens validering
// (portal_koble_bestilling, steg 1). Egenskapen som skal holde: det edge-funksjonen slipper gjennom, godtar Postgres også (edge ⊆ Postgres).
// Motsatt vei (edge strengere enn Postgres, f.eks. Unicode-mellomrom) er bevisst og trygg: portalen sender allerede normaliserte verdier.
// Kjør fra rotmappen (Node 22.6+ med --experimental-strip-types) hver gang valideringen i ENTEN logikk.ts ELLER SQL-funksjonen endres:
//   1) node --experimental-strip-types supabase/tester/portal_bestilling_differensialtest.mjs gen <utmappe>        (skriver cases.json og diff.sql)
//   2) npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file <utmappe>/diff.sql > <utmappe>/diff_ut.json
//      (diff.sql ligger i begin ... rollback: ingenting blir stående; fjern «Initialising login role...» øverst i diff_ut.json hvis den står der)
//   3) node --experimental-strip-types supabase/tester/portal_bestilling_differensialtest.mjs sammenlign <utmappe>   (skriver avvik; «edge godtar» + SQL avviser = FEIL)
// Sist kjørt 2026-10-30: 356 tilfeller, 305 like, 51 avvik som alle er «edge avviser / Postgres godtar» (Unicode-mellomrom, ß/ı i serienummer), 0 i motsatt retning.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseInnkommende } from '../functions/portal-bestilling/logikk.ts'
import path from 'node:path';

const mode = process.argv[2]
const ut = process.argv[3] || '.'
const f = (n) => path.join(ut, n);
const base = { bestilling_id: 'cm9testbestilling0001', nr: 'B-2026-0001', ident_type: 'CHASSIS', ident: 'TESTWXYZ000000001' };
const CH = 'TESTWXYZ000000001';

const ws = [' ', '﻿', '\t', '\u000b', '\u000c', ' ', '　', '\u0085', '​', ' ', '\n', '\r', ' ', ' ', '᠎', ' '];
const cases = [];
const add = (felt, verdi, ekstra = {}) => cases.push({ felt, obj: { ...base, ...ekstra, [felt]: verdi } });

// ident (CHASSIS)
for (const w of ws) { add('ident', w + CH); add('ident', CH + w); add('ident', CH.slice(0, 8) + w + CH.slice(8)); add('ident', CH.slice(0, 8) + w + '-' + CH.slice(8)); }
for (const c of ['I', 'O', 'Q', 'i', 'o', 'q', 'А', 'Ａ', '٣', 'ı', 'İ', 'ß', 'é', 'Ø', '0', '9', 'Z', 'z', '-', '_', '.', '/', "'", ';', '<', '́']) {
  add('ident', CH.slice(0, 16) + c); add('ident', c + CH.slice(1)); add('ident', CH.slice(0, 5) + c + CH.slice(6));
}
for (const n of [0, 1, 15, 16, 17, 18, 19, 40]) add('ident', 'A1'.repeat(30).slice(0, n));
for (const v of ['testwxyz000000001', 'TestWxyz000000001', 'TESTWXYZ-0000-00001', 'TEST WXYZ 0000 00001', '  TESTWXYZ000000001  ', '']) add('ident', v);
// ident (SERIENUMMER)
// (BESTILLINGSNR har samme regler som SERIENUMMER, så begge typene kjøres gjennom de samme tilfellene)
for (const S of [{ ident_type: 'SERIENUMMER' }, { ident_type: 'BESTILLINGSNR' }]) {
for (const w of ws) { add('ident', w + 'AB-123' + w, S); add('ident', 'AB' + w + 'CD', S); add('ident', 'AB' + w + w + 'CD', S); }
for (const c of ['.', '_', '/', ' ', '-', ',', ':', ';', '#', '<', '>', '"', "'", '\\', '&', '%', '(', ')', 'æ', 'Ø', 'é', 'ß', 'ı', '٣', 'А', 'Ａ', '́', '\u0000x'.slice(1)]) add('ident', 'AB' + c + 'CD', S);
for (const n of [0, 1, 2, 3, 4, 39, 40, 41, 60]) add('ident', 'A'.repeat(n), S);
for (const v of ['   ', 'a b', '  a  ', 'ab', 'a b c d e', '-', '---', '...', '   ab   ', '  a-b  ']) add('ident', v, S);
}
// bestilling_id
for (const w of ws) { add('bestilling_id', w + 'cm9testbestilling0001'); add('bestilling_id', 'cm9testbestilling0001' + w); add('bestilling_id', 'cm9test' + w + 'bestilling0001'); }
for (const n of [0, 1, 7, 8, 9, 63, 64, 65]) add('bestilling_id', 'a1'.repeat(40).slice(0, n));
for (const c of ['-', '_', '.', '/', ' ', '$', 'é', 'Ø', 'А', 'Ａ', '٣', "'", ';', '%', '́']) add('bestilling_id', 'cm9test' + c + 'bestilling');
// nr
for (const v of ['', ' ', '#', '###', '-', '---', 'é', 'B 2026 0001', 'B-2026-0001', 'b-2026-0001', '٣٣٣', 'Ａ', '<b>', 'x'.repeat(30), 'x'.repeat(31), 'x'.repeat(40), '\n', '\t1']) add('nr', v);
// ident_type
for (const v of ['CHASSIS', 'chassis', 'Chassis', 'SERIENUMMER', 'serienummer', 'BESTILLINGSNR', 'bestillingsnr', 'Bestillingsnr', ' BESTILLINGSNR', 'BESTILLINGSNR ', 'VIN', '', ' CHASSIS', 'CHASSIS ', 'CHASSIS\n', 'CHASSIS ', 'KJØRETØY']) add('ident_type', v);
// manglende felt
for (const f of ['bestilling_id', 'nr', 'ident_type', 'ident']) { const o = { ...base }; delete o[f]; cases.push({ felt: 'mangler_' + f, obj: o }); }

const unike = cases.map((c, i) => {
  const o = { ...c.obj };
  if (c.felt !== 'bestilling_id' && o.bestilling_id === base.bestilling_id) o.bestilling_id = 'cm9diff' + String(i).padStart(5, '0');
  return { ...c, obj: o };
});

if (mode === 'gen') {
  writeFileSync(f('cases.json'), JSON.stringify(unike));
  let sql = 'begin;\ncreate temp table _d(n int, res text);\ndo $t$ begin\n';
  unike.forEach((c, i) => {
    const j = JSON.stringify(c.obj);
    if (j.includes('$j$')) throw new Error('dollar-tag i data');
    sql += `begin perform public.portal_koble_bestilling($j$${j}$j$::jsonb); insert into _d values (${i}, 'ok'); exception when others then insert into _d values (${i}, left(sqlerrm, 80)); end;\n`;
  });
  sql += 'end $t$;\nselect n, res from _d order by n;\nrollback;\n';
  writeFileSync(f('diff.sql'), sql);
  console.log('tilfeller:', unike.length);
} else {
  const svarJson = JSON.parse(readFileSync(f('diff_ut.json'), 'utf8').replace(/^[^{]*/, ''));
  const sqlRader = new Map(svarJson.rows.map((r) => [r.n, r.res]));
  const avvik = [];
  let like = 0;
  unike.forEach((c, i) => {
    const e = parseInnkommende(c.obj);
    const s = sqlRader.get(i);
    const edgeOk = e.ok;
    const sqlOk = s === 'ok';
    if (edgeOk === sqlOk) { like++; return; }
    avvik.push({ i, felt: c.felt, edge: edgeOk ? 'godtar' : 'avviser (' + e.felt + ')', sql: s, verdi: JSON.stringify(c.obj[c.felt.replace('mangler_', '')] ?? null) });
  });
  const farlige = avvik.filter((a) => a.edge === 'godtar');
  console.log('like:', like, 'avvik:', avvik.length, 'av', unike.length, '| FARLIGE (edge godtar, Postgres avviser):', farlige.length);
  for (const a of farlige) console.log('FEIL', JSON.stringify(a));
  if (farlige.length) process.exitCode = 1;
}
