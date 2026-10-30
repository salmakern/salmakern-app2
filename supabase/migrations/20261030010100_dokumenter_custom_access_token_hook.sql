-- Dokumenterer en funksjon som allerede finnes live, men manglet i repoet (s09-011).
-- Dette er Supabase sin "Custom Access Token"-hook: kjøres av Supabase Auth selv ved
-- hver ny/fornyet innlogging, og limer ansatt_id/rolle/session_token fra
-- auth.users.raw_app_meta_data inn i selve JWT-et - dette er grunnen til at
-- current_ansatt() (og dermed all RLS i appen) i det hele tatt vet hvilken ansatt som
-- spør. Oppdateres av logg_inn_med_pin/login_med_pin ved PIN-innlogging.
--
-- MERK: denne migrasjonen oppretter kun funksjonen (ufarlig, ingen atferdsendring siden
-- den allerede finnes identisk live). Selve KOBLINGEN "bruk denne funksjonen som Auth
-- Hook ved tokenutstedelse" er en egen innstilling i Supabase-dashbordet
-- (Authentication → Hooks → Custom Access Token), og kan ikke settes via SQL alene -
-- den må være satt der fra før (bekreftet ved at hooken faktisk virker live i dag).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  claims jsonb;
  meta jsonb;
begin
  select raw_app_meta_data into meta from auth.users where id = (event->>'user_id')::uuid;
  claims := coalesce(event->'claims', '{}'::jsonb);
  if meta ? 'ansatt_id' then
    claims := claims || jsonb_build_object(
      'ansatt_id', meta->'ansatt_id',
      'rolle', meta->'rolle',
      'session_token', meta->'session_token'
    );
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$function$;
