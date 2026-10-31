-- Kjøres i en transaksjon som ALLTID rulles tilbake - ingenting av dette består.
-- Kjøring (fra rotmappen, samme mønster som portal_bekreft_avvis_TEST_body.sql):
--   (echo "begin;"; cat supabase/migrations/20261031110000_ansatte_skrivebeskyttelse.sql; cat supabase/tester/ansatte_skrivebeskyttelse_TEST_body.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --file /tmp/t.sql
-- Siste setning før rollback skriver ut resultatlinjene: alle skal ha ok=true.

create temp table _res (n serial, navn text, ok boolean, info text);

-- 1) Lag to TEST-ansatte (990001 = vanlig ansatt, 990002 = admin) - triggeren slås AV et
--    øyeblikk for selve oppsettet (vi kjører som postgres, uten noen innlogget ansatt-sesjon).
alter table ansatte disable trigger ansatte_beskytt_skriving_trigger;
insert into ansatte (id, navn, rolle, aktiv, session_token)
values (990001, 'TEST - vanlig ansatt', 'ansatt', true, 'test-token-990001'),
       (990002, 'TEST - admin', 'admin', true, 'test-token-990002');
alter table ansatte enable trigger ansatte_beskytt_skriving_trigger;

do $$
declare
  v_feil text;
begin

  -- T1: vanlig ansatt kan IKKE opprette en ny rad (ikke engang en vanlig en).
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    insert into ansatte (id, navn, rolle, aktiv) values (990003, 'TEST - uautorisert insert', 'ansatt', true);
    insert into _res(navn, ok, info) values ('T1', false, 'insert ble tillatt for ikke-admin');
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T1', v_feil = 'KUN_ADMIN', v_feil);
  end;

  -- T2: vanlig ansatt kan IKKE sette en admin inaktiv.
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    update ansatte set aktiv = false where id = 990002;
    insert into _res(navn, ok, info) values ('T2', false, 'update av aktiv på admin ble tillatt');
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T2', v_feil = 'KUN_ADMIN', v_feil);
  end;

  -- T3: vanlig ansatt kan IKKE slette en admin-rad.
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    delete from ansatte where id = 990002;
    insert into _res(navn, ok, info) values ('T3', false, 'delete av admin ble tillatt');
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T3', v_feil = 'KUN_ADMIN', v_feil);
  end;

  -- T4: vanlig ansatt KAN endre sitt eget navn (eksisterende, bevisst lovlig flyt).
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    update ansatte set navn = 'TEST - nytt navn' where id = 990001;
    insert into _res(navn, ok, info)
      select 'T4', navn = 'TEST - nytt navn', navn from ansatte where id = 990001;
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T4', false, 'uventet feil: ' || v_feil);
  end;

  -- T5: vanlig ansatt KAN sette stemplet_inn_siden på egen rad (innstempling).
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    update ansatte set stemplet_inn_siden = now() where id = 990001;
    insert into _res(navn, ok, info)
      select 'T5', stemplet_inn_siden is not null, stemplet_inn_siden::text from ansatte where id = 990001;
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T5', false, 'uventet feil: ' || v_feil);
  end;

  -- T6: vanlig ansatt kan IKKE endre en ANNEN ansatts navn.
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    update ansatte set navn = 'TEST - kapret navn' where id = 990002;
    insert into _res(navn, ok, info) values ('T6', false, 'endring av en annens navn ble tillatt');
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T6', v_feil = 'KUN_ADMIN', v_feil);
  end;

  -- T7: vanlig ansatt kan fortsatt IKKE endre egen rolle (eksisterende trigger, uendret).
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    update ansatte set rolle = 'admin' where id = 990001;
    insert into _res(navn, ok, info) values ('T7', false, 'rolle-eskalering ble tillatt');
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T7', v_feil = 'KUN_ADMIN', v_feil);
  end;

  -- T8: vanlig ansatt kan IKKE snike med flere kolonner i samme kall som eget navn (f.eks.
  --     sette aktiv=false på seg selv samtidig med en lovlig navneendring).
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    update ansatte set navn = 'TEST - snik', aktiv = false where id = 990001;
    insert into _res(navn, ok, info) values ('T8', false, 'aktiv ble endret sammen med navn');
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T8', v_feil = 'KUN_ADMIN', v_feil);
  end;

  -- T9: admin KAN opprette en ny ansatt-rad direkte.
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990002, 'session_token', 'test-token-990002')::text, true);
  begin
    insert into ansatte (id, navn, rolle, aktiv) values (990004, 'TEST - admin-opprettet', 'ansatt', true);
    insert into _res(navn, ok, info) select 'T9', exists(select 1 from ansatte where id = 990004), 'opprettet';
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T9', false, 'uventet feil: ' || v_feil);
  end;

  -- T10: admin KAN sette en annen (ikke-admin) inaktiv.
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990002, 'session_token', 'test-token-990002')::text, true);
  begin
    update ansatte set aktiv = false where id = 990004;
    insert into _res(navn, ok, info) select 'T10', aktiv = false, aktiv::text from ansatte where id = 990004;
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T10', false, 'uventet feil: ' || v_feil);
  end;

  -- T11: admin KAN endre rolle på en annen ansatt (begge triggere skal slippe admin gjennom).
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990002, 'session_token', 'test-token-990002')::text, true);
  begin
    update ansatte set rolle = 'godkjenner' where id = 990004;
    insert into _res(navn, ok, info) select 'T11', rolle = 'godkjenner', rolle from ansatte where id = 990004;
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T11', false, 'uventet feil: ' || v_feil);
  end;

  -- T12: admin KAN slette en ansatt-rad.
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990002, 'session_token', 'test-token-990002')::text, true);
  begin
    delete from ansatte where id = 990004;
    insert into _res(navn, ok, info) select 'T12', not exists(select 1 from ansatte where id = 990004), 'slettet';
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T12', false, 'uventet feil: ' || v_feil);
  end;

  -- T13: opprett_ansatt-RPC-en (den ekte app-flyten) fungerer fortsatt uendret for en admin.
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990002, 'session_token', 'test-token-990002')::text, true);
  begin
    perform opprett_ansatt(990005, 'TEST - via RPC', 'ansatt', '9999');
    insert into _res(navn, ok, info) select 'T13', exists(select 1 from ansatte where id = 990005), 'opprettet via RPC';
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T13', false, 'uventet feil: ' || v_feil);
  end;

  -- T14: opprett_ansatt-RPC-en avvises fortsatt for en ikke-admin (dens EGEN sjekk, uendret).
  perform set_config('request.jwt.claims', jsonb_build_object('ansatt_id', 990001, 'session_token', 'test-token-990001')::text, true);
  begin
    perform opprett_ansatt(990006, 'TEST - skal feile', 'ansatt', '9998');
    insert into _res(navn, ok, info) values ('T14', false, 'opprett_ansatt tillot ikke-admin');
  exception when others then
    get stacked diagnostics v_feil = message_text;
    insert into _res(navn, ok, info) values ('T14', v_feil = 'KUN_ADMIN', v_feil);
  end;

end $$;

select navn, ok, info from _res order by n;
