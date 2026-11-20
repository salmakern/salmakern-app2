-- Test av 20261120100000_avslutt_ansatt.sql. ALLTID i en transaksjon som rulles tilbake: ingenting blir stående.
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261120100000_avslutt_ansatt.sql; cat supabase/tester/avslutt_ansatt_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok = true.
-- Logger inn som en eksisterende admin INNE I transaksjonen (JWT-claims settes lokalt) og lager
-- TEST-ansatte (990301-990308) og en TEST-ordre (TEST-avslutt-1) som forsvinner ved rollback.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  v_adm record;
  v_pin_fri1 text; v_pin_fri2 text; v_pin_opptatt text;
  r jsonb;
  v_a record;
  v_n int;
  v_mins int;
  v_s jsonb;
begin
  select id, session_token into v_adm from ansatte where aktiv and rolle = 'admin' and id < 990000 order by id limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);

  -- Tre ledige 6-sifrede PIN-er.
  for v_n in 1..200 loop
    v_pin_fri1 := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    v_pin_fri2 := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    v_pin_opptatt := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    exit when v_pin_fri1 <> v_pin_fri2 and v_pin_opptatt not in (v_pin_fri1, v_pin_fri2)
      and not exists (select 1 from ansatte_pin where pin in (v_pin_fri1, v_pin_fri2, v_pin_opptatt));
  end loop;

  -- TEST-ansatte:
  --  990301: skal avsluttes - stemplet inn 2t10min, PIN, to push-abonnementer, åpen ordreklokke.
  --  990302: vanlig ansatt, deler ordre med 990301 (sin klokke skal IKKE røres), har PIN v_pin_opptatt (brukes til PIN_I_BRUK-testen).
  --  990303: TEST-admin (brukes til "kan ikke avslutte seg selv").
  --  990304: aktiv, ikke stemplet inn, ingen PIN/push - ren aktiv=false-sjekk.
  --  990305: stemplet inn for 10 sekunder siden (raatid rundes til 0 - ingen timeregistrering skal skje).
  --  990306: vanlig ansatt, brukes til å bevise at ikke-admin ikke kan kalle funksjonene.
  insert into ansatte (id, navn, rolle, aktiv, flere_enheter) values
    (990301, 'TEST - avslutt A', 'ansatt', true, true),
    (990302, 'TEST - avslutt B kollega', 'ansatt', true, true),
    (990303, 'TEST - avslutt admin', 'admin', true, true),
    (990304, 'TEST - avslutt C enkel', 'ansatt', true, true),
    (990305, 'TEST - avslutt D nettopp stemplet', 'ansatt', true, true),
    (990306, 'TEST - avslutt E vanlig', 'ansatt', true, true);
  update ansatte set stemplet_inn_siden = now() - interval '2 hours 10 minutes' where id = 990301;
  update ansatte set stemplet_inn_siden = now() - interval '10 seconds' where id = 990305;
  insert into ansatte_pin (ansatt_id, pin) values (990301, v_pin_fri1), (990302, v_pin_opptatt);
  insert into push_abonnement (ansatt_id, endpoint, p256dh, auth) values
    (990301, 'https://test.push/990301/a', 'p1', 'a1'),
    (990301, 'https://test.push/990301/b', 'p2', 'a2');

  insert into ordrer (id, status, ordre_status) values ('TEST-avslutt-1', 'aktiv', 'paabegynt');
  update ordrer set ordre_timer_sessions = jsonb_build_array(
      jsonb_build_object('start', (extract(epoch from now()) * 1000)::bigint - 3600000, 'stopp', null, 'ansattId', 990301, 'ansatt', 'TEST - avslutt A'),
      jsonb_build_object('start', (extract(epoch from now()) * 1000)::bigint - 3600000, 'stopp', null, 'ansattId', 990302, 'ansatt', 'TEST - avslutt B kollega')
    ) where id = 'TEST-avslutt-1';

  -- ===== Rettigheter =====
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990306, 'role', 'authenticated')::text, true);
  begin perform avslutt_ansatt(990301); insert into _res(navn, ok, info) values ('T1 en vanlig ansatt kan ikke kalle avslutt_ansatt', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T1 en vanlig ansatt kan ikke kalle avslutt_ansatt (KUN_ADMIN)', sqlerrm = 'KUN_ADMIN', sqlerrm); end;
  begin perform admin_reaktiver_ansatt(990301, v_pin_fri2); insert into _res(navn, ok, info) values ('T1b en vanlig ansatt kan ikke kalle admin_reaktiver_ansatt', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T1b en vanlig ansatt kan ikke kalle admin_reaktiver_ansatt (KUN_ADMIN)', sqlerrm = 'KUN_ADMIN', sqlerrm); end;

  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);

  -- ===== Inndata-validering =====
  begin perform avslutt_ansatt(null); insert into _res(navn, ok, info) values ('T2 null ansatt-id avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T2 null ansatt-id avvises (UGYLDIG_ANSATT)', sqlerrm = 'UGYLDIG_ANSATT', sqlerrm); end;
  begin perform avslutt_ansatt(999999); insert into _res(navn, ok, info) values ('T3 ukjent ansatt-id avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T3 ukjent ansatt-id avvises (ANSATT_FINNES_IKKE)', sqlerrm = 'ANSATT_FINNES_IKKE', sqlerrm); end;

  -- ===== Kan ikke avslutte seg selv =====
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990303, 'role', 'authenticated')::text, true);
  begin perform avslutt_ansatt(990303); insert into _res(navn, ok, info) values ('T4 en admin kan ikke avslutte seg selv', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T4 en admin kan ikke avslutte seg selv (KAN_IKKE_AVSLUTTE_SEG_SELV)', sqlerrm = 'KAN_IKKE_AVSLUTTE_SEG_SELV', sqlerrm); end;
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', v_adm.id, 'session_token', v_adm.session_token, 'role', 'authenticated')::text, true);

  -- ===== Full gjennomgang (990301): innstemplet, åpen ordreklokke, PIN, to push-abonnementer =====
  r := avslutt_ansatt(990301);
  insert into _res(navn, ok, info) values ('T5 svaret: ok, navn, tid registrert, 1 ordreklokke stoppet',
    (r->>'ok')::boolean and r->>'navn' = 'TEST - avslutt A' and (r->>'timeRegistrert')::boolean and (r->>'ordreklokkerStoppet')::int = 1, r::text);

  select * into v_a from ansatte where id = 990301;
  insert into _res(navn, ok, info) values ('T5 aktiv=false, session_token null, stemplet_inn_siden null',
    v_a.aktiv = false and v_a.session_token is null and v_a.stemplet_inn_siden is null, row_to_json(v_a)::text);

  select mins into v_mins from timer_entries where ansatt_id = 990301 and type = 'normal';
  insert into _res(navn, ok, info) values ('T5 timeføring lagret med ca. 130 min (2t10min, under 8t: ingen pause)', v_mins between 129 and 131, v_mins::text);

  select ordre_timer_sessions into v_s from ordrer where id = 'TEST-avslutt-1';
  insert into _res(navn, ok, info) values ('T5 kun 990301 sin økt er stoppet, 990302 (kollega) sin økt er urørt',
    (v_s->0->>'stopp') is not null and (v_s->1->>'stopp') is null, v_s::text);

  insert into _res(navn, ok, info) values ('T5 PIN-raden er slettet', not exists (select 1 from ansatte_pin where ansatt_id = 990301), null);
  insert into _res(navn, ok, info) values ('T5 push-abonnementene er slettet (begge)', not exists (select 1 from push_abonnement where ansatt_id = 990301), null);

  -- ===== Idempotent: et nytt kall gjør ikke noe mer =====
  r := avslutt_ansatt(990301);
  select count(*) into v_n from timer_entries where ansatt_id = 990301 and type = 'normal';
  insert into _res(navn, ok, info) values ('T6 nytt kall på en allerede avsluttet ansatt: ok, ingen ny tid registrert, ingen dobbel timeføring',
    (r->>'ok')::boolean and (r->>'timeRegistrert')::boolean = false and (r->>'ordreklokkerStoppet')::int = 0 and v_n = 1, r::text || ' antall timeforinger=' || v_n);

  -- ===== Enkel ansatt uten klokke/PIN/push: ren aktiv=false =====
  r := avslutt_ansatt(990304);
  select aktiv into v_a.aktiv from ansatte where id = 990304;
  insert into _res(navn, ok, info) values ('T7 ansatt uten stempling/PIN/push: aktiv=false, ingen feil', (r->>'ok')::boolean and v_a.aktiv = false, r::text);

  -- ===== Nettopp stemplet inn (10 sek): rundes til 0 min, ingen timeføring =====
  r := avslutt_ansatt(990305);
  select count(*) into v_n from timer_entries where ansatt_id = 990305;
  insert into _res(navn, ok, info) values ('T8 stemplet inn i 10 sekunder: ingen timeføring opprettes (0 min er meningsløst), men stemplingen nulles og aktiv settes false',
    (r->>'timeRegistrert')::boolean = false and v_n = 0 and (select stemplet_inn_siden is null and aktiv = false from ansatte where id = 990305), r::text);

  -- ===== Reaktivering =====
  begin perform admin_reaktiver_ansatt(999999, v_pin_fri2); insert into _res(navn, ok, info) values ('T9 reaktivering av ukjent ansatt avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T9 reaktivering av ukjent ansatt avvises (ANSATT_FINNES_IKKE)', sqlerrm = 'ANSATT_FINNES_IKKE', sqlerrm); end;
  begin perform admin_reaktiver_ansatt(990301, '1234'); insert into _res(navn, ok, info) values ('T10 ugyldig (4-sifret) PIN avvises', false, 'ingen feil');
  exception when others then insert into _res(navn, ok, info) values ('T10 ugyldig (4-sifret) PIN avvises (UGYLDIG_PIN)', sqlerrm = 'UGYLDIG_PIN', sqlerrm); end;

  r := to_jsonb(admin_reaktiver_ansatt(990301, v_pin_opptatt));
  select aktiv into v_a.aktiv from ansatte where id = 990301;
  insert into _res(navn, ok, info) values ('T11 PIN i bruk av en annen (990302) gir PIN_I_BRUK (ikke en feil) og aktiverer IKKE',
    r = to_jsonb('PIN_I_BRUK'::text) and v_a.aktiv = false, r::text || ' aktiv=' || v_a.aktiv::text);

  r := to_jsonb(admin_reaktiver_ansatt(990301, v_pin_fri2));
  select * into v_a from ansatte where id = 990301;
  insert into _res(navn, ok, info) values ('T12 en ledig, gyldig 6-sifret PIN reaktiverer: ok, aktiv=true',
    r = to_jsonb('ok'::text) and v_a.aktiv = true, r::text || ' aktiv=' || v_a.aktiv::text);
  insert into _res(navn, ok, info) values ('T12 den nye PIN-en er lagret (og bare den)',
    (select pin from ansatte_pin where ansatt_id = 990301) = v_pin_fri2, null);

  -- ===== Grants: begge RPC-ene er kallbare av anon/authenticated (de sjekker innloggingen/rollen selv) =====
  insert into _res(navn, ok, info) values ('T13 avslutt_ansatt/admin_reaktiver_ansatt har execute for anon og authenticated',
    has_function_privilege('anon', 'public.avslutt_ansatt(integer)', 'execute') and has_function_privilege('authenticated', 'public.avslutt_ansatt(integer)', 'execute')
    and has_function_privilege('anon', 'public.admin_reaktiver_ansatt(integer, text)', 'execute') and has_function_privilege('authenticated', 'public.admin_reaktiver_ansatt(integer, text)', 'execute'), null);
end;
$test$;

select n, navn, case when ok then 'OK' else 'FEIL' end as resultat, info from _res order by n;
