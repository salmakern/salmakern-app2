-- ============================================================
-- Salmaker'n – Selvbetjent PIN-endring + admin-overstyring av PIN
-- ============================================================
-- Bedt om av Henrik 2026-10-08: en ansatt skal kunne endre sin EGEN PIN selv
-- ("Min profil" i Mer-fanen), og admin skal kunne sette en NY PIN for en
-- hvilken som helst ansatt (f.eks. når noen har glemt sin). Fantes ikke i det
-- hele tatt før denne migreringen - opprett_ansatt() kunne kun SETTE en PIN
-- ved opprettelse, aldri endre en eksisterende.
--
-- ansatte_pin har ingen RLS-policyer (se 20260803154933_pin_sikkerhet.sql) -
-- kun SECURITY DEFINER-funksjoner som denne kan lese/skrive den i det hele
-- tatt, så disse to funksjonene er den ENESTE veien inn.

-- En ansatt endrer sin EGEN pin. current_ansatt() beviser hvem som faktisk
-- ringer (basert på JWT-sesjonen, ikke noe klienten kan forfalske) - denne
-- funksjonen kan derfor ALDRI brukes til å endre en ANNEN ansatts PIN.
create or replace function endre_egen_pin(p_ny_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  meg integer;
begin
  select id into meg from current_ansatt();
  if meg is null then
    raise exception 'IKKE_INNLOGGET';
  end if;

  if p_ny_pin !~ '^[0-9]{4}$' then
    raise exception 'UGYLDIG_PIN';
  end if;

  if exists (select 1 from ansatte_pin where pin = p_ny_pin and ansatt_id <> meg) then
    raise exception 'PIN_I_BRUK';
  end if;

  update ansatte_pin set pin = p_ny_pin where ansatt_id = meg;
end;
$$;
grant execute on function endre_egen_pin(text) to anon, authenticated;

-- Admin setter en NY pin for en VILKÅRLIG ansatt - dekker "glemt PIN"-
-- tilfellet (en ansatt som ikke kan logge inn kan naturligvis ikke bruke
-- endre_egen_pin() over selv). Samme 'KUN_ADMIN'-mønster som opprett_ansatt().
create or replace function admin_sett_pin(p_ansatt_id integer, p_ny_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;

  if p_ny_pin !~ '^[0-9]{4}$' then
    raise exception 'UGYLDIG_PIN';
  end if;

  if exists (select 1 from ansatte_pin where pin = p_ny_pin and ansatt_id <> p_ansatt_id) then
    raise exception 'PIN_I_BRUK';
  end if;

  -- upsert i stedet for ren update - i det usannsynlige tilfellet en ansatt
  -- mangler rad i ansatte_pin (bør ikke skje via opprett_ansatt(), men tryggere
  -- enn å anta det alltid finnes én).
  insert into ansatte_pin (ansatt_id, pin) values (p_ansatt_id, p_ny_pin)
  on conflict (ansatt_id) do update set pin = excluded.pin;
end;
$$;
grant execute on function admin_sett_pin(integer, text) to anon, authenticated;
