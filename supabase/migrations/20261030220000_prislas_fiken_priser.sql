-- Kjørt: 2026-10-30
-- s09-023/s05-003 (prislås), godkjent av Henrik 30.10: lås pris + mva-type på hver
-- fakturalinje når den legges til/endrer produktnummer, i stedet for å la fiken-fakturer
-- hente Fiken sin pris slik den er DEN DAGEN fakturaen opprettes. Rabatt-% fryses bevisst
-- IKKE her - den er kundespesifikk (fiken_kunde_rabatt) og kjent først ved fakturering,
-- og det er ikke rabatten prissynk endrer.
--
-- fiken_priser: lokal, jevnlig oppdatert kopi av Fiken sine produktpriser (fylt av en egen
-- edge-funksjon + cron, IKKE herfra) - unngår at hver avkrysning i Lager/Utstyr blir
-- avhengig av et live Fiken-kall. Fylles BEVISST ikke i denne migrasjonen; tom tabell gir
-- helt uendret oppførsel (ingen pris å fryse = samme fallback til Fikens egen pris som i
-- dag) til synk-jobben har kjørt første gang.
create table if not exists public.fiken_priser (
  produktnummer text primary key,
  navn text not null,
  pris_kr numeric not null,
  mva_type text,
  konto text,
  oppdatert_at timestamptz not null default now()
);
alter table public.fiken_priser enable row level security;
revoke all on public.fiken_priser from public, anon, authenticated;
grant select on public.fiken_priser to anon, authenticated;
create policy "lese_fiken_priser" on public.fiken_priser for select
  using (exists (select 1 from current_ansatt()));
-- Ingen insert/update/delete-rettighet for klienten - kun synk-funksjonen (service_role,
-- omgår RLS) skriver.

-- oppdater_ordre_fiken_linje_ved_id (20261023120000): jsonb_set ERSTATTET før hele
-- linje-elementet med det klienten sendte - et allerede frosset pris-felt kunne dermed bli
-- overskrevet av en eldre klient som ikke kjenner til det, eller av synkroniserOmbyggingFiken-
-- Linjer()/synkroniserDrivstoffFikenLinje() som bare sender {produktnummer, antall[, belop]}
-- hver gang de kjører. Flettes nå felt for felt i stedet. Samtidig: fryser pris+mva fra
-- fiken_priser når produktnummeret er NYTT eller endret - uendret produktnummer beholder sin
-- tidligere frosne pris via selve flettingen.
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
  v_eksisterende jsonb;
  v_ny jsonb;
  v_pris record;
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
      v_eksisterende := v_elem;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_linje is null then
    if v_idx is not null then
      select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_linjer
      from jsonb_array_elements(v_linjer) with ordinality as t(elem, i)
      where i - 1 != v_idx;
    end if;
    update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;
    return jsonb_build_object('fikenLinjer', v_linjer);
  end if;

  v_ny := p_linje;

  if (v_ny ? 'produktnummer') and (v_eksisterende is null or (v_eksisterende->>'produktnummer') is distinct from (v_ny->>'produktnummer')) then
    select pris_kr, mva_type into v_pris from fiken_priser where produktnummer = v_ny->>'produktnummer';
    if found then
      v_ny := v_ny || jsonb_build_object('pris', v_pris.pris_kr, 'mva', v_pris.mva_type, 'kilde', 'fiken_priser', 'tidspunkt', to_jsonb(now()));
    end if;
  end if;

  if v_idx is not null then
    v_linjer := jsonb_set(v_linjer, array[v_idx::text], coalesce(v_eksisterende, '{}'::jsonb) || v_ny);
  else
    v_linjer := v_linjer || jsonb_build_array(v_ny);
  end if;

  update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;

  return jsonb_build_object('fikenLinjer', v_linjer);
end;
$$;

-- Samme to fikser (flette + prislås) i den produktnummer-keyede varianten (20261022150000),
-- brukt av oppdaterFikenLinjeForOppskrift()/leggTilFikenLinjeDrivstoff() - her er
-- produktnummeret selve nøkkelen og endres aldri underveis, så prislås gjelder kun når
-- linjen er NY (v_idx var null).
create or replace function public.oppdater_ordre_fiken_linje(p_ordre_id text, p_produktnummer text, p_linje jsonb)
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
  v_eksisterende jsonb;
  v_ny jsonb;
  v_pris record;
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
    if v_elem->>'produktnummer' = p_produktnummer then
      v_idx := v_i;
      v_eksisterende := v_elem;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_linje is null then
    if v_idx is not null then
      select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_linjer
      from jsonb_array_elements(v_linjer) with ordinality as t(elem, i)
      where i - 1 != v_idx;
    end if;
    update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;
    return jsonb_build_object('fikenLinjer', v_linjer);
  end if;

  v_ny := p_linje;

  if v_idx is null then
    select pris_kr, mva_type into v_pris from fiken_priser where produktnummer = p_produktnummer;
    if found then
      v_ny := v_ny || jsonb_build_object('pris', v_pris.pris_kr, 'mva', v_pris.mva_type, 'kilde', 'fiken_priser', 'tidspunkt', to_jsonb(now()));
    end if;
  end if;

  if v_idx is not null then
    v_linjer := jsonb_set(v_linjer, array[v_idx::text], coalesce(v_eksisterende, '{}'::jsonb) || v_ny);
  else
    v_linjer := v_linjer || jsonb_build_array(v_ny);
  end if;

  update ordrer set fiken_linjer = v_linjer where id = p_ordre_id;

  return jsonb_build_object('fikenLinjer', v_linjer);
end;
$$;
grant execute on function public.oppdater_ordre_fiken_linje(text, text, jsonb) to anon, authenticated;
grant execute on function public.oppdater_ordre_fiken_linje_ved_id(text, text, jsonb) to anon, authenticated;
