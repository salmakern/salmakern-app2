-- Øktgrense 12 timer (Henrik 12.11, AskUserQuestion: «12 timer (anbefalt)»), s.k. s00-026.
-- Denne filen dokumenterer en endring som allerede var kjørt direkte mot produksjon (samme
-- dag) uten noen migrasjonsfil i repoet - funnet av QA-gjennomgangen 18.11. Filen her er en
-- ren, idempotent kopi av det som faktisk står i databasen (sjekket med pg_get_functiondef
-- og information_schema 18.11), så Git og produksjon stemmer overens igjen. Ingen ny
-- oppførsel. `admin_sett_oktgrense_alle(720)` er IKKE kalt av denne filen - den må kjøres
-- separat av en innlogget admin (databasen krever current_ansatt().rolle = 'admin').
--
-- Rollback: alter table public.ansatte alter column okt_maks_minutter set default 240;
--           drop function if exists public.admin_sett_oktgrense_alle(integer);

alter table public.ansatte alter column okt_maks_minutter set default 720;

create or replace function public.admin_sett_oktgrense_alle(p_minutter integer default 720)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_antall integer;
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;
  if p_minutter is null or p_minutter < 30 or p_minutter > 1440 then
    raise exception 'UGYLDIG_MINUTTER';
  end if;
  update public.ansatte
  set okt_maks_minutter = p_minutter
  where er_delt_stasjon = false
    and okt_maks_minutter = 240;
  get diagnostics v_antall = row_count;
  return v_antall;
end;
$function$;
