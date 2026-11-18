-- Trinn 5 av «Én produktliste» (Henrik 18.11.2026: «Ja, start trinn 5»): bestillinger fra forhandlernes innkjøpsportal som SELGEREN videresender på e-post.
-- Edge-funksjonen epost-bestilling (Resend inbound) leser e-posten, tolker hver «Rad» (én bil) og vurderer den (tolk.ts / logikk.ts). Her lagres resultatet:
--  * epost_bestillinger: én rad per «Rad» i e-posten. «Innkommende» er radene med status 'innkommende'. Selve e-posten lagres ALDRI (persondata, «lagre
--    det kort»): bare avsenderadressen, forhandleren, chassis.nr, modell, grunnprodukt-/tilvalgsteksten, linjene og hvorfor den stoppet. Behandlede rader
--    slettes etter 60 dager (pg_cron), innkommende blir stående til noen har sett på dem.
--  * ordrer.epost_bestilling_id / epost_bekreftet_at / epost_bekreftet_av: en ordre LAGET av en e-post står som «E-POST · IKKE BEKREFTET» til en ansatt trykker
--    Bekreft (samme tanke som en portalbestilling, men egne kolonner: portal_bestilling_id ville sendt status til portalen for en bestilling portalen ikke kjenner).
--    Leses av dbToOrdre, skrives ALDRI av ordreToDb/save().
--  * Produktene havner i ordrer.portal_linjer (samme felt som en portalbestilling, så «Skal på bilen» viser dem som bestilling) med kilde 'epost' og antall,
--    men UTEN rabatt_prosent: kundens avtalte rabatt brukes ved fakturering. Ingenting går til Fiken herfra.
-- Regler (Henrik): rett på ordren BARE ved sikkert treff (edge-funksjonen sier sikker = true OG ordretilstanden under stemmer), ellers «Innkommende».
-- Finnes ingen aktiv ordre med chassis.nr, lages den («På vei», ikke bekreftet). Datoene i e-posten brukes ikke.
--
-- Rollback (ingen andre objekter avhenger av disse):
--   select cron.unschedule('epost-bestillinger-opprydding');
--   drop function if exists public.epost_bestilling_lagre(jsonb), public.epost_bestilling_legg_paa(text, text), public.epost_bestilling_lag_ordre(text),
--     public.epost_bestilling_avvis(text), public.epost_bekreft_ordre(text), public._epost_lag_ordre(public.epost_bestillinger, jsonb, text),
--     public._epost_legg_linjer_paa(public.epost_bestillinger, text, text), public.epost_bestillinger_rydd(),
--     public._epost_linjer(jsonb), public._epost_tekst(text, int), public._epost_logg(text), public._epost_produktliste_fra();
--   drop table if exists public.epost_bestillinger;
--   alter table public.ordrer drop column if exists epost_bestilling_id, drop column if exists epost_bekreftet_at, drop column if exists epost_bekreftet_av;

alter table public.ordrer add column if not exists epost_bestilling_id text;
alter table public.ordrer add column if not exists epost_bekreftet_at timestamptz;
alter table public.ordrer add column if not exists epost_bekreftet_av text;

create table if not exists public.epost_bestillinger (
  id            text primary key default ('epb_' || replace(gen_random_uuid()::text, '-', '')),
  melding_id    text not null check (char_length(melding_id) between 1 and 120),
  rad           int not null check (rad between 1 and 30),
  mottatt_at    timestamptz not null default now(),
  avsender      text,
  kontakt_id    text,
  kontakt_navn  text,
  selger_navn   text,
  chassis       text,
  chassis_raa   text,
  modell_slug   text,
  grunn_tekst   text not null default '',
  tilvalg_tekst text not null default '',
  linjer        jsonb not null default '[]'::jsonb check (jsonb_typeof(linjer) = 'array'),
  grunner       jsonb not null default '[]'::jsonb check (jsonb_typeof(grunner) = 'array'),
  status        text not null check (status in ('innkommende', 'lagt_paa', 'ny_ordre', 'avvist')),
  ordre_id      text,
  behandlet_av  text,
  behandlet_at  timestamptz,
  unique (melding_id, rad)
);
create index if not exists epost_bestillinger_status_idx on public.epost_bestillinger (status, mottatt_at);
alter table public.epost_bestillinger enable row level security;
-- Bare administrator leser (Innkommende vises bare for admin). Ingen skriveregler: all skriving går via funksjonene under.
drop policy if exists epost_bestillinger_admin_lese on public.epost_bestillinger;
create policy epost_bestillinger_admin_lese on public.epost_bestillinger for select to authenticated
  using (exists (select 1 from public.current_ansatt() a where a.rolle = 'admin'));
revoke all on public.epost_bestillinger from anon;
grant select on public.epost_bestillinger to authenticated;

-- Fra dette tidspunktet viser appen «Skal på bilen» (PRODUKTLISTE_FRA i js/skal-paa-bilen.js). Eldre ordrer viser ikke portal_linjer, så en e-post til en
-- slik ordre går til «Innkommende».
create or replace function public._epost_produktliste_fra() returns timestamptz language sql immutable as $$ select '2026-11-17T17:20:53Z'::timestamptz $$;

-- Linjene fra edge-funksjonen, strengt validert. Feil = exception (hele kallet avvises, aldri en halvt lagret liste).
create or replace function public._epost_linjer(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare v jsonb := '[]'::jsonb; e jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 30 then raise exception 'UGYLDIG_INPUT: linjer'; end if;
  for e in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'produktnummer', '') !~ '^[0-9]{1,6}$'
       or coalesce(btrim(e->>'navn'), '') = '' or char_length(e->>'navn') > 200
       or coalesce(e->>'antall', '') !~ '^[0-9]{1,2}$' or (e->>'antall')::int not between 1 and 50 then
      raise exception 'UGYLDIG_INPUT: linjer';
    end if;
    v := v || jsonb_build_array(jsonb_build_object('produktnummer', e->>'produktnummer',
      'navn', left(btrim(regexp_replace(e->>'navn', '[\u0001-\u001f\u007f<>]', '', 'g')), 200), 'antall', (e->>'antall')::int, 'kilde', 'epost'));
  end loop;
  return v;
end $$;

create or replace function public._epost_tekst(t text, n int) returns text language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(t, ''), '[\u0001-\u001f\u007f​-‏‪-‮⁦-⁩]', ' ', 'g'), '\s+', ' ', 'g')), n)
$$;

create or replace function public._epost_logg(p_tekst text) returns jsonb language sql stable as $$
  select jsonb_build_object('av', 'E-post', 'tid', to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY, HH24:MI:SS'), 'txt', p_tekst)
$$;

-- Legger linjene på en eksisterende ordre (ingen bestilling fra før). Returnerer null ved suksess, ellers grunnen.
create or replace function public._epost_legg_linjer_paa(r public.epost_bestillinger, p_ordre_id text, p_av text) returns text
language plpgsql security definer set search_path = public as $$
declare o public.ordrer%rowtype;
begin
  select * into o from public.ordrer where id = p_ordre_id for update;
  if not found then return 'Ordren finnes ikke'; end if;
  if o.status <> 'aktiv' or coalesce(o.ordretype, 'bil') <> 'bil' then return 'Ordren er ikke en aktiv bil-ordre'; end if;
  if o.created_at < public._epost_produktliste_fra() then return 'Ordren er fra før «Skal på bilen» (17.11), så produktene vises ikke der. Legg dem inn for hånd'; end if;
  if coalesce(jsonb_array_length(o.portal_linjer), 0) > 0 then
    if (select coalesce(jsonb_agg(jsonb_build_object('nr', x->>'produktnummer', 'a', coalesce((x->>'antall')::int, 1)) order by x->>'produktnummer'), '[]') from jsonb_array_elements(o.portal_linjer) x)
     = (select coalesce(jsonb_agg(jsonb_build_object('nr', x->>'produktnummer', 'a', (x->>'antall')::int) order by x->>'produktnummer'), '[]') from jsonb_array_elements(r.linjer) x) then
      return null; -- samme bestilling er allerede på ordren (f.eks. videresendt to ganger)
    end if;
    return 'Ordren har allerede en bestilling med andre produkter';
  end if;
  update public.ordrer
     set portal_linjer = r.linjer,
         endringer = coalesce(endringer, '[]'::jsonb) || jsonb_build_array(public._epost_logg('Bestilling på e-post fra ' || coalesce(nullif(r.selger_navn, ''), r.avsender, 'ukjent')
           || ' lagt på ordren' || case when p_av is not null then ' av ' || p_av else '' end || ': ' || (select string_agg(x->>'produktnummer' || case when (x->>'antall')::int > 1 then ' × ' || (x->>'antall') else '' end, ', ') from jsonb_array_elements(r.linjer) x) || '.')),
         updated_at = now()
   where id = p_ordre_id;
  return null;
end $$;

-- Lager en ny ordre («På vei», ikke bekreftet) for forhandleren (kontakten fra Kontakter). Samme kolonner og utgangsverdier som portal_koble_bestilling.
create or replace function public._epost_lag_ordre(r public.epost_bestillinger, k jsonb, p_av text) returns text
language plpgsql security definer set search_path = public as $$
declare v_id text; v_merke text; v_modell text; v_kunde text := btrim(coalesce(k->>'navn', '')); v_eier text := coalesce(r.selger_navn, ''); v_ukonf int; v_utstyr jsonb; v_dok jsonb := '[]'::jsonb; v_fnr text;
begin
  if r.chassis is null or r.chassis !~ '^[A-HJ-NPR-Z0-9]{17}$' then raise exception 'EPOST: chassis'; end if;
  select merke, modell into v_merke, v_modell from public.portal_modell_kobling where portal_modell_slug = r.modell_slug;
  if not found or coalesce(btrim(v_merke), '') = '' then raise exception 'EPOST: modell'; end if;
  perform pg_advisory_xact_lock(hashtextextended('portal_forhandler:' || lower(v_kunde), 0));
  select count(*) into v_ukonf from public.ordrer where status = 'aktiv' and epost_bestilling_id is not null and epost_bekreftet_at is null and lower(btrim(coalesce(kunde, ''))) = lower(v_kunde);
  if v_ukonf >= 10 then raise exception 'EPOST: tak'; end if;
  -- Selgerens navn som kontaktperson bare hvis det ikke også er navnet på en annen kontakt/kontaktperson (Admin-ark slår opp e-post på NAVN, se portal_koble_bestilling).
  if exists (select 1 from public.innstillinger i, jsonb_array_elements(i.kontakter) kk where i.id = 1 and kk->>'id' <> (k->>'id')
               and (lower(btrim(coalesce(kk->>'navn', ''))) = lower(v_eier)
                    or exists (select 1 from jsonb_array_elements(coalesce(kk->'kontaktpersoner', '[]'::jsonb)) kp where lower(btrim(coalesce(kp->>'navn', ''))) = lower(v_eier)))) then
    v_eier := '';
  end if;
  v_utstyr := jsonb_build_object('har', '', 'skalHa', '', 'hengerfeste', 'ikke_hengerfeste', 'hengerfesteMontert', 'ikke_montert', 'hengerfesteBestilt', 'ikke_bestilt', 'skalHaBekreftet', false);
  v_fnr := btrim(coalesce(k->>'forhandlerNr', ''));
  if v_fnr <> '' then v_utstyr := v_utstyr || jsonb_build_object('forhandlerNr', v_fnr); end if;
  if btrim(coalesce(k->>'fullmaktUrl', '')) <> '' then
    v_dok := jsonb_build_array(jsonb_build_object('navn', coalesce(nullif(k->>'fullmaktNavn', ''), 'Fullmakt.pdf'), 'url', k->>'fullmaktUrl',
      'lastetOppAv', 'Automatisk (forhandlerfullmakt)', 'dato', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;
  v_id := 'ord_' || ((extract(epoch from clock_timestamp()) * 1000)::bigint)::text || '_' || substr(md5(r.id), 1, 6);
  insert into public.ordrer (
    id, regnr, kunde, eier, ombygging, merke, type, modell, variant, versjon, chassis, farge, ankomstdato, status, ordre_status,
    kalender_dato, kalender_tid, vekter, drivstoff, utstyr, bilder_ankomst, bilder_levering, bilder_avstand_skader, bilder_manglende_deler,
    ansatte_signert, signatur, godkjent, godkjenner_navn, diagnose, diagnose_av, fakturert, fakturert_av, ordre_start, ordre_stopp,
    ordre_timer_sessions, klargjoring_timer_sessions, fiken_linjer, notater, endringer, utstyr_sjekkliste, utstyr_mal_navn,
    visnings_sjekkliste, visnings_mal_navn, flate_id, coc, fullmakt, typegodkjenning, egenvekt_coc, forhandler_orgnr, kjoreseddel_skilt,
    dokumenter, updated_at, portal_modell_slug, portal_linjer, forhandler_kontakt_id, epost_bestilling_id
  ) values (
    v_id, '', v_kunde, v_eier, '{"nyttKjoretoy":false,"bruktKjoretoy":false,"lafinto":false,"personbil":false}'::jsonb,
    v_merke, '', v_modell, '', '', r.chassis, '', null, 'aktiv', 'paa_vei', null, '',
    '{"totalvekt":{"a":"","e":"","v":""},"vogntog":{"a":"","e":"","v":""},"foraksel":{"a":"","e":"","v":""},"bakaksel":{"a":"","e":"","v":""}}'::jsonb,
    '{"totalpris":"","satsId":""}'::jsonb, v_utstyr,
    '[null,null,null,null,null,null]'::jsonb, '[null,null,null,null,null,null]'::jsonb, '[null,null,null]'::jsonb, '[]'::jsonb,
    '[]'::jsonb, null, false, '', false, '', false, '', null, null,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '',
    jsonb_build_array(public._epost_logg('Opprettet fra bestilling på e-post fra ' || coalesce(nullif(r.selger_navn, ''), r.avsender, 'ukjent')
      || case when p_av is not null then ' (lagt inn av ' || p_av || ' fra Innkommende)' else '' end || '. Ikke bekreftet ennå.')),
    '[]'::jsonb, '', '[]'::jsonb, '', null, 'har_ikke', case when v_dok <> '[]'::jsonb then 'har' else 'har_ikke' end, '', '', coalesce(k->>'orgnr', ''), null,
    v_dok, now(), r.modell_slug, r.linjer, k->>'id', r.id
  );
  return v_id;
end $$;

-- Hovedinngangen fra edge-funksjonen (bare service_role). Idempotent per (melding_id, rad): Resend kan sende samme varsel flere ganger.
-- p = { melding_id, avsender, kontakt_id, kontakt_navn, selger_navn, rader: [{ rad, chassis, chassis_raa, modell_slug, grunn_tekst, tilvalg_tekst, linjer, sikker, grunner }] }
create or replace function public.epost_bestilling_lagre(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e jsonb; r public.epost_bestillinger; v_ny boolean; v_status text; v_grunner jsonb; v_ordre text; v_k jsonb; v_n int; o public.ordrer%rowtype; v_feil text;
  v_kontakt_id text := nullif(btrim(coalesce(p->>'kontakt_id', '')), ''); v_ut jsonb := '[]'::jsonb; v_melding text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'rader') <> 'array' or jsonb_array_length(p->'rader') not between 1 and 30 then raise exception 'UGYLDIG_INPUT'; end if;
  v_melding := btrim(coalesce(p->>'melding_id', ''));
  if v_melding !~ '^[A-Za-z0-9_.:@<>-]{1,120}$' then raise exception 'UGYLDIG_INPUT: melding_id'; end if;
  for e in select * from jsonb_array_elements(p->'rader') loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'rad', '') !~ '^[0-9]{1,2}$' or jsonb_typeof(e->'grunner') is distinct from 'array' then raise exception 'UGYLDIG_INPUT: rad'; end if;
    insert into public.epost_bestillinger (melding_id, rad, avsender, kontakt_id, kontakt_navn, selger_navn, chassis, chassis_raa, modell_slug, grunn_tekst, tilvalg_tekst, linjer, grunner, status)
    values (v_melding, (e->>'rad')::int, public._epost_tekst(lower(p->>'avsender'), 200), v_kontakt_id, public._epost_tekst(p->>'kontakt_navn', 200), public._epost_tekst(p->>'selger_navn', 120),
            case when upper(coalesce(e->>'chassis', '')) ~ '^[A-HJ-NPR-Z0-9]{17}$' then upper(e->>'chassis') end, public._epost_tekst(e->>'chassis_raa', 60),
            nullif(public._epost_tekst(e->>'modell_slug', 80), ''), public._epost_tekst(e->>'grunn_tekst', 200), public._epost_tekst(e->>'tilvalg_tekst', 500),
            public._epost_linjer(coalesce(e->'linjer', '[]'::jsonb)),
            (select coalesce(jsonb_agg(public._epost_tekst(g #>> '{}', 300)), '[]'::jsonb) from (select g from jsonb_array_elements(e->'grunner') g limit 20) x),
            'innkommende')
    on conflict (melding_id, rad) do nothing
    returning * into r;
    v_ny := found;
    if not v_ny then
      select * into r from public.epost_bestillinger where melding_id = v_melding and rad = (e->>'rad')::int;
      v_ut := v_ut || jsonb_build_array(jsonb_build_object('rad', r.rad, 'status', r.status, 'ny', false));
      continue;
    end if;
    v_status := 'innkommende'; v_grunner := r.grunner; v_ordre := null;
    if coalesce((e->>'sikker')::boolean, false) and jsonb_array_length(r.grunner) = 0 and r.chassis is not null and r.kontakt_id is not null and jsonb_array_length(r.linjer) > 0 then
      select kk into v_k from public.innstillinger i, jsonb_array_elements(i.kontakter) kk where i.id = 1 and kk->>'id' = r.kontakt_id and kk->>'type' = 'Forhandler' limit 1;
      perform pg_advisory_xact_lock(hashtextextended('portal_chassis:' || r.chassis, 0));
      select count(*) into v_n from public.ordrer where status = 'aktiv' and coalesce(ordretype, 'bil') = 'bil' and upper(btrim(coalesce(chassis, ''))) = r.chassis;
      if v_k is null then v_grunner := jsonb_build_array('Forhandleren finnes ikke lenger i Kontakter');
      elsif v_n > 1 then v_grunner := jsonb_build_array('Flere aktive ordrer har dette chassis.nr');
      elsif v_n = 1 then
        select * into o from public.ordrer where status = 'aktiv' and coalesce(ordretype, 'bil') = 'bil' and upper(btrim(coalesce(chassis, ''))) = r.chassis;
        if lower(btrim(coalesce(o.kunde, ''))) <> lower(btrim(coalesce(v_k->>'navn', ''))) then
          v_grunner := jsonb_build_array('Chassis.nr står på en ordre for en annen kunde (' || coalesce(nullif(btrim(o.kunde), ''), 'ingen kunde satt') || ')');
        elsif o.ordre_status = 'hentet' then v_grunner := jsonb_build_array('Ordren med dette chassis.nr er hentet');
        else
          v_feil := public._epost_legg_linjer_paa(r, o.id, null);
          if v_feil is null then v_status := 'lagt_paa'; v_ordre := o.id; else v_grunner := jsonb_build_array(v_feil); end if;
        end if;
      else
        begin
          v_ordre := public._epost_lag_ordre(r, v_k, null); v_status := 'ny_ordre';
        exception when raise_exception then
          v_grunner := jsonb_build_array(case when sqlerrm like '%tak%' then 'Forhandleren har allerede 10 ubekreftede e-postordrer. Bekreft eller slett noen først'
                                              when sqlerrm like '%modell%' then 'Modellen har ingen kobling til merke/modell i appen (portal_modell_kobling)'
                                              else 'Kunne ikke lage ordren' end);
        end;
      end if;
    end if;
    update public.epost_bestillinger set status = v_status, grunner = v_grunner, ordre_id = v_ordre,
           behandlet_at = case when v_status <> 'innkommende' then now() end where id = r.id;
    v_ut := v_ut || jsonb_build_array(jsonb_build_object('rad', r.rad, 'status', v_status, 'ny', true));
  end loop;
  return jsonb_build_object('rader', v_ut);
end $$;

-- Innkommende: administrator legger raden på en valgt ordre (linjene som de står; manglende produkter legges til med «+ Legg til utstyr» etterpå).
create or replace function public.epost_bestilling_legg_paa(p_id text, p_ordre_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.epost_bestillinger; v_av text; v_feil text;
begin
  select a.navn into v_av from public.ansatte a join public.current_ansatt() c on c.id = a.id where c.rolle = 'admin';
  if v_av is null then raise exception 'KUN_ADMIN'; end if;
  select * into r from public.epost_bestillinger where id = p_id for update;
  if not found then raise exception 'FINNES_IKKE'; end if;
  if r.status <> 'innkommende' then raise exception 'ALLEREDE_BEHANDLET'; end if;
  if jsonb_array_length(r.linjer) = 0 then raise exception 'INGEN_LINJER'; end if;
  v_feil := public._epost_legg_linjer_paa(r, p_ordre_id, v_av);
  if v_feil is not null then raise exception 'IKKE_LAGT_PAA: %', v_feil; end if;
  update public.epost_bestillinger set status = 'lagt_paa', ordre_id = p_ordre_id, behandlet_av = v_av, behandlet_at = now() where id = p_id;
  return jsonb_build_object('kode', 'ok', 'ordre_id', p_ordre_id);
end $$;

-- Innkommende: administrator lager en ny ordre fra raden (chassis.nr, modell og forhandler må være kjent, og ingen aktiv ordre har chassis.nr).
create or replace function public.epost_bestilling_lag_ordre(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.epost_bestillinger; v_av text; v_k jsonb; v_ordre text;
begin
  select a.navn into v_av from public.ansatte a join public.current_ansatt() c on c.id = a.id where c.rolle = 'admin';
  if v_av is null then raise exception 'KUN_ADMIN'; end if;
  select * into r from public.epost_bestillinger where id = p_id for update;
  if not found then raise exception 'FINNES_IKKE'; end if;
  if r.status <> 'innkommende' then raise exception 'ALLEREDE_BEHANDLET'; end if;
  if r.chassis is null then raise exception 'MANGLER_CHASSIS'; end if;
  if jsonb_array_length(r.linjer) = 0 then raise exception 'INGEN_LINJER'; end if;
  select kk into v_k from public.innstillinger i, jsonb_array_elements(i.kontakter) kk where i.id = 1 and kk->>'id' = r.kontakt_id and kk->>'type' = 'Forhandler' limit 1;
  if v_k is null then raise exception 'UKJENT_FORHANDLER'; end if;
  perform pg_advisory_xact_lock(hashtextextended('portal_chassis:' || r.chassis, 0));
  if exists (select 1 from public.ordrer where status = 'aktiv' and coalesce(ordretype, 'bil') = 'bil' and upper(btrim(coalesce(chassis, ''))) = r.chassis) then raise exception 'CHASSIS_FINNES'; end if;
  begin
    v_ordre := public._epost_lag_ordre(r, v_k, v_av);
  exception when raise_exception then
    raise exception '%', case when sqlerrm like '%tak%' then 'TAK' when sqlerrm like '%modell%' then 'UKJENT_MODELL' else 'KUNNE_IKKE_LAGE' end;
  end;
  update public.epost_bestillinger set status = 'ny_ordre', ordre_id = v_ordre, behandlet_av = v_av, behandlet_at = now() where id = p_id;
  return jsonb_build_object('kode', 'ok', 'ordre_id', v_ordre);
end $$;

create or replace function public.epost_bestilling_avvis(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_av text;
begin
  select a.navn into v_av from public.ansatte a join public.current_ansatt() c on c.id = a.id where c.rolle = 'admin';
  if v_av is null then raise exception 'KUN_ADMIN'; end if;
  update public.epost_bestillinger set status = 'avvist', behandlet_av = v_av, behandlet_at = now() where id = p_id and status = 'innkommende';
  if not found then raise exception 'ALLEREDE_BEHANDLET'; end if;
  return jsonb_build_object('kode', 'ok');
end $$;

-- Alle innloggede ansatte kan bekrefte en ordre laget av en e-post (som Bekreft på en portalordre). Idempotent.
create or replace function public.epost_bekreft_ordre(p_ordre_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_av text; o public.ordrer%rowtype;
begin
  select a.navn into v_av from public.ansatte a join public.current_ansatt() c on c.id = a.id;
  if v_av is null then raise exception 'IKKE_INNLOGGET'; end if;
  select * into o from public.ordrer where id = p_ordre_id for update;
  if not found then raise exception 'ORDRE_FINNES_IKKE'; end if;
  if o.epost_bestilling_id is null then raise exception 'IKKE_EPOST_ORDRE'; end if;
  if o.epost_bekreftet_at is not null then
    return jsonb_build_object('kode', 'allerede', 'epost_bekreftet_at', o.epost_bekreftet_at, 'epost_bekreftet_av', o.epost_bekreftet_av, 'endringer', o.endringer);
  end if;
  update public.ordrer set epost_bekreftet_at = now(), epost_bekreftet_av = v_av,
         endringer = coalesce(endringer, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('av', v_av, 'tid', to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY, HH24:MI:SS'), 'txt', 'Bestilling på e-post bekreftet')),
         updated_at = now()
   where id = p_ordre_id returning * into o;
  return jsonb_build_object('kode', 'ok', 'epost_bekreftet_at', o.epost_bekreftet_at, 'epost_bekreftet_av', o.epost_bekreftet_av, 'endringer', o.endringer);
end $$;

-- «Lagre det kort»: behandlede rader slettes etter 60 dager. Innkommende blir stående til noen har sett på dem.
create or replace function public.epost_bestillinger_rydd() returns int
language sql security definer set search_path = public as $$
  with d as (delete from public.epost_bestillinger where status <> 'innkommende' and coalesce(behandlet_at, mottatt_at) < now() - interval '60 days' returning 1)
  select count(*)::int from d
$$;

revoke all on function public._epost_produktliste_fra(), public._epost_linjer(jsonb), public._epost_tekst(text, int), public._epost_logg(text),
  public._epost_legg_linjer_paa(public.epost_bestillinger, text, text), public._epost_lag_ordre(public.epost_bestillinger, jsonb, text),
  public.epost_bestilling_lagre(jsonb), public.epost_bestillinger_rydd() from public, anon, authenticated;
grant execute on function public.epost_bestilling_lagre(jsonb) to service_role;
revoke all on function public.epost_bestilling_legg_paa(text, text), public.epost_bestilling_lag_ordre(text), public.epost_bestilling_avvis(text), public.epost_bekreft_ordre(text) from public, anon;
grant execute on function public.epost_bestilling_legg_paa(text, text), public.epost_bestilling_lag_ordre(text), public.epost_bestilling_avvis(text), public.epost_bekreft_ordre(text) to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'epost-bestillinger-opprydding';
select cron.schedule('epost-bestillinger-opprydding', '17 3 * * *', $$select public.epost_bestillinger_rydd()$$);
