-- Reisetid pr. kontrollstasjon (Henrik 11.11, svar på "ta de som trenger konkrete svar" -
-- han vil fylle inn reisetid per stasjonsnavn selv, i stedet for automatisk kart-oppslag).
-- "Time på biltilsynet"-varselet (send-push, paaminnelser_sjekk) sendes i dag ALLTID 30
-- minutter før, uansett hvilken stasjon (tid_biltilsynet_sted er ren fritekst). Denne
-- kolonnen lar admin registrere en egen reisetid per stasjonsnavn (samme array-mønster som
-- drivstoff_satser/utstyr_maler) - ukjente/uregistrerte stasjonsnavn faller fortsatt
-- tilbake på 30 minutter i edge-funksjonen.
--
-- Ren tilleggskolonne (ADD COLUMN med default), ingen rader berøres.
-- Kjør: npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file supabase/migrations/20261111180000_biltilsyn_reisetider.sql
-- Rollback: alter table public.innstillinger drop column if exists biltilsyn_reisetider;

alter table public.innstillinger
  add column if not exists biltilsyn_reisetider jsonb not null default '[]'::jsonb;
