-- Kjørt: 2026-08-26
-- Bakgrunn: migreringen 20260824000000_pin_rate_limiting_og_search_path.sql
-- konverterte login_med_pin() fra "language sql" til "language plpgsql" (for å
-- kunne legge til rate-limit-sjekken), men beholdt "returns table(id bigint, ...)"
-- fra den gamle versjonen. ansatte.id er faktisk "integer", ikke "bigint" - noe
-- "language sql" tydeligvis tolererte stille (implisitt cast), mens plpgsql sin
-- "return query" krever eksakt type-match og feiler med "structure of query
-- does not match function result type: Returned type integer does not match
-- expected type bigint in column 1".
--
-- Konsekvens: login_med_pin() har feilet på ALLE kall (uansett PIN) siden
-- 2026-08-24 - brukt til å bekrefte godkjenner-PIN når en ordre lukkes
-- ("Fullfør og lukk ordre"). Appen tolket denne databasefeilen som "Feil PIN
-- eller ikke godkjenner", så det har vært umulig å lukke noen ordre siden da.
--
-- Fiks: id-typen rettes til integer, samme som logg_inn_med_pin (som har
-- vært riktig og fungert hele tiden) og som ansatte.id faktisk er.

-- Må droppes først - Postgres tillater ikke å endre OUT-parameter-typen på en
-- eksisterende funksjon med "create or replace" alene.
drop function if exists public.login_med_pin(text);

create or replace function public.login_med_pin(kandidat_pin text)
returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, session_token text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  treff ansatte%rowtype;
begin
  perform public._pin_rate_limit_sjekk();

  select a.* into treff
  from ansatte a
  join ansatte_pin p on p.ansatt_id = a.id
  where p.pin = kandidat_pin and a.aktiv = true
  limit 1;

  if not found then
    perform public._pin_rate_limit_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);
  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn, treff.session_token;
end;
$$;
grant execute on function public.login_med_pin(text) to anon, authenticated;
