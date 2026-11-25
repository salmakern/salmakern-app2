-- Standardtid per modell skrives med en egen, målrettet rutine (Henger igjen s09-027, 2026-11-25).
--
-- Før dette: settStandardtid() i js/ansatte-utstyr.js endret den lokale kopien S.standardtider og kalte saveInnstillinger(), som skriver
-- HELE utstyr_maler, drivstoff_satser, biltilsyn_reisetider og standardtider fra nettleserens minne. En fane med en utdatert kopi kunne
-- da skrive gamle utstyrsmaler tilbake, eller en annen admins nylig satte standardtid for en annen modell (samme feilklasse som
-- dagens_pin-feilen 12.11, se CLAUDE.md «Vi blir logget ut hele tiden»). Nå:
--   * sett_standardtid(p_modell, p_ombygging_min) endrer BARE nøkkelen for én modell i innstillinger.standardtider (jsonb_set i én
--     UPDATE, radlåst av Postgres), og bare feltet «ombygging» i den (andre felt i objektet beholdes). Svarer med hele, ferske
--     standardtider, så klienten får med seg andres endringer.
--   * Bare admin (current_ansatt(), samme sjekk som lager_avvis_bestillingsforslag). Sjekket i databasen, ikke bare i appen.
--   * Klienten slutter å sende standardtider i saveInnstillinger() (samme gren).
-- Ingen data endres av selve migrasjonen.
--
-- Utrulling: denne migrasjonen FØR klienten (en ny klient mot en database uten funksjonen får en tydelig feil og lagrer ikke standardtiden;
-- en gammel klient mot ny database virker som før).
-- Rollback: drop function public.sett_standardtid(text, integer);
-- Test: supabase/tester/sett_standardtid_TEST_body.sql (rulles alltid tilbake).

create or replace function public.sett_standardtid(p_modell text, p_ombygging_min integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ut jsonb;
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;
  -- Nøkkelen er modellteksten slik appen bruker den (ordrer.modell / utstyrsmalens biltype), uendret: en trimmet nøkkel ville ikke
  -- truffet en eksisterende rad med mellomrom. Bare tom/blank og urimelig lang tekst avvises.
  if p_modell is null or btrim(p_modell) = '' or length(p_modell) > 100 then
    raise exception 'UGYLDIG_MODELL';
  end if;
  if p_ombygging_min is null or p_ombygging_min < 0 or p_ombygging_min > 100000 then
    raise exception 'UGYLDIG_MINUTTER';
  end if;
  update innstillinger
     set standardtider = jsonb_set(
           case when jsonb_typeof(standardtider) = 'object' then standardtider else '{}'::jsonb end,
           array[p_modell],
           (case when jsonb_typeof(standardtider -> p_modell) = 'object' then standardtider -> p_modell else '{}'::jsonb end)
             || jsonb_build_object('ombygging', p_ombygging_min))
   where id = 1
   returning standardtider into v_ut;
  if not found then
    raise exception 'INGEN_INNSTILLINGER';
  end if;
  return v_ut;
end;
$$;

revoke execute on function public.sett_standardtid(text, integer) from public;
grant execute on function public.sett_standardtid(text, integer) to anon, authenticated;
