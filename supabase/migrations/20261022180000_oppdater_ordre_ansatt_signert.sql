-- Kjørt: 2026-10-22
-- Bakgrunn: "Ansatte på ordren" lar bevisst FLERE ansatte melde seg på samme ordre samtidig,
-- hver i sin egen nettleserøkt/enhet. meldPaa()/meldAv() (ordre-diverse.js) leste likevel
-- o.ansatteSignert fra nettleserens EGEN lokale kopi, la til/fjernet ett element, og skrev
-- hele arrayet tilbake via den generelle save() (full-rad-upsert) - to ansatte som meldte seg
-- på/av innen et par sekunder av hverandre kunne overskrive hverandres påmelding (funnet
-- 2026-10-22, samme rotårsak som dokumenter-/fikenLinjer-kappløpet).
--
-- Atomisk, radlåst funksjon (samme mønster som oppdater_ordre_dokument) keyet på ansatt-id -
-- p_ansatt=null = meld av (fjern), ellers meld på (legg til hvis ikke allerede der).

create or replace function public.oppdater_ordre_ansatt_signert(p_ordre_id text, p_ansatt_id integer, p_ansatt jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liste jsonb;
  v_idx int := null;
  v_i int := 0;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  select coalesce(ansatte_signert, '[]'::jsonb) into v_liste
  from ordrer where id = p_ordre_id for update;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_elem in select * from jsonb_array_elements(v_liste) loop
    if (v_elem->>'id')::integer = p_ansatt_id then v_idx := v_i; end if;
    v_i := v_i + 1;
  end loop;

  if p_ansatt is null then
    if v_idx is not null then
      select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_liste
      from jsonb_array_elements(v_liste) with ordinality as t(elem, i)
      where i - 1 != v_idx;
    end if;
  elsif v_idx is null then
    v_liste := v_liste || jsonb_build_array(p_ansatt);
  end if; -- allerede meldt på - ingen endring (speiler den gamle "if allerede påmeldt: return"-sjekken)

  update ordrer set ansatte_signert = v_liste where id = p_ordre_id;
  return v_liste;
end;
$$;
grant execute on function public.oppdater_ordre_ansatt_signert(text, integer, jsonb) to anon, authenticated;
