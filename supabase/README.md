# Database-migrasjoner

Alle endringer i databaseskjemaet (nye tabeller, kolonner, funksjoner, RLS-policyer)
skal ligge som `.sql`-filer i `migrations/`, navngitt `<tidsstempel>_<beskrivelse>.sql`.

Historikken frem til og med `20260821061615_bilder_avstand_skader.sql` er de gamle
migreringene som opprinnelig ble kjørt manuelt i Supabase sitt SQL Editor (derav
navn som `supabase_*.sql` i git-historikken) - de er nå samlet her i riktig
kronologisk rekkefølge og markert som "applied" i Supabase sin egen
migrasjonshistorikk (`supabase migration repair`), slik at CLI-et vet at de
allerede er kjørt.

`rollback-referanser/` inneholder rollback-scripts som ikke er en del av selve
migrasjonskjeden - de skal ALDRI kjøres automatisk (f.eks. via `db push`), kun
brukes manuelt hvis en spesifikk endring må reverseres.

## Ny endring i skjemaet

1. Lag en ny fil: `supabase/migrations/<YYYYMMDDHHMMSS>_kort_beskrivelse.sql`
2. Skriv SQL-en der (ikke i SQL Editor direkte - filen ER kilden til sannhet)
3. Kjør den mot prosjektet:
   ```bash
   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file supabase/migrations/<filnavn>.sql
   ```
   (`db push` krever Docker lokalt for shadow-database-diffing, som ikke er
   tilgjengelig i denne utviklingsmiljøet - `db query --file` kjører SQL-en
   direkte mot prosjektet via Management API og trenger ikke Docker.)
4. Commit filen. Historikken er da riktig uansett hvor endringen ble kjørt fra.

## Nyttige kommandoer

```bash
# Sikkerhets- og ytelsessjekk av hele databasen
npx supabase db advisors --linked --project-ref qoqpenbfdxeduylxirwk --type all

# Se om lokal migrasjonshistorikk stemmer med det som faktisk er kjørt i Supabase
npx supabase migration list --linked --project-ref qoqpenbfdxeduylxirwk

# Kjør et enkeltstående SQL-spørring/endring mot databasen
npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file <sti-til-fil>.sql

# Se status på automatiske backups
npx supabase backups list --project-ref qoqpenbfdxeduylxirwk
```

## "ordre-push"-triggeren og Vault (s00-021, løst 2026-10-30)

Triggeren `"ordre-push"` (AFTER UPDATE på `public.ordrer`) varsler ansatte om
statusendringer via edge-funksjonen `send-push`. Den brukte opprinnelig
`supabase_functions.http_request` DIREKTE som trigger-funksjon, med den ekte Supabase
**service_role**-nøkkelen hardkodet i klartekst i selve `CREATE TRIGGER`-definisjonen
(synlig for alle med SQL Editor/direkte spørretilgang - IKKE nåbar via appens offentlige
PostgREST-API). Dette var årsaken til at triggeren bevisst ikke lå i en vanlig
migrasjonsfil (ville ha lekket en ekte hemmelighet til Git-historikken for alltid).

**Løsning (migrasjon `20261030180000_ordre_push_vault_nokkel.sql`):** `supabase_functions.
http_request` tar kun STATISKE argumenter (bakt inn i trigger-definisjonen ved `CREATE
TRIGGER`, ikke slått opp på nytt per rad), så et rent "bytt ut nøkkelen i samme
triggerfunksjon"-grep var ikke mulig. Erstattet med en egen trigger-funksjon
(`public.ordre_push_trigger_fn()`) som slår opp nøkkelen DYNAMISK fra Supabase sin Vault
(`vault.decrypted_secrets`, hemmelighetens navn: `ordre_push_service_role_key`) ved hver
kjøring, og selv bygger samme nyttelast-form (`old_record`/`record`/`type`/`table`/
`schema`) og kaller `net.http_post` direkte - `send-push` (som leser
`payload.record`/`old_record`) merker ingen forskjell. Hele push-varselet er pakket i en
`exception when others`-blokk: et feilende varsel kan ALDRI rulle tilbake selve
ordre-oppdateringen, som uansett kjører i samme transaksjon som AFTER UPDATE-triggeren.

Selve hemmeligheten ble flyttet til Vault via en engangskommando som ALDRI ble committet
(kun migrasjonen som slår den opp etter navn ligger i Git). Live-verifisert 30.10 med en
TEST-ordre (opprettet og slettet i samme test): triggeren kjører, legger inn forventet
rad i `supabase_functions.hooks`, og `send-push` svarer `200 ok` - identisk oppførsel som
før, uten noen hemmelighet synlig i databaseskjemaet.

Hvis denne triggeren noen gang må gjenskapes fra bunnen (f.eks. et helt nytt prosjekt):
kjør migrasjonen, lagre deretter en gyldig service_role-nøkkel (Project Settings → API) i
Vault under navnet `ordre_push_service_role_key` via `select vault.create_secret('<ekte
nøkkel>', 'ordre_push_service_role_key', '...')` i SQL Editor - ALDRI i en fil som
committes.

Sjekket 2026-10-30 (før fiksen): `ordre-push` var den ENESTE triggeren i databasen som
brukte `http_request` med en `Bearer`-header - ingen andre hadde samme hull.

## Skriving til ansatte-tabellen og PIN-innloggingen (s09-032, innloggingsfeil rettet 2026-10-31)

Tabellen `ansatte` er beskyttet av to triggere: `ansatte_hindre_selv_rolleendring_trigger` (bare admin kan endre `rolle`) og `ansatte_beskytt_skriving_trigger` (`20261031110000`): INSERT og DELETE krever admin, og en ikke-admin kan bare
endre `navn` og `stemplet_inn_siden` på sin EGEN rad (`session_token`, `rolle`, `aktiv`, `kan_fore_lonn`, `ansettelsesdato`, `flere_enheter` og `id` er blokkert).

**Feilen 31.10:** `logg_inn_med_pin` (SECURITY DEFINER) setter et nytt `session_token` på ansatte-raden til den som taster riktig PIN. Det skjer fra en sesjon som ennå ikke har ansatt-claims (ny anonym sesjon) eller fra en
som har en ANNEN ansatts claims (delt enhet uten utlogging), og den nye triggeren avviste det med `KUN_ADMIN`: PIN-innloggingen var brutt for alle fra ca. kl. 11:45 til 13:43 norsk tid (allerede innloggede var upåvirket).
Testene av s09-032 dekket `opprett_ansatt`, navn og stempling, men ikke innloggingen. Rettet i `20261031140000_ansatte_beskytt_skriving_innlogging.sql`: `logg_inn_med_pin` setter den transaksjonslokale markeringen
`app.pin_innlogging` rett før `session_token`-oppdateringen og nuller den rett etter, og triggeren slipper gjennom en UPDATE som BARE endrer `session_token` når markeringen er satt. En REST-klient kan ikke sette en egen GUC, og
en klient uten ansatt-sesjon stoppes av RLS før triggeren kjører. Bare `logg_inn_med_pin` (session_token) og `opprett_ansatt` (insert, admin-sjekk) skriver til `ansatte` fra databasefunksjoner (sjekket 31.10).

**Regel:** rør aldri `ansatte_beskytt_skriving` eller `logg_inn_med_pin` uten å teste SELVE PIN-innloggingen: `supabase/tester/ansatte_beskytt_skriving_innlogging_TEST_body.sql` (rulles tilbake; fersk innlogging, delt enhet, og at
alle blokkeringene gjelder). Uten rettelsen feiler T1 og T2 med `KUN_ADMIN`. Den daglige booking-QA-en (punkt 20) kjører den testen hver natt.

## send-push: innloggingssjekk (s00-006/s00-027, myk modus fra 2026-10-31)

`send-push` har samme innloggingssjekk som fiken-fakturer, send-frakt-epost og vegvesen-oppslag (den delte blokken
`EDGE-AUTH-GATE`, byte-lik i alle fire; `test/edge-auth-gate.test.js` vokter det), i MYK modus: utfallet logges som én
JSON-linje (`edge_auth: 1`), men ingenting blokkeres før `send-push` (eller `*`) står i hemmeligheten `EDGE_AUTH_ENFORCE`.
Alle kjente roller slipper gjennom (klient-varslene kommer fra enhver ansatt: godkjenner-chat, møter, fravær, lager, ny ordre).

**Hvem kaller `send-push`** (kartlagt mot live-databasen 31.10, bare navn og ja/nei, aldri nøkler):

| Kaller | Sender | Kategori i gaten |
|---|---|---|
| Nettleseren (alle `edgeFetch('send-push', ...)` i appen) | innlogget ansatts access-token i `Authorization` | `ansatt` |
| Triggeren `ordre-push` (`public.ordre_push_trigger_fn`) | `Authorization`: service_role-nøkkelen fra Vault (bare for Supabase-porten) og `x-server-secret` fra Vault | `server` |
| Cron `paaminnelser-sjekk` (hvert 5. min) og `daglig-paaminnelse` (kl. 06:55) | de samme to headerne (`20261031124000_send_push_server_hemmelighet.sql`; før det den offentlige nøkkelen `sb_publishable_...`, så service_role-nøkkelen via `20261031113000_send_push_cron_vault_nokkel.sql`) | `server` |

`portal-bestilling` kaller IKKE `send-push` (den sender sine egne varsler fra `push.ts`), og ingen andre triggere eller funksjoner i
databasen nevner `send-push`.

**Server-kall** er en egen gyldig kategori som bare finnes i `send-push` (blokken `SERVER-KALLER`, utenfor den delte blokken): headeren
`x-server-secret` sammenlignes mot funksjonshemmeligheten `SEND_PUSH_SERVER_SECRET` (SHA-256 av begge sider, løkke uten tidlig avbrudd; mangler den eller er den
under 32 tegn gir den aldri treff), uten oppslag mot databasen, og slippes gjennom også når håndheving er på. Loggføres som `via: 'server', grunn: 'delt_hemmelighet'`.
Samme verdi ligger i Vault (`send_push_server_secret`); cron-jobbene og triggeren slår den opp ved HVER kjøring, så den står aldri i en fil, i Git eller i selve cron-jobben.
Headeren står ikke i CORS-listen, så en nettleser kan ikke sende den.

**Hvorfor ikke service_role-nøkkelen i `Authorization` (første forsøk 31.10):** nøkkelen i Vault (`ordre_push_service_role_key`) er en ANNEN verdi enn funksjonens
`SUPABASE_SERVICE_ROLE_KEY` (funksjonen har også `SUPABASE_SECRET_KEYS`/`SUPABASE_PUBLISHABLE_KEYS`, det nye nøkkelsystemet). Bekreftet med SHA-256-sammendrag, og loggene viste at cron-kall
sto som `via: 'ingen'`. En egen delt hemmelighet er uavhengig av hva plattformen legger i de innebygde nøklene.

**Bekreftet i produksjon 31.10:** et kall med riktig hemmelighet ble logget `via: 'server'`, kall med feil hemmelighet og uten ble `ingen`, og den første planlagte cron-kjøringen etter
migrasjonen (kl. 13:10 norsk tid) ble logget `via: 'server'`. **Ikke sett ennå:** triggeren `ordre-push` i en ekte ordreoppdatering (en tilbakerullet test viste at forespørselen den køer får riktig
header; første ekte ordreoppdatering skal vise `via: 'server'`), og `via: 'ansatt'` for appens varsler (krever ekte bruk).

**Slik lages eller byttes hemmeligheten** (verdien skal aldri stå i en fil i Git eller OneDrive, eller i en samtale): generer en tilfeldig verdi (minst 32 tegn), sett den som funksjonshemmelighet
(`npx supabase secrets set --env-file <midlertidig fil utenfor OneDrive> --project-ref qoqpenbfdxeduylxirwk`) og lagre SAMME verdi i Vault (`select vault.create_secret('<verdi>', 'send_push_server_secret', '...')`,
ved bytte `vault.update_secret`), og slett så den midlertidige filen. Kontroll uten å vise verdier: `npx supabase secrets list` viser et SHA-256-sammendrag av funksjonshemmeligheten; sammenlign de 8 første tegnene
med `left(encode(extensions.digest(decrypted_secret, 'sha256'), 'hex'), 8)` for Vault-hemmeligheten.

**Tester:** `test/edge-auth-gate.test.js` (enhetstester av gaten, mutasjonstestet) og `supabase/tester/send_push_server_hemmelighet_TEST_body.sql` (rulles tilbake; sjekker cron-jobbene, at `ordre-push` køer en
forespørsel med riktig header, og at varselet fortsatt går hvis Vault-hemmeligheten mangler).

**Slik leser du loggene:** Supabase → Edge Functions → funksjonen → Logs, filtrer Event message på `haandhevet` (et søk på `edge_auth` gir falskt «ingen treff» på grunn av understreken), og klikk en rad for å se `via`/`grunn`.

**Før håndheving slås på for send-push:** loggene må vise `via: 'ansatt'` for appens varsler og `via: 'server'` for cron og `ordre-push` (se «Ikke sett ennå» over). Rollback = fjern navnet fra `EDGE_AUTH_ENFORCE`.
Mangler Vault-hemmeligheten, eller fjernes `SEND_PUSH_SERVER_SECRET`, regnes cron og `ordre-push` som vanlige kallere: i myk modus endres ingenting, men med håndheving ville de fått 401 og påminnelser og statusvarsler stoppet STILLE
(cron-kjøringen står som «succeeded»). Se at påminnelsene faktisk når funksjonen (skal ikke vise 401): `select status_code, left(content, 24), count(*) from net._http_response where created > now() - interval '1 day' group by 1, 2;`
og `select status, count(*) from cron.job_run_details where start_time > now() - interval '1 day' group by 1;`.

## Bestillinger fra Forhandlerportalen («Bestill», fase 2, 2026-10-30)

Forhandlerportalen sender en bestilling (chassis.nr, serienummer eller forhandlerens eget bestillingsnummer, forhandler, selger, modell) hit. Fire lag, alle testet hver for seg:

1. **Tabeller og kolonner** (`20261030200000_portal_bestilling_grunnlag.sql`): `portal_bestillinger` (ett utfall per bestilling), `portal_modell_kobling`
   (portalens modell-slug til appens merke/modell, godkjent av Henrik), og tre nullable kolonner på `ordrer`. Bare admin leser dem.
2. **Postgres-funksjonen `portal_koble_bestilling(p jsonb)`** (`20261030210000_portal_koble_bestilling.sql`): all forretningslogikk. Kobler til en eksisterende
   ordre, oppretter ny ordre «På vei» (ikke bekreftet fra portal, i nøyaktig samme form som appen lager den), lager en løs rad i Admin-ark (serienummer) eller
   legger bestillingen til avklaring. Idempotent på portalens bestilling-id; en slettet portal-ordre gjenopplives aldri (gravstein). Kan KUN kalles av
   `service_role`. Test: `tester/portal_koble_bestilling_TEST_body.sql` (47 sjekker, alltid i en transaksjon som rulles tilbake; kjøring står øverst i filen). Et nytt kall etter at en ansatt har bekreftet svarer fortsatt `ok` med status `bekreftet`.
   Utfall `venter_*` og `avklaring_*` er endelige sett fra portalen: et nytt kall på samme bestilling-id endrer ingenting. Når årsaken er rettet (rad i
   `portal_modell_kobling`, rettet org.nr/kontakt-id i Kontakter, manuell avklaring) kjøres funksjonen på nytt av admin med `kjor_pa_nytt` (SQL som
   postgres/service_role, senere G8-RPC-ene), med de lagrede feltene fra `portal_bestillinger`.
   Kjent og bevisst: taket på 10 gjelder bare ordrer (chassis-banen); serienummer-rader og rader i `portal_bestillinger` har ingen egen grense her (portalens
   grenser og at bare portalen har hemmeligheten begrenser dem), og samme serienummer sendt to ganger gir to Admin-ark-rader.
   Rollback: `rollback-referanser/portal_koble_bestilling_ROLLBACK.sql`.
3. **Edge-funksjonen `portal-bestilling`** (`functions/portal-bestilling/`: `index.ts` er døra inn, `logikk.ts` er ren validering/avgrensning). Egen hemmelighet
   `PORTAL_BESTILLING_SECRET` (Supabase-hemmelighet; samme verdi i portalens miljø som `x-sync-secret`, og aldri `FIKEN_SYNC_SECRET`), sammenlignet i
   konstant tid, håndhevet fra dag én (ingen myk modus: det finnes ingen gamle kallere). Funksjonen er utrullet med standard `verify_jwt`, så portalen må
   også sende anon-nøkkelen som `apikey`/`Authorization`. Ti navngitte strengfelt pluss det valgfrie `linjer` (produktliste, se punkt 7 under) slippes
   gjennom til databasen (`kjor_pa_nytt` kastes alltid), og et
   vellykket svar er bare `{kode, status, ordre_id?}`, feilsvar bare `{kode, felt?}` (aldri detaljer eller databasefeil). Logger én JSON-linje per kall uten
   verdier (utfall, HTTP-status, tid, SQLSTATE-kode og tidsavbrudd-flagg ved databasefeil).
   **Kontrakten for portalen:** påkrevd `bestilling_id` (8-64 tegn A-Za-z0-9_-, portalens id), `nr`, `ident_type` (`CHASSIS` | `SERIENUMMER` | `BESTILLINGSNR`; de to siste har samme format, 3-40 tegn A-Z0-9._/ - og blir begge en løs Admin-ark-rad med nummeret i Serienummer-kolonnen, men `BESTILLINGSNR` får merknaden «Fra portalen <nr> (bestillingsnr fra forhandler)» og eget varsel; lagt til 2026-10-31, Henrik: «bestillingsnummer fra forhandler ved siden av chassis.nr og serienummer», sjekk-regel i `20261031100000_portal_bestillingsnr.sql` og funksjonen v3), `ident`; valgfri
   `kontakt_id`, `orgnr`, `forhandler_navn`, `selger_navn`, `selger_epost`, `modell_slug` (uten kontakt-id og org.nr blir utfallet `venter_forhandler`, uten
   `modell_slug` på en ny chassis-ordre `venter_modell`). Svar: `200 {kode:'ok'|'trenger_avklaring', status, ordre_id?}` er ENDELIG (også `trenger_avklaring`:
   mottatt, ikke feil, ikke retry; vis aldri `status` til selgeren, den kan røpe at chassis.nr finnes hos en annen forhandler); `400 ugyldig_input`/`401`/`405`/`413`
   er permanente (rett feilen); `500 ikke_konfigurert` og `502 intern_feil` betyr prøv igjen med SAMME `bestilling_id` (idempotent, også etter tidsavbrudd
   midt i en transaksjon). Portalens fetch-tidsavbrudd og Vercels `maxDuration` må ligge over funksjonens 25 s. Rull ut på nytt etter endring:
   `npx supabase functions deploy portal-bestilling --project-ref qoqpenbfdxeduylxirwk --use-api` (begge filene lastes opp; relativ import virker).
   Rollback: `npx supabase functions delete portal-bestilling --project-ref qoqpenbfdxeduylxirwk` (øyeblikkelig). Å bare fjerne hemmeligheten
   (`secrets unset`) er IKKE nok alene: hemmeligheten leses når funksjonen starter, så kjørende kopier kan huske den gamle verdien en stund
   (ved mistanke om lekkasje: sett en NY verdi, rull ut på nytt og oppdater portalens miljø).
   Tester: `test/portal-bestilling.test.js` (34 enhetstester: validering, svaravgrensning og hele håndtereren mot falsk Deno og falsk database, inkl. størrelsesgrensen på byte-nivå og at ingen
   logglinje fra noen bane inneholder verdier; kjører i `npm test`) og `tester/portal_bestilling_differensialtest.mjs` (sammenligner edge-valideringen med Postgres-valideringen på 356 grensetilfeller;
   kjøres for hånd når valideringen i en av dem endres; egenskapen er at det edge godtar, godtar Postgres også).
   **Push-varsel til administratorer (G9, 2026-10-30; Henrik: «admin bare»):** etter at bestillingen er behandlet sender funksjonen et web-push-varsel til alle aktive ansatte med rolle
   `admin` som har et abonnement (`push_abonnement`), for utfallene ny ordre, ny løs Admin-ark-rad (serienummer) og alt som venter på avklaring (`venter_*`, `avklaring_*`); aldri for `koblet`,
   `avvist` eller `bekreftet`. Nøyaktig ÉN gang per bestilling: raden i `portal_bestillinger` claimes med `push_sendt_at` (migrasjon `20261030240000`) FØR sendingen, så retry eller to samtidige kall aldri gir to
   varsler (prisen: feiler sendingen etter claimet, prøves den ikke på nytt). Teksten bygges av databaseraden (Kontakter-navn, merke/modell fra oversettelsen, chassis/serienummer), aldri av noe selgeren har skrevet.
   Best-effort: feil og tidsavbrudd (6 s) svelges og endrer aldri svaret til portalen; utløpte abonnement (404/410) ryddes bort som i `send-push`. Bruker samme VAPID-hemmeligheter som `send-push`
   (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`); mangler de, hoppes push over uten å bruke opp claimet. Logikken ligger i `push.ts` (testet i `test/portal-bestilling-push.test.js` og i håndtererens
   tester). **OBS ved testing:** ethvert kall som gir et av varselutfallene sender ET EKTE varsel til admin-telefonene, også «venter_forhandler» for en ukjent kontakt - test aldri mot den utrullede funksjonen
   med en gyldig bestilling uten at Henrik har sagt ja. Rollback for push: rull ut funksjonen uten `push.ts`-kallet, deretter `rollback-referanser/portal_bestilling_push_ROLLBACK.sql`.
   **Funksjonen er utrullet, men INGENTING kaller den ennå** (portalen sender først når koblingen slås på, G11). Livetest 2026-10-30: uten nøkkel 401 (porten),
   uten/med feil hemmelighet 401, GET 405, ugyldig chassis/JSON 400, for stor body 413, ukjent kontakt 200 `venter_forhandler` (og samme svar ved gjentatt kall).
4. **Bekreft og Avvis i appen** (`20261030230000_portal_bekreft_avvis.sql`): RPC-ene `portal_bekreft_ordre(p_ordre_id)` (alle innloggede ansatte; idempotent; setter bekreftet-tidspunkt/-navn, én logglinje og
   `portal_bestillinger.status = 'bekreftet'`) og `portal_avvis_ordre(p_ordre_id)` (bare admin og godkjenner; sletter bare en URØRT, ubekreftet portal-ordre, se `v_urort` i filen, og markerer alle bestillinger som
   peker på ordren som `avvist` = gravstein). Begge er SECURITY DEFINER og sjekker `current_ansatt()` selv; `anon` kan ikke kalle dem. Rolle- og urørt-sjekken er et sikkerhetsnett mot misforståelser i appen, IKKE en
   grense mot en ansatt som går forbi appen (RLS på `ordrer` tillater alle innloggede ansatte å endre/slette direkte). Test: `tester/portal_bekreft_avvis_TEST_body.sql` (43 sjekker, rullet tilbake; 2 nye sjekker
   lagt til 2026-10-31 for startstatus-raden, se punkt 6 under). Rollback: `rollback-referanser/portal_bekreft_avvis_ROLLBACK.sql` (appkoden må rulles tilbake først). Appdelen (merke, filter, banner, knapper)
   står i rotens CLAUDE.md og testes av `test/portal-ordre-visning.test.js`.
5. **Modellnøkkel i Fiken-matching** (s09-012 steg 2, `20261031150000_portal_modell_slug_matching.sql`, kjørt mot produksjon 2026-10-31 kveld): ny kolonne `ordrer.portal_modell_slug` (satt av
   `portal_koble_bestilling` v5 på CHASSIS-grenen, aldri på serienummer/bestillingsnr-grenen siden `admin_ark` ikke har tilsvarende felt) og RPC-en `hent_portal_modell_kobling()` (enhver innlogget ansatt kan lese
   `portal_modell_kobling` gjennom den - tabellen selv har RLS som bare slipper admin gjennom). `js/ordre-detalj.js` sin `kanoniskMerkeModell(o)` bruker slugen (når den finnes) i stedet for ordrens frie
   merke/modell-tekst i `synkroniserOmbyggingFikenLinjer()` (Fiken-fakturering treffer riktig produkt selv om en ansatt har rettet skrivemåten på ordren), og `ombyggingBoksHTML()` viser et gult varsel hvis
   fritekst og portal-modell avviker. Gjelder BARE ordre med `portal_modell_slug` satt - helt uendret for alle andre ordre. Test: `test/fiken-ombygging.test.js` (10 nye tester) og den generiske
   `/portal/i`-regelen i `test/portal-ordre-visning.test.js` (dekker også denne kolonnen automatisk). Deployet: commit `e96772a`.
6. **Statusutsending til portalen** (s08-034, `20261030200000_ordre_status_utboks.sql` + `20261031160000_ordre_status_utboks_kun_portal.sql` + `20261031180000_portal_bekreft_utboks_baseline.sql`, kjørt
   2026-10-30/31): egen tabell `ordre_status_utboks` (LEVERINGSKØ, ikke en permanent logg som `ordre_status_historikk` fra s09-025) fylt av en trigger som bare fyrer på en faktisk `ordre_status`-endring OG bare
   for ordre med `portal_bestilling_id` satt (innsnevret 2026-10-31 - fyrte før på ALLE ordre, noe portalen aldri kunne levere). `portal_bekreft_ordre()` legger i tillegg selv en rad med `status_forrige = null`
   idet en ansatt trykker Bekreft (uten den ville portalen ikke visst noe om en bestilling før første senere statusendring, som kan være dager etter bekreftelse). Edge-funksjonen `send-ordre-status-til-portal`
   (egen hemmelighet `ORDRE_STATUS_SYNK_SECRET`, samme mønster som `fiken-priser-synk`) leser uleverte rader, slår opp `send_epost` (ALLTID false for startstatus-rader og for status `hentet`; false for
   `klar_henting` bare når `admin_ark`-raden for samme chassis har `fraktselskap = 'Hente selv'` OG `bestilt_frakt = true`, ellers true; ALLTID false når ordren ikke er bekreftet ennå), og POSTer til
   `https://forhandler.salmaker.as/api/salmakern/bestilling-status` (header `x-salmakern-status-secret`) med `{event_id, portal_bestilling_id, status, status_forrige, send_epost, endret_at,
   klar_for_henting_dato?}`. 404 fra portalen er permanent (markeres levert med feilen notert, aldri retry); alt annet prøves igjen neste kjøring med samme `event_id` (idempotent hos portalen). **INGEN cron-jobb
   er opprettet ennå** - funksjonen kjører bare ved manuelt kall. Henrik 2026-10-31 kveld: ingen e-post til forhandlere/selgere (verken denne eller velkomst-e-posten) før forhandlergjennomgangen med daglig
   leder søndag 1.11 er ferdig - IKKE opprett cron-jobben før det er opphevet (se punkt 21d i `salmakern-booking-daglig-qa` sin QA-sjekkliste, som sjekker dette hver natt). Live-testet mot webhook.site med
   ekte TEST-ordre (opprettet/bekreftet/statusendret/slettet, 0 rester). Deployet: commits `7f9376a`, `c46fb8d`, `c0a7614`.
7. **Utstyr og rabatt fra bestillingen** (s08-048, `20261031170000_portal_bestilling_linjer.sql` + `portal_koble_bestilling` v5, kjørt mot produksjon 2026-10-31 kveld): valgfritt felt `linjer`
   (`[{produktnummer, navn, rabatt_prosent}]`, maks 30 rader, strengt validert - fail-closed, hele kallet avvises ved første ugyldige element) lagret rått i `portal_bestillinger.linjer` (admin-innsyn) og
   normalisert på `ordrer.portal_linjer` (samme les-ikke-skriv-mønster som `portal_modell_slug`/`portal_bestilling_id` - leses av `dbToOrdre`, skrives ALDRI av `ordreToDb`). Edge-funksjonen `portal-bestilling`
   (`logikk.ts`) har en egen valideringsgren for `linjer` (array av objekter, ikke en streng som resten av `TILLATTE_FELT`) og videresender feltet uendret. Ny `js/lager.js`-funksjon
   `leggTilPortalUtstyrLinjer(ordreId)` (kalt fra `portalBekreftOrdre()` rett etter `autoVelgUtstyrMal`) legger hver linjes `navn` i «Skal ha etter visning» og `produktnummer` i `fiken_linjer` MED
   `rabatt_prosent` frosset som `rabatt` på linjen - idempotent (samme `finnes`-sjekk som `oppdaterSkalHaForOppskrift`/`oppdaterFikenLinjeForOppskrift`). `fiken-fakturer` bruker en frosset `l.rabatt` (når
   `typeof l.rabatt === 'number' && Number.isFinite(l.rabatt)`) i stedet for `fiken_kunde_rabatt` for akkurat den linjen - uendret for alle andre linjer/ordre. Rabatten kommer altså fra BESTILLINGEN (portalens
   forhandlersats), ikke Salmaker'ns egen kundetabell, per Henriks avgjørelse 2026-10-30 («rabattene skal være de som er i forhandlerportalen»). Testet mot falsk Fiken (`test/fiken-fakturer-rabatt.test.js`, 20
   tester, bygget og adversarielt verifisert via en workflow - fant og rettet ett reelt hull der den falske Supabase-klienten ikke skilte mellom ulike `contactId`). Kjent, akseptert avrundingsforskjell mot
   portalen (inntil ca. 1 kr per linje - portalen runder variant+tillegg én gang, Fiken runder per linje). **Portalen har ikke begynt å sende `linjer` ennå** (bygget og bekreftet 2026-10-31, venter på at de
   ruller det ut). Deployet: commits `57a9de2`, `d1cb89f`.
8. **Koble SERIENUMMER/BESTILLINGSNR til portalen når chassis.nr blir kjent** (s90-20261101-1, Henrik 2026-11-01: «når vi får chassis.nr på bestillingen, lag en ordre på vei og gi den status i
   portalen», `20261101000000_portal_koble_chassis_fra_losrad.sql`): før punkt 7 i denne listen fantes, ble en SERIENUMMER/BESTILLINGSNR-bestilling bare en løs rad i Admin-ark uten ordre og uten
   `portal_bestilling_id` - ingen status gikk noensinne til portalen. **v6 av `portal_koble_bestilling`**: ÉN linje endret - `admin_ark`-grenen i idempotens-sjekken (4a) respekterer nå `kjor_pa_nytt`
   (akkurat som `venter_*`/`avklaring_*`-grenen rett under alt gjorde - dette ER den «G8-RPC-en» v5 sin kommentar varslet om). Resten av funksjonen er byte-identisk med v5. **Ny funksjon
   `portal_koble_chassis_fra_losrad(p_admin_ark_id, p_chassis)`** (kallbar av `authenticated`, krever `rolle = 'admin'` - speiler `admin_ark`-tabellens egen RLS, en strengere grense enn
   `portal_bekreft_ordre` som er åpen for alle ansatte): slår opp om admin_ark-raden har en tilknyttet `portal_bestillinger`-rad (via `admin_ark_id`, UANSETT status - bevisst intet filter på
   `status = 'admin_ark'`, slik at to samtidige kall for samme rad aldri begge tror «ikke tilknyttet» og lager to ordre; `portal_koble_bestilling` sin egen advisory-lock-idempotens er det som
   faktisk avgjør utfallet uansett hvilken status raden sto i). Finnes ingen tilknyttet bestilling (det store flertallet av Admin-ark-rader), returneres `{tilknyttet:false}` og ingenting skjer her.
   Finnes den, bygges en ny nyttelast FRA DEN LAGREDE raden (`bestilling_id, nr, kontakt_id, orgnr, selger_navn, selger_epost, modell_slug, linjer`) med `ident_type=CHASSIS` og det nye
   chassisnummeret, og `portal_koble_bestilling` kalles på nytt med `kjor_pa_nytt=true` - CHASSIS-grenen (4b) gjenbrukes dermed uendret, så ALLE kanttilfellene (annen forhandler, flere aktive
   ordre, hentet-men-ikke-arkivert, allerede koblet, tak per forhandler, `linjer`→`ordrer.portal_linjer`) er allerede løst uten ny kode. `js/admin-ark.js` (`cellEdited` for `chassisNr`) kaller den
   nye RPC-en FØR `adminArkOpprettOrdreForChassis()`; er raden ikke portal-tilknyttet, faller den tilbake til den uendrede, opprinnelige veien. Sender ingen e-post eller push selv (det er
   status-synk-stoppen i punkt 6 som styrer det, uberørt av denne funksjonen). Testet i rullet-tilbake transaksjoner: 21/21 nye sjekker (`supabase/tester/portal_koble_chassis_fra_losrad_TEST_body.sql`)
   og hele den opprinnelige 62-punkts regresjonstesten for `portal_koble_bestilling` på nytt (62/62, 0 feil - v6 er bevist uendret for alt annet enn den nye kapasiteten). Kjørt mot produksjon
   2026-11-01 etter Henriks eksplisitte ja. Rollback: `supabase/rollback-referanser/portal_koble_chassis_fra_losrad_ROLLBACK.sql`.
   **Rettet etter uavhengig gjennomgang (portal-økta, 2026-11-01)** - ikke fjern: `adminArkKobleChassisTilPortalHvisAktuelt` har ingen busy-sperre (en delt boolean ville blokkert HELT VANLIGE rader
   ved f.eks. lim inn av flere chassisnumre samtidig - SQL-funksjonen har sin egen advisory-lock-idempotens); enhver USIKKER feil (nettverk, tidsavbrudd, funksjonen finnes ikke) gir `{tilknyttet:false}`
   og faller tilbake til vanlig oppretting (riktig for det store flertallet av rader, som ikke er portal-tilknyttet); en KJENT forretningsfeil fra wrapperen selv (`UGYLDIG_INPUT: chassis`, `KUN_ADMIN` -
   kastet ETTER at raden er bekreftet portal-tilknyttet) gir i stedet `{tilknyttet:true}` og en tydelig advarsel, slik at fallback aldri lager en ikke-koblet ordre med et nummer databasen nettopp avviste
   uten at noen fikk vite det. Chassis normaliseres fullt i `cellEdited` (mellomrom/bindestrek fjernet, ikke bare store bokstaver) - ellers kunne `admin_ark.chassis_nr` (rå tekst) og `ordrer.chassis`
   (normalisert av SQL-funksjonen) bli to ulike strenger som aldri matcher via `samsvarerChassis()`. «Koblet»-toasten (chassis fantes alt på en aktiv ordre) vises bevisst IKKE grønn: ordren er ikke
   endret og forhandleren får ikke status, og teksten sier det rett ut (Henriks valg, spurt direkte - alternativet var å stemple `portal_bestilling_id` på den eksisterende ordren, avslått pga. risikoen
   for at Bekreft da kjører automatikk på en ordre som kan være i arbeid). **Kjent, bevisst valgt:** mister klienten SVARET fra en vellykket kobling (nettfeil rett etter at databasen har opprettet
   portal-ordren), faller den tilbake til å lage en VANLIG, ikke-koblet ordre - i sjeldne tilfeller kan det da finnes to ordre for samme bil (én portal-koblet, én ikke). Vurdert mot alternativet (ingen
   ordre i det hele tatt ved enhver usikker feil, som rammer alle vanlige rader) og bevisst latt være endret.

## Importerte biler til portalen (aktive biler i selgernes «Mine bestillinger», etappe 1, skrevet 2026-11-10, IKKE kjørt og IKKE utrullet)

Henriks ønske: de aktive bilene i appen skal stå i selgernes «Mine bestillinger» hos Forhandlerportalen, med status. **Portalen eier alt som lages** (matching mot forhandler, oppretting, skjuling, godkjenning per kunde); appen gir bare et
SKRIVEBESKYTTET øyeblikksbilde, og skriver aldri til portalen. Portalen skriver heller aldri hit, så en lekket hemmelighet kan aldri skape rader hos forhandlerne (den kan bare lese). Hele opplegget er bygget HVILENDE (modus AV i portalen).
Appsiden er kun SQL og en edge-funksjon: **ingen `js/*.js`, ingen `sw.js`-bump, ingen forsinkelse å vente på for klientene** (bruk `git diff --stat -- js sw.js salmakern.html`: skal være tomt).

**Filer:** `migrations/20261110200000_portal_import_fakta.sql` (funksjonen), `functions/portal-import-fakta/index.ts` (døra inn) og `logikk.ts` (ren validering, ingen Deno-API-er), `tester/portal_import_fakta_TEST_body.sql`,
`rollback-referanser/portal_import_fakta_ROLLBACK.sql`, Vitest `test/portal-import-fakta.test.js` med gullfila `test/fixtures/portal-import-fakta-svar.json` (byte-lik portalens kopi i portal-testmappen).

**Postgres-funksjonen `portal_import_fakta(p_ider text[] default null) returns jsonb`:** `stable` + `security invoker` (Postgres avviser en skriving i en stable-funksjon, og den får ingen utvidede rettigheter), og BARE `service_role` kan kalle den (revoke fra
public/anon/authenticated). Den leser `ordrer`, `innstillinger` (rad `id = 1`, `kontakter`) og `portal_bestillinger`. Svaret er `{versjon: 1, generert, aktive, utvalgte}`:
- `aktive`: ALLE bil-ordrer (`ordretype = 'bil'`) som ikke er arkivert, sortert på `ordre_id`, høyst 500 (ellers `FOR_MANGE_AKTIVE`). «Arkivert» er `coalesce(nullif(btrim(status), ''), 'aktiv') = 'arkivert'` (som appens UI), ikke `status = 'aktiv'` strengt slik `portal_koble_bestilling` har det (ingen forskjell i dagens data).
- `utvalgte`: én oppføring per id i `p_ider` (dedupet, sortert): hele raden pluss `finnes: true` (uansett ordretype og status), eller bare `{ordre_id, finnes: false}`. Portalen ber om id-ene til importradene den har, for å få positivt bevis før den skjuler en.
- Hver rad har ALLTID 15 felt: `ordre_id, ordretype, kunde, chassis, eier, merke, modell, ordre_status, status, opprettet, kontakt_treff, kontakt_id, kontakt_navn, kontakt_orgnr, portal_bestilling_ider` (null er eksplisitt). `ordre_status` er `coalesce(nullif(btrim(..), ''), 'ikke_paabegynt')`: portalen regner «hentet» av den, aldri med `<>` (utelater NULL).
- **Normalisering skjer BARE her:** `kunde`, `eier`, `merke`, `modell` og kontaktnavn renses likt (de 92 tegnene i `c_skjult` fjernes: styrekoder unntatt tab/linjeskift/CR, DEL og C1, myk bindestrek, nullbredde- og retningstegn, U+2060-U+206F, U+FEFF, U+FFF9-U+FFFB; hvitt mellomrom blir ett mellomrom; trimmet; kappet til 200 tegn og trimmet på nytt), `chassis` er store bokstaver uten mellomrom og bindestrek (kappet til 40),
  org.nr er bare siffer (høyst 20). Kontakter med tom id eller id over 120 tegn utelates. Appens SQL kapper selv, slik at en lang tekst tastet av en ansatt aldri gir ugyldig svar for hele importen. **Tegnklassen er skrevet med u-escapes, ikke rå tegn** (rå usynlige tegn forsvinner ved kopiering, og et rått U+2028 i et regex er en syntaksfeil): kontroller etter enhver redigering at filen ikke inneholder noen tegn i U+200B-U+200F, U+202A-U+202E, U+2060-U+206F eller U+FEFF (et lite skript som leser filen som UTF-8 holder; Write/Edit-verktøyene kan gjøre u-escapes om til rå tegn, og det er nettopp det som skal fanges).
  **Mellomrom-klassen er utvidet utover `\s`** (`c_mellomrom`/`c_chassis_ut`: `\s` pluss uttrykkelig nbsp og de andre Unicode-mellomrommene): hva `\s` regner som mellomrom avhenger av databasens `lc_ctype` (målt lokalt i PGlite: `\s` matcher ikke nbsp, selv om spesifikasjonens måling mot portal-databasen sa det motsatte), og resultatet skal ikke avhenge av det.
- `kontakt_treff` = antall Forhandler-kontakter med samme rensede navn som kunden (uavhengig av store/små bokstaver); `kontakt_id/-navn/-orgnr` settes bare ved nøyaktig ett treff. `kontakter` som ikke er en JSON-liste gir 0 treff, aldri feil.
- `portal_bestilling_ider` = portalens `Bestilling.id`-er appen kjenner for ordren: `ordrer.portal_bestilling_id`, `portal_bestillinger.ordre_id`, og `portal_bestillinger` med `ident_type = 'CHASSIS'` og `ident` = ordrens chassis (de to siste med `status <> 'avvist'`: en slettet ordres gravstein teller ikke).
- `p_ider` valideres (høyst 500, hver `^[A-Za-z0-9_.-]{1,64}$`): én rar id avviser HELE kallet (`UGYLDIG_INPUT: ider`), og portalen sender aldri en slik id. Ordrens egen id valideres ikke (en eldre id utenfor mønsteret står i `aktive`; portalen håndterer den).

**Edge-funksjonen `portal-import-fakta` (bare svarer):** `POST` med `{versjon: 1, ider?: string[]}` (høyst 500 id-er, body høyst 65 536 byte). Rekkefølgen er bevisst: metode (alt annet enn POST gir 405, ingen CORS) → hemmelighet → størrelse → JSON og `parseForesporsel` → `rpc` → `mapFakta`. Utrullet med standard `verify_jwt` (som `portal-bestilling`):
portalen sender anon-nøkkelen som `Authorization` og `apikey`, og i tillegg headeren `x-salmakern-hent-secret` = `SALMAKERN_HENT_SECRET` (Henriks valg 9: samme hemmelighet som selgerlisten, nå brukt i MOTSATT retning, portal til app), minst 32 tegn, sammenlignet i konstant tid via SHA-256, og både miljøvariabelen og headeren trimmes (en hemmelighet limt inn med linjeskift skal ikke gi evig 401).
Feilsvar er bare `{kode, felt?}`, aldri databasetekst: 400 `ugyldig_input` (versjon/ider/body), 401 `uautorisert`, 405 `metode_ikke_tillatt`, 413 `ugyldig_input` (body), 422 `for_mange_aktive`, 500 `ikke_konfigurert` (hemmelighet eller Supabase-nøkkel mangler), 502 `intern_feil` (databasefeil, tidsavbrudd etter 25 s, uventet svarform). Suksess er `200 {ok: true, versjon, generert, aktive, utvalgte}` med `Cache-Control: no-store`; `mapFakta` avgrenser svaret til nøyaktig kontraktens felt (ekstra felt kastes, ukjent form gir 502).
Én logglinje per kall, bare tall og faste koder (`{portal_import_fakta: 1, fn, utfall, http, ms, antall_aktive, antall_utvalgte, antall_ider}`; ved databasefeil også `sqlstate`, som skiller f.eks. 57014 tidsavbrudd og PGRST202 «funksjonen er ikke kjørt inn ennå»), aldri id-er, navn, chassis eller hemmeligheter.
**Funksjonen har INGEN skrivende kall og ingen utgående nettverkskall:** det eneste databasekallet er `rpc('portal_import_fakta')`, ingen push, ingen e-post, ingen import fra søsken-funksjoner (kildetekst-test V6). Kontrakten er versjon 1; grensene (500 id-er, 500 aktive, 65 536 byte, 15 s klienttidsavbrudd hos portalen, 25 s her) må endres sammen i begge ender.

**Rekkevidden til `SALMAKERN_HENT_SECRET` har økt (A6):** hemmeligheten ga før bare lesetilgang til selgerlisten og rabattsatsene den beskyttet. Nå gir den også lesetilgang til kundenavn, kontaktpersoner (eier-tekst) og chassis.nr for ALLE aktive ordrer (opptil 500 rader). Den som kan lese Vercel-miljøet (eller Supabase-hemmelighetene) kan dermed hente det.
Det er en bevisst følge av valg 9; en egen `SALMAKERN_IMPORT_SECRET` er billig å innføre senere (ett navn i portalens `lib/import/konfig.ts` og i funksjonen, og et nytt hemmelighetspar). Verdien skal aldri leses opp eller limes inn i chat; `npx supabase secrets list --project-ref qoqpenbfdxeduylxirwk` viser bare navn og digest. At hemmeligheten er satt og lik i Vercel Production og som Supabase-hemmelighet er IKKE verifisert.

**Utrulling (hvert steg krever Henriks eget ja; portalen legges ut FØRST, se portalens CLAUDE.md):**
1. SQL-testen i en rullet-tilbake transaksjon (ikke mellom 00:00 og 03:00 norsk tid; den lager en midlertidig funksjon og rader):
   `( echo "begin;"; cat supabase/migrations/20261110200000_portal_import_fakta.sql; cat supabase/tester/portal_import_fakta_TEST_body.sql; echo "rollback;" ) > "$TEMP/t.sql"` og
   `npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"`. Alle rader skal være OK; etterpå skal `to_regprocedure('public.portal_import_fakta(text[])')` fortsatt være null.
2. Migrasjonen: `npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file supabase/migrations/20261110200000_portal_import_fakta.sql`. Kontroller: funksjonen finnes, `service_role` har `execute`, og `anon`/`authenticated` har det ikke.
3. Edge-funksjonen: `npx supabase functions deploy portal-import-fakta --project-ref qoqpenbfdxeduylxirwk --use-api` (begge filene lastes opp). Kontroller UTEN hemmeligheten: POST gir 401 `{"kode":"uautorisert"}`, GET gir 405.
- **Rollback:** (1) sett importen til modus AV i portalen (`/admin/import-bestillinger`) FØRST, så portalen slutter å kalle funksjonen; (2) `npx supabase functions delete portal-import-fakta --project-ref qoqpenbfdxeduylxirwk`; (3) `supabase/rollback-referanser/portal_import_fakta_ROLLBACK.sql` (`drop function`; migrasjonen endrer ingen data). Feil rekkefølge er ufarlig (502 hos portalen, og et feilet faktakall gir ingen endring av synlighet der).

**Testet (2026-11-10, lokalt):** Vitest `test/portal-import-fakta.test.js` (50 tester: `parseForesporsel`, `mapFakta` mot gullfila, `mapFeil`, hele håndtereren mot falsk Deno og en falsk klient som bare har `rpc`, kildetekst-vakt, hemmelighetssammenligning). Mutasjonskjøring av edge-funksjonen mot testen (42 mutanter: hemmelighetssjekken, lengdekravet, trim, `===`, rekkefølgen på sjekkene, grenser, validering, `fetch(`/`.from(`/`send-push`, databasefeilteksten i svar og logg, `mapFakta`-strengheten osv.): alle drept bortsett fra to ekvivalente (en ekstra lesing av body uten virkning på svaret, og regex-sjekken av tidspunktformatet, som er overflødig ved siden av `toISOString()`-sammenligningen).
SQL-testen (`tester/portal_import_fakta_TEST_body.sql`, sjekkene S1-S15, 65 rader) er kjørt mot **PGlite (Postgres 17 i WASM) lokalt**: 65 av 65 OK, og 39 av 40 mutasjoner av funksjonen (fjernet `status <> 'avvist'`, `coalesce`, `ordretype`, tegnklassen, kappingen, `grant ... to authenticated`, `volatile` osv.) ble drept av en sjekk; den siste (bare `ordretype = 'bil'` i `where`) er ekvivalent fordi `er_aktiv` har samme vilkår, og fjernes vilkåret fra `er_aktiv` (alene eller sammen med `where`) dreper S6 den. **SQL-testen er IKKE kjørt mot den ekte databasen** (det er et skrivende steg som krever Henriks ja). PGlite har en annen `lc_ctype` enn appens database (`en_US.UTF-8`), så `lower()` for Æ/Ø/Å og mellomrom-klassen er de stedene en forskjell kunne dukke opp der: det er første sjekk å se på hvis en rad feiler.

## Lager: hyller og bestillinger (2026-11-03)

Migrasjon `20261103200000_lager_hyller_og_bestillinger.sql` (kjørt 2026-11-03 etter Henriks ja; testet først i en rullet tilbake transaksjon, 28 av 28 kontroller; `supabase/tester/lager_hyller_og_bestillinger_TEST_body.sql`).

- `lager_hyller` (`id`, `kode`, `navn`, `rekkefolge`): koden er unik på `upper(kode)` og begrenset til `^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$` (den står i QR-lenken). `lagervarer.hylle_id` refererer med `on delete set null`: en slettet hylle sletter aldri varer.
- `lager_bestillinger`: én rad per vare per bestilling (`antall` eller `ukjent_antall`, `leverandor`, `bestilt_dato`, `forventet_dato`, `status` apen/mottatt/kansellert, `mottatt_*`). Sletting av en vare tar bestillingene med (`on delete cascade`).
- RLS på begge (`krever_innlogget_ansatt`, som resten) og begge i Realtime-publikasjonen. Appen skiller admin/ansatt selv (bare admin registrerer/kansellerer/oppretter hyller); databasen krever bare en innlogget ansatt, som for `lagervarer`.
- RPC-ene (SECURITY DEFINER, `search_path = public`, krever `current_ansatt()`): `lager_registrer_bestillinger(jsonb)` (opptil 500 rader, setter `bestilt = true`), `lager_motta_bestilling(id, antall, ansatt, kommentar)` (radlås på bestilling og vare, øker beholdningen, skriver lagerhistorikk `inn`, setter `bestilt` etter gjenværende åpne bestillinger, `IKKE_APEN`
  hvis den allerede er mottatt/kansellert), `lager_kanseller_bestilling(id)`.
- **`endre_lagervare_antall_batch` er endret**: den nullstilte `bestilt` så snart beholdningen kom over minimum, også med en åpen bestilling (f.eks. en delleveranse). Nå nullstilles flagget bare uten åpen bestilling. Resten er uendret (hentet fra databasen før endringen).
- Rollback: `drop function` for de tre nye, tilbakestill `endre_lagervare_antall_batch` til forrige definisjon, `drop table lager_bestillinger`, `alter table lagervarer drop column hylle_id`, `drop table lager_hyller`.

## Prislås (s09-023/s05-003, 2026-10-30/31)

Fryser pris og mva-type på en fakturalinje når den legges til/endrer produktnummer, i stedet
for å la `fiken-fakturer` hente Fikens pris slik den er DEN DAGEN fakturaen opprettes - en
prisendring i Fiken (prissynk) mellom bestilling og fakturering skal ikke lenger endre det
kunden faktureres uten at noen merker det. Rabatt-% fryses bevisst IKKE - den er kundespesifikk
(`fiken_kunde_rabatt`) og kjent først ved fakturering, og det er ikke rabatten prissynk endrer.

1. **`fiken_priser`** (migrasjon `20261030220000`): lokal kopi av Fiken sine produktpriser
   (produktnummer, navn, pris_kr, mva_type, konto), fylt av en egen edge-funksjon i stedet for
   et live Fiken-kall per linje/avkrysning i Lager/Utstyr. Kun lesing for klienten.
2. **`fiken-priser-synk`**: egen edge-funksjon (egen hemmelighet `FIKEN_PRISER_SYNK_SECRET`,
   ALDRI delt med `FIKEN_SYNC_SECRET` - denne skriver til databasen, ikke bare leser) som
   henter hele Fiken sin produktliste og upserter inn i `fiken_priser`. Kalt av en planlagt
   `pg_cron`-jobb (`fiken-priser-synk-cron`, migrasjon `20261030231000`) hver 6. time.
   Hemmeligheten ligger også i Supabase Vault (`fiken_priser_synk_secret`, satt via en
   engangskommando som ALDRI ble committet - samme mønster som ordre-push-triggeren over) slik
   at cron-jobben kan sende den i `x-sync-secret`-headeren.
3. **`oppdater_ordre_fiken_linje` / `oppdater_ordre_fiken_linje_ved_id`** (samme migrasjon):
   fryser `pris`/`mva`/`kilde`/`tidspunkt` fra `fiken_priser` når en linjes produktnummer er
   NYTT eller endret seg. Samtidig fikset en reell bug: begge funksjonene brukte
   `jsonb_set(..., p_linje)`, som ERSTATTER hele linje-elementet med det klienten sender - en
   allerede frosset pris kunne dermed forsvinne hvis en eldre klient bare endret `antall`.
   Flettes nå felt for felt (`eksisterende || ny`) i stedet.
4. **`fiken-fakturer`**: en linje med `pris`+`mva` satt sender nå `unitPrice`/`vatType`
   eksplisitt til Fiken i stedet for å la Fiken fylle inn dagens pris. Linjer uten frosset pris
   (lagt til før denne endringen, eller et produktnummer uten rad i `fiken_priser`) er helt
   uendret - ingen `unitPrice` settes, akkurat som før.
5. **Engangs-backfill** (kjørt manuelt 2026-10-31, ikke en migrasjonsfil): fryste pris+mva på
   131 eksisterende linjer på 96 ufakturerte ordrer (19 linjer uten treff i `fiken_priser`,
   typisk Drivstoff, fikk bevisst ingen pris). Backfillede linjer er merket
   `kilde: "fiken_priser_backfill"` (til forskjell fra `"fiken_priser"` for linjer frosset via
   den vanlige flyten), så de kan skilles fra og reverseres isolert -
   `rollback-referanser/prislas_backfill_20261030_ROLLBACK.sql`.

Live-verifisert i en rollback-transaksjon (7 scenarier mot `fiken_priser`-oppslag og
flette-fiksen) og med 276 ekte produkter synket inn fra Fiken (spotsjekket mot kjente priser).
Samme synk svarte også det siste ubesvarte spørsmålet i s08-012: alle 276 Fiken-produkter med
fast pris har mva-type `high`, ingen unntak.

## Fiken gir fakturastatus tilbake (s90-20261104-5, Henriks valgte steg 1 i automatiseringsplanen 4.11, deployet 2026-11-13)

«Fakturert» i appen betydde tidligere bare at en KLADD var laget i Fiken (`fiken-fakturer`
lagrer `fiken_kladd_url`+`fakturert=true` samtidig) - appen fikk aldri vite om kladden faktisk
ble sendt, betalt eller slettet i Fiken (Henriks vurdering: «største pengerisiko»). Dette er
FØRSTE, minste steg: kun lesing (GET-only mot Fiken) og lagring av statusen - ingen varsler/UI
ennå (kommer i senere steg).

1. **Nye kolonner på `ordrer`** (migrasjon `20261104220000`, kjørt 4.11): `fiken_faktura_status`
   (`kladd`/`sendt`/`betalt`/`kladd_borte`/`ukjent`, NULL = ikke sjekket), `fiken_kladd_uuid`,
   `fiken_faktura_referanse` (øyeblikksbilde av `orderReference`-teksten satt av `fiken-fakturer`
   DA kladden ble opprettet - ALDRI regnet ut på nytt fra ordrens nåværende chassis/regnr, se
   punkt 2), `fiken_faktura_id`, `fiken_faktura_status_sjekket_at`.
2. **`fiken-faktura-status-synk`**: egen edge-funksjon (egen hemmelighet
   `FIKEN_FAKTURA_STATUS_SYNK_SECRET`, samme mønster som `FIKEN_PRISER_SYNK_SECRET` - skriver
   til databasen, aldri delt med `FIKEN_SYNC_SECRET`) som henter alle ufakturerte-ikke-betalte
   bil-ordre med en kladd (maks 50 per kjøring) og for hver: GET kladden (200 = fortsatt kladd,
   uuid lagres for senere presist oppslag), 404 = borte - slå opp via `invoiceDraftUuid` (presist,
   krever lagret uuid) eller fall-back på det FROSNE `fiken_faktura_referanse` (aldri et
   nyutregnet regnr/chassis, siden regnr ofte legges inn ETTER fakturering); nøyaktig ett treff
   gir `sendt`/`betalt` (fra fakturaens `sale.settled`), null treff gir `kladd_borte`, flere treff
   er for usikkert å gjette = `ukjent`. Sekvensielle GET-kall (ALDRI `Promise.all`) - Fiken
   tillater kun én samtidig forespørsel. `kladd_borte`/`ukjent` er bevisst IKKE endelige og
   sjekkes på nytt hver kjøring (kun `betalt` er reelt endelig). Hver ordre i egen try/catch - én
   feilet rad velter aldri resten. Kalt av en planlagt `pg_cron`-jobb
   (`fiken-faktura-status-synk-cron`, migrasjon `20261113100000`) hver 6. time, 20 min forskjøvet
   fra `fiken-priser-synk-cron`. Hemmeligheten ligger også i Supabase Vault
   (`fiken_faktura_status_synk_secret`, satt via en engangskommando som ALDRI ble committet)
   slik at cron-jobben kan sende den i `x-sync-secret`-headeren.
3. **Allerede bygget av en tidligere økt** (edge-funksjon + 14 grønne tester
   `test/fiken-faktura-status-synk.test.js` + DB-migrasjon kjørt), men aldri utrullet - denne
   runden fullførte bare utrullingen (hemmelighet satt, Vault speilet, funksjon deployet,
   cron-jobb opprettet) og den faktiske live-verifiseringen.
4. **Live-verifisert 2026-11-13** med et ekte kall mot den utrullede funksjonen: 33 kandidat-
   ordre, `{kladd:1, sendt:2, betalt:0, kladd_borte:0, ukjent:30, feilet:0}`. De 30 «ukjent» er
   FORVENTET, ikke en feil: det er ordre fakturert FØR denne kolonnen/funksjonen fantes, uten
   lagret uuid eller referanse å slå opp på (`fiken_faktura_referanse` ble aldri bakfylt for
   eksisterende rader - bevisst, se punkt 1 om hvorfor et nyutregnet oppslag er utrygt). Nye
   fakturaer fra og med 4.11 (da kolonnen kom) får `fiken_faktura_referanse` satt direkte av
   `fiken-fakturer` ved opprettelse, og fanges som `kladd` (med uuid lagret) allerede neste
   kjøring mens kladden fortsatt finnes - de blir derfor sporbare presist fremover.
5. **Senere steg (ikke bygget)**: vise statusen i ordredetaljens Fakturering-kort, varsel ved
   `kladd_borte`/en lenge usendt kladd, og en måte å løse de 30 historiske «ukjent»-ordrene
   manuelt (Henrik må bekrefte identitet - ingen automatisk gjetning).

## Backup-status (sjekket 2026-08-24)

Daglige fysiske backups er aktivert (`walg_enabled: true`) - prosjektet har
åtte dagers historikk med fullførte daglige snapshots. **Point-in-time
recovery (PITR) er derimot IKKE aktivert** (`pitr_enabled: false`) - man kan
altså gjenopprette til begynnelsen av en gitt dag, men ikke til et vilkårlig
tidspunkt midt på dagen (f.eks. "ti minutter før noen slettet feil ordre ved
et uhell"). PITR er et betalt tillegg i Supabase og krever et bevisst valg om
å oppgradere - ikke gjort her, siden det er en kostnadsbeslutning.

**Oppdatering 2026-08-24**: Henrik fikk prisen (7 dager ~$100/mnd, 14 dager ~$200/mnd,
28 dager ~$400/mnd - siden dere allerede har daglige backups er dere trolig på Pro-planen,
så dette kommer i tillegg) og valgte bevisst å IKKE aktivere PITR - daglige backups er nok
for en virksomhet i denne størrelsen. Ikke ta opp igjen med mindre noe endrer seg
(f.eks. mye høyere transaksjonsvolum, eller et konkret hendelse som gjør at det plutselig
er relevant).
