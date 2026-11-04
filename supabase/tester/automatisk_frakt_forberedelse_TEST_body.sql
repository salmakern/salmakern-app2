-- Test av migrasjon 20261104150000 (automatisk frakt-forberedelse ved klar_henting).
-- ALLTID i en transaksjon som rulles tilbake. Bruker SYNTETISKE ordrer/admin_ark-rader
-- (egne TEST-id-er), ikke ekte data.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261104150000_automatisk_frakt_forberedelse.sql; cat supabase/tester/automatisk_frakt_forberedelse_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file /tmp/t.sql

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_forberedt timestamptz;
begin
  -- T1: vanlig ordre, fraktselskap satt, ikke bestilt -> status til klar_henting skal forberede.
  insert into public.ordrer (id, chassis, kunde, ordre_status, status)
    values ('ord_test_frakt_1', 'TESTWXYZ000000200', 'TEST Kunde', 'ikke_paabegynt', 'aktiv');
  insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, fraktselskap, bestilt_frakt)
    values ('ark_test_frakt_1', 'TESTWXYZ000000200', 2026, 999001, 'Bring', false);
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_1';
  select frakt_forberedt_at into v_forberedt from public.admin_ark where id = 'ark_test_frakt_1';
  insert into _res(navn, ok, info) values ('T1: fraktselskap satt, ikke bestilt -> frakt_forberedt_at settes', v_forberedt is not null, 'frakt_forberedt_at=' || coalesce(v_forberedt::text,'NULL'));

  -- T2: re-velger SAMME status (ingen reell overgang) -> ingen ny/endret markering.
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_1';
  declare v_forberedt2 timestamptz;
  begin
    select frakt_forberedt_at into v_forberedt2 from public.admin_ark where id = 'ark_test_frakt_1';
    insert into _res(navn, ok, info) values ('T2: samme status på nytt (ingen reell overgang) -> uendret tidspunkt (idempotent)', v_forberedt2 = v_forberedt, 'før=' || v_forberedt::text || ' etter=' || v_forberedt2::text);
  end;

  -- T3: tilbake til ikke_paabegynt og frem til klar_henting IGJEN -> frakt_forberedt_at IKKE null fra før, skal IKKE overskrives (fortsatt samme tidspunkt, siden WHERE-betingelsen krever frakt_forberedt_at is null).
  update public.ordrer set ordre_status = 'ikke_paabegynt' where id = 'ord_test_frakt_1';
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_1';
  declare v_forberedt3 timestamptz;
  begin
    select frakt_forberedt_at into v_forberedt3 from public.admin_ark where id = 'ark_test_frakt_1';
    insert into _res(navn, ok, info) values ('T3: status frem og tilbake og tilbake til klar_henting -> IKKE en ny markering (allerede forberedt)', v_forberedt3 = v_forberedt, 'v1=' || v_forberedt::text || ' v3=' || v_forberedt3::text);
  end;

  -- T4: fraktselskap = "Levering av oss" -> ingen forberedelse.
  insert into public.ordrer (id, chassis, kunde, ordre_status, status)
    values ('ord_test_frakt_2', 'TESTWXYZ000000201', 'TEST Kunde 2', 'ikke_paabegynt', 'aktiv');
  insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, fraktselskap, bestilt_frakt)
    values ('ark_test_frakt_2', 'TESTWXYZ000000201', 2026, 999002, 'Levering av oss', false);
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_2';
  insert into _res(navn, ok, info) values ('T4: fraktselskap "Levering av oss" -> ingen forberedelse',
    (select frakt_forberedt_at is null from public.admin_ark where id = 'ark_test_frakt_2'), '');

  -- T5: fraktselskap tomt -> ingen forberedelse.
  insert into public.ordrer (id, chassis, kunde, ordre_status, status)
    values ('ord_test_frakt_3', 'TESTWXYZ000000202', 'TEST Kunde 3', 'ikke_paabegynt', 'aktiv');
  insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, fraktselskap, bestilt_frakt)
    values ('ark_test_frakt_3', 'TESTWXYZ000000202', 2026, 999003, '', false);
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_3';
  insert into _res(navn, ok, info) values ('T5: fraktselskap tomt -> ingen forberedelse',
    (select frakt_forberedt_at is null from public.admin_ark where id = 'ark_test_frakt_3'), '');

  -- T6: fraktselskap satt, men bestilt_frakt ALT true -> ingen ny forberedelse (allerede håndtert manuelt).
  insert into public.ordrer (id, chassis, kunde, ordre_status, status)
    values ('ord_test_frakt_4', 'TESTWXYZ000000203', 'TEST Kunde 4', 'ikke_paabegynt', 'aktiv');
  insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, fraktselskap, bestilt_frakt)
    values ('ark_test_frakt_4', 'TESTWXYZ000000203', 2026, 999004, 'Bring', true);
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_4';
  insert into _res(navn, ok, info) values ('T6: bestilt_frakt allerede true -> ingen ny forberedelse',
    (select frakt_forberedt_at is null from public.admin_ark where id = 'ark_test_frakt_4'), '');

  -- T7: case-ulik chassis-skriving mellom ordrer.chassis og admin_ark.chassis_nr -> matcher likevel.
  insert into public.ordrer (id, chassis, kunde, ordre_status, status)
    values ('ord_test_frakt_5', 'testwxyz000000204', 'TEST Kunde 5', 'ikke_paabegynt', 'aktiv');
  insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, fraktselskap, bestilt_frakt)
    values ('ark_test_frakt_5', ' TESTWXYZ000000204 ', 2026, 999005, 'Nor Lines', false);
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_5';
  insert into _res(navn, ok, info) values ('T7: ulik store/små bokstaver + mellomrom i chassis -> matcher likevel',
    (select frakt_forberedt_at is not null from public.admin_ark where id = 'ark_test_frakt_5'), '');

  -- T8: arkivert admin_ark-rad med matchende chassis -> IKKE forberedt.
  insert into public.ordrer (id, chassis, kunde, ordre_status, status)
    values ('ord_test_frakt_6', 'TESTWXYZ000000205', 'TEST Kunde 6', 'ikke_paabegynt', 'aktiv');
  insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, fraktselskap, bestilt_frakt, arkivert)
    values ('ark_test_frakt_6', 'TESTWXYZ000000205', 2026, 999006, 'Bring', false, true);
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_6';
  insert into _res(navn, ok, info) values ('T8: arkivert admin_ark-rad -> ikke forberedt',
    (select frakt_forberedt_at is null from public.admin_ark where id = 'ark_test_frakt_6'), '');

  -- T9: leveranse (ordretype) med samme status-tekst -> aldri påvirket (forsvar i dybden, leveranser bruker egne statuser i praksis).
  insert into public.ordrer (id, chassis, kunde, ordre_status, status, ordretype)
    values ('ord_test_frakt_7', 'TESTWXYZ000000206', 'TEST Kunde 7', 'ikke_paabegynt', 'aktiv', 'leveranse');
  insert into public.admin_ark (id, chassis_nr, aar, rekkefolge, fraktselskap, bestilt_frakt)
    values ('ark_test_frakt_7', 'TESTWXYZ000000206', 2026, 999007, 'Bring', false);
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_7';
  insert into _res(navn, ok, info) values ('T9: ordretype leveranse -> aldri forberedt, selv med matchende chassis',
    (select frakt_forberedt_at is null from public.admin_ark where id = 'ark_test_frakt_7'), '');

  -- T10: ingen matchende admin_ark-rad i det hele tatt -> ingen feil, statusoppdateringen går fint.
  insert into public.ordrer (id, chassis, kunde, ordre_status, status)
    values ('ord_test_frakt_8', 'TESTWXYZ000000207', 'TEST Kunde 8', 'ikke_paabegynt', 'aktiv');
  update public.ordrer set ordre_status = 'klar_henting' where id = 'ord_test_frakt_8';
  insert into _res(navn, ok, info) values ('T10: ingen admin_ark-rad for chassiset -> ingen feil',
    (select ordre_status from public.ordrer where id = 'ord_test_frakt_8') = 'klar_henting', '');
end
$test$;

select n, case when ok then 'OK  ' else 'FEIL' end as resultat, navn, case when ok then '' else info end as info from _res order by n;
