-- Kjøres etter 20261104100000_ordreklokke_opprydding.sql (som er i produksjon siden 2026-11-04). Funn fra etterkontrollen 2026-11-09:
-- stopp_forlatte_ordreklokker() leste slutten på ALLE normal/manuell-føringer til en ansatt i ÉN spørring. En enkelt rad som passerer regex-vaktene men ikke kan tolkes som tidspunkt ('2026-02-30', '25:00') ga feil 22008 for
-- hele spørringen, og den indre exception-blokka svelget det: regel 1 stoppet da økta ved starten (null varighet) selv om gyldige føringer fantes, uten at noen fikk vite det.
-- Nå parses hver rad for seg i timeforing_slutt_ms() (returnerer null for en rad som ikke lar seg tolke), så en ugyldig rad bare utelates og de gyldige brukes. Ellers er cron-funksjonen uendret.
-- Rollback: kjør funksjonen fra 20261104100000_ordreklokke_opprydding.sql på nytt (create or replace), og deretter: drop function public.timeforing_slutt_ms(text, text, text);

-- Slutten på en timeføring som ms siden epoke (Europe/Oslo), eller null hvis raden ikke lar seg tolke. Kun til bruk fra opprydningsfunksjonen (kjører som eier): revokert fra anon/authenticated/public.
create or replace function public.timeforing_slutt_ms(p_dato text, p_start text, p_stopp text)
returns bigint
language plpgsql
stable
set search_path = public
as $$
begin
  return (extract(epoch from ((p_dato || ' ' || p_stopp)::timestamp + case when p_stopp < p_start then interval '1 day' else interval '0' end) at time zone 'Europe/Oslo') * 1000)::bigint;
exception when others then
  return null;
end;
$$;
revoke execute on function public.timeforing_slutt_ms(text, text, text) from public, anon, authenticated;

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
                select public.timeforing_slutt_ms(te.dato, te.start, te.stopp) as slutt_ms
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
