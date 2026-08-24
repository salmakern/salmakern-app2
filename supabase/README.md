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
