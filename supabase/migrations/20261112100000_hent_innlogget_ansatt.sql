-- ============================================================
-- Gjenopprett en tidligere PIN-innlogging ved sideinnlasting (uten å be om PIN på nytt)
-- ============================================================
-- Bakgrunn: "vi blir logget ut hele tiden" (2026-11-12, se CLAUDE.md). Appen viste
-- PIN-skjermen på nytt ved ENHVER sideinnlasting, uansett om den anonyme Auth-sesjonen
-- fortsatt var helt gyldig - fordi klienten aldri sjekket om økta allerede var koblet til
-- en ansatt. Kombinert med svært hyppige tvungne reloads (service worker-oppdateringer,
-- se js/eksport-varsler.js) ga dette gjentatte, uforutsette "utlogginger" midt i vanlig
-- bruk, uten at noen faktisk logget ut.
--
-- Denne funksjonen leser INGEN PIN og krever ingen - den gjør NØYAKTIG samme server-side
-- sjekk som current_ansatt() (migrasjon 20260803162946): aktiv ansatt, matchende ansatt_id-
-- claim i JWT-en, og enten flere_enheter eller matchende session_token-claim. Claimsene i
-- JWT-en ble satt av en TIDLIGERE vellykket logg_inn_med_pin() + custom_access_token_hook -
-- denne funksjonen oppretter ingen ny tilstand, den bare LESER det som allerede er der.
-- Returnerer tomt (ingen rad) hvis: sesjonen aldri har vært PIN-innlogget, ansatten er
-- deaktivert, eller session_token er ugyldiggjort fordi noen har logget inn med samme PIN
-- et annet sted siden (nøyaktig samme tilfelle som i dag ville gitt en avvist RLS-spørring -
-- klienten viser da PIN-skjermen som før, ingen endring i sikkerhetsmodellen).
create or replace function hent_innlogget_ansatt()
returns table (id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.navn, a.rolle, a.aktiv, a.kan_fore_lonn
  from ansatte a
  where a.aktiv = true
    and (auth.jwt()->>'ansatt_id') is not null
    and a.id = (auth.jwt()->>'ansatt_id')::integer
    and (a.flere_enheter or a.session_token = (auth.jwt()->>'session_token'));
$$;
grant execute on function hent_innlogget_ansatt() to anon, authenticated;
