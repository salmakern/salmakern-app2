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

**Kall til edge-funksjoner og utlogging (2026-10-29)**: ALLE kall til `/functions/v1/` (fiken-fakturer,
send-frakt-epost, vegvesen-oppslag, send-push) går via `edgeFetch(funksjon, init)` i `core.js` - aldri en
direkte `fetch()` (vokter: `test/ingen-direkte-edge-kall.test.js`). Den sender den innloggede ansattes
access-token som `Authorization` og `SUPA_KEY` som `apikey`, og ved 401 fornyes sesjonen og kallet prøves
ÉN gang til. Serversiden: fiken-fakturer, send-frakt-epost, vegvesen-oppslag og send-push verifiserer token-et mot
`current_ansatt()` (foreløpig i MYK modus: logger `edge_auth`, blokkerer ikke, til `EDGE_AUTH_ENFORCE` slås på; send-push
godtar i tillegg service_role-nøkkelen som server-kall, og cron-jobbene for påminnelsene er flyttet til den (fra Vault, 31.10);
håndheving slås på først når loggene viser via=ansatt/server - se `supabase/README.md`, «send-push: innloggingssjekk»). `doLogout()` avslutter nå Auth-
sesjonen på ekte: først `logg_ut()` (migrasjon `20261029150000`, nuller ansatt_id/rolle/session_token
KUN på denne enhetens Auth-bruker, aldri `ansatte`-raden), så `auth.signOut({scope:'local'})`. En ny
anonym sesjon startes først når PIN tastes (`sikreAnonymSesjon()` i `tryLogin`, bevisst ikke ved
utlogging, for å spare Supabase sin grense for anonyme innlogginger per IP). Mislykkede lagringer i
offline-køen får en siste sjanse før utlogging, og en vanlig utlogging spør hvis noe fortsatt venter
(ellers erstattes S av databasen ved neste innlogging). Kjent begrensning: et access-token som allerede
er utstedt gjelder ut sin levetid (maks 1 time) etter utlogging. `CACHE` i `sw.js` ble bumpet til v13 i
samme commit, så åpne PWA-er henter den nye koden.

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

## Bestillinger fra Forhandlerportalen («Bestill», fase 2, 2026-10-30)

Forhandlerportalens Bestill-knapp (se portalens CLAUDE.md, «Bestill») sender en bestilling med chassis.nr, serienummer eller forhandlerens eget bestillingsnummer (BESTILLINGSNR, 2026-10-31: løs rad i Admin-ark med nummeret i Serienummer-kolonnen, merknaden «Fra portalen <nr> (bestillingsnr fra forhandler)»). Her lander den slik (Henriks avgjørelser: Salmaker'n/Kontakter er
fasit; chassis.nr gir automatisk ordre «På vei» merket «ikke bekreftet», ansatte bekrefter etterpå; serienummer gir en løs rad i Admin-ark; «Bestill frakt» og Admin-arkets e-poster røres ikke).
Hele kjeden og begrunnelsene står i `supabase/README.md` («Bestillinger fra Forhandlerportalen»); her det du må vite når du rører appen:

- **Tre lag i databasen**: tabellene `portal_bestillinger` (ett utfall per bestilling, bare admin leser) og `portal_modell_kobling` (portalens modell til appens merke/modell, 14 rader godkjent av Henrik 2026-10-30)
  samt tre kolonner på `ordrer` (`portal_bestilling_id`, `portal_bekreftet_at`, `portal_bekreftet_av`); Postgres-funksjonen `portal_koble_bestilling` (kun service_role) som lager/kobler ordren; edge-funksjonen
  `portal-bestilling` (egen hemmelighet) som er døra inn; og RPC-ene `portal_bekreft_ordre` / `portal_avvis_ordre` som appen kaller. **Portalen sender ennå ingenting** (slås på i portalen, G11): uten portal-ordre er alt
  nedenfor usynlig i appen.
- **`portal_*`-kolonnene LESES av `dbToOrdre` men skrives ALDRI av `ordreToDb`/`save()`** (vokter: `test/portal-ordre-visning.test.js`). Da kan en ansatt som lagrer et annet felt aldri nullstille bekreftelsen.
  Skriv aldri disse kolonnene fra klienten; bruk RPC-ene.
- **Visning (G5)**: `portalBadgeHTML(o)` (core.js): amber «PORTAL · IKKE BEKREFTET» før bekreftelse og blå «PORTAL» etter, på Ordre-lista og begge Oversikt-listene (i ordredetaljen vises bare kort «PORTAL» i fargen,
  `portalBadgeHTML(o, true)`, så chassis.nr ikke presses på små telefoner; banneret sier «ikke bekreftet») (ikke på ukekalenderens
  kort, og ikke på vanlige ordre som en portal-bestilling bare er koblet til). Filteret `Fra portal, ikke bekreftet (N)` i `#ordreStatusFilter` (verdi `portal_ubekreftet`; N oppdateres i `renderOrdreList`).
  `sw.js` CACHE ble bumpet til v15; bump den igjen ved hver appendring.
- **Bekreft / Avvis (G6)** (seksjonen nederst i `js/ordre-diverse.js`, banner i ordredetaljen): Alle ansatte kan trykke **Bekreft** (setter bekreftet-tidspunkt og -navn, skriver én logglinje, kjører `autoVelgUtstyrMal`
  siden ordren ikke ble opprettet av appen; `autoVelgUtstyrMal` og hjelperne `oppdaterSkalHaForOppskrift`/`oppdaterFikenLinjeForOppskrift` tar nå en valgfri `ordreId`, siden Bekreft kjører etter en await og
  brukeren kan ha gått til en annen ordre). Bare **admin og godkjenner** ser **Avvis og slett**, og RPC-en sletter bare en URØRT, ubekreftet portal-ordre (fortsatt «På vei», uten flåte/kalender/ankomstdato/
  bilder/timer/signatur/Fiken-linjer/lagerbruk/godkjenning, uten utfylt utstyr/vekter/ombygging/drivstoff/regnr/farge/notater, og med bare opprettelseslinjen i loggen; en NULL gir «ikke urørt»); ellers `IKKE_URORT` og
  en administrator sletter den som vanlig ordre («Slett ordre»). **Dette er et sikkerhetsnett mot misforståelser i appen, ikke en grense mot en ansatt som går forbi appen**: RLS på `ordrer` (`krever_innlogget_ansatt`,
  FOR ALL) lar alle innloggede ansatte slette og endre ordrer direkte, for alle ordrer (fantes før portalen). En avvist bestilling står igjen som «avvist» i `portal_bestillinger` (gravstein): et nytt kall fra
  portalen gjenskaper aldri ordren; en bekreftet bestilling svarer fortsatt `ok` ved nytt kall. Klienten legger ordre-id i `ignorerRealtimeFor` før Bekreft (eget Realtime-ekko), og en handling mens en annen pågår gir en beskjed.
- **Banneret advarer** hvis ordrens kontaktperson (`eier`) mangler eller ikke har e-post i Kontakter: Admin-ark finner e-postmottakere på NAVN (`adminArkFinnKontaktEpost`), og koblingsfunksjonen lar derfor selgerens
  navn stå som kontaktperson bare når det ikke tilhører noen annen kontakt/kontaktperson (ellers tom). Merk at appen ellers slår opp e-post på navn på tvers av alle forhandlere.
- **Test**: SQL-testene (`supabase/tester/*_TEST_body.sql`) kjøres ALLTID i en transaksjon som rulles tilbake (kjøring står øverst i filene). Nettlesertest: lokal server (`python -m http.server 8099` i rotmappen) + headless
  Edge mot den ekte databasen med TEST-ansatte (id 990001/990002, `ansatte` + `ansatte_pin`, tilfeldig ledig PIN) og TEST-bestillinger (chassis `TESTWXYZ0000000xx`, lagd med `portal_koble_bestilling`), alt slettet etterpå.
  Merk: nye ansatte-/ordre-rader vises i sanntid for ansatte som har appen åpen, så gjør det utenom arbeidstid og rydd straks.
- **«Bestilt frakt»-valget i ordrefilteret** (`salmakern.html`, `bestilt_frakt`) matchet ingenting før 2026-10-30 (filteret sammenlignet bare `ordreStatus`, og «Bestilt frakt» sluttet å være en status 30.9). Nå filtrerer det på `erBestiltFraktAktiv(o)` (core.js: `bestiltFrakt` og ikke `hentet`, samme regel som lilla merke/kantlinje); vokter: `test/sorter-ordre-bestilt-frakt.test.js`. Push-varsel til administratorer når en ny
  portal-bestilling kommer er bygget (G9, i edge-funksjonen `portal-bestilling`; se `supabase/README.md`: test aldri mot den utrullede funksjonen uten Henriks ja, det sender ekte varsler), og avklaringer (`venter_*`/`avklaring_*` i `portal_bestillinger`) har ingen visning ennå (G8): Claude utfører dem via SQL på Henriks ord.

## Daglig automatisk QA-gjennomgang

En planlagt oppgave (`salmakern-booking-daglig-qa`, kl. 04:00 hver natt) gjør en full
gjennomgang av hele appen og rapporterer status til Henrik om morgenen - se
`C:\Users\GroAnitaMartinsen\.claude\scheduled-tasks\salmakern-booking-daglig-qa\SKILL.md`
for den fulle sjekklisten. Oppgaven kan ikke logge inn (PIN alltid blokkert i ubetjente
økter), så den dekker Ordre/Timer/Kalender/Lager/Ansatte/Admin-ark/Eksport med statisk
kodegjennomgang i stedet for en ekte brukerflyt når den kjører ubetjent. Holdes i takt med
endringer i appen - se "Arbeidsvaner" i nettside-delen av denne filen for selve regelen.

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

---

# nettside/ — den offentlige markedsføringssiden (salmaker.as)

**Viktig grensesnitt**: dette repoet inneholder BÅDE det interne bestillings-/admin-verktøyet
beskrevet over (`salmakern.html`, PIN-beskyttet) OG den offentlige markedsføringssiden
(`nettside/`, ren HTML/CSS/JS, ingen auth). **Rør aldri `salmakern.html` eller noe under det
i forbindelse med `nettside/`-arbeid** - det er et bevisst skille av sikkerhetshensyn (unngå å
eksponere det interne verktøyet for PIN-gjetting via lenker fra den offentlige siden).

- Live: https://salmaker.as, servert via GitHub Pages fra dette repoet
  (`https://salmakern.github.io/salmakern-app2/nettside/...` er den faktiske GH Pages-stien -
  husk `/nettside/`-prefikset når du sjekker noe direkte med curl, rot-`index.html` er bare en
  meta-refresh-viderekobling dit).
- **VIKTIG lærdom (2026-08-26)**: Fordi `salmakern.html` (booking) og `nettside/` deler samme
  GitHub Pages-nettsted, rammer DNS-/domene-endringer på `salmaker.as` OGSÅ booking-verktøyet,
  selv om man aldri rører selve filen. Da et egendefinert domene (CNAME) ble satt opp for
  `nettside/`, begynte GitHub å 301-viderekoble den gamle `salmakern.github.io/...`-adressen
  til `salmaker.as` for HELE nettstedet, inkludert `salmakern.html`. Henriks installerte
  Edge-PWA-snarvei for booking (`Salmaker'n – Telemark Salmakerverksted.lnk`, app-id
  `cfdjnpfdlofiphghklnedbambbemdihb`) fulgte automatisk med over til det nye domenet - og
  siden `salmaker.as` sitt HTTPS-sertifikat ikke var klart ennå (GitHub-utstedelse tar tid),
  brøt booking-appen fullstendig (`NET::ERR_CERT_COMMON_NAME_INVALID`, og siden GitHub Pages
  setter HSTS kunne man heller ikke bare "fortsette likevel" i nettleseren - måtte fjernes via
  `edge://net-internals/#hsts` → Delete domain security policies → `salmaker.as`).
  **Konsekvens for fremtidig arbeid**: enhver DNS-/CNAME-/domene-endring på `salmaker.as` må
  varsles til Henrik FØR den gjøres, med eksplisitt advarsel om at booking-appen kan bli
  utilgjengelig til HTTPS-sertifikatet er utstedt (kan ta fra minutter til flere timer) - ikke
  bare anta det er trygt fordi man "bare rører nettside/".
  **Løst 2026-08-26**: sertifikatet var stuck fordi `www.salmaker.as` pekte til en gammel,
  ubrukt tredjepartsløsning (`s.multiscreensite.com`) i stedet for `salmakern.github.io` -
  GitHub prøver å validere www-varianten av domenet samtidig med apex-domenet, så en feil
  der blokkerte utstedelsen for HELE domenet. Fikset ved å endre DNS-posten for `www` hos
  Domeneshop til å peke på `salmakern.github.io`, deretter fjerne+legge til domenet på nytt
  i GitHub Pages-innstillingene for å tvinge frem et nytt forsøk. `https://salmaker.as`,
  booking og Forhandlerportalen er alle bekreftet fungerende over HTTPS nå. Hvis en fremtidig
  domene-endring gir samme symptom (sertifikat henger i timevis), sjekk www-posten først.
- Ren statisk HTML/CSS/JS per side (`kia-ev9.html`, `varebil.html`, `bestilling.html`, osv.) -
  ingen byggesteg. Bruk **relative** stier for bilder/CSS/JS (ikke `/nettside/...`) - GH Pages
  gjør ekte navigasjon uten server-side rewrite, så absolutte stier brekker under
  prosjekt-understien.
- **`reveal.js` (fade-inn ved scrolling) må IKKE bruke en andel som terskel** (`threshold: 0.15` e.l.).
  Tidligere vistes et element først når 15 % av det var synlig, og modelllista på `varebil.html` er ca.
  5000 px høy på mobil (16 modeller i én kolonne): 15 % er ca. 750 px, så på telefoner med synlig høyde
  under det ble listen ALDRI synlig (opacity 0), og hver ny modell gjorde det verre. Målt 2026-10-15 i
  headless Edge: 375x500 og 375x664 aldri, 375x812/360x740/390x844 så vidt. Nå `threshold: 0` med
  `rootMargin: "0px 0px -40px 0px"` (vises når toppen er 40 px inne i skjermen). Testet på alle 20 sider i
  375x664 og 1315x740: alt blir synlig etter scrolling, og elementer under folden er fortsatt skjult ved
  lasting (effekten er bevart). `reveal.js` lastes uten `?v=`, så gamle nettlesere kan bruke den
  bufrede filen i opptil ca. 10 min (GitHub Pages).

## Synk mot Forhandlerportalen

Modellsidene henter ombyggingsvarianter (navn, produktnummer, bilder - **aldri pris**) live fra
Forhandlerportalens offentlige API i stedet for å ha dem hardkodet:

- `model-sync.js` - kjører på hver modellside (både de 17 håndlagde sidene og den generiske
  `modell.html?slug=X`), henter `GET /api/public/models/[slug]` fra
  `forhandlerportal-umber.vercel.app`, fyller `#prodGrid` (produktliste) og
  `#mainImg`/`#thumbContainer` (bildegalleri). Faller tilbake til en "ta kontakt"-melding hvis
  modellen ikke finnes eller mangler varianter.
- `model-list-sync.js` - kjører på `varebil.html`, henter `GET /api/public/models` (hele
  lista), erstatter den statiske `#modelsGrid`-lenkelisten med ferske lenker + bilder. Modeller
  med en av de 17 kjente slugene lenker til sin egendefinerte side; alt annet lenker til
  `modell.html?slug=X`. Modeller UTEN bilde får en "KOMMER SNART"-plate (`.thumb-placeholder` /
  `.thumb-placeholder-label` i `site.css`: skråstriper og en mørk plate med rød venstrekant) -
  samme utseende som `NoImagePlaceholder` i Forhandlerportalen (endret 2026-10-15, før det var et
  bil-emoji). Hold de to like hvis den ene endres. Enkeltmodellsiden (`model-sync.js`, `renderEmpty()`, vises
  for en modell uten varianter eller når API-et ikke svarer) bruker samme plate, i stor variant
  (`.model-hero-media .thumb-placeholder`, portalens size="lg") inni den vanlige 4:3-bilderuta med rød kant, så
  oppsettet er likt modeller med bilde (endret 2026-10-15, før det var en stiplet boks med kamera-emoji og teksten
  "Legg til bilder her" - en intern beskjed på en offentlig side).
- `modell.html` - generisk modellside for HELT NYE modeller lagt til i Forhandlerportalens
  admin-panel. Trenger ingen ny HTML-fil lenger - admin setter navn, slug, "fordeler"-liste og
  bilde, så fungerer siden automatisk.
- CORS på API-siden er låst til `https://salmakern.github.io` (se
  `forhandlerportal/src/lib/cors.ts`) - ved lokal testing av disse skriptene må `API_BASE` i
  filen midlertidig pekes mot `http://localhost:3000` og CORS midlertidig åpnes, husk å
  reversere begge deler før push.

## Finn forhandler (2026-10-10)

`finn-forhandler.html` + `finn-forhandler.js`: kunden velger modell, skriver postnummer/sted
(eller "Bruk min posisjon"), ser forhandlerne som selger modellen sortert på luftlinje-avstand
og kan sende en forespørsel til opptil 3 av dem. Data og utsending ligger i Forhandlerportalen
(se dens CLAUDE.md, seksjonen "Finn forhandler"): `GET /api/public/dealers`,
`GET /api/public/models`, `POST /api/public/foresporsel`.

- **Postnummer/sted slås opp direkte fra nettleseren hos Kartverket (Geonorge)**, aldri via våre
  servere - ingenting om kundens posisjon lagres. Postnummer = snitt av adressene i området,
  stedsnavn via stedsnavn-API-et (bare by/tettsted/bygd/kommune-typer), ellers fullt adressesøk.
- Nedtrekket viser BARE modeller som har forhandlere. Tre tilstander skal alltid være pene:
  ingen forhandlere lagt inn ("Vi legger inn forhandlere fortløpende" + kontaktknapper), API-feil
  og normal visning. Siden er derfor trygg å ha live før Henrik har lagt inn forhandlere.
- **Menylenke** "Finn forhandler" (og bunntekstlenke) på alle aktive sider. `galleri.html`,
  `om.html` og `tjenester.html` har et eldre oppsett uten hovedmeny, er ikke lenket fra noe
  sted og er bevisst ikke rørt. CTA-knappen "Finn forhandler" på modellsidene (lenker til
  `finn-forhandler.html?modell=<slug>`) legges til av `model-sync.js`, ikke i hver HTML-fil.
- **Headeren er klebrig og vokste da menyen fikk en lenke til** (målt, ikke gjettet): ved
  900-1024px ble den fra én til to rader, og på mobil +36px. Rettet i `site.css` med en regel
  for `max-width: 1120px` (litt tettere meny) og strammere mobilregel (`720px`); målt etterpå:
  én rad fra 900px og opp, 800px lavere enn før, mobil ca. +7px mot før. Husk å måle header-
  høyden (`.site-header` offsetHeight) ved 375/800/1024/1280 hvis menyen endres igjen. `site.css`
  er nå `?v=10` på alle sider (bumpet 2026-10-15), `model-sync.js` `?v=6` og `model-list-sync.js` `?v=7`.
- **Teste lokalt**: portalens API tillater bare `https://salmaker.as` som origin, så en side
  servert fra localhost får CORS-feil. Løsning brukt: en liten lokal proxy som serverer
  `nettside/`, sender `/api/*` videre til portalen på localhost:3000 med `Origin: https://salmaker.as`
  og bytter `API_BASE` til "" KUN i svaret for `finn-forhandler.js`. Aldri løsne CORS i
  portalen for å teste.

## Logofiler

"Master"-kopiene av alle logovarianter ligger samlet i `../logoer/` (én mappenivå opp fra
dette repoet, altså `Claude app/logoer/`) - IKKE i `nettside/`. `nettside/logo-transparent.png`
er en egen, aktiv kopi brukt av selve nettsiden (byte-identisk med `logoer/logo-transparent.png`
i skrivende stund) - rør den kopien når du endrer noe som faktisk skal vises på salmaker.as.

Se Forhandlerportal-repoets `CLAUDE.md` for full forklaring av hvilken variant som brukes hvor
- kort versjon: `logoer/logo-transparent.png` (hvit fyll, med skygge-effekt, bevist på mørk
header her) og `logoer/SALMAKERN LOGOFORSLAG NY.png` (ren outline uten skygge, sort undertekst
- kun lys bakgrunn) er de to filene som faktisk er i aktiv bruk. `logoer/logo-dark.png` (solid
sort fyll, med skygge) er IKKE i bruk noe sted lenger - ikke gjenbruk den uten å sjekke med
Henrik først.

## Bestillingsskjema

`bestilling.html` ("Send forespørsel" - knappene på modellsidene og i menyen) sender med `fetch()`
som JSON til **Forhandlerportalens eget endepunkt** `https://forhandler.salmaker.as/api/public/bestilling`
(se portalens CLAUDE.md, seksjonen "Send forespørsel"). Portalen sender e-posten via Resend fra
verifisert avsender (`post@forhandler.salmaker.as`) til **post@salmaker.as**, med kundens e-post som
svaradresse. Ingenting lagres.

**Hvorfor ikke Formspree (2026-10-12):** skjemaet sendte tidligere til Formspree
(`/f/mqpzrwpg`, gratisabonnement). Innsendingene ble lagret der, men e-postvarslene kom aldri frem
til Microsoft 365-postkassen (salmaker.as ligger bak Exchange Online Protection), og Formshield
(spamfilter) kunne i tillegg stoppe ekte forespørsler. Det skjulte `_cc`-feltet som skulle gi kopi
til post@ gjorde heller aldri noe (Formspree har ikke noe slikt felt). Formspree-skjemaet kan
slås av i Formspree (Settings -> "Form Enabled") når det nye har vist seg i drift; gamle
innsendinger ligger 30 dager under Submissions. `om.html` (gammel, ikke lenket) har fortsatt et
Formspree-skjema med plassholder-ID - bevisst ikke rørt.

Skjemaet-siden: inline-skript (ingen avhengigheter), skjult honeypot-felt `kontaktref` (heter
bevisst ikke "website"/"url" - passordbehandlere autofyller dem), og klienten venter til minst 3 s
er gått siden sideåpning før den sender (serveren avviser < 2,5 s). Uten JavaScript skjules
skjemaet helt (et skjema uten action sendes som GET med persondata i URL-en). Feil vises i en
inline boks (`#formError`), ikke `alert()`.

E-postens utseende (felles mal, bilder, mørk modus) er beskrevet i portalens CLAUDE.md, "E-postmalen".

**Levering er IKKE det samme som "sendt":** Resend aksepterer e-posten, men om Microsoft 365 leverer
den til innboksen ser vi ikke fra koden. Status per e-post står i Resend-dashbordet (Emails ->
Delivered/Bounced). Etter endringer i e-postoppsettet eller ved mistanke: send én TEST-forespørsel
og bekreft at den kommer frem i post@salmaker.as. Siden ingenting lagres, finnes det ikke lenger et
arkiv som Formspree sitt Submissions - e-posten ER sporet.

## Arbeidsvaner (gjelder også her, se Forhandlerportal sin CLAUDE.md for full begrunnelse)

**Hold QA-oppgaven i takt med endringene.** Når en endring påvirker hva besøkende ser eller
gjør på nettsiden (nytt design, endrede tekster/tall, nye sider, endret datakilde),
oppdater den daglige QA-oppgaven `nettside-daglig-qa` i SAMME økt, før arbeidet meldes
ferdig. Prompten ligger i `C:\Users\GroAnitaMartinsen\.claude\scheduled-tasks\nettside-daglig-qa\SKILL.md`
og endres med `update_scheduled_task` (les SKILL.md først og bygg videre på den). Legg til/endre
sjekkpunktet for det som ble endret, og fjern det som ikke lenger gjelder - ellers gir QA-en
falske varsler. Gjelder endringen også Forhandlerportalen, oppdater `forhandlerportal-daglig-qa`
(se Forhandlerportal sin CLAUDE.md). Booking-QA-en (`salmakern-booking-daglig-qa`) oppdateres på
samme måte når booking-verktøyet endres.

Se kritisk på visuelle endringer ved faktisk visningsstørrelse/bakgrunn før de vises frem som
ferdige. Ved subjektive designvalg (f.eks. hvilken logofil/størrelse) - vis flere reelle
alternativer side ved side og la Henrik velge, ikke bestem selv.
