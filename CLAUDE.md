# Salmakern-appen

## Feilsøkingsnotat: "ingenting fungerer" på én spesifikk brukers PC (2026-08-24)

En bruker rapporterte at Admin-ark sluttet å fungere (skriving/dra-og-slipp virket, men
data nådde aldri ordre/kalender) - reproduserbart IKKE på noen andre enheter, ikke i noen
annen nettleser, kun på denne ene PC-en med Edge. Etter lang feilsøking var den faktiske
årsaken en KOMBINASJON av:

1. **Edge sin "Tracking Prevention" blokkerte lagringstilgang for salmakern-siden selv**
   (ikke en ekstern tjeneste - siden sin EGEN adresse dukket opp i konsollvarselet). Dette
   kan stille ødelegge Supabase Auth-sesjonens vedvarenhet og annen lagringsavhengig logikk
   uten noen synlig feilmelding i konsollen.
2. En ekte bug i `sw.js` (`res.clone()` kalt asynkront i stedet for synkront - se git-
   historikk for fiksen) som kastet "Response body is already used" i konsollen.
3. Potensielt korrupt/utdatert `localStorage`-innhold spesifikt for den nettleseren.

Løsningen som til slutt fungerte var å gjøre ALLE tre samtidig: skru sporingsforebygging
til "Grunnleggende" i `edge://settings/privacy`, avregistrere service workeren via
DevTools → Application → Service Workers → Unregister, og kjøre `localStorage.clear()` i
konsollen - etterfulgt av en fullstendig omlasting og ny innlogging. Ingen av de tre alene
ble bekreftet tilstrekkelig - de ble gjort sammen, så det er uklart hvilken som faktisk var
avgjørende. Skjer dette igjen: prøv denne kombinasjonen FØR du antar det er en kodebug -
spesielt hvis feilen kun rammer én bruker/enhet og alt fungerer normalt for andre.

Internt PWA-verktøy for Telemark Salmakerverksted: ordrehåndtering, timeregistrering/lønn,
lager, admin-ark og mer. Ren HTML/CSS/JS - ingen byggesteg, ingen rammeverk. Backend er
Supabase (Postgres + Auth + Storage + Realtime + Edge Functions). Deployes til GitHub Pages.

## Arkitektur

`salmakern.html` laster 11 script-tagger fra `js/` i denne rekkefølgen:

```
core.js → oversikt-kalender.js → ordre-detalj.js → ordre-diverse.js → timer.js →
arkiv-mer.js → ansatte-utstyr.js → eksport-varsler.js → flate.js → lager.js → admin-ark.js
```

**Alt deler globalt scope.** Det finnes ingen moduler/import-export - `S` (hele appens
tilstand), `me` (innlogget ansatt), `db` (Supabase-klient), og delte hjelpefunksjoner som
`esc()`, `ordreLabel()`, `samsvarerChassis()`, `visToast()` er globale, definert i én fil og
brukt fritt i alle andre. Rekkefølgen over spiller mindre rolle enn den ser ut som, siden
nesten alt kalles fra event-handlere/render-kall som først kjører etter at alle scriptene er
lastet - men vær obs på dette hvis du legger til kode som kjører på toppnivå (utenfor en
funksjon), som f.eks. de to lytterne i admin-ark.js linje 21 og 326.

## Etablerte mønstre (les dette før du endrer noe)

**Escaping**: ALL fritekst en ansatt skriver inn (kundenavn, merknader, meldinger,
kategorinavn, osv.) skal gjennom `esc()` (definert i `ordre-detalj.js`) før den settes i
`innerHTML`. Verdier som også brukes inni en `onclick="funksjon('...')"`-attributt trenger
BEGGE deler: `esc(verdi).replace(/'/g,"\\'")` - én for HTML-attributt-konteksten, én for
JS-streng-konteksten inni den. Se `js/lager.js` (`visKategoriDetalj`) for eksempel.

**Batch-skriving til Supabase**: ALDRI ett databasekall per rad i en løkke - det har vist
seg upålitelig i praksis (noen kall forsvinner stille ved mange samtidige enkeltkall). Samle
endringer i en liste/objekt under løkken, send ÉN `upsert`/`insert`/`delete(.in())` etter.
Se `flyttVare()` i `lager.js` for det opprinnelige mønsteret, og `lagerBatchNy()`/
`lagerBatchFlush()` for en gjenbrukbar variant.

**Sanntid (Realtime) og egen-echo**: `subscribeRealtime()` i `core.js` abonnerer på
`postgres_changes` for alle tabeller. Uten unntak ville hver lokal lagring trigge en
UPDATE-event tilbake til seg selv med en gang, som re-rendrer hele siden ("føles som en
reload"). Mønsteret: rett før et lagre-kall, marker raden i et ignorer-Set
(`ignorerRealtimeFor`/`ignorerRealtimeAdminArk`/etc., eller et enkelt boolsk flagg for
enkeltrad-tabeller som `innstillinger`), fjern markeringen igjen etter 10 sek via
`setTimeout`. Realtime-handleren sjekker dette settet/flagget og hopper over UPDATE-er den
selv forårsaket. **Ny tabell som trenger sanntid → husk denne markeringen**, ellers er du
tilbake til "siden refresher seg selv"-bugen.

**Chassis-sammenligning**: bruk alltid `samsvarerChassis(a, b)` (case-uavhengig + trim), ikke
`===` direkte - chassisnummer kan skrives inn med ulik store/små bokstaver flere steder i
appen (Admin-ark, ordre, flåte).

**PIN-innlogging**: ingen passord, kun 4-sifret PIN sjekket server-side via
`logg_inn_med_pin`/`login_med_pin` (Postgres-funksjoner, se `supabase/migrations/`). PIN-er
lastes ALDRI ned til nettleseren. Rate-limited siden 2026-08-24 (5 feil forsøk → 10 min
lockout per anonym Auth-sesjon, se `20260824000000_pin_rate_limiting_og_search_path.sql`).

## PDF-eksport

`genPDF()` i `eksport-varsler.js` bygger en rik HTML/CSS-mal (logo, tabeller, bildegallerier,
godkjenningsmerker) og bruker nettleserens print-til-PDF-dialog - fungerer på alle vanlige
nettlesere, men litt klønete på iOS Safari spesifikt (noen flere trykk enn en direkte
nedlasting). Ekte SERVER-side PDF-generering (Supabase Edge Function) ble vurdert, men Deno-
runtimen har ingen HTML/CSS-rendering tilgjengelig - kun lavnivå-biblioteker som `pdf-lib`
(tegner tekst/linjer på x/y-koordinater, ingen automatisk layout). Å bruke det ville betydd å
bygge HELE PDF-malen på nytt i en helt annen, mye mer arbeidskrevende API, med reell risiko for
visuelle avvik i et dokument som brukes forretningsmessig - og vedlikeholde layouten to steder
fremover. Eneste reelle "ordentlig HTML-til-PDF"-vei er en betalt tredjeparts-API, som krever
en kontoopprettelse (samme begrensning som Sentry under). Vurdert og bevisst latt være - print-
til-PDF-løsningen som allerede er på plass fungerer, bare ikke like elegant på alle enheter.

## Feilovervåking

Sentry-integrasjonen (`initFeilovervaking()` i `core.js`) er ferdig koblet opp, men står av
til en DSN er satt - null ekstra nettverkskall/kostnad frem til da. For å skru på:

1. Opprett en gratis konto på [sentry.io](https://sentry.io)
2. Nytt prosjekt → velg plattform "Browser" (rent JavaScript, ikke React/Vue/etc.)
3. Kopier DSN-en (ser ut som `https://xxxx@xxxx.ingest.sentry.io/xxxx`)
4. Lim den inn som verdien til `SENTRY_DSN` øverst i `js/core.js`

Etter det fanges JS-feil og avviste Promises automatisk og dukker opp i Sentry sitt
dashbord - inkludert mislykkede lagringer som i dag bare logges til `console.error` og er
usynlige med mindre noen tilfeldigvis har utviklerverktøy åpne.

## Database

Se [`supabase/README.md`](supabase/README.md) for migrasjonskonvensjon, nyttige
`supabase`-CLI-kommandoer (advisors, migration list/repair, backups), og backup-status.

Kort versjon: nye skjemaendringer → ny fil i `supabase/migrations/`, kjør med
`npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file <fil>` (ikke
`db push` - krever Docker, som ikke er tilgjengelig i dette utviklingsmiljøet).

## Testing

```bash
npm install        # én gang
npm run check       # node --check på alle js/*.js - fanger syntaksfeil
npm test            # Vitest - se test/
npm run lint         # ESLint (bevisst begrenset - se eslint.config.js)
```

CI (`.github/workflows/ci.yml`) kjører alle tre på hver push/PR mot `main`.

Testene i `test/` laster enkeltfunksjoner fra `js/*.js` inn i en isolert Node `vm`-context
(`test/helpers/load-script.js`) - samme grunnprinsipp som manuell iframe-injeksjonstesting i
nettleseren, bare i Node. De fleste funksjoner er trygge å laste slik; noen (som
`admin-ark.js`) har kode på toppnivå som trenger minimale `window`/`document`-stubber (se
`test/sikkerhet-og-matching.test.js` for eksempel).

Testdekningen er bevisst smal: de stedene penger og riktighet er involvert (lønn/overtid,
XSS-escaping, chassis-matching, offline-køen for mislykkede lagringer), ikke et forsøk på å
dekke hele appen.

**Node `vm`-særtrekk å huske på**: `let`/`const` deklarert på toppnivå i en fil som kjøres med
`vm.runInContext()` blir IKKE synlige som egenskaper på sandbox-objektet etterpå (`S`, `db`,
`me`, `offlineKo` er alle sånn i `core.js`) - kun `function`-deklarasjoner (og `var`) blir det.
Løsningen (brukt i `test/offline-ko.test.js`): kjør en liten ekstra `vm.runInContext(...)` i
SAMME context rett etter kildefilen, med hjelpe-funksjoner som `function _getS(){return S;}` -
de deler toppnivå-scope med første kjøring og kan derfor lese/skrive de "usynlige" bindingene.

## Kjente begrensninger i dette utviklingsmiljøet

- Ingen Docker → `supabase db pull`/`db dump`/`db push` fungerer ikke. Bruk
  `supabase db query --file` i stedet (se `supabase/README.md`).
- `window.open()` returnerer alltid `null` i det AI-agent-styrte nettleserverktøyet som er
  brukt til testing her, selv ved et ekte simulert klikk - ikke en reell bug, bare en
  begrensning i selve testverktøyet (popup-blokkering). PDF-utskrift (`genPDF` i
  `eksport-varsler.js`) må derfor bekreftes manuelt av en ekte bruker i en ekte nettleser.
- Samme verktøy har vist seg å cache `<script src>`-lastede JS-filer aggressivt på tvers av
  "ferske" faner selv etter Service Worker- og CacheStorage-tømming - `fetch()` med
  `cache:'no-store'` og en cache-buster-query fungerer pålitelig for å hente fersk kildekode
  til inspeksjon, men å faktisk kjøre den ferske versjonen i en levende side har vært upålitelig.
  Stol på isolerte Node-tester (`npm test`) for logikkverifisering fremfor å jage denne
  cachen videre.
