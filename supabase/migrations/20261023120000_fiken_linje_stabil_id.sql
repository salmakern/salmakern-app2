-- Kjørt: 2026-10-23
-- Bakgrunn: siste av de to bevisst utsatte restfunnene fra 29-funns-gjennomgangen
-- 2026-10-22 (se samtalen samme dag). Den rent manuelle fakturalinje-redigeringen
-- (legg til tom linje / fjern linje / rediger felt i Fakturering-kortet,
-- leggTilFikenLinje/fjernFikenLinje/settFikenLinje i ordre-detalj.js) identifiserte
-- linjer ved ARRAY-INDEKS og skrev via den generelle save() (full rad-upsert fra
-- nettleserens lokale kopi) - samme kappløpsmønster som alt annet som ble fikset samme
-- uke, pluss et eget problem: indeks er ustabil hvis to admin redigerer samtidig (rekke-
-- følgen kan ha endret seg), og en tom/duplikat produktnummer under utfylling gjorde at
-- den PRODUKTNUMMER-keyede funksjonen (oppdater_ordre_fiken_linje, 20261022150000) ikke
-- passet for akkurat disse tre funksjonene.
--
-- Løsning: gi hver fakturalinje en stabil, unik id (uavhengig av produktnummer og
-- posisjon), og lag en tilsvarende atomisk funksjon keyet på DENNE iden i stedet for
-- indeks eller produktnummer. Backfiller eksisterende rader FØR ny frontend-kode tas i
-- bruk, slik at alle linjer har en id fra første gang den nye koden leser dem.

update ordrer
set fiken_linjer = (
  select coalesce(jsonb_agg(
    case when elem ? 'id' then elem
    else elem || jsonb_build_object('id', 'fl_' || ordrer.id || '_' || (i - 1)::text)
    end
  ), '[]'::jsonb)
  from jsonb_array_elements(ordrer.fiken_linjer) with ordinality as t(elem, i)
)
where jsonb_array_length(coalesce(fiken_linjer, '[]'::jsonb)) > 0
  and exists (
    select 1 from jsonb_array_elements(fiken_linjer) e where not (e ? 'id')
  );

create or replace function public.oppdater_ordre_fiken_linje_ved_id(p_ordre_id text, p_linje_id text, p_linje jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linjer jsonb;
  v_idx int := null;
  v_i int := 0;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  select coalesce(fiken_linjer, '[]'::jsonb) into v_linjer
  from ordrer where id = p_ordre_id for update;

  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_elem in select * from jsonb_array_elements(v_linjer) loop
    if v_elem->>'id' = p_linje_id then
      v_idx := v_i;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_linje is null then
    if v_idx is not null then
      select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_linjer
      from jsonb_array_elements(v_linjer) with ordinality as t(elem, i)
      where i - 1 != v_idx;
    end if;
  elsif v_idx is not null then
    v_linjer := jsonb_set(v_linjer, array[v_idx::text], p_linje);
  else
    v_linjer := v_linjer || jsonb_build_array(p_linje);
  end if;

  update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;

  return jsonb_build_object('fikenLinjer', v_linjer);
end;
$$;
grant execute on function public.oppdater_ordre_fiken_linje_ved_id(text, text, jsonb) to anon, authenticated;
