// Bevisst begrenset oppsett: js/*.js er 11 filer som deler globalt scope via
// vanlige <script>-tagger (ingen moduler, ingen byggesteg) - S, me, db, esc(),
// ordreLabel() osv. er alle definert i én fil og brukt i andre. Å skru på
// no-undef/no-unused-vars uten å liste opp alle disse globalene ville gitt
// hundrevis av falske positiver, så de er bevisst av. Reglene som er på
// fanger ekte feil (dupliserte nøkler, uendelige typos, utilgjengelig kode)
// uten den kostnaden.
export default [
  {
    files: ['js/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        console: 'readonly', localStorage: 'readonly', fetch: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
        URL: 'readonly', Image: 'readonly', FileReader: 'readonly',
        Blob: 'readonly', FormData: 'readonly', Notification: 'readonly',
        requestAnimationFrame: 'readonly'
      }
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],

      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-const-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-obj-calls': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-self-compare': 'error',
      'no-self-assign': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-irregular-whitespace': 'error',
      'no-sparse-arrays': 'error',
      'no-this-before-super': 'error',
      'no-class-assign': 'error',
      'no-setter-return': 'error',
      'no-async-promise-executor': 'error',
      'no-misleading-character-class': 'error',
      'no-loss-of-precision': 'error',
      'no-invalid-regexp': 'error'
    }
  }
];
