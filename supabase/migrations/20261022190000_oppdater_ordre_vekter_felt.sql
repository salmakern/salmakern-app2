-- Kjørt: 2026-10-22
-- Bakgrunn: o.vekter (totalvekt/vogntog/foraksel/bakaksel, hver med delfeltene a/e/v) skrives
-- fra to uavhengige steder - sv() (manuell inntasting i Vekter-tabellen) og
-- vegvesenBeregnOgSettEndring() (automatisk jevnt-fordelt-last-beregning, kjørt fra
-- vegvesenAutoGenererHvisKomplett() på hvert render) - begge via den generelle save() (full-
-- rad-upsert av HELE ordren fra nettleserens lokale kopi). En ansatt som taster inn et
-- vektfelt samtidig som automatikken (eller en annen ansatt på en annen enhet) skriver et
-- ANNET vektfelt kunne dermed overskrive hverandre, siden begge sender HELE vekter-objektet
-- basert på sin egen, potensielt utdaterte lokale kopi (funnet 2026-10-22, samme rotårsak som
-- dokumenter-/fikenLinjer-kappløpet, men her gjelder det delfelt INNI én jsonb-kolonne i
-- stedet for elementer i et array).
--
-- Atomisk, radlåst funksjon som kun endrer de SPESIFIKKE delfeltene som faktisk sendes inn
-- (f.eks. {"totalvekt.e": "1234", "vogntog.e": "1200"}) - leser fersk vekter fra databasen
-- under radlås, bruker jsonb_set per oppgitt sti, og skriver kun det tilbake. Et samtidig
-- kall som endrer et ANNET delfelt (f.eks. "foraksel.a") kollideres ikke med dette.

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

  select coalesce(vekter, '{}'::jsonb) into v_vekter from ordrer where id = p_ordre_id for update;
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
