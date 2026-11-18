import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Natt-QA-en (salmakern-booking-daglig-qa, punkt 20a) kjører PIN-innloggingstesten med --yes mot den ekte databasen.
// Tillatelsesregelen er låst til NØYAKTIG fila supabase/tester/natt/pin_innlogging_NATT.sql, så natt-kjøringen aldri
// kan kjøre en annen, skrivende fil. Denne testen holder fila lik selve testfila (pakket i begin/rollback), så den ikke
// blir utdatert når testfila endres, og så ingen kan legge en ekte skriving inn i den uten at npm test feiler.
// Endret testfila? Lag NATT-fila på nytt: «begin;», hele innholdet, en tom linje og «rollback;».

const rot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const les = (rel) => readFileSync(path.join(rot, rel), 'utf8').replace(/\r\n/g, '\n');

describe('natt-QA: PIN-innloggingstesten (punkt 20a)', () => {
  const natt = les('supabase/tester/natt/pin_innlogging_NATT.sql');
  const body = les('supabase/tester/ansatte_beskytt_skriving_innlogging_TEST_body.sql');

  it('er nøyaktig begin; + testfila + rollback;', () => {
    expect(natt).toBe('begin;\n' + body + '\nrollback;\n');
  });

  it('har ingen commit som kunne gjort skrivingen varig', () => {
    expect(natt).not.toMatch(/\bcommit\b/i);
  });
});
