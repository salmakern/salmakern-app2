-- s08-058 (Henrik, "ja synk automatisk" 2026-11-12): når en ansatt retter en tastefeil i
-- chassis.nr på en ordre EFTER at den alt er koblet til en bestilling fra Forhandlerportalen,
-- skal portal_bestillinger.ident følge rettelsen - ellers kan en senere, korrekt bestilling
-- fra portalen med samme (riktige) chassis ikke lenger matche denne bestillingen.
--
-- Dekker begge veiene en ordre kan ha blitt koblet på (samme to veier som portal_avvis_ordre
-- allerede skiller mellom): ordrer.portal_bestilling_id (opprettet som NY ordre) og
-- portal_bestillinger.ordre_id (bestillingen ble KOBLET til en allerede eksisterende ordre -
-- se kommentaren i migrasjon 20261031170000, "koblet-grenen rører bevisst ikke den kolonnen").
-- Ingen feil hvis ordren uansett ikke kom fra portalen - oppdaterer da bare 0 rader.
--
-- SECURITY DEFINER siden portal_bestillinger kun kan skrives av service_role/appens egne
-- stier - samme mønster som portal_bekreft_ordre/portal_avvis_ordre (migrasjon
-- 20261030230000). Alle innloggede ansatte kan kalle den (samme nivå som å redigere selve
-- chassis-feltet, som enhver ansatt allerede kan).
--
-- Rollback: drop function if exists public.portal_oppdater_bestilling_chassis(text, text);

create or replace function public.portal_oppdater_bestilling_chassis(p_ordre_id text, p_nytt_chassis text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ans_id bigint;
  v_chassis text;
  v_pbid text;
  v_antall int;
begin
  select a.id into v_ans_id from public.current_ansatt() a;
  if v_ans_id is null then
    raise exception 'IKKE_INNLOGGET';
  end if;

  v_chassis := upper(btrim(coalesce(p_nytt_chassis, '')));
  if length(v_chassis) <> 17 then
    raise exception 'UGYLDIG_CHASSIS';
  end if;

  select portal_bestilling_id into v_pbid from public.ordrer where id = p_ordre_id;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  update public.portal_bestillinger
     set ident = v_chassis, oppdatert_at = now()
   where ident_type = 'CHASSIS'
     and (portal_bestilling_id = v_pbid or ordre_id = p_ordre_id);
  get diagnostics v_antall = row_count;

  return jsonb_build_object('kode', 'ok', 'antall_oppdatert', v_antall);
end;
$function$;

revoke all on function public.portal_oppdater_bestilling_chassis(text, text) from public, anon;
grant execute on function public.portal_oppdater_bestilling_chassis(text, text) to authenticated, service_role;
