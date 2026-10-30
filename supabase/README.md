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

## Bestillinger fra Forhandlerportalen («Bestill», fase 2, 2026-10-30)

Forhandlerportalen sender en bestilling (chassis.nr eller serienummer, forhandler, selger, modell) hit. Tre lag, alle testet hver for seg:

1. **Tabeller og kolonner** (`20261030200000_portal_bestilling_grunnlag.sql`): `portal_bestillinger` (ett utfall per bestilling), `portal_modell_kobling`
   (portalens modell-slug til appens merke/modell, godkjent av Henrik), og tre nullable kolonner på `ordrer`. Bare admin leser dem.
2. **Postgres-funksjonen `portal_koble_bestilling(p jsonb)`** (`20261030210000_portal_koble_bestilling.sql`): all forretningslogikk. Kobler til en eksisterende
   ordre, oppretter ny ordre «På vei» (ikke bekreftet fra portal, i nøyaktig samme form som appen lager den), lager en løs rad i Admin-ark (serienummer) eller
   legger bestillingen til avklaring. Idempotent på portalens bestilling-id; en slettet portal-ordre gjenopplives aldri (gravstein). Kan KUN kalles av
   `service_role`. Test: `tester/portal_koble_bestilling_TEST_body.sql` (47 sjekker, alltid i en transaksjon som rulles tilbake; kjøring står øverst i filen).
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
   **Kontrakten for portalen:** påkrevd `bestilling_id` (8-64 tegn A-Za-z0-9_-, portalens id), `nr`, `ident_type` (`CHASSIS` | `SERIENUMMER`), `ident`; valgfri
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
   **Funksjonen er utrullet, men INGENTING kaller den ennå** (portalen sender først når koblingen slås på, G11). Livetest 2026-10-30: uten nøkkel 401 (porten),
   uten/med feil hemmelighet 401, GET 405, ugyldig chassis/JSON 400, for stor body 413, ukjent kontakt 200 `venter_forhandler` (og samme svar ved gjentatt kall).

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
