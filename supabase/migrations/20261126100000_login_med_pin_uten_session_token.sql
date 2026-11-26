-- login_med_pin (godkjenner-PIN ved «Godkjenn og lukk») sender ikke lenger ut den ansattes session_token
-- (Henger igjen s90-20261125-sessiontoken, Henrik 26.11: «bare fjern sessiontoken»).
-- Klienten (bekreftGodkjenn i js/ordre-diverse.js) leser bare rolle og navn; session_token ble aldri brukt.
-- aktiv og kan_fore_lonn står i svaret som før.
--
-- Grunnlag: funksjonskroppen er BYTE-LIK login_med_pin i 20261125200000_pin_nodbrems.sql (kontrollert mot den LIVE
-- definisjonen 26.11 med pg_get_functiondef: nødbrems, ny-PIN-terskel og rate limit uendret). Eneste endring:
-- session_token er fjernet fra RETURNS TABLE(...) og fra «return query select ...». Funksjonen GJØR det samme.
--
-- Returtypen endres, så drop + create (create or replace kan ikke endre RETURNS TABLE), og grant gjenoppretter
-- dagens rettigheter (lest live 26.11: {=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
-- service_role=X/postgres}). Ingen begin/commit her: fila kjøres inni test-transaksjonen (se testen).
-- Gamle åpne faner er upåvirket (leser aldri session_token). Ingen klientendring, ingen sw.js-bump.
--
-- ROLLBACK (i en transaksjon):
--   drop function public.login_med_pin(text);
--   kjør så login_med_pin-blokken fra 20261125200000_pin_nodbrems.sql (create or replace ... session_token text ...)
--   og: grant execute on function public.login_med_pin(text) to public, anon, authenticated, service_role;

drop function if exists public.login_med_pin(text);

create function public.login_med_pin(kandidat_pin text)
 returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  treff ansatte%rowtype;
  v_funnet boolean;
  v_st sikkerhet_tilstand%rowtype;
  v_terskel timestamptz;
begin
  if auth.uid() is null then
    raise exception 'IKKE_INNLOGGET';
  end if;

  perform public._pin_rate_limit_sjekk();
  perform public._pin_rate_limit_global_sjekk();

  select a.* into treff
  from ansatte a
  join ansatte_pin p on p.ansatt_id = a.id
  where p.pin = kandidat_pin and a.aktiv = true
  limit 1;
  v_funnet := found;

  -- NØDBREMS: som i logg_inn_med_pin - bare admin mens den er aktiv. I tillegg (Henrik 25.11: «samme regel begge
  -- steder») godtas ikke en PIN som må byttes etter nødbremsen (samme terskel som ny_pin_kreves i logg_inn_med_pin),
  -- heller ikke for admin. Begge gir samme svar som feil PIN og telles som feil forsøk (ikke et PIN-orakel).
  select * into v_st from sikkerhet_tilstand where sikkerhet_tilstand.id = 1;
  v_terskel := case when v_st.nodbrems_aktiv then v_st.nodbrems_siden else v_st.ny_pin_kreves_fra end;
  if not v_funnet
     or (coalesce(v_st.nodbrems_aktiv, false) and treff.rolle is distinct from 'admin')
     or exists (select 1 from ansatte_pin p
                where p.ansatt_id = treff.id
                  and coalesce(p.pin_satt_at, '-infinity'::timestamptz) < v_terskel) then
    perform public._pin_rate_limit_registrer(false);
    perform public._pin_rate_limit_global_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);
  perform public._pin_rate_limit_global_registrer(true);
  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn;
end;
$function$;

-- Samme rettigheter som før (live 26.11: public, anon, authenticated, service_role).
grant execute on function public.login_med_pin(text) to public, anon, authenticated, service_role;
