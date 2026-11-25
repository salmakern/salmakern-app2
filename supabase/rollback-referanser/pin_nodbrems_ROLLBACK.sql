-- ROLLBACK for 20261125200000_pin_nodbrems.sql: de LIVE definisjonene fra produksjonen 25.11 (pg_get_functiondef), før nødbremsen.
-- Kjør i én transaksjon: begin; <denne fila>; commit;
-- NB: gjenoppretter også «manglende logget_inn_at = ingen grense» i current_ansatt/hent_innlogget_ansatt (slik det var før).

CREATE OR REPLACE FUNCTION public._pin_rate_limit_global_registrer(v_suksess boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Nullstilles bevisst IKKE av en vellykket innlogging (se toppkommentaren) - en
  -- angriper som et uhell lykkes med én PIN skal ikke få et friskt forsøksbudsjett.
  if not v_suksess then
    insert into pin_global_forsok default values;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_sett_pin(p_ansatt_id integer, p_ny_pin text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  if p_ny_pin !~ '^[0-9]{6}$' then
    raise exception 'UGYLDIG_PIN';
  end if;

  perform public._pin_rate_limit_sjekk();

  if exists (select 1 from ansatte_pin where pin = p_ny_pin and ansatt_id <> p_ansatt_id) then
    perform public._pin_rate_limit_registrer(false);
    return 'PIN_I_BRUK';
  end if;
  perform public._pin_rate_limit_registrer(true);

  insert into ansatte_pin (ansatt_id, pin) values (p_ansatt_id, p_ny_pin)
  on conflict (ansatt_id) do update set pin = excluded.pin;
  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.current_ansatt()
 RETURNS TABLE(id bigint, rolle text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.rolle
  from ansatte a
  where a.aktiv = true
    and (auth.jwt()->>'ansatt_id') is not null
    and a.id = (auth.jwt()->>'ansatt_id')::integer
    and (a.flere_enheter or a.session_token = (auth.jwt()->>'session_token'))
    and (
      (auth.jwt()->>'logget_inn_at') is null
      or now() - (auth.jwt()->>'logget_inn_at')::timestamptz < (a.okt_maks_minutter || ' minutes')::interval
    );
$function$;

CREATE OR REPLACE FUNCTION public.endre_egen_pin(p_ny_pin text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  meg integer;
begin
  select id into meg from current_ansatt();
  if meg is null then
    raise exception 'IKKE_INNLOGGET';
  end if;

  if p_ny_pin !~ '^[0-9]{6}$' then
    raise exception 'UGYLDIG_PIN';
  end if;

  perform public._pin_rate_limit_sjekk();

  if exists (select 1 from ansatte_pin where pin = p_ny_pin and ansatt_id <> meg) then
    perform public._pin_rate_limit_registrer(false);
    return 'PIN_I_BRUK';
  end if;
  perform public._pin_rate_limit_registrer(true);

  update ansatte_pin set pin = p_ny_pin where ansatt_id = meg;
  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.hent_innlogget_ansatt()
 RETURNS TABLE(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, pin_kort boolean, okt_maks_minutter integer, er_delt_stasjon boolean, logget_inn_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.navn, a.rolle, a.aktiv, a.kan_fore_lonn,
    (exists (select 1 from ansatte_pin p where p.ansatt_id = a.id and length(p.pin) <> 6)),
    a.okt_maks_minutter, a.er_delt_stasjon,
    (auth.jwt()->>'logget_inn_at')::timestamptz
  from ansatte a
  where a.aktiv = true
    and (auth.jwt()->>'ansatt_id') is not null
    and a.id = (auth.jwt()->>'ansatt_id')::integer
    and (a.flere_enheter or a.session_token = (auth.jwt()->>'session_token'))
    -- Manglende claim (sesjon fra FØR denne migreringen) = ingen grense ennå, IKKE utløpt -
    -- se toppkommentaren, punkt 2 (unngår å kaste ut alle eksisterende innlogginger med én gang).
    and (
      (auth.jwt()->>'logget_inn_at') is null
      or now() - (auth.jwt()->>'logget_inn_at')::timestamptz < (a.okt_maks_minutter || ' minutes')::interval
    );
$function$;

drop function if exists public.logg_inn_med_pin(text);
CREATE FUNCTION public.logg_inn_med_pin(kandidat_pin text)
 RETURNS TABLE(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, ansettelsesdato date, pin_kort boolean, okt_maks_minutter integer, er_delt_stasjon boolean, logget_inn_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  treff ansatte%rowtype;
  ny_token text;
  v_pin_lengde integer;
  v_na timestamptz := now();
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

  if not found then
    perform public._pin_rate_limit_registrer(false);
    perform public._pin_rate_limit_global_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);
  perform public._pin_rate_limit_global_registrer(true);

  select length(pin) into v_pin_lengde from ansatte_pin where ansatt_id = treff.id;

  ny_token := gen_random_uuid()::text;
  -- Markerer for ansatte_beskytt_skriving at DETTE er en innlogging (bare session_token endres); nulles rett etter.
  perform set_config('app.pin_innlogging', '1', true);
  update ansatte set session_token = ny_token where ansatte.id = treff.id;
  perform set_config('app.pin_innlogging', '', true);

  update auth.users
  set raw_app_meta_data = raw_app_meta_data
    || jsonb_build_object('ansatt_id', treff.id, 'rolle', treff.rolle, 'session_token', ny_token,
                           'logget_inn_at', v_na)
  where auth.users.id = auth.uid();

  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn,
    treff.ansettelsesdato, (v_pin_lengde <> 6), treff.okt_maks_minutter, treff.er_delt_stasjon, v_na;
end;
$function$;
grant execute on function public.logg_inn_med_pin(text) to public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.login_med_pin(kandidat_pin text)
 RETURNS TABLE(id integer, navn text, rolle text, aktiv boolean, kan_fore_lonn boolean, session_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  treff ansatte%rowtype;
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

  if not found then
    perform public._pin_rate_limit_registrer(false);
    perform public._pin_rate_limit_global_registrer(false);
    return;
  end if;

  perform public._pin_rate_limit_registrer(true);
  perform public._pin_rate_limit_global_registrer(true);
  return query select treff.id, treff.navn, treff.rolle, treff.aktiv, treff.kan_fore_lonn, treff.session_token;
end;
$function$;

drop function if exists public.nodbrems_pa();
drop function if exists public.nodbrems_av();
drop function if exists public.endre_pin_etter_nodbrems(text);
drop function if exists public._sikkerhet_push(text, int);
alter publication supabase_realtime drop table public.sikkerhet_tilstand;
drop table if exists public.sikkerhet_tilstand;
alter table public.ansatte_pin drop column if exists pin_satt_at;
