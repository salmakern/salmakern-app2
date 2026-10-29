-- Kjørt: 2026-10-29
-- Bakgrunn: RLS-policyen "krever_innlogget_ansatt" på ansatte (cmd ALL) tillater i dag ENHVER
-- innlogget ansatt å oppdatere ENHVER rad i tabellen, inkludert rolle-feltet - kun selve
-- appens UI (endreAnsattRolle() vises bare for admin) hindrer en vanlig ansatt fra å gjøre
-- seg selv til admin. Siden skrivingen går via et rått db.from('ansatte').update(...)-kall
-- (ikke en SECURITY DEFINER-funksjon som opprett_ansatt()/admin_sett_pin()), er det ingenting
-- i databasen som faktisk håndhever dette - et kall direkte mot Supabase sitt REST-API (forbi
-- selve appens knapper) kunne i dag satt egen rolle til 'admin'. Oppdaget ved gjennomgang av
-- tilgangsstyringen 2026-10-29.
--
-- Løsning: en BEFORE UPDATE-trigger som blokkerer enhver endring av rolle-feltet med mindre
-- den som utfører kallet allerede ER admin (samme sjekk som admin_sett_pin()/opprett_ansatt()
-- bruker) - rører ikke den eksisterende, fungerende admin-flyten (endreAnsattRolle() i
-- ansatte-utstyr.js), siden current_ansatt() der faktisk returnerer en admin-rad.
create or replace function public.ansatte_hindre_selv_rolleendring()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.rolle is distinct from old.rolle then
    if not exists (select 1 from current_ansatt() where rolle = 'admin') then
      raise exception 'KUN_ADMIN';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists ansatte_hindre_selv_rolleendring_trigger on public.ansatte;
create trigger ansatte_hindre_selv_rolleendring_trigger
  before update of rolle on public.ansatte
  for each row
  execute function public.ansatte_hindre_selv_rolleendring();
