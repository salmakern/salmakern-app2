-- Kjørt: 2026-10-08
-- Bakgrunn: logg_inn_med_pin() (PIN-innloggingen, se 20260803162946) returnerte ikke
-- ansettelsesdato (naturlig nok, kolonnen fantes ikke da) - uten denne fiksen ville
-- me.ansettelsesdato ALLTID vært tom for enhver innlogget bruker i appen, uansett hva
-- admin fyller inn på ansatten, og 2-månedersregelen for egenmelding (js/timer.js) ville
-- aldri faktisk slått inn. Identisk funksjon som før, bare med ansettelsesdato lagt til i
-- både RETURNS TABLE og select-listen helt til slutt. Må droppes først - Postgres tillater
-- ikke "create or replace" når selve returtypen (RETURNS TABLE-kolonnene) endres.
drop function if exists public.logg_inn_med_pin(text);
create or replace function public.logg_inn_med_pin(kandidat_pin text)
returns table (id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, ansettelsesdato date)
language plpgsql
security definer
set search_path = public
as $$
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
$$;
grant execute on function public.logg_inn_med_pin(text) to anon, authenticated;
