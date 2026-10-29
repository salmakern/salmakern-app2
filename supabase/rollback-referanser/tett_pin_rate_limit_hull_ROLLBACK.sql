-- ============================================================
-- NØDBREMS: Kjør denne HVIS noe går galt etter at
-- 20261029140000_tett_pin_rate_limit_hull.sql er kjørt og PIN-innlogging
-- slutter å virke for ekte ansatte (f.eks. uventet IKKE_INNLOGGET for noen
-- som faktisk har en gyldig sesjon). Setter logg_inn_med_pin()/login_med_pin()
-- og kjøretillatelsene tilbake til slik de var FØR fiksen - dette gjenåpner
-- det kjente PIN-rate-limit-hullet, så bruk kun midlertidig mens feilen
-- undersøkes.
-- ============================================================

create or replace function public.logg_inn_med_pin(kandidat_pin text)
returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, ansettelsesdato date)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  treff ansatte%rowtype;
  ny_token text;
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

  ny_token := gen_random_uuid()::text;
  update ansatte set session_token = ny_token where ansatte.id = treff.id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data
    || jsonb_build_object('ansatt_id', treff.id, 'rolle', treff.rolle, 'session_token', ny_token)
  where auth.users.id = auth.uid();

  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn, treff.ansettelsesdato;
end;
$function$;

create or replace function public.login_med_pin(kandidat_pin text)
returns table(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, session_token text)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

grant execute on function public._pin_rate_limit_sjekk() to public;
grant execute on function public._pin_rate_limit_registrer(boolean) to public;
