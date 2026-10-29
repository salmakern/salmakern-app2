-- Kjørt: 2026-10-29
-- Utlogging som faktisk avslutter innloggingen (funn s00-018 i "Henger igjen", uavhengig gjennomgang 29.10).
--
-- Bakgrunn: ansatt = anonym Supabase Auth-sesjon + PIN. logg_inn_med_pin() skriver ansatt_id/rolle/
-- session_token i auth.users.raw_app_meta_data, og custom_access_token_hook kopierer dem inn i hver
-- JWT som utstedes. Appens doLogout() satt tidligere bare me = null - ingenting ble fjernet i
-- Auth, så ansatt-token og refresh-token levde videre i nettleseren etter "Logg ut" (og for
-- kontoen med flere_enheter ble de aldri ugyldiggjort av en ny innlogging heller). Det gjelder mer
-- nå som edge-funksjonene (fiken-fakturer, send-frakt-epost m.fl.) skal kreve ansatt-token.
--
-- logg_ut() fjerner ansatt-koblingen fra DEN INNLOGGEDE AUTH-BRUKEREN (auth.uid()) - ingenting annet:
--   * ansatte-raden (inkl. session_token) røres IKKE. Å nulle session_token der ville logget ut
--     alle andre enheter til samme ansatt (og ville ikke betydd noe for flere_enheter-kontoen).
--   * andre Auth-brukere (andre enheter, andre ansatte) røres IKKE: hver enhet har sin egen anonyme
--     Auth-bruker, og funksjonen kan bare treffe auth.uid() - ingen parameter å misbruke.
-- Etter dette gir en eventuell refresh-token (om en skulle ha lekket) et JWT uten ansatt-claims, som
-- current_ansatt() avviser. Klienten kaller deretter auth.signOut({scope:'local'}) som sletter
-- sesjonen og refresh-token. Allerede utstedte access-token (maks 1 time) kan ikke trekkes tilbake.
--
-- Kjørbar kun for innloggede Auth-brukere (inkl. anonyme, som har rollen authenticated), ikke for
-- bare den offentlige nøkkelen uten sesjon (anon). Uten sesjon (auth.uid() null) gjør den ingenting.
--
-- Rollback: se supabase/rollback-referanser/logg_ut_ROLLBACK.sql

create or replace function public.logg_ut()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return;
  end if;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data - 'ansatt_id' - 'rolle' - 'session_token'
  where id = auth.uid();
end;
$function$;

revoke execute on function public.logg_ut() from public;
revoke execute on function public.logg_ut() from anon;
grant execute on function public.logg_ut() to authenticated;
