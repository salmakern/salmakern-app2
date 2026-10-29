-- Kjørt: 2026-10-29
-- Bakgrunn: ansatte.mobil og ansatte.fodselsdato (lagt til 2026-10-28 for kjøreseddel-
-- forberedelse) ble hentet med db.from('ansatte').select('*') i loadFromSupabase() - det
-- betyr at ALLE innloggede ansatte fikk ALLE andre ansattes mobilnummer og fødselsdato inn
-- i sin egen nettleser, ikke bare admin (som er den eneste UI-en faktisk viser det til).
-- I tillegg sender Supabase Realtime (postgres_changes) HELE raden til alle abonnenter ved
-- enhver endring, UANSETT eventuelle kolonne-rettigheter satt på selve REST-grensesnittet -
-- en ren select()-begrensning i appen hadde derfor ikke stoppet lekkasjen via realtime-
-- kanalen. Løsningen er samme mønster som allerede brukes for PIN-koder (ansatte_pin): flytt
-- feltene til en EGEN tabell uten generell RLS-policy og uten sanntids-abonnement, kun
-- tilgjengelig via SECURITY DEFINER-funksjoner.
--
-- session_token er BEVISST IKKE flyttet/fjernet her - den er en reell, aktiv del av
-- current_ansatt() sin egen autentiseringssjekk (se migrasjon 20260803162946) og kan ikke
-- flyttes ut av ansatte-tabellen uten å bryte innlogging. Den er fortsatt synlig for alle
-- ansatte via select(*)/realtime, men gir i praksis ingen reell risiko alene: en klient kan
-- ikke selv sette en vilkårlig 'session_token'-claim i sin egen JWT (det skjer kun via
-- logg_inn_med_pin()/login_med_pin(), som krever riktig PIN) - å SE en annens
-- session_token-verdi lar deg derfor ikke forfalske deg som dem.

create table if not exists public.ansatte_kontaktinfo (
  ansatt_id integer primary key references public.ansatte(id) on delete cascade,
  mobil text,
  fodselsdato date
);

insert into public.ansatte_kontaktinfo (ansatt_id, mobil, fodselsdato)
select id, mobil, fodselsdato from public.ansatte
where (mobil is not null and mobil <> '') or fodselsdato is not null
on conflict (ansatt_id) do nothing;

alter table public.ansatte drop column if exists mobil;
alter table public.ansatte drop column if exists fodselsdato;

alter table public.ansatte_kontaktinfo enable row level security;
-- Ingen generell policy med vilje - kun SECURITY DEFINER-funksjonene under kan lese/skrive,
-- samme mønster som ansatte_pin.

create or replace function public.admin_hent_ansatt_kontaktinfo()
returns table(ansatt_id integer, mobil text, fodselsdato date)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;
  return query select k.ansatt_id, k.mobil, k.fodselsdato from ansatte_kontaktinfo k;
end;
$function$;

create or replace function public.admin_sett_ansatt_kontaktinfo(p_ansatt_id integer, p_mobil text, p_fodselsdato date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;
  insert into ansatte_kontaktinfo (ansatt_id, mobil, fodselsdato)
  values (p_ansatt_id, p_mobil, p_fodselsdato)
  on conflict (ansatt_id) do update set mobil = excluded.mobil, fodselsdato = excluded.fodselsdato;
end;
$function$;
