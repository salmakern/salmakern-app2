// Cross-plattform erstatning for en bash-for-løkke (npm sitt "run"-kommando
// bruker cmd.exe som shell på Windows uansett hvilken terminal du startet fra,
// så en bash-for-løkke i package.json sin "check"-kommando feiler lokalt for
// alle på Windows selv fra Git Bash).
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const filer = readdirSync('js').filter(f => f.endsWith('.js')).sort();
let feil = false;

for (const f of filer) {
  const sti = `js/${f}`;
  try {
    execFileSync(process.execPath, ['--check', sti], { stdio: 'inherit' });
    console.log(`OK  ${sti}`);
  } catch {
    feil = true;
  }
}

if (feil) {
  console.error('\nSyntaksfeil funnet - se over.');
  process.exit(1);
}
console.log(`\nAlle ${filer.length} filer OK.`);
