-- Test av migrasjon 20261031160000 (ordre-status-utboks-triggeren filtrert til portal-ordre).
-- ALLTID i en transaksjon som rulles tilbake: ingenting blir stående.
-- Kjøring (fra rotmappen - alle migrasjonene under er kjørt mot produksjon 31.10, trenger
-- derfor bare testen selv og en rulle-tilbake, men portal_koble_bestilling tas med for å
-- kunne lage en TEST portal-ordre uten en ekte Fiken/edge-funksjon i veien):
--   (echo "begin;"; cat supabase/migrations/20261030210000_portal_koble_bestilling.sql; cat supabase/migrations/20261031160000_ordre_status_utboks_kun_portal.sql; cat supabase/tester/ordre_status_utboks_kun_portal_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_vanlig text; v_portal text; v_n int; r jsonb;
begin
  -- En TEST portal-ordre, laget med den ekte koblingsfunksjonen (samme mønster som
  -- portal_koble_bestilling_TEST_body.sql) - ekte kontakt AK Auto AS, bare til lesing.
  insert into public.portal_modell_kobling (portal_modell_slug, merke, modell, godkjent_av) values ('testutboks', 'TESTMERKE', 'TESTMODELL', 'test')
    on conflict (portal_modell_slug) do nothing;
  r := public.portal_koble_bestilling(jsonb_build_object('bestilling_id', 'testutboks001', 'nr', 'B-TEST-UTBOKS', 'ident_type', 'CHASSIS', 'ident', 'TESTWXYZ000000090',
        'kontakt_id', 'k_portal_akauto', 'orgnr', '831862122', 'selger_navn', 'Test Utboks', 'modell_slug', 'testutboks'));
  v_portal := r->>'ordre_id';
  insert into _res(navn, ok, info) values ('Forutsetning: TEST portal-ordre opprettet', r->>'status' = 'ny_ordre' and v_portal is not null, r::text);

  -- En VANLIG ordre (ingen portal_bestilling_id) - kopier en ekte rad sin struktur ved å
  -- plukke en eksisterende aktiv ordre og sette status direkte tilbake og frem, uten å
  -- røre noe annet felt.
  select id into v_vanlig from public.ordrer where status = 'aktiv' and portal_bestilling_id is null and ordre_status <> 'hentet' order by created_at desc limit 1;

  if v_vanlig is not null then
    select count(*) into v_n from public.ordre_status_utboks where ordre_id = v_vanlig;
    update public.ordrer set ordre_status = 'hentet' where id = v_vanlig;
    update public.ordrer set ordre_status = 'ikke_paabegynt' where id = v_vanlig;
    insert into _res(navn, ok, info) values ('Vanlig ordre (ingen portal_bestilling_id): statusendring legges IKKE i utboksen',
      (select count(*) from public.ordre_status_utboks where ordre_id = v_vanlig) = v_n, 'før/etter: ' || v_n);
  else
    insert into _res(navn, ok, info) values ('Vanlig ordre: hoppet over (fant ingen aktiv ordre uten portal_bestilling_id)', true, '');
  end if;

  if v_portal is not null then
    select count(*) into v_n from public.ordre_status_utboks where ordre_id = v_portal;
    update public.ordrer set ordre_status = 'hentet' where id = v_portal;
    update public.ordrer set ordre_status = 'ikke_paabegynt' where id = v_portal;
    insert into _res(navn, ok, info) values ('Portal-ordre: TO statusendringer legges i utboksen som før',
      (select count(*) from public.ordre_status_utboks where ordre_id = v_portal) = v_n + 2, 'før: ' || v_n || ' etter: ' || (select count(*) from public.ordre_status_utboks where ordre_id = v_portal));
  else
    insert into _res(navn, ok, info) values ('Portal-ordre: hoppet over (fant ingen aktiv portal-ordre)', true, '');
  end if;
end
$test$;

select n, case when ok then 'OK  ' else 'FEIL' end as resultat, navn, case when ok then '' else info end as info from _res order by n;
