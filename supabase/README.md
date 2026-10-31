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
   også sende anon-nøkkelen som `apikey`/`Authorization`. Bare ti navngitte felt slippes gjennom til databasen (`kjor_pa_nytt` kastes alltid), og et
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
   grense mot en ansatt som går forbi appen (RLS på `ordrer` tillater alle innloggede ansatte å endre/slette direkte). Test: `tester/portal_bekreft_avvis_TEST_body.sql` (43 sjekker, rullet tilbake). Rollback:
   `rollback-referanser/portal_bekreft_avvis_ROLLBACK.sql` (appkoden må rulles tilbake først). Appdelen (merke, filter, banner, knapper) står i rotens CLAUDE.md og testes av `test/portal-ordre-visning.test.js`.

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
