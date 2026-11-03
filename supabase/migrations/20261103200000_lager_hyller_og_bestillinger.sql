-- Kjørt: 2026-11-03 (etter Henriks samtykke). Testet først i en transaksjon som ble rullet tilbake (28 av 28), deretter kjørt; verifisert read-only: tabellene, RPC-ene og Realtime er på plass, 174 varer er uendret.
-- Bakgrunn: Lager fase 1 (Henrik 2026-11-03): QR-kode på hver HYLLE (25 mm-etikett) som åpner hylla i appen, og registrering av BESTILLINGER (også de som allerede er lagt) med mottak.
--  lager_hyller        en hylle har en kort kode (f.eks. A1, den står i QR-lenken og på etiketten) og et valgfritt navn. Koden er unik uavhengig av store/små bokstaver.
--  lagervarer.hylle_id hvilken hylle en vare står på (null = ikke plassert). Slettes hylla, blir varene stående uten hylle (on delete set null), aldri slettet.
--  lager_bestillinger  én rad per bestilling av én vare: antall (eller «ukjent antall» for en bestilling som allerede var lagt før appen visste om den), leverandør, bestilt- og forventet dato,
--                      status apen/mottatt/kansellert. Det gamle flagget lagervarer.bestilt (en ren boolean) følger nå åpne bestillinger: SANT så lenge varen har minst én åpen bestilling.
-- RPC-ene under er atomiske (radlås) og krever en innlogget ansatt, som endre_lagervare_antall_batch:
--  lager_registrer_bestillinger(jsonb)  legger inn flere bestillinger og setter bestilt = true på varene
--  lager_motta_bestilling(...)          øker beholdningen, lukker bestillingen, skriver lagerhistorikk (type inn), og setter bestilt etter gjenværende åpne bestillinger
--  lager_kanseller_bestilling(text)     lukker en åpen bestilling uten å endre beholdningen, og setter bestilt etter gjenværende åpne
-- Rollback: drop function ... ; drop table public.lager_bestillinger; alter table public.lagervarer drop column hylle_id; drop table public.lager_hyller;

create table if not exists public.lager_hyller (
  id text primary key,
  kode text not null,
  navn text not null default '',
  rekkefolge integer not null default 0,
  created_at timestamptz not null default now(),
  constraint lager_hyller_kode_form check (kode ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$')
);
create unique index if not exists lager_hyller_kode_unik on public.lager_hyller (upper(kode));

alter table public.lagervarer add column if not exists hylle_id text references public.lager_hyller(id) on delete set null;
create index if not exists lagervarer_hylle_id_idx on public.lagervarer (hylle_id) where hylle_id is not null;

create table if not exists public.lager_bestillinger (
  id text primary key,
  vare_id text not null references public.lagervarer(id) on delete cascade,
  antall numeric not null default 0 check (antall >= 0),
  ukjent_antall boolean not null default false,
  mottatt_antall numeric not null default 0 check (mottatt_antall >= 0),
  leverandor text not null default '',
  bestilt_dato date,
  forventet_dato date,
  status text not null default 'apen' check (status in ('apen', 'mottatt', 'kansellert')),
  bestilt_av text not null default '',
  kommentar text not null default '',
  mottatt_at timestamptz,
  mottatt_av text,
  created_at timestamptz not null default now(),
  constraint lager_bestilling_antall_kjent check (ukjent_antall or antall > 0)
);
create index if not exists lager_bestillinger_apne_idx on public.lager_bestillinger (vare_id) where status = 'apen';

alter table public.lager_hyller enable row level security;
alter table public.lager_bestillinger enable row level security;
drop policy if exists krever_innlogget_ansatt on public.lager_hyller;
drop policy if exists krever_innlogget_ansatt on public.lager_bestillinger;
create policy krever_innlogget_ansatt on public.lager_hyller for all
  using (exists (select 1 from current_ansatt())) with check (exists (select 1 from current_ansatt()));
create policy krever_innlogget_ansatt on public.lager_bestillinger for all
  using (exists (select 1 from current_ansatt())) with check (exists (select 1 from current_ansatt()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lager_hyller') then
    alter publication supabase_realtime add table public.lager_hyller;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lager_bestillinger') then
    alter publication supabase_realtime add table public.lager_bestillinger;
  end if;
end $$;

-- Legger inn flere bestillinger og setter bestilt = true på varene. Hver rad: {id, vareId, antall, ukjentAntall, leverandor, bestiltDato, forventetDato, kommentar, bestiltAv}.
create or replace function public.lager_registrer_bestillinger(p_bestillinger jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rad jsonb;
  v_ukjent boolean;
  v_antall numeric;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if jsonb_typeof(p_bestillinger) <> 'array' or jsonb_array_length(p_bestillinger) = 0 then
    raise exception 'INGEN_BESTILLINGER';
  end if;
  if jsonb_array_length(p_bestillinger) > 500 then
    raise exception 'FOR_MANGE_BESTILLINGER';
  end if;
  for v_rad in select * from jsonb_array_elements(p_bestillinger) loop
    v_ukjent := coalesce((v_rad->>'ukjentAntall')::boolean, false);
    v_antall := coalesce(nullif(v_rad->>'antall', '')::numeric, 0);
    if not v_ukjent and v_antall <= 0 then
      raise exception 'UGYLDIG_ANTALL';
    end if;
    insert into lager_bestillinger (id, vare_id, antall, ukjent_antall, leverandor, bestilt_dato, forventet_dato, kommentar, bestilt_av)
    values (
      coalesce(nullif(v_rad->>'id', ''), 'lb_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || floor(random() * 100000)::int),
      v_rad->>'vareId', case when v_ukjent then 0 else v_antall end, v_ukjent,
      coalesce(v_rad->>'leverandor', ''), nullif(v_rad->>'bestiltDato', '')::date, nullif(v_rad->>'forventetDato', '')::date,
      coalesce(v_rad->>'kommentar', ''), coalesce(v_rad->>'bestiltAv', '')
    );
    update lagervarer set bestilt = true where id = v_rad->>'vareId';
  end loop;
  return jsonb_build_object('antall', jsonb_array_length(p_bestillinger));
end;
$$;

create or replace function public.lager_motta_bestilling(p_id text, p_antall numeric, p_ansatt text, p_kommentar text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b lager_bestillinger%rowtype;
  v lagervarer%rowtype;
  v_ny numeric;
  v_apne integer;
  v_mangler numeric;
  v_kommentar text;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if p_antall is null or p_antall < 0 then
    raise exception 'UGYLDIG_ANTALL';
  end if;
  select * into b from lager_bestillinger where id = p_id for update;
  if not found then
    raise exception 'BESTILLING_FINNES_IKKE';
  end if;
  if b.status <> 'apen' then
    raise exception 'IKKE_APEN';
  end if;
  select * into v from lagervarer where id = b.vare_id for update;

  v_mangler := case when b.ukjent_antall then 0 else greatest(b.antall - p_antall, 0) end;
  v_kommentar := trim(both ' ' from coalesce(p_kommentar, '')
    || case when v_mangler > 0 then case when coalesce(p_kommentar, '') <> '' then ' - ' else '' end || 'Forventet ' || b.antall || ', mottatt ' || p_antall || ' (mangler ' || v_mangler || ' ' || v.enhet || ')' else '' end);

  update lagervarer set antall = antall + p_antall where id = b.vare_id returning antall into v_ny;
  update lager_bestillinger set status = 'mottatt', mottatt_antall = p_antall, mottatt_at = now(), mottatt_av = coalesce(p_ansatt, '') where id = p_id;
  select count(*) into v_apne from lager_bestillinger where vare_id = b.vare_id and status = 'apen';
  update lagervarer set bestilt = (v_apne > 0) where id = b.vare_id;
  if p_antall > 0 then
    insert into lagerhistorikk (id, vare_id, vare_navn, endring, type, ordre_id, batch_id, ansatt_navn, kommentar, oppskrift_id)
    values ('lh_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || floor(random() * 1000)::int, v.id, v.navn, p_antall, 'inn', null, null, coalesce(p_ansatt, ''),
            case when v_kommentar = '' then 'Mottak av bestilling' else v_kommentar end, null);
  end if;
  return jsonb_build_object('vareId', b.vare_id, 'vareNavn', v.navn, 'enhet', v.enhet, 'forventet', b.antall, 'ukjentAntall', b.ukjent_antall, 'mottatt', p_antall,
                            'mangler', v_mangler, 'nyttAntall', v_ny, 'minAntall', v.min_antall, 'bestilt', v_apne > 0);
end;
$$;

create or replace function public.lager_kanseller_bestilling(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b lager_bestillinger%rowtype;
  v_apne integer;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  select * into b from lager_bestillinger where id = p_id for update;
  if not found then
    raise exception 'BESTILLING_FINNES_IKKE';
  end if;
  if b.status <> 'apen' then
    raise exception 'IKKE_APEN';
  end if;
  update lager_bestillinger set status = 'kansellert' where id = p_id;
  select count(*) into v_apne from lager_bestillinger where vare_id = b.vare_id and status = 'apen';
  update lagervarer set bestilt = (v_apne > 0) where id = b.vare_id;
  return jsonb_build_object('vareId', b.vare_id, 'bestilt', v_apne > 0);
end;
$$;

-- Den eksisterende atomiske lagerendringen nullstilte bestilt-flagget så snart beholdningen kom over minimum, også når varen fortsatt har en ÅPEN bestilling
-- (f.eks. en delleveranse). Nå nullstilles det bare hvis det ikke finnes noen åpen bestilling. Resten av funksjonen er uendret (hentet fra databasen 2026-11-03).
create or replace function public.endre_lagervare_antall_batch(p_endringer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultater jsonb := '[]'::jsonb;
  v_endring jsonb;
  v_antall numeric;
  v_min_antall numeric;
  v_bestilt boolean;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  for v_endring in select * from jsonb_array_elements(p_endringer) loop
    update lagervarer
    set antall = antall + (v_endring->>'endring')::numeric,
        bestilt = case
          when (min_antall <= 0 or (antall + (v_endring->>'endring')::numeric) > min_antall)
               and not exists (select 1 from lager_bestillinger lb where lb.vare_id = lagervarer.id and lb.status = 'apen') then false
          else bestilt
        end
    where id = v_endring->>'vareId'
    returning antall, min_antall, bestilt into v_antall, v_min_antall, v_bestilt;

    if found then
      v_resultater := v_resultater || jsonb_build_array(jsonb_build_object(
        'id', v_endring->>'vareId', 'antall', v_antall, 'minAntall', v_min_antall, 'bestilt', v_bestilt
      ));
    end if;
  end loop;

  return v_resultater;
end;
$$;

grant execute on function public.lager_registrer_bestillinger(jsonb) to anon, authenticated;
grant execute on function public.lager_motta_bestilling(text, numeric, text, text) to anon, authenticated;
grant execute on function public.lager_kanseller_bestilling(text) to anon, authenticated;
