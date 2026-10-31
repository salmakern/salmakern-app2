-- s09-034 (funnet av Salmaker'n-token-økta 31.10, ikke akutt men trygt å rette med en gang):
-- kontaktperson_slett (opprinnelig 20261022170000) filtrerte med `p->>'id' != p_kontaktperson_id`.
-- For en kontaktperson UTEN id er p->>'id' SQL NULL, og `NULL != <tekst>` er NULL (ikke true) -
-- WHERE beholder da bare rader der sammenligningen er TRUE, så raden faller stille ut av
-- resultatet selv om den aldri var den som skulle slettes. 61 av 235 kontaktpersoner manglet id
-- (eldre rader) da dette ble funnet: å slette ÉN kontaktperson hos en forhandler slettet dermed
-- i praksis ALLE id-løse kontaktpersoner hos SAMME forhandler samtidig, uten varsel.
--
-- Fiks: `is distinct from` i stedet for `!=` - sant for en NULL id sammenlignet mot en hvilken
-- som helst ikke-null p_kontaktperson_id (NULL regnes alltid som forskjellig fra noe annet),
-- så en id-løs kontaktperson beholdes med mindre den selv er den NULL-id-en som faktisk skal
-- slettes (umulig i praksis: p_kontaktperson_id kommer fra appen og er aldri NULL/tom streng
-- for et ekte slett-kall - se kontaktperson_upsert, som krever id, i samme fil).
--
-- Rent en bugfiks i selve filtreringen - resten av funksjonen (admin-sjekk, forhandler-oppslag,
-- lagring) er identisk med 20261022170000. Test: supabase/tester/kontaktperson_slett_null_id_TEST_body.sql.
create or replace function public.kontaktperson_slett(p_forhandler_id text, p_kontaktperson_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kontakter jsonb;
  v_forhandler_idx int := null;
  v_forhandler jsonb;
  v_kontaktpersoner jsonb;
  v_i int := 0;
  v_elem jsonb;
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  select coalesce(kontakter, '[]'::jsonb) into v_kontakter from innstillinger where id = 1 for update;
  if not found then raise exception 'INNSTILLINGER_FINNES_IKKE'; end if;

  v_i := 0;
  for v_elem in select * from jsonb_array_elements(v_kontakter) loop
    if v_elem->>'id' = p_forhandler_id then
      v_forhandler_idx := v_i;
      v_forhandler := v_elem;
    end if;
    v_i := v_i + 1;
  end loop;
  if v_forhandler_idx is null then
    raise exception 'FORHANDLER_FINNES_IKKE';
  end if;

  select coalesce(jsonb_agg(p), '[]'::jsonb) into v_kontaktpersoner
  from jsonb_array_elements(coalesce(v_forhandler->'kontaktpersoner','[]'::jsonb)) p
  where p->>'id' is distinct from p_kontaktperson_id;

  v_forhandler := jsonb_set(v_forhandler, '{kontaktpersoner}', v_kontaktpersoner);
  v_kontakter := jsonb_set(v_kontakter, array[v_forhandler_idx::text], v_forhandler);

  update innstillinger set kontakter = v_kontakter where id = 1;
  return v_kontakter;
end;
$$;
grant execute on function public.kontaktperson_slett(text, text) to anon, authenticated;
