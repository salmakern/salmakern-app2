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

**Realtime utelater STORE uendrede kolonner (TOAST, målt 2026-11-02)**: en UPDATE-hendelse har IKKE
med en stor, eksternt lagret kolonne som ikke ble endret av akkurat den oppdateringen. Målt mot ekte
`ordrer` med en TEST-ordre (urelatert kolonne endret): en 160 KB `bilder_levering` manglet (69 av 70
felter), mens små eksterne kolonner (`endringer` og `dokumenter`, under ca. 2 KB) alltid kom med.
På en test-tabell (12,8 KB, med og uten RLS) manglet feltet også. I praksis kan det altså mangle:
`bilder_*` og `signatur` på ordrer med bilder/signatur (5/2/5 ekte rader 2026-11-02), og
`innstillinger.kontakter` (19 KB). Å bygge objektet på nytt fra `p.new` ga da en tom bildeliste/
signatur lokalt, og `save()` (som fortsatt skriver `bilder_*`/`signatur` fra den lokale kopien)
kunne skrive det tomme tilbake til databasen. Derfor bruker ordre-handleren
`dbToOrdreFraRealtime(gammel, p.new)` (beholder lokal verdi for kolonner som MANGLER i raden;
kolonne→egenskap utledes av `dbToOrdre` selv, så nye kolonner følger med), og innstillinger-
handleren sjekker `'kolonne' in row` før den overskriver. **Ny Realtime-handler som erstatter et
helt objekt fra `p.new` → bruk samme mønster.** Vakt: `test/realtime-manglende-felt.test.js`.
**Dette forklarer IKKE meldingene om at Vegvesen-dokumenter «forsvinner» eller at sletting «tar
alle»**: `dokumenter` kom med i alle målinger, og sletting i den åpne appen (to flåteordrer, 14 s
observert) fjernet bare det valgte dokumentet. Årsaken til de meldingene er ikke funnet; be om
konkrete steg/skjermbilde før du jager den videre.

**Vegvesen-dokumentnavn (2026-11-02)**: filnavnet er `<type>-<chassis eller flåtenummer>.pdf`, og
flåtenummeret er et fritt redigerbart navn. Lagringen erstatter bare en linje med SAMME navn, så
`vegvesenFjernAndreVersjonerAvType()` fjerner andre versjoner av samme type med et annet navn når et
nytt dokument lagres (ellers ble det dobbelt opp ved omdøping/flytting inn og ut av flåte). Filen i
Storage slettes bare hvis ingen annen ordre peker på den. «Skriv ut» velger nyeste per type.
Vakt: `test/vegvesen-utdaterte-versjoner.test.js`.

**Diagnostikk: dokumentlista som krymper på skjermen (2026-11-02, årsak IKKE funnet)**: de ansatte
melder at dokumenter «forsvinner» eller at sletting «tar alle», men at de er tilbake etter F5 (altså
intakt i databasen, bare visningen blir tom). Koden observerer symptomet i stedet for å gjette
(`dokumentKrympingSjekk()` i `core.js`, kalt fra `dokumenterListeHTML()`): krymper lista med minst 2
uten at appen selv fjernet så mange (`dokumentTapBevisst()`: `slettDokument` melder 1 per ordre,
fjerning av utdaterte/genererte melder antallet), spørres databasen om fasit-antallet. **Bare hvis
databasen har FLERE enn skjermen viser** sendes én Sentry-melding, «Dokumentliste krympet på
skjermen, men databasen har dokumentene» (tag `omraade:dokumentliste`, maks én per minutt per ordre).
Den inneholder kun ordre-id, antall (før/skjerm/database), `objektUtskiftet` (S.ordrer-objektet er byttet
ut under visningen), `ignorertRealtime`, `aktivOrdre`, synlighet, online, rolle og `logg`: de siste ~40
hendelsene fra `dokLogg()` (`rt_update` fra→til, `rt_ignorert`, `rt_status`, `full_innlasting`,
`oppdater_aktiv`, `dok_lagre`, `dok_slett`, `synlighet`), ingen navn, URL-er eller chassis. Er databasen
enig i krympingen (en kollega slettet) sendes ingenting. **Les Sentry for denne meldingen før du
jager feilen videre**: loggen viser hva som skjedde rett før (f.eks. en forsinket `rt_update` med
færre dokumenter, en `full_innlasting`, eller `objektUtskiftet: true`). Vakt:
`test/dokument-krymping-diagnostikk.test.js`.

**Chassis-sammenligning**: bruk alltid `samsvarerChassis(a, b)` (case-uavhengig + trim), ikke
`===` direkte - chassisnummer kan skrives inn med ulik store/små bokstaver flere steder i
appen (Admin-ark, ordre, flåte).

**Chassis.nr vises HELT på ordrekortet og i ordredetaljen (2026-11-02)**: nummeret er aldri avkortet (ingen RTL/ellipsis-
knep, `CHASSIS_TRUNKER_STIL` er fjernet) og aldri delt midt i (`CHASSIS_HEL_STIL` = `white-space:nowrap`, i `ordre-detalj.js`).
Raden har `flex-wrap:wrap` og venstrekolonnen `flex:1 1 0` uten `overflow:hidden`/`min-width:0`, så nummerets bredde utløser
bruddet: er det ikke plass ved siden av, havner statusknappen UNDER nummeret. Kundenavnet på kortet har `width:0;min-width:100%`
så det avkortes med «…» uten å presse kortet bredere. Kontrollert på 393, 360 og 320 px (kortet er ca. 327 px på en smal
iPhone). Vakt: `test/chassis-hele.test.js`. NB: `max-width:100px` på `.ordre-status-dropdown` under 480 px virker ikke (inline
`max-width:100%` fra `statusDropdown()` vinner), og det er bevisst latt stå siden statusnavnet skal være lesbart.
I ordredetaljens header (2026-11-02, Henrik: «veldig mye plass som ikke blir brukt») står «Vedtak» på SAMME rad som «Aktiv»-pillen (egen flex-rad
under statusknappen, PORTAL-merket under raden); headeren gikk fra ca. 113 til 88 px. Vakt i `test/chassis-hele.test.js`.

**Frakt-e-post med henteklar-dato (2026-11-02)**: velger man en dato i dialogen «Bestill frakt» (Admin-ark), sendes den med i
bestillingen til fraktselskapet: «Bilen er klar for å bli hentet fra DD.MM.YYYY.» (HTML og ren tekst, mellom bilopplysningene og
signaturen; kontaktpersonen på kopi får samme e-post). Uten dato er e-posten som før; datoen er fortsatt valgfri for ekte
fraktselskap og påkrevd for «Hente selv» (egen `klar_for_henting`-e-post, uendret). Klienten sender `dato` (`adminArkSendFraktBestilling`),
og `send-frakt-epost/index.ts` formaterer den med `datoVisning()` (bare nøyaktig `YYYY-MM-DD`, alt annet gir ingen datolinje).
**Edge-funksjonen må rulles ut for at dette virker**: `npx supabase functions deploy send-frakt-epost --project-ref
qoqpenbfdxeduylxirwk --use-api` (klienten uten funksjonen er ufarlig: ukjent felt ignoreres). Test ALDRI med en ekte mottaker:
`test/frakt-epost.test.js` kjører hele funksjonen mot falsk Deno og falsk Resend.

**Ordre.vekter kan komme tom fra databasen (2026-11-02, tom Ordre-side for alle)**: `ordrer.vekter` har kolonne-default `'{}'`, og `save()` skriver ikke vekter (s09-005: vekter eies av RPC-ene
`oppdater_ordre_vekter_felt` m.fl.). Da den første NYE ordren siden 30.10 ble opprettet, kom den inn med `vekter = {}`, `dbToOrdre` beholdt det tomme objektet, `tvangsflyt()` leste `o.vekter.totalvekt.a` og
kastet, og `renderOrdreList` stoppet midt i lista: «67 ordrer», men ingen kort, for alle brukere. Rettet i to lag: (1) `normaliserVekter()` i `core.js` fyller alltid inn totalvekt/vogntog/foraksel/bakaksel med a/e/v
og beholder det som finnes (brukes av `dbToOrdre`; all kode kan fortsatt anta full struktur), og (2) hvert ordrekort i `renderOrdreList` bygges i try/catch (`ordreKortFeilHTML()`): en ordre som ikke lar seg tegne
gir ET lite feilkort + logg + Sentry-melding (bare ordre-id og feilmelding), aldri en tom liste for alle. Databasen er rettet samme dag (migrasjon `20261102150000_ordrer_vekter_default_og_rpc.sql`): hjelpefunksjonen `vekter_normalisert()` er sannhetskilden for strukturen, kolonne-defaulten bruker den (nye ordrer får full struktur), rammede rader er reparert, og `oppdater_ordre_vekter_felt` normaliserer før den setter feltene (før dette gjorde `jsonb_set` INGENTING når foreldrenøkkelen manglet, så vekter tastet inn på en ordre med `{}` ble aldri lagret, uten feilmelding). Vokter: `test/ordre-vekter-normalisering.test.js` (klient), `test/ordre-uventet-radform.test.js` (se under) og `supabase/tester/ordrer_vekter_default_og_rpc_TEST_body.sql` (database, kjøres i rullet-tilbake transaksjon). Lærdom: en ny kolonne/default i databasen er en
datatilstand klienten må tåle, ikke bare en verdi appen selv skriver; og skriver du IKKE en kolonne fra `save()`, må lesesiden normalisere den.

**Ordre i uventet radform skal aldri kunne blanke en liste (2026-11-02)**: `test/ordre-uventet-radform.test.js` laster HELE appen (`test/helpers/app-harness.js`, alle js/*.js i salmakern.html-rekkefølge, forenklet DOM) og bygger en ordre slik databasen lager den når
bare kolonne-defaultene brukes, ut fra et øyeblikksbilde av de faktiske kolonnene (`test/fixtures/ordrer-kolonner.json`). Deretter settes HVER kolonne, én om gangen, til hver verdi databasen tillater (NULL der den er nullable, `{}`, `[]`, tom tekst), og alle
ordrevisninger kjøres (Oversikt, Ordre-lista, Mer, Arkiv, ukekalender, rapporter, ordredetalj, Realtime-banen); ingen kombinasjon skal kaste eller logge feil. Kalibrert mot koden fra før rettelsen (kaster da i Ordre-lista og Mer). Går en ny kolonne/default
inn i `ordrer`: kjør `npm run sjekk-kolonner` (read-only, sammenligner databasen med øyeblikksbildet; `-- --skriv` oppdaterer det) og så `npm test`. Nattens QA kjører samme sjekk. **Rører du hva som lagres eller leses på en ordre (særlig det `save()` utelater, som
vekter), opprett en TEST-ordre med «+ Ny ordre» og åpne Ordre-lista, Mer og ordren FØR du pusher** - testene i dag brukte ferdig utfylte ordrer og så aldri raden databasen faktisk gir en ny ordre.

**Admin stempler ut en annen ansatt (2026-11-02)**: «Stemplet inn nå» (Oversikt, bare admin) har en «Stemple ut»-knapp per ansatt (`apneStempleUtModal`/`adminStempleUt` nederst i `js/timer.js`, modal `#stempleUt`). Admin velger klokkeslett (samme dag som innstemplingen; ikke i fremtiden, over 0 og høyst 16 timer),
og appen gjør det samme som den ansattes egen utstempling: timen registreres som `normal` med vanlig pauseregel (`beregnManuellMinutter`), ordre-klokka (Ombygging) stoppes, og `ansatte.stemplet_inn_siden` nullstilles. **Ingen databaseendring** (RLS lar admin sette inn `timer_entries` for andre, `ansatte_beskytt_skriving` lar admin skrive alt).
Rekkefølgen er laget for at lønn aldri går tapt eller dobles: (1) fersk lesing av stemplingen, (2) timen settes inn med FAST id `tadm_<ansatt>_<innstemplingen i ms>` (duplikat 23505 = «allerede registrert», så nye forsøk og to administratorer gir aldri to rader), (3) stemplingen nullstilles bare hvis den fortsatt er den som ble lest.
Feiler (2) skjer ingenting; feiler (3) står ansatten fortsatt stemplet inn og «Stemple ut» kan trykkes igjen. Den ansattes EGEN enhet har klokka gående lokalt: `sjekkAdminUtstempling()` (Realtime-handleren for `ansatte` i `core.js`, og ved oppstart) stopper den BARE når databasen viser tom stempling OG det finnes en `normal`-timeføring på
vedkommende opprettet etter at klokka startet, uten å registrere noe nytt. Ellers beholdes klokka (en mislykket innstemplingsskriving eller en urelatert oppdatering skal aldri slette en ekte klokke). Kjent rest: trykker den ansatte selv Stopp i samme sekund som admin stempler ut, kan tiden føres to ganger (admin ser det i timelista og sletter den ene). Admin-utstempling merkes bare via id-prefikset `tadm_` (ingen egen kolonne). Vakt: `test/admin-utstempling.test.js`.

**Bred gjennomgang 2026-11-02 (etter at Ordre-lista ble tom): hva som ble funnet og rettet**
- **Store tabeller lastes i sider (`hentAlleRader()` i `core.js`)**: `timer_entries` ble lastet med `.limit(300)` mens tabellen hadde 351 rader (og `lagerhistorikk` `.limit(500)` mot 944; Supabase kutter dessuten stille ved 1000). De eldste radene manglet i hver klient, så Månedsoversikt/Årsstatistikk/årstotaler regnet på ufullstendige data uten feilmelding. `ordrer`, `timer_entries`, `lagerhistorikk` og `admin_ark` går nå via `hentAlleRader(() => spørring.order(..).order('id'))` (sekundærnøkkel er påkrevd). Vakt: `test/hent-alle-rader.test.js`.
- **Bildelister (`normaliserBilder()`)**: `bilder_ankomst/levering` har default `'[]'`, og `[].every(Boolean)` er sant, så en ordre opprettet utenom appen så ut til å ha «6 bilder» uten ett bilde. `dbToOrdre` fyller nå alltid opp til faste plasser. `ordreKolonneKart()` prøver nå med både et objekt og en liste, ellers ville Realtime tømt kolonner normaliserere ignorerer for «feil» type.
- **Delte Storage-filer slettes aldri (`storageFilBrukesAvAndre()` i `ordre-diverse.js`)**: en Vegvesen-fil generert for en flåte står i dokumentlista til alle medlemmene men ligger under mappa til første, og en forhandlers fullmakt (`forhandlere/...`) er ÉN fil kopiert inn i mange ordrer. «Slett dokument», «Erstatt dokument» og «Slett ordre» slettet filen betingelsesløst og ga ødelagte lenker (24 delte flåtefiler og 2 delte fullmaktfiler i de ekte dataene). Filen slettes nå bare hvis ingen annen ordre/kontakt peker på den, og i «Slett dokument» først ETTER at lenkene er fjernet. Vakt: `test/delte-lagringsfiler.test.js`.
- **`autoFyllForhandlerFullmakt` skrev HELE `dokumenter`-kolonnen** fra økta sitt minne (overskrev kollegaers samtidige dokumenter, trolig én av årsakene til «dokumenter forsvinner»); bruker nå den atomiske `oppdater_ordre_dokument`.
- **Hver visning isoleres per element**: Oversikt-listene (aktive/ventende) og ukekalenderen har try/catch per kort/hendelse, som Ordre-lista (`ordreKortFeilHTML`). Kontakt-/kontaktperson-oppslag i `admin-ark.js` tåler manglende navn. Realtime-handlerne for `flater` og `lager_oppskrifter` beholder lokal verdi når den store kolonnen mangler i hendelsen.
- **Innlogging og klokke tåler blokkert lagring**: `initTimerPage()` kalles i try/catch i `tryLogin`, og klokka bruker `timerStartHent/Sett/Fjern` (svelger `localStorage`-feil; Edge Tracking Prevention, se feilsøkingsnotatet øverst).
- **Funnet, IKKE rettet (Henriks vurdering trengs)**: (a) offline-køen lagrer bare ordre-ID-er, og en full innlasting (`loadFromSupabase`) kan erstatte lokale, ennå ikke lagrede endringer; (b) `visOppdateringsToast` laster appen på nytt etter 10 s «uansett», også midt i skriving; (c) `eksportFiken` bruker alltid inneværende måned, og `eksportCSV` tar alle ansattes rader uten månedsfilter;
  (d) fakturalinjer uten `id` i databasen (latent) får bare en lokal id. Kartleggingen (28 agenter) ble avbrutt av brukergrensen før kontrollørene rakk å verifisere alle funn; de rettede er verifisert mot koden og ekte tall.

**Ny leveranse (ordre uten bil, 2026-11-03)**: Henrik trengte å legge inn en ordre uten bil, for å sende av gårde løsninger. En leveranse er en rad i `ordrer` med `ordretype = 'leveranse'` (alle andre er `'bil'`), så `fiken_linjer`,
timer, lagerbruk, dokumenter, logg, Realtime og offline-køen er de samme. Alt leveranse-spesifikt ligger i `js/leveranse.js` (lastes SIST i salmakern.html), og `erLeveranse(o)` (core.js) er veiviseren i resten av koden.
- **Database** (`20261103100000_ordretype_leveranse.sql`, kjørt): `ordretype` (check bil/leveranse), `leveranse` jsonb (merking, adresse, postnr, sted, kontaktTlf, fraktselskap, kolli, onsketHentedato, sporing, sendtDato, fraktAuto), og `frakt_bestilt_at/av/til`
  (settes BARE av edge-funksjonen send-frakt-epost, leses av klienten, skrives aldri av `ordreToDb`/`save()`). `portal_koble_bestilling` matcher nå chassis bare mot `ordretype = 'bil'` (en leveranse med samme chassis kan aldri kobles til eller telle som en bil-bestilling).
  Alle lesinger går gjennom `normaliserLeveranse()` (aldri rått), og `ordreToDb` tar bare med `ordretype`/`leveranse` for leveranser, så bil-ordrer lagres som før.
- **Identifikasjon**: chassis.nr, reg.nr ELLER «merking» (fri tekst), minst ett kreves, pluss kunde (trengs til Fiken). Tittelen (`leveranseTittel`) er merking, ellers reg.nr, ellers chassis. Samme chassis som en bil-ordre er lov (løsningen kan høre til en bil vi har).
- **Statusløype**: Under arbeid -> Klar til sending -> Sendt (`LEVERANSE_STATUSER`, bevisst ikke i `STATUSER`, så ingen bil-nedtrekk viser dem; `statusInfo` kjenner begge). «Fakturert» er den vanlige fakturert-markeringen. Sendt OG fakturert arkiveres automatisk
  (`leveranseSjekkArkiver`, kalt fra statusendring, `toggleFakturert` og `kallFikenFakturer`). Arbeidsklokka (`ordreTimerSessions`, «Arbeidstid») går mens den er «Under arbeid» og meldt på; ved statusbytte stoppes/startes den via `oppdater_ordre_timer_fase` som for bil-ordrer (ellers ville den gått videre etter «Sendt»). Ingen tvangsflyt (`tvangsflyt()` gir `[]`).
- **Fakturering til Fiken**: samme Fakturering-kort og `fiken-fakturer`. Edge-funksjonen tar et valgfritt `referanse` (merking, reg.nr og chassis det finnes av, maks 100 tegn) som Ordrereferanse i stedet for chassis; bil-ordrer sender ingen og får samme referanse som før.
  «Hent fra Utstyr-boksen» og drivstoff-knappen skjules for en leveranse. Kladden opprettes som vanlig (sendes fra Fiken).
- **Automatisk fraktbestilling på e-post**: settes statusen til «Klar til sending» (og automatisk bestilling ikke er slått av per leveranse, og fraktselskapet bestilles på e-post, dvs. ikke «Hente selv»/«Levering av oss») sender klienten `{type:'leveranse_bestilling', ordreId}` til
  `send-frakt-epost`. SERVEREN leser leveransen, slår opp fraktselskapets e-post i Kontakter (aldri fra klienten), kontrollerer kravene på nytt (adresse, postnr/sted, kunde, status), «claimer» bestillingen med én UPDATE ... WHERE `frakt_bestilt_at IS NULL` FØR den sender (samme bestilling går
  aldri ut to ganger, også ved to samtidige kall; testet med 5 parallelle), og frigir claimet hvis sendingen feiler. Admin kan «Bestill frakt nå» / «Send på nytt» (`paaNytt`, bare admin). Alt kjører med kallerens eget token (RLS), aldri service-nøkkel.
  NB: hvis `EDGE_AUTH_ENFORCE` slås på for send-frakt-epost, blir bare admin sluppet gjennom (TILLATTE_ROLLER), og en vanlig ansatt som setter «Klar til sending» får da en tydelig feil og admin må trykke «Bestill frakt nå».
- **Pakker og fraktpris (2026-11-03, bedt om av Henrik)**: `leveranse.kolliListe` er en liste av pakker (`antall`, `vekt` = kg per pakke, `lengde`/`bredde`/`hoyde` i cm), maks 50, og `leveranse.fraktPris` er fraktprisen i kr EKS. mva (det kunden belastes). Begge normaliseres i `normaliserLeveranse` (tall også med komma; negative/NaN/feil type blir tomt; antall minst 1);
  `leveranseKolliSum` gir antall/totalvekt/pakker uten vekt. Pakkene legges inn i Frakt-kortet (`leveransePakkerHTML`, `leggTilKolli`/`settKolli`/`fjernKolli`; bare pakke-blokken tegnes på nytt, så feltet man står i beholder fokus) og én pakke kan fylles ut allerede i «Ny leveranse». Pakkene (antall, vekt per stk, mål, totalvekt) står i
  fraktbestillingen på e-post (server-validert i `leveranseBestilling`); FRAKTPRISEN sendes aldri til fraktselskapet. «Legg frakt på fakturaen» (`leggFraktPaaFaktura`, bare admin) legger en fakturalinje med fast beløp (`belop`, 25 % mva, ingen rabatt, som drivstoff) via `oppdater_ordre_fiken_linje`; Fiken-produktnummeret for frakt oppgis på leveransen
  (`fraktProduktnr`, siste brukte huskes på enheten) fordi prislista ikke har noe frakt-produkt, og nummeret må finnes i Fiken. Er leveransen allerede fakturert, må admin bekrefte (linjen kommer ikke med i en kladd som allerede er laget). Ingen databaseendring (jsonb).
- **Push** (`send-push`): statustekstene finnes for leveranse-statusene, og varselet bruker merkingen («Leveranse X er sendt»), ikke den rå statuskoden.
- **Bil-ordrer og koblinger**: Admin-ark, flåter, «Ny ordre»-dublettsjekk og «Mer → til godkjenning» ignorerer leveranser (`!erLeveranse`), Oversikt-lista, tallene og ukekalenderen gjelder bare biler. Leveranser har sitt eget kort «Leveranser» nederst på Oversikt (`renderLeveranseOversikt` i `leveranse.js`, kalt fra `renderOversikt`): aktive leveranser gruppert i Under arbeid / Klar til sending / Sendt (venter på fakturering), med søk og «+ Ny leveranse»; ukjent status havner i «Under arbeid» så ingen leveranse kan bli usynlig. I Ordre-fanen har de LEVERANSE-merke og filteret «Leveranser (alle)».
- **Ikke gjort (bevisst, første versjon)**: ingen API-bestilling hos fraktselskap (venter på valg av selskap og nøkkel), og Arkiv-lista viser «Ankomst/Utstyr»-linjer som for biler.
- **Test**: `test/leveranse.test.js` (45), `test/frakt-epost-leveranse.test.js` (22, falsk Deno/PostgREST/Resend; ingen ekte e-post), `test/send-push-leveranse.test.js`, referansetestene i `test/fiken-fakturer-rabatt.test.js`, og `test/ordre-uventet-radform.test.js` kjører nå
  BÅDE bil- og leveranse-rader gjennom alle visninger (som admin og vanlig ansatt) og sjekker at ordredetaljen ikke viser en skjult feil. SQL: `supabase/tester/ordretype_leveranse_TEST_body.sql` (rullet tilbake). Live-test mot den ekte databasen 2026-11-03 med en TEST-ansatt (opprett, vis, rediger, last på nytt, slett;
  ingen statusendring/e-post/Fiken siden de ville sendt ekte push eller laget en ekte kladd). Kjent testmiljø-særtrekk: avsluttes en vitest-fil mens `me` er admin, dør worker-prosessen ved nedstenging (årsak ikke funnet), så testene setter `me` tilbake til en vanlig ansatt.

**Lager: hyller med QR, bestillinger og mottak (fase 1, 2026-11-03, bedt om av Henrik)**: lageret fikk hyller med QR-etikett, skanning, og registrering/mottak av bestillinger. Klientkoden ligger i `js/lager-hylle.js` (lastes etter `lager.js`), databasen i migrasjon
`20261103200000_lager_hyller_og_bestillinger.sql` (se `supabase/README.md`, «Lager: hyller og bestillinger»). Det du må vite:

- **Hylle**: `lager_hyller` (kort kode som `A1`, valgfritt navn; koden er unik uavhengig av store/små bokstaver og bare `A-Z a-z 0-9 _ -`, 1-20 tegn), og `lagervarer.hylle_id` (null = ikke plassert; slettes hylla, blir varene stående uten hylle). Hylle-nedtrekk i vare-skjemaet, «Plasser varer» (avkrysning, én
  oppdatering per retning) og kode på vare-detaljen. Bare admin oppretter/endrer/sletter hyller og bestillinger; alle ansatte kan Ta ut, Fyll på, Tell og Motta.
- **QR og etikett**: QR-en inneholder `https://salmaker.as/salmakern.html?h=<kode>` (`hylleUrl`). Biblioteket (`js/vendor/qrcode.js`, MIT) lastes først når en etikett lages (ikke på hver sidelasting). Etiketten er 25 x 25 mm: QR 19 mm øverst, koden under (1,6 + 19 + 0,4 + 3,4 = 24,4 mm), skriften
  skaleres ned for lange koder (`etikettSkriftMm`). Utskrift via skjult iframe + `print()`: én etikett per side (`@page 25mm 25mm`) for etikettskriver, eller A4-ark med rutenett til utklipp. Målt i ekte nettleser: QR-en (29 moduler) leses tilbake med jsQR ned til 70 px, også med liten skade (feilretting M).
  **Ikke testet:** utskrift på en ekte etikettskriver og avlesning med en ekte mobil. Be Henrik skrive ut én testetikett og skanne den før resten skrives ut (valg som «tilpass til side» i utskriftsdialogen kan krympe den).
- **Åpning**: `?h=<kode>` leses i `tryLogin` (som `?ordre=`), URL-en ryddes, og hylla åpnes etter innlogging (`pendingHylleKode` / `apneHylleFraUrlHvisKlar`); ukjent kode gir beskjed. `sw.js` lagrer ikke en sidelasting med søkestreng (ellers én kopi av hele siden per hylle) og faller tilbake
  på den vanlige kopien uten nett (`ignoreSearch`). `CACHE` er v37.
- **Skanning** (`apneSkannModal`): kamera i appen. Innebygd `BarcodeDetector` der den finnes, ellers jsQR (`js/vendor/jsQR.js`, Apache-2.0, lastes ved behov); feiler den innebygde, byttes det til jsQR. Kameraet stoppes alltid ved lukking, også hvis tillatelsen kommer ETTER at vinduet er lukket
  (`_skannNr`), og `play()` avventes ikke (kunne henge til første bilde). Uten kamera/tillatelse: beskjed og felt for å skrive koden. Testet i ekte nettleser med en falsk kamerastrøm (alle tre veiene), men **ikke med et ekte kamera eller en ekte `BarcodeDetector`** (kameraet er blokkert i testverktøyet).
- **Bestillinger** (`lager_bestillinger`, én rad per vare per bestilling): kjent antall, eller «ukjent antall» for det som allerede er bestilt, pluss leverandør, bestilt-/forventet dato og kommentar. Registrering, mottak og kansellering går via RPC-ene `lager_registrer_bestillinger` / `lager_motta_bestilling` /
  `lager_kanseller_bestilling` (atomiske, radlås), aldri lokal regning. **`lagervarer.bestilt` følger nå åpne bestillinger**: sann så lenge varen har en åpen bestilling, og `endre_lagervare_antall_batch` nullstiller den ikke lenger mens en åpen bestilling finnes (målt live: påfyll over minimum lot flagget stå).
  «Fjern bestilt-merking» er sperret mens en åpen bestilling finnes; den gamle «Merk som bestilt» (uten bestillingsrad) virker som før. Mottak med mindre enn bestilt lukker bestillingen, noterer mangelen i historikken og sender varselet `mangelfull_levering` (som før). Dobbelt mottak gir `IKKE_APEN` og endrer ingenting (testet live).
  Knappen «Registrer alt under minimum som allerede bestilt» forhåndsvelger ALLE varer under minimum med ukjent antall: bruk den bare for å fange opp det som faktisk er bestilt (man kan fjerne avkryssinger).
- **Tomt felt er ikke 0** (`lesLagerTall`): et tomt telle-/mottaksfelt ble først tolket som 0 (en tom telling ville nullet lageret, et tomt mottak lukket bestillingen uten varer). Funnet av testene; vokter i `test/lager-hylle.test.js`.
- **Vinduene** (`lagerModal`) legges alltid SIST i dokumentet: alle `.modal` har samme z-index, så det sist åpnede ligger øverst (ellers havnet «Fyll på» under hylleside-vinduet, derfor har hylleside-vinduet eget Ta ut/Fyll på/Tell i stedet for å gjenbruke `lagerEndringModal`).
- **Verktøylinjen på Lager-siden brøt aldri linjen** (`flex-shrink:0`): siden ble 478 px bred på en 375 px telefon allerede før (4 knapper), og 775 px med de tre nye. Rettet (`min-width:0;max-width:100%`); målt etterpå 375 px, tre rader knapper. Sjekk `document.documentElement.scrollWidth` ved 375 px etter endringer på toppen av Lager-siden.
- **Test**: `test/lager-hylle.test.js` (50 tester: koder/lenker, QR generert og lest tilbake med jsQR, etikettmål, hyller, skanning, kamera-opprydding, uttak/påfyll/telling, bestillinger og mottak mot falsk database, Realtime-handlerne, oppsett) og SQL `supabase/tester/lager_hyller_og_bestillinger_TEST_body.sql` (28 kontroller, rulles tilbake).
  Live-test 2026-11-03 mot den ekte databasen med en TEST-ansatt (opprettet via `opprett_ansatt` med en admins claims, slettet etterpå sammen med TEST-hylle/-vare/-bestillinger; databasen verifisert tilbake til 174 varer og 0 hyller/bestillinger). Sendte aldri ekte varsler (ingen uttak under minimum, ingen mangel). Nettleserverktøyet blokkerer `confirm()`: sett `window.confirm = () => true` før Slett/Kanseller.
- **Fase 2 (ikke bygget, Henrik har godkjent retningen)**: automatisk e-post til leverandør med forhåndsvisning, foreslåtte uttak fra portal-/Fiken-linjer mot oppskrifter, Fiken-innkjøp som forslag, daglig morgenvarsel og minimumsforslag.

**PIN-innlogging**: ingen passord, kun 4-sifret PIN sjekket server-side via
`logg_inn_med_pin`/`login_med_pin` (Postgres-funksjoner, se `supabase/migrations/`). PIN-er
lastes ALDRI ned til nettleseren. Rate-limited siden 2026-08-24 (5 feil forsøk → 10 min
lockout per anonym Auth-sesjon, se `20260824000000_pin_rate_limiting_og_search_path.sql`).
`logg_inn_med_pin` oppdaterer `ansatte.session_token`, og `ansatte` er beskyttet av triggeren `ansatte_beskytt_skriving` (kun admin kan INSERT/DELETE og endre
de fleste kolonner): de to er koblet via markeringen `app.pin_innlogging` (supabase/README.md, «Skriving til ansatte-tabellen»). Rør aldri en av dem uten å teste selve
PIN-innloggingen med `supabase/tester/ansatte_beskytt_skriving_innlogging_TEST_body.sql` - en feil her låste alle ute 31.10 (kl. 11:45 til 13:43).

**Kall til edge-funksjoner og utlogging (2026-10-29)**: ALLE kall til `/functions/v1/` (fiken-fakturer,
send-frakt-epost, vegvesen-oppslag, send-push) går via `edgeFetch(funksjon, init)` i `core.js` - aldri en
direkte `fetch()` (vokter: `test/ingen-direkte-edge-kall.test.js`). Den sender den innloggede ansattes
access-token som `Authorization` og `SUPA_KEY` som `apikey`, og ved 401 fornyes sesjonen og kallet prøves
ÉN gang til. Serversiden: fiken-fakturer, send-frakt-epost, vegvesen-oppslag og send-push verifiserer token-et mot
`current_ansatt()` (foreløpig i MYK modus: logger `edge_auth`, blokkerer ikke, til `EDGE_AUTH_ENFORCE` slås på; send-push
har i tillegg en server-kategori for cron og ordre-push (egen delt hemmelighet i headeren x-server-secret, 31.10; bekreftet live for
cron, ordre-push venter på første ekte ordreoppdatering): håndheving slås på først når loggene viser via=ansatt/server for ekte kall - se `supabase/README.md`, «send-push: innloggingssjekk»). `doLogout()` avslutter nå Auth-
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
  lista) og erstatter den statiske `#modelsGrid`-lenkelisten med **samme oppsett som Produkter-siden i
  Forhandlerportalen, uten priser** (endret 2026-11-02): søkefelt, «HOPP TIL»-knapper (Alle + ett per merke med
  antall), merkegrupper (rød strek + merkenavn + «N MODELLER» + linje) som flyter i et 5-kolonners rutenett (3 på
  mellomstor skjerm, 1 på mobil; hver gruppe spenner like mange kolonner som den har kort, `--n3`/`--n5` settes av
  scriptet), modellkort med 4:3-bilde, modellnavn uten merke og «N varianter», og dempede «KOMMER SNART»-kort for
  modeller uten varianter. Merket utledes av modellnavnet med samme regel som portalens `splitModelName`
  (`src/lib/modelName.ts`; `MULTI_WORD_BRANDS` må holdes lik), og gruppering/rekkefølge følger portalens
  `src/lib/brandGroups.ts` (merker med ferdige modeller først, flest modeller øverst, alt-«kommer snart» sist).
  Listen har ikke variantantall, så scriptet henter `GET /api/public/models/<slug>` for hver modell (parallelt, maks
  4 s ventetid; svikter et kall tegnes kortet uten antall og regnes som ferdig) - bare på varebil.html, forsiden
  henter bare tallet. Søket treffer modellnavn, variantnavn og produktnumre. Bildene hentes via portalens
  bildeoptimalisering (`/_next/image?...&w=384|640|828`), ikke som originaler på opptil 4 MB, med fallback til
  originalen hvis det svikter. Svikter API-et helt, står den statiske reservelista igjen (ingen verktøylinje).
  Modeller med en av de 17 kjente slugene lenker til sin egendefinerte side; alt annet lenker til
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
  høyden (`.site-header` offsetHeight) ved 375/800/1024/1280 hvis menyen endres igjen. **Logoen i headeren (2026-11-02, Henrik valgte alternativ B «større, samme logo» fra en valgside med fem alternativer):** `.logo-link img` er 60 px på PC, 52 px fra 721 til 1120 px og 50 px under 721 px (før 40 px overalt). Målt headerhøyde (før → etter): 1280 px 72 → 89, 1024 px 69 → 81, 800 px 129 → 141 (to rader), 375 px 178 → 188. Menyen står på én rad ved siden av logoen fra ca. 915 px (var ca. 900 px); under det bryter den til to rader som før. Bokstavene i SALMAKER er HULE i `logo-transparent.png` (bare en tynn kant), så logoen er svak på den mørke headeren; en fylt variant ble laget og vist som alternativ C/D/E, men ikke valgt (kan tas i bruk senere). Bunntekstlogoen er uendret (40 px). `site.css`
  er nå `?v=15` på alle sider (bumpet 2026-11-02: logoen i headeren er større, og stiler for modelloversikten per merke på varebil.html og for den roterende heroen; 2026-10-31: rulleteksten på forsiden fikk fullt merke + modellnavn og 53s i stedet for 42s; modellsidenes h1 (`.page-hero-dark h1`) skalerer ned under ca. 400px så lange ord som GELÄNDEWAGEN ikke går utenfor skjermen), `model-sync.js` `?v=6`, `model-list-sync.js` `?v=8` og `hero-rotasjon.js` `?v=1`.
- **Roterende hero på forsiden (2026-11-02, `hero-rotasjon.js`)**: viser profilbildet til hver modell (hentet live fra
  `GET /api/public/models`, kun modeller med `imageUrl`: 11 av 14), alle i NØYAKTIG samme ramme (`.hero-media` er
  `position:absolute; inset:0; object-fit:cover`, så størrelsen er lik uansett bilde; kontrollert: alle 11 målte
  1009x660 på desktop og 375x660 på mobil). Kryssovergang 1,5 s, 6 s per bilde, en etikett nede til høyre
  (`.hero-modell`) med modellnavn som lenker til modellsiden. Originalbildene er opptil 4 MB PNG, så bildene hentes via
  **portalens bildeoptimalisering** (`/_next/image?url=<bilde>&w=828|1200|1920&q=75`, 46-275 KB WebP); bare neste bilde
  forhåndslastes. Det statiske `hero-bil.jpg` i HTML-en vises først og er fallback: svikter API-et, er det under 2
  bilder, eller har besøkende `prefers-reduced-motion`, skjer ingenting (siden er som før). Skriptet har en egen kopi av
  `KNOWN_PAGES` (hold lik `model-list-sync.js`). Lokal testing: API-et gir CORS-feil fra localhost (se under), så test ved
  å stubbe `window.fetch` for `/api/public/models` med den ekte lista og kjøre skriptet på nytt i siden.
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
