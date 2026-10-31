-- s08-034: portal-økta sitt spørsmål (31.10) - uten en hendelse akkurat ved Bekreft vet
-- portalen ingenting om en bestilling før ordre_status FAKTISK endrer seg (triggeren
-- ordre-status-utboks, 20261030200000/20261031160000, fyrer bare på en reell overgang).
-- Står en ordre lenge på samme status etter at den er bekreftet (f.eks. fortsatt "På vei"
-- i flere dager), ville portalen ikke sett noen status i det hele tatt.
--
-- Fiks: portal_bekreft_ordre() legger nå selv en rad rett i ordre_status_utboks ved
-- bekreftelse, med status_forrige = null og status = ordrens FAKTISKE status akkurat da -
-- nøyaktig samme radform som triggeren selv lager, slik at send-ordre-status-til-portal
-- ikke trenger å skille dem. Lagt inn i en egen exception-blokk (samme prinsipp som
-- triggeren): en feilende kø-innsetting skal aldri hindre selve bekreftelsen.
create or replace function public.portal_bekreft_ordre(p_ordre_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ans_id bigint;
  v_navn text;
  v_o public.ordrer%rowtype;
  v_tid text;
  v_endringer jsonb;
  v_bekreftet_at timestamptz;
begin
  select a.id into v_ans_id from public.current_ansatt() a;
  if v_ans_id is null then
    raise exception 'IKKE_INNLOGGET';
  end if;
  select coalesce(nullif(btrim(an.navn), ''), 'Ansatt ' || an.id::text) into v_navn from public.ansatte an where an.id = v_ans_id;

  select * into v_o from public.ordrer where id = p_ordre_id for update;
  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;
  if v_o.portal_bestilling_id is null then
    raise exception 'IKKE_PORTAL_ORDRE';
  end if;
  if v_o.portal_bekreftet_at is not null then
    return jsonb_build_object('kode', 'allerede_bekreftet', 'portal_bekreftet_at', v_o.portal_bekreftet_at, 'portal_bekreftet_av', coalesce(v_o.portal_bekreftet_av, ''),
                              'endringer', coalesce(v_o.endringer, '[]'::jsonb));
  end if;

  v_tid := to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY, HH24:MI:SS');
  v_bekreftet_at := now();
  v_endringer := coalesce(v_o.endringer, '[]'::jsonb)
                 || jsonb_build_array(jsonb_build_object('av', v_navn, 'tid', v_tid, 'txt', 'Bekreftet som bestilling fra Forhandlerportalen'));
  update public.ordrer
     set portal_bekreftet_at = v_bekreftet_at, portal_bekreftet_av = v_navn, endringer = v_endringer, updated_at = v_bekreftet_at
   where id = p_ordre_id;
  update public.portal_bestillinger
     set status = 'bekreftet', detalj = 'Bekreftet av ' || v_navn || ' ' || v_tid, oppdatert_at = v_bekreftet_at
   where portal_bestilling_id = v_o.portal_bestilling_id;

  begin
    insert into public.ordre_status_utboks (ordre_id, status, status_forrige)
    values (p_ordre_id, v_o.ordre_status, null);
  exception when others then
    raise warning 'portal-bekreft-ordre: kunne ikke legge startstatus i utboksen (%), bekreftelsen fortsetter uendret', sqlerrm;
  end;

  return jsonb_build_object('kode', 'ok', 'portal_bekreftet_at', v_bekreftet_at, 'portal_bekreftet_av', v_navn, 'endringer', v_endringer);
end;
$function$;
