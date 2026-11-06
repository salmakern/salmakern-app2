-- Test av 20261106000000_rate_limit_pin_endring.sql. ALLTID i en transaksjon som rulles
-- tilbake (oppretter egne TEST-ansatte med id 990020-990022, aldri ekte rader).
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261106000000_rate_limit_pin_endring.sql; cat supabase/tester/rate_limit_pin_endring_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
--
-- auth.uid() leser 'sub' fra JWT-claims (ikke ansatt_id) - _pin_rate_limit_sjekk/registrer
-- bruker DEN som nøkkel, så hver "økt" i denne testen simuleres med en FAST 'sub'-uuid i
-- tillegg til ansatt_id/rolle/session_token (current_ansatt() bruker ansatt_id, ikke sub).
--
-- endre_egen_pin/admin_sett_pin returnerer nå 'ok'/'PIN_I_BRUK' (vanlig retur) i stedet for å
-- raise'e PIN_I_BRUK - en "raise exception" ville rullet tilbake registreringen rett før den i
-- SAMME kall (se migrasjonens toppkommentar). FOR_MANGE_FORSOK raiser fortsatt (ingenting å
-- miste - sjekken skjer før noen skriving).

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  r record;
  v_retur text;
  v_feilet boolean;
  v_sqlerrm text;
  v_antall_feil int;
  v_blokkert timestamptz;
  v_pin text;
  SUB_A constant uuid := '11111111-1111-1111-1111-111111111111';
  SUB_C constant uuid := '33333333-3333-3333-3333-333333333333';
  SUB_ADMIN constant uuid := '44444444-4444-4444-4444-444444444444';
begin
  -- Oppsett: ansatte_beskytt_skriving (20261031140000) slipper INSERT/DELETE gjennom når
  -- current_ansatt() er admin - impersoner midlertidig en ekte admin (id 17) KUN for oppsettet.
  perform set_config('request.jwt.claims', json_build_object('ansatt_id', 17, 'rolle', 'admin', 'session_token', 'ikke-brukt-flere-enheter')::text, true);

  -- tre TEST-ansatte (flere_enheter=true - trenger ikke matche session_token)
  insert into ansatte (id, navn, rolle, aktiv, kan_fore_lonn, flere_enheter) values
    (990020, 'TEST RL A', 'ansatt', true, true, true),
    (990021, 'TEST RL B', 'ansatt', true, true, true),
    (990022, 'TEST RL Admin', 'admin', true, true, true);
  insert into ansatte_pin (ansatt_id, pin) values (990020, '1111'), (990021, '2222');

  -- T1: bare service_role/postgres kan nå hjelperne direkte (uendret fra før - defense i dybden)
  insert into _res(navn, ok, info) values ('T1 _pin_rate_limit_sjekk er fortsatt ikke kallbar av anon/authenticated',
    not has_function_privilege('anon', 'public._pin_rate_limit_sjekk()', 'execute')
    and not has_function_privilege('authenticated', 'public._pin_rate_limit_sjekk()', 'execute'), null);
  insert into _res(navn, ok, info) values ('T1b endre_egen_pin/admin_sett_pin er fortsatt kallbare av authenticated (eksplisitt satt på nytt)',
    has_function_privilege('authenticated', 'public.endre_egen_pin(text)', 'execute')
    and has_function_privilege('authenticated', 'public.admin_sett_pin(integer,text)', 'execute'), null);

  -- T2: ansatt A prøver å endre til B sin pin (kollisjon) - skal returnere 'PIN_I_BRUK' (IKKE raise) og telle 1 feil
  perform set_config('request.jwt.claims', json_build_object('sub', SUB_A, 'ansatt_id', 990020, 'rolle', 'ansatt', 'session_token', 'x')::text, true);
  select endre_egen_pin('2222') into v_retur;
  insert into _res(navn, ok, info) values ('T2 kollisjon returnerer PIN_I_BRUK (ikke raise)', v_retur = 'PIN_I_BRUK', v_retur);
  select antall_feil, blokkert_til into v_antall_feil, v_blokkert from pin_forsok where auth_uid = SUB_A;
  insert into _res(navn, ok, info) values ('T2b telleren står på 1, ikke blokkert ennå', v_antall_feil = 1 and v_blokkert is null, coalesce(v_antall_feil::text, 'NULL'));

  -- T3: fire forsøk til (totalt 5) - femte skal sette blokkert_til
  for r in select generate_series(1,4) loop
    perform endre_egen_pin('2222');
  end loop;
  select antall_feil, blokkert_til into v_antall_feil, v_blokkert from pin_forsok where auth_uid = SUB_A;
  insert into _res(navn, ok, info) values ('T3 femte feil setter blokkert_til minst 10 min frem', v_antall_feil = 5 and v_blokkert > now() + interval '9 minutes', coalesce(v_antall_feil::text,'NULL') || ' / ' || coalesce(v_blokkert::text,'NULL'));

  -- T4: sjette forsøk - MED GYLDIG, ledig pin - skal likevel BLOKKERES (FOR_MANGE_FORSOK raiser), ikke slippe gjennom
  v_feilet := false; v_sqlerrm := null;
  begin perform endre_egen_pin('3333'); exception when others then v_feilet := true; v_sqlerrm := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T4 blokkert selv med en faktisk LEDIG pin (sperren slår inn FØR oppslaget)', v_feilet and v_sqlerrm = 'FOR_MANGE_FORSOK', v_sqlerrm);
  select pin into v_pin from ansatte_pin where ansatt_id = 990020;
  insert into _res(navn, ok, info) values ('T4b PIN-en til A er uendret (ingen skriving skjedde)', v_pin = '1111', v_pin);

  -- T5: fersk ansatt/sub - et FORMAT-ugyldig forsøk skal IKKE telle som et forsøk i det hele tatt (raiser fortsatt, ingenting å miste)
  perform set_config('request.jwt.claims', json_build_object('sub', SUB_C, 'ansatt_id', 990021, 'rolle', 'ansatt', 'session_token', 'x')::text, true);
  v_feilet := false; v_sqlerrm := null;
  begin perform endre_egen_pin('12'); exception when others then v_feilet := true; v_sqlerrm := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T5 ugyldig format gir UGYLDIG_PIN (raise, som før)', v_feilet and v_sqlerrm = 'UGYLDIG_PIN', v_sqlerrm);
  insert into _res(navn, ok, info) values ('T5b ugyldig format telles IKKE (ingen rad i pin_forsok)', not exists (select 1 from pin_forsok where auth_uid = SUB_C), null);

  -- T6: samme sub, én ekte kollisjon (mot A sin pin 1111) så en vellykket endring - skal nullstille telleren
  select endre_egen_pin('1111') into v_retur;
  insert into _res(navn, ok, info) values ('T6 kollisjon mot A sin pin returnerer PIN_I_BRUK', v_retur = 'PIN_I_BRUK', v_retur);
  select antall_feil into v_antall_feil from pin_forsok where auth_uid = SUB_C;
  insert into _res(navn, ok, info) values ('T6a én kollisjon telt', v_antall_feil = 1, coalesce(v_antall_feil::text,'NULL'));
  select endre_egen_pin('5555') into v_retur;
  insert into _res(navn, ok, info) values ('T6b vellykket endring returnerer ok', v_retur = 'ok', v_retur);
  select pin into v_pin from ansatte_pin where ansatt_id = 990021;
  insert into _res(navn, ok, info) values ('T6c vellykket endring faktisk lagret', v_pin = '5555', v_pin);
  insert into _res(navn, ok, info) values ('T6d vellykket endring nullstiller telleren (raden slettes)', not exists (select 1 from pin_forsok where auth_uid = SUB_C), null);

  -- T7: admin_sett_pin rammes av samme sperre-mønster (egen sub, så den ikke forstyrres av A sin blokkering)
  perform set_config('request.jwt.claims', json_build_object('sub', SUB_ADMIN, 'ansatt_id', 990022, 'rolle', 'admin', 'session_token', 'x')::text, true);
  for r in select generate_series(1,5) loop
    perform admin_sett_pin(990021, '1111'); -- kolliderer alltid med A sin pin ('1111')
  end loop;
  v_feilet := false; v_sqlerrm := null;
  begin perform admin_sett_pin(990021, '6666'); exception when others then v_feilet := true; v_sqlerrm := sqlerrm; end; -- 6666 er ledig
  insert into _res(navn, ok, info) values ('T7 admin_sett_pin blokkeres etter 5 feil, selv med ledig pin', v_feilet and v_sqlerrm = 'FOR_MANGE_FORSOK', v_sqlerrm);

  -- T8: DELT sperre - A (sub SUB_A) er alt blokkert fra T3/T4; samme sub skal også stoppes i selve INNLOGGINGEN
  perform set_config('request.jwt.claims', json_build_object('sub', SUB_A)::text, true);
  v_feilet := false; v_sqlerrm := null;
  begin perform logg_inn_med_pin('0000'); exception when others then v_feilet := true; v_sqlerrm := sqlerrm; end;
  insert into _res(navn, ok, info) values ('T8 samme sesjon (sub) er også blokkert fra PIN-innlogging (delt forsvar)', v_feilet and v_sqlerrm = 'FOR_MANGE_FORSOK', v_sqlerrm);
end;
$test$;

select navn, ok, info from _res order by n;
