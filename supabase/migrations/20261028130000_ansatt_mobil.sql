-- Kjørt: 2026-10-28
-- Bakgrunn: forberedelse til kjøreseddel-integrasjon mot Statens vegvesen sitt "API for
-- kjøresedler" (se samtalen 2026-10-26/28) - Henrik ba om å forberede appen før selve
-- API-tilgangen er på plass (venter på Altinn-godkjenning). Henrik bekreftet 2026-10-28 at
-- når man faktisk skriver en kjøreseddel i dag trengs navn (finnes alt, ansatte.navn),
-- fødselsdato og telefonnummer (for SMS-bekreftelse til sjåføren) - disse to legges derfor
-- til nå, uavhengig av om det eksakte API-skjemaet (ikke sett ennå) bruker akkurat disse
-- feltnavnene. Nyttig uavhengig av kjøreseddel også (kontaktinfo på egne ansatte).

alter table public.ansatte add column if not exists mobil text;
alter table public.ansatte add column if not exists fodselsdato date;
