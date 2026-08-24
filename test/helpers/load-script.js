// js/*.js er vanlige <script>-tagger uten moduler - alt er globale function-
// deklarasjoner. For å kunne enhetsteste rene funksjoner uten å bygge om hele
// appen til ES-moduler, laster denne hjelperen en kildefil inn i en isolert
// vm-context og gir testen tilgang til alt som ble deklarert der (samme
// grunnprinsipp som iframe-injeksjonen som ble brukt for manuell testing
// under selve utviklingen - bare i Node i stedet for nettleseren).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsDir = path.resolve(__dirname, '../../js');

export function loadScript(filnavn, ekstraGlobals = {}) {
  const kode = readFileSync(path.join(jsDir, filnavn), 'utf8');
  const sandbox = {
    console,
    Math, Date, JSON, Array, Object, String, Number, Boolean,
    Set, Map, Promise, RegExp,
    ...ekstraGlobals
  };
  vm.createContext(sandbox);
  vm.runInContext(kode, sandbox, { filename: filnavn });
  return sandbox;
}
