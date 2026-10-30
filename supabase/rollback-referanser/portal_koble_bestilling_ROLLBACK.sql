-- Rollback for 20261030210000_portal_koble_bestilling.sql
-- Fjerner funksjonen. Ingenting kaller den før edge-funksjonen (G4) er rullet ut; fjern den først. Kjør kun manuelt, aldri via db push.
-- Rader funksjonen har opprettet (ordrer med portal_bestilling_id satt, rader i portal_bestillinger og admin_ark med merknad «Fra portalen ...») berøres IKKE
-- av dette; de må ryddes bevisst (se supabase/README og plan G11) hvis noe er opprettet.
drop function if exists public.portal_koble_bestilling(jsonb);
