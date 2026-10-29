-- Rollback for 20261029150000_logg_ut.sql
-- Fjerner logg_ut(). Klienten (js/core.js, avsluttSesjon) tåler at funksjonen mangler: feilen fra
-- rpc('logg_ut') logges bare, og signOut kjøres uansett. Kjør kun manuelt, aldri via db push.
drop function if exists public.logg_ut();
