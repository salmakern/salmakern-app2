-- Kjørt i produksjon 2026-11-04 kveld. Etterfulgt av 20261109100000_ordreklokke_trygg_parse.sql (trygg parse av timeføringer i cron). Test: supabase/tester/ordreklokke_opprydding_TEST_body.sql (rullet tilbake).
-- Bakgrunn (Henrik 2026-11-04, «reparer dagens»): en Ombygging-klokke (ordrer.ordre_timer_sessions) kunne stå åpen hele natta: Ismails økt startet 3.11 kl. 13:56 og gikk til den ble stoppet manuelt dagen etter,
-- fordi han aldri var stemplet inn. Av 40 økter var 10 over 10 timer (lengste 66,8 t) og 16 uten stemplet tid i det hele tatt. Klokka er koblet til lønnsklokka bare ved en EGEN utstempling.
-- Reparasjonen i databasen:
--  1) Klokka starter bare for den som er stemplet inn (ansatte.stemplet_inn_siden satt), unntatt de som ikke fører lønn (kan_fore_lonn = false: de kan ikke stemple). Gjelder bare Ombygging-/Arbeidstid-feltet
--     (ordre_timer_sessions), ALDRI Klargjøring (en ren manuell klokke uten kobling til lønn, Henriks valg 2026-10-23). Håndheves her, ikke bare i appen, så både den automatiske starten (status/påmelding)
--     og den manuelle knappen følger samme regel. Er noen påmeldt men ikke stemplet inn når fasen starter, starter klokka når de stempler inn (klienten gjenopptar da, se timer.js).
--  2) stopp_ordreklokker_for_ansatt(): stopper ALLE åpne ordreklokker for en ansatt på serveren (ikke bare de som den lokale kopien kjenner), for egen utstempling og for admin (med valgt klokkeslett).
--  3) stopp_forlatte_ordreklokker() (pg_cron hvert 10. minutt): stopper åpne økter for ansatte som IKKE er stemplet inn lenger (stopp = slutten på siste timeføring som overlapper økta, ellers starten),
--     og alle økter eldre enn 14 timer (stopp = start + 14 t). Merkes med autoStopp og logges på ordren. Rører bare rader der noe faktisk stoppes. Hver ordre behandles i sin egen delblokk: en ugyldig rad
--     (tom dato i en timeføring, en start som ikke er et tall, ...) hopper bare over den ordren (advarsel i loggen, «feil» i svaret) og stopper aldri opprydningen for alle andre.
-- Rollback (kjør som ÉN fil/transaksjon, i denne rekkefølgen: de nye RPC-ene kaller hjelperen, så den må ikke droppes før de er byttet ut, ellers feiler hver start av en klokke med «function does not exist»):
--   1) gjenopprett oppdater_ordre_timer_sesjon og oppdater_ordre_timer_fase fra 20261023140000_ordre_timer_effektivitet.sql;
--   2) select cron.unschedule('stopp-forlatte-ordreklokker');
--   3) drop function stopp_forlatte_ordreklokker(); drop function stopp_ordreklokker_for_ansatt(bigint, text, bigint); drop function ansatt_kan_ha_ordreklokke(bigint);

-- Er ansatten stemplet inn (eller unntatt fordi hen ikke fører lønn)? Ukjent ansatt = nei. En innstempling eldre enn 16 timer er en glemt utstempling (samme grense som admin-utstempling i appen) og teller ikke:
-- ellers kunne en klokke startes dagen etter på en gammel stempling som ingen har ryddet.
create or replace function public.ansatt_kan_ha_ordreklokke(p_ansatt_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (a.stemplet_inn_siden is not null and a.stemplet_inn_siden > now() - interval '16 hours') or a.kan_fore_lonn is false from ansatte a where a.id = p_ansatt_id), false);
$$;

-- Start/stopp for EN ansatt. Nytt: «start» på Ombygging-feltet krever at ansatten er stemplet inn (IKKE_STEMPLET_INN). Resten er uendret.
create or replace function public.oppdater_ordre_timer_sesjon(p_ordre_id text, p_felt text, p_handling text, p_ansatt_id integer, p_ansatt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions jsonb;
  v_idx int := null;
  v_i int := 0;
  v_elem jsonb;
  v_me record;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into v_me from current_ansatt();
  if v_me.id is null then
    raise exception 'IKKE_INNLOGGET';
  end if;
  -- Nytt (gjennomgang 2026-11-04): en ansatt kan bare starte/stoppe SIN EGEN klokke; admin kan også andres. Før dette kunne enhver innlogget ansatt starte/stoppe en kollegas klokke med et eget kall.
  -- Appen kaller alltid med innlogget ansatts egen id (admin stopper andres via stopp_ordreklokker_for_ansatt).
  if p_ansatt_id is null then
    raise exception 'UGYLDIG_ANSATT';
  end if;
  if v_me.id is distinct from p_ansatt_id and v_me.rolle <> 'admin' then
    raise exception 'IKKE_TILLATT';
  end if;
  if p_felt not in ('ordre_timer_sessions','klargjoring_timer_sessions') then
    raise exception 'UGYLDIG_FELT';
  end if;
  if p_handling not in ('start','stopp') then
    raise exception 'UGYLDIG_HANDLING';
  end if;

  if p_felt = 'ordre_timer_sessions' then
    select coalesce(ordre_timer_sessions, '[]'::jsonb) into v_sessions from ordrer where id = p_ordre_id for update;
  else
    select coalesce(klargjoring_timer_sessions, '[]'::jsonb) into v_sessions from ordrer where id = p_ordre_id for update;
  end if;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  for v_elem in select * from jsonb_array_elements(v_sessions) loop
    if (v_elem->>'ansattId')::int = p_ansatt_id and (v_elem->>'stopp') is null then
      v_idx := v_i;
    end if;
    v_i := v_i + 1;
  end loop;

  if p_handling = 'start' then
    if v_idx is null then
      if p_felt = 'ordre_timer_sessions' and not ansatt_kan_ha_ordreklokke(p_ansatt_id) then
        raise exception 'IKKE_STEMPLET_INN';
      end if;
      v_sessions := v_sessions || jsonb_build_array(jsonb_build_object('start', v_now, 'stopp', null, 'ansattId', p_ansatt_id, 'ansatt', p_ansatt));
    end if;
  else
    if v_idx is not null then
      v_sessions := jsonb_set(v_sessions, array[v_idx::text,'stopp'], to_jsonb(v_now));
    end if;
  end if;

  if p_felt = 'ordre_timer_sessions' then
    update ordrer set ordre_timer_sessions = v_sessions where id = p_ordre_id;
  else
    update ordrer set klargjoring_timer_sessions = v_sessions where id = p_ordre_id;
  end if;

  return jsonb_build_object('sessions', v_sessions);
end;
$$;

-- Fasestart/-slutt for ALLE påmeldte. Nytt: ved start hoppes påmeldte over som ikke er stemplet inn (bare Ombygging-feltet); navnene returneres i «ikkeStemplet» så appen kan si fra.
create or replace function public.oppdater_ordre_timer_fase(p_ordre_id text, p_felt text, p_handling text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions jsonb;
  v_signert jsonb;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_person jsonb;
  v_har_apen boolean;
  v_elem jsonb;
  v_ikke jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if p_felt not in ('ordre_timer_sessions','klargjoring_timer_sessions') then
    raise exception 'UGYLDIG_FELT';
  end if;
  if p_handling not in ('start_alle_paameldte','avslutt_fase') then
    raise exception 'UGYLDIG_HANDLING';
  end if;

  if p_felt = 'ordre_timer_sessions' then
    select coalesce(ordre_timer_sessions,'[]'::jsonb), coalesce(ansatte_signert,'[]'::jsonb)
      into v_sessions, v_signert from ordrer where id = p_ordre_id for update;
  else
    select coalesce(klargjoring_timer_sessions,'[]'::jsonb), coalesce(ansatte_signert,'[]'::jsonb)
      into v_sessions, v_signert from ordrer where id = p_ordre_id for update;
  end if;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  if p_handling = 'start_alle_paameldte' then
    for v_person in select * from jsonb_array_elements(v_signert) loop
      v_har_apen := false;
      for v_elem in select * from jsonb_array_elements(v_sessions) loop
        if (v_elem->>'ansattId')::int = (v_person->>'id')::int and (v_elem->>'stopp') is null then
          v_har_apen := true;
        end if;
      end loop;
      if not v_har_apen then
        if p_felt = 'ordre_timer_sessions' and not ansatt_kan_ha_ordreklokke((v_person->>'id')::bigint) then
          v_ikke := v_ikke || to_jsonb(v_person->>'navn');
        else
          v_sessions := v_sessions || jsonb_build_array(jsonb_build_object('start', v_now, 'stopp', null, 'ansattId', (v_person->>'id')::int, 'ansatt', v_person->>'navn'));
        end if;
      end if;
    end loop;
  else
    select coalesce(jsonb_agg(
      case when elem->>'stopp' is null then elem || jsonb_build_object('stopp', v_now) else elem end
    ), '[]'::jsonb) into v_sessions
    from jsonb_array_elements(v_sessions) elem;
    v_signert := '[]'::jsonb;
  end if;

  if p_felt = 'ordre_timer_sessions' then
    update ordrer set ordre_timer_sessions = v_sessions, ansatte_signert = v_signert where id = p_ordre_id;
  else
    update ordrer set klargjoring_timer_sessions = v_sessions, ansatte_signert = v_signert where id = p_ordre_id;
  end if;

  return jsonb_build_object('sessions', v_sessions, 'ansatteSignert', v_signert, 'ikkeStemplet', v_ikke);
end;
$$;

-- Stopper ALLE åpne Ombygging-økter for en ansatt, på alle ordrer (eller bare p_ordre_id). Egen utstempling: stopp = nå. Admin kan stoppe andres og velge klokkeslett (p_stopp_ms, ikke i fremtiden;
-- stopp settes aldri før økta startet). Returnerer {antall, ordrer: [{id, sessions}]} så klienten kan oppdatere seg uten å vente på Realtime.
create or replace function public.stopp_ordreklokker_for_ansatt(p_ansatt_id bigint, p_ordre_id text default null, p_stopp_ms bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me record;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_o record;
  v_ny jsonb;
  v_antall int := 0;
  v_denne int;
  v_ordrer jsonb := '[]'::jsonb;
  v_navn text;
  v_stopp bigint;
begin
  select * into v_me from current_ansatt();
  if v_me.id is null then
    raise exception 'IKKE_INNLOGGET';
  end if;
  if p_ansatt_id is null then
    raise exception 'UGYLDIG_ANSATT';
  end if;
  if v_me.id <> p_ansatt_id and v_me.rolle <> 'admin' then
    raise exception 'IKKE_TILLATT';
  end if;
  if p_stopp_ms is not null and v_me.rolle <> 'admin' then
    raise exception 'IKKE_TILLATT';
  end if;
  if p_stopp_ms is not null and p_stopp_ms > v_now + 60000 then
    raise exception 'STOPP_I_FREMTIDEN';
  end if;
  v_stopp := least(coalesce(p_stopp_ms, v_now), v_now);
  select navn into v_navn from ansatte where id = p_ansatt_id;

  for v_o in
    select o.id, o.ordre_timer_sessions as okter from ordrer o
    where jsonb_typeof(o.ordre_timer_sessions) = 'array' and (p_ordre_id is null or o.id = p_ordre_id)
      and exists (select 1 from jsonb_array_elements(o.ordre_timer_sessions) e where (e->>'stopp') is null and e->>'ansattId' = p_ansatt_id::text)
    order by o.id
    for update
  loop
    select count(*) into v_denne from jsonb_array_elements(v_o.okter) e where (e->>'stopp') is null and e->>'ansattId' = p_ansatt_id::text;
    select jsonb_agg(
      case when (e->>'stopp') is null and e->>'ansattId' = p_ansatt_id::text
        then jsonb_set(e, '{stopp}', to_jsonb(greatest((e->>'start')::bigint, v_stopp)))
             || case when v_me.id <> p_ansatt_id then jsonb_build_object('stoppetAvAdmin', true) else '{}'::jsonb end
        else e end order by ord) into v_ny
    from jsonb_array_elements(v_o.okter) with ordinality as t(e, ord);
    update ordrer set ordre_timer_sessions = v_ny,
      endringer = case when v_me.id <> p_ansatt_id then coalesce(endringer, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'tid', to_char(now() at time zone 'Europe/Oslo', 'FMDD.FMMM.YYYY, HH24:MI:SS'),
        'txt', 'Ombygging-klokka til ' || coalesce(v_navn, '?') || ' ble stoppet av administrator (kl. ' || to_char(to_timestamp(v_stopp / 1000.0) at time zone 'Europe/Oslo', 'HH24:MI') || ')',
        'av', 'System')) else endringer end
    where id = v_o.id;
    v_antall := v_antall + v_denne;
    v_ordrer := v_ordrer || jsonb_build_array(jsonb_build_object('id', v_o.id, 'sessions', v_ny));
  end loop;

  return jsonb_build_object('antall', v_antall, 'ordrer', v_ordrer);
end;
$$;

-- Opprydding (pg_cron hvert 10. minutt, ingen innlogging; ikke kallbar utenfra): stopper åpne Ombygging-økter som ikke lenger har noen mening.
--  regel 1: ansatten er IKKE stemplet inn lenger (tom stempling) og fører lønn: stopp = slutten på siste timeføring (normal/manuell) som slutter etter at økta startet (men høyst start + 14 t), ellers starten på økta (nullengde). Økter nyere enn 10 min røres ikke.
--  regel 2: økta er eldre enn 14 timer: stopp = start + 14 t.
create or replace function public.stopp_forlatte_ordreklokker()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_o record;
  v_e jsonb;
  v_ny jsonb;
  v_endr jsonb;
  v_endret boolean;
  v_start bigint;
  v_siste bigint;
  v_stopp bigint;
  v_grunn text;
  v_ansatt bigint;
  v_navn text;
  v_tom_stempling boolean;
  r1 int := 0;
  r2 int := 0;
  l1 int;
  l2 int;
  v_feil int := 0;
begin
  -- Ingen cast i filteret (en ugyldig verdi i én ordre skal ikke kunne velte spørringen for alle): bare «har en økt uten stopp». Selve vurderingen skjer trygt per økt under.
  for v_o in
    select o.id, o.ordre_timer_sessions as okter, o.endringer from ordrer o
    where jsonb_typeof(o.ordre_timer_sessions) = 'array'
      and exists (select 1 from jsonb_array_elements(o.ordre_timer_sessions) e where jsonb_typeof(e) = 'object' and (e->>'stopp') is null)
    order by o.id
    for update
  loop
    begin
      l1 := 0; l2 := 0;
      v_ny := '[]'::jsonb; v_endr := '[]'::jsonb; v_endret := false;
      for v_e in select * from jsonb_array_elements(v_o.okter) loop
        v_grunn := null;
        v_start := case when jsonb_typeof(v_e) = 'object' and (v_e->>'start') ~ '^\d{1,15}$' then (v_e->>'start')::bigint end;
        if v_start is not null and (v_e->>'stopp') is null and v_start < v_now - 600000 then
          v_ansatt := case when (v_e->>'ansattId') ~ '^\d{1,15}$' then (v_e->>'ansattId')::bigint end;
          -- Regel 1 gjelder bare en TOM stempling (ansatten er ikke stemplet inn): en GAMMEL, ikke-tom stempling (over 16 t, glemt utstempling) hører under regel 2 (start + 14 t). Ellers ville en økt som startet mer enn 2 t etter
          -- innstemplingen blitt stengt med null varighet så snart stemplingen ble 16 t gammel, og admin kunne ikke rette det etterpå (stopp_ordreklokker_for_ansatt finner da ingen åpen økt).
          -- Ukjent ansatt (økt uten gyldig ansattId) regnes som ikke stemplet. Ansatte som ikke fører lønn (kan_fore_lonn = false) berøres bare av regel 2.
          v_tom_stempling := coalesce((select a.stemplet_inn_siden is null and a.kan_fore_lonn is not false from ansatte a where a.id = v_ansatt), true);
          if v_tom_stempling then
            -- Slutten på siste timeføring etter at økta startet. Ugyldig data i en timeføring (tom dato, umulig dato) gir «ingen føring funnet» i stedet for en feil.
            begin
              select max(x.slutt_ms) into v_siste from (
                select (extract(epoch from ((te.dato::text || ' ' || te.stopp)::timestamp + case when te.stopp < te.start then interval '1 day' else interval '0' end) at time zone 'Europe/Oslo') * 1000)::bigint as slutt_ms
                from timer_entries te
                where te.ansatt_id = v_ansatt and te.type in ('normal', 'manuell') and te.dato ~ '^\d{4}-\d{2}-\d{2}$' and te.start ~ '^\d\d:\d\d$' and te.stopp ~ '^\d\d:\d\d$') x
              where x.slutt_ms > v_start and x.slutt_ms <= v_now;
            exception when others then
              v_siste := null;
            end;
            -- Aldri senere enn start + 14 t (som regel 2): ligger cron etter (nedetid, sen utrulling), skal en gammel økt ikke strekkes over senere dagers arbeid.
            v_stopp := greatest(v_start, least(coalesce(v_siste, v_start), v_start + 14 * 3600000));
            v_grunn := 'ikke_stemplet_inn'; l1 := l1 + 1;
          elsif v_start < v_now - 14 * 3600000 then
            v_stopp := v_start + 14 * 3600000;
            v_grunn := 'glemt'; l2 := l2 + 1;
          end if;
        end if;
        if v_grunn is not null then
          v_e := jsonb_set(v_e, '{stopp}', to_jsonb(v_stopp)) || jsonb_build_object('autoStopp', v_grunn);
          v_navn := coalesce(v_e->>'ansatt', '?');
          v_endr := v_endr || jsonb_build_array(jsonb_build_object(
            'tid', to_char(now() at time zone 'Europe/Oslo', 'FMDD.FMMM.YYYY, HH24:MI:SS'),
            'txt', 'Ombygging-klokka til ' || v_navn || ' ble stoppet automatisk (' || case v_grunn when 'ikke_stemplet_inn' then 'ikke lenger stemplet inn' else 'gikk over 14 timer' end || ')',
            'av', 'System'));
          v_endret := true;
        end if;
        v_ny := v_ny || jsonb_build_array(v_e);
      end loop;
      if v_endret then
        update ordrer set ordre_timer_sessions = v_ny, endringer = coalesce(v_o.endringer, '[]'::jsonb) || v_endr where id = v_o.id;
      end if;
      r1 := r1 + l1; r2 := r2 + l2;
    exception when others then
      -- Denne ordren hoppes over (endringene i delblokken rulles tilbake); alle andre ordrer behandles som vanlig. Prøves på nytt neste kjøring.
      v_feil := v_feil + 1;
      raise warning 'stopp_forlatte_ordreklokker: ordre % hoppet over: %', v_o.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ikkeStemplet', r1, 'glemt', r2, 'feil', v_feil);
end;
$$;

revoke execute on function public.stopp_forlatte_ordreklokker() from public, anon, authenticated;
-- Hjelperen er security definer og omgår RLS på ansatte: den kalles BARE fra de andre security definer-funksjonene her (som kjører som eier), og skal ikke kunne kalles utenfra (ellers kunne hvem som helst med anon-nøkkelen
-- sjekke hvem som er stemplet inn akkurat nå). Supabase gir nye funksjoner execute til anon/authenticated som standard, derfor eksplisitt revoke.
revoke execute on function public.ansatt_kan_ha_ordreklokke(bigint) from public, anon, authenticated;
grant execute on function public.stopp_ordreklokker_for_ansatt(bigint, text, bigint) to anon, authenticated;

-- Hvert 10. minutt (samme mønster som de andre cron-jobbene). cron.schedule med samme navn erstatter en eksisterende jobb.
select cron.schedule('stopp-forlatte-ordreklokker', '*/10 * * * *', 'select public.stopp_forlatte_ordreklokker()');
