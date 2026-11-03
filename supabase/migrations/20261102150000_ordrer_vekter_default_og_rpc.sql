-- Kjørt: 2026-11-02 (etter Henriks samtykke). Testet først i en transaksjon som ble rullet tilbake (18 av 18 OK, inkl. RPC-en ende til ende), deretter kjørt; verifisert read-only: 0 ordrer med manglende struktur, default bruker vekter_normalisert(), RPC-en normaliserer.
-- Bakgrunn: ordrer.vekter hadde default '{}'. Siden s09-005 (2026-10-30) skriver ikke save() vekter (de
-- eies av RPC-ene), så en NY ordre får kolonnens default '{}' i stedet for strukturen appen forventer
-- (totalvekt/vogntog/foraksel/bakaksel, hver med a/e/v). To følger, begge funnet 2026-11-02:
--   1) Klienten kastet i tvangsflyt() og Ordre-siden ble tom for alle (rettet i klienten: normaliserVekter()).
--   2) oppdater_ordre_vekter_felt() bruker jsonb_set(.., '{totalvekt,a}', ..), og jsonb_set gjør INGENTING når
--      foreldrenøkkelen ('totalvekt') mangler. Vekter tastet inn på en ny ordre ble derfor aldri lagret,
--      uten feilmelding.
-- Rettelse: (a) hjelpefunksjonen vekter_normalisert() er sannhetskilden for strukturen, (b) kolonne-defaulten
-- bruker den, (c) eksisterende rader med manglende nøkler repareres (bare manglende deler fylles inn, innfylte
-- verdier beholdes), (d) RPC-en normaliserer før den setter feltene, så den virker også mot en rad som
-- fortsatt har '{}'.
-- Rollback: se bunnen av filen (kolonnen får '{}' igjen; funksjonene kan bli stående).

create or replace function public.vekter_normalisert(p jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select (case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end)
    || jsonb_build_object(
      'totalvekt', '{"a":"","e":"","v":""}'::jsonb || (case when jsonb_typeof(p -> 'totalvekt') = 'object' then p -> 'totalvekt' else '{}'::jsonb end),
      'vogntog',   '{"a":"","e":"","v":""}'::jsonb || (case when jsonb_typeof(p -> 'vogntog')   = 'object' then p -> 'vogntog'   else '{}'::jsonb end),
      'foraksel',  '{"a":"","e":"","v":""}'::jsonb || (case when jsonb_typeof(p -> 'foraksel')  = 'object' then p -> 'foraksel'  else '{}'::jsonb end),
      'bakaksel',  '{"a":"","e":"","v":""}'::jsonb || (case when jsonb_typeof(p -> 'bakaksel')  = 'object' then p -> 'bakaksel'  else '{}'::jsonb end)
    );
$$;
grant execute on function public.vekter_normalisert(jsonb) to anon, authenticated;

alter table public.ordrer alter column vekter set default public.vekter_normalisert('{}'::jsonb);

update public.ordrer
   set vekter = public.vekter_normalisert(vekter)
 where vekter is null
    or not (vekter ?& array['totalvekt','vogntog','foraksel','bakaksel'])
    or exists (
      select 1 from unnest(array['totalvekt','vogntog','foraksel','bakaksel']) k
       where jsonb_typeof(vekter -> k) is distinct from 'object'
          or not (vekter -> k ?& array['a','e','v'])
    );

create or replace function public.oppdater_ordre_vekter_felt(p_ordre_id text, p_felter jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vekter jsonb;
  v_rad record;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  -- Normaliseres under radlåsen: en ordre som fortsatt har '{}' (eller mangler et vektfelt) skal kunne få en vekt
  -- satt, ikke bare ignorere den (jsonb_set gjør ingenting uten foreldrenøkkelen).
  select public.vekter_normalisert(vekter) into v_vekter from ordrer where id = p_ordre_id for update;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_rad in select key, value from jsonb_each_text(p_felter) loop
    v_vekter := jsonb_set(v_vekter, string_to_array(v_rad.key, '.'), to_jsonb(v_rad.value), true);
  end loop;

  update ordrer set vekter = v_vekter where id = p_ordre_id;
  return v_vekter;
end;
$$;
grant execute on function public.oppdater_ordre_vekter_felt(text, jsonb) to anon, authenticated;

-- ROLLBACK (kjøres bare ved behov): alter table public.ordrer alter column vekter set default '{}'::jsonb;
-- Reparerte rader trenger ikke rulles tilbake (de har bare fått inn manglende tomme felt).
