-- Bakgrunn: lageret har i dag 178 varer, 88 under minimum, men 0 registrerte bestillinger og bare 2 varer med
-- leverandør satt. Henrik vil på sikt ha automatiske forslag til oppbestilling, men presiserte at eksisterende,
-- allerede bestilte varer MÅ registreres manuelt (med "Registrer alt under minimum som allerede bestilt",
-- se 20261103200000_lager_hyller_og_bestillinger.sql) FØR automatikken noensinne kjører - ellers ville den
-- foreslå oppbestilling på alt som allerede er bestilt utenom appen. Denne migrasjonen bygger og tester hele
-- funksjonen, men lar den stå AVSLÅTT (innstillinger.lager_forslag_aktiv = false) til Henrik selv slår den på.
--
-- Hvordan bryteren virker: cron-jobben under kjører HVER dag kl. 06:30 (Oslo-tid) og kaller alltid
-- lager_generer_bestillingsforslag() - men funksjonen sjekker FØRST innstillinger.lager_forslag_aktiv og gjør
-- ingenting (returnerer {aktiv:false, generert:0}) når den er false (default). Henrik slår den på selv, uten
-- noen ny utrulling, med:
--   update innstillinger set lager_forslag_aktiv = true where id = 1;
-- (eller via en admin-only bryter i appen, Lager → Bestillinger → "Automatiske forslag").
--
-- Et FORSLAG er en rad i lager_bestillinger med status = 'forslag' (ny verdi, lagt til i CHECK-regelen) - samme
-- tabell og samme felter som en ekte bestilling, bare ikke godkjent ennå. Forslag kommer ALDRI for en vare uten
-- leverandør satt (eksplisitt krav, i motsetning til et tidligere, uavklart forslag om å tillate det): en vare
-- uten leverandør er i dag 86 av de 88 under minimum, og skal fortsatt kreve at noen slår opp leverandøren først.
-- Bare admin kan godkjenne (lager_godkjenn_bestillingsforslag, gjør forslaget til en ekte åpen bestilling, samme
-- virkning som "Registrer bestilling") eller avvise (lager_avvis_bestillingsforslag, sletter forslagsraden -
-- den var aldri en ekte bestilling. Er varen fortsatt under minimum neste dag og ingen har registrert en ekte
-- bestilling i mellomtiden, foreslås den på nytt - bevisst, for å ikke kreve en egen "husk at dette ble avvist"-
-- mekanisme for en funksjon som uansett starter avslått).
--
-- Rollback: select cron.unschedule('lager-bestillingsforslag-kl-0630');
--           drop function public.lager_avvis_bestillingsforslag(text);
--           drop function public.lager_godkjenn_bestillingsforslag(text, text, numeric, date);
--           drop function public.lager_generer_bestillingsforslag();
--           alter table public.lager_bestillinger drop constraint lager_bestillinger_status_check;
--           alter table public.lager_bestillinger add constraint lager_bestillinger_status_check check (status in ('apen','mottatt','kansellert'));
--           alter table public.innstillinger drop column if exists lager_forslag_aktiv;

-- ─── 1) Status 'forslag' i tillegg til apen/mottatt/kansellert ────────────────────────────────────────────────
alter table public.lager_bestillinger drop constraint lager_bestillinger_status_check;
alter table public.lager_bestillinger add constraint lager_bestillinger_status_check
  check (status in ('apen', 'mottatt', 'kansellert', 'forslag'));

-- ─── 2) Bryteren (samme mønster som gps_lat/dagens_pin/timesats_kr - singleton-rad id = 1) ────────────────────
alter table public.innstillinger add column if not exists lager_forslag_aktiv boolean not null default false;

-- ─── 3) Generer forslag (kalles av cron, ALDRI fra klienten - revoke under) ───────────────────────────────────
-- For hver vare UNDER minimum, UTEN en åpen bestilling ELLER et forslag fra før, OG MED leverandør satt: lag
-- én forslagsrad. Samme antallsformel som foreslaattBestillingsantall() i js/lager-hylle.js (det som mangler
-- til minimum, minst 1). Markerer varen bestilt = true med en gang (som lager_registrer_bestillinger gjør) -
-- det hindrer en ansatt fra å registrere en ekte dobbel bestilling mens forslaget venter på godkjenning; blir
-- forslaget avvist, nullstilles flagget igjen (se lager_avvis_bestillingsforslag).
create or replace function public.lager_generer_bestillingsforslag()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktiv boolean;
  v_vareider jsonb := '[]'::jsonb;
  v record;
  v_antall numeric;
begin
  select coalesce(lager_forslag_aktiv, false) into v_aktiv from innstillinger where id = 1;
  if not coalesce(v_aktiv, false) then
    return jsonb_build_object('aktiv', false, 'generert', 0);
  end if;

  for v in
    select lv.id, lv.antall, lv.min_antall, lv.leverandor
    from lagervarer lv
    where lv.min_antall > 0
      and lv.antall <= lv.min_antall
      and coalesce(nullif(btrim(lv.leverandor), ''), '') <> ''
      and not exists (
        select 1 from lager_bestillinger lb where lb.vare_id = lv.id and lb.status in ('apen', 'forslag')
      )
    order by lv.id
  loop
    v_antall := greatest(1, ceil(case when (v.min_antall - v.antall) > 0 then (v.min_antall - v.antall) else greatest(v.min_antall, 1) end));
    insert into lager_bestillinger (id, vare_id, antall, ukjent_antall, leverandor, status, bestilt_av, kommentar)
    values (
      'lb_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || floor(random() * 100000)::int,
      v.id, v_antall, false, v.leverandor, 'forslag', '', 'Automatisk forslag: under minimum'
    );
    update lagervarer set bestilt = true where id = v.id;
    v_vareider := v_vareider || jsonb_build_array(v.id);
  end loop;

  return jsonb_build_object('aktiv', true, 'generert', jsonb_array_length(v_vareider), 'vareIder', v_vareider);
end;
$$;

-- Supabase gir execute til PUBLIC (altså anon/authenticated via PostgREST) på nye funksjoner som standard -
-- denne skal BARE kunne kalles av cron (som kjører med eierens rettigheter), aldri fra klienten direkte.
revoke execute on function public.lager_generer_bestillingsforslag() from public, anon, authenticated;

-- ─── 4) Godkjenn et forslag (BARE admin) - gjør det til en ekte åpen bestilling ────────────────────────────────
-- p_antall/p_forventet_dato er valgfrie: admin kan justere antallet eller sette en forventet leveringsdato
-- før godkjenning, uten å måtte avvise og registrere på nytt for hånd.
create or replace function public.lager_godkjenn_bestillingsforslag(p_id text, p_ansatt text, p_antall numeric default null, p_forventet_dato date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b lager_bestillinger%rowtype;
  v_antall numeric;
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;
  select * into b from lager_bestillinger where id = p_id for update;
  if not found then
    raise exception 'FORSLAG_FINNES_IKKE';
  end if;
  if b.status <> 'forslag' then
    raise exception 'IKKE_FORSLAG';
  end if;
  v_antall := coalesce(p_antall, b.antall);
  if not b.ukjent_antall and v_antall <= 0 then
    raise exception 'UGYLDIG_ANTALL';
  end if;
  update lager_bestillinger
  set status = 'apen',
      antall = case when b.ukjent_antall then b.antall else v_antall end,
      forventet_dato = coalesce(p_forventet_dato, forventet_dato),
      bestilt_dato = coalesce(bestilt_dato, current_date),
      bestilt_av = coalesce(nullif(p_ansatt, ''), bestilt_av)
  where id = p_id;
  update lagervarer set bestilt = true where id = b.vare_id;
  return jsonb_build_object('vareId', b.vare_id);
end;
$$;

-- ─── 5) Avvis et forslag (BARE admin) - det var aldri en ekte bestilling, så raden slettes helt ──────────────
create or replace function public.lager_avvis_bestillingsforslag(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b lager_bestillinger%rowtype;
  v_apne integer;
begin
  if not exists (select 1 from current_ansatt() where rolle = 'admin') then
    raise exception 'KUN_ADMIN';
  end if;
  select * into b from lager_bestillinger where id = p_id for update;
  if not found then
    raise exception 'FORSLAG_FINNES_IKKE';
  end if;
  if b.status <> 'forslag' then
    raise exception 'IKKE_FORSLAG';
  end if;
  delete from lager_bestillinger where id = p_id;
  select count(*) into v_apne from lager_bestillinger where vare_id = b.vare_id and status in ('apen', 'forslag');
  update lagervarer set bestilt = (v_apne > 0) where id = b.vare_id;
  return jsonb_build_object('vareId', b.vare_id, 'bestilt', v_apne > 0);
end;
$$;

grant execute on function public.lager_godkjenn_bestillingsforslag(text, text, numeric, date) to anon, authenticated;
grant execute on function public.lager_avvis_bestillingsforslag(text) to anon, authenticated;

-- ─── 6) Cron kl. 06:30 Oslo-tid, hver dag ───────────────────────────────────────────────────────────────────
-- Samme mønster som daglig-pin-rotasjon/daglig-paaminnelse: kjører på begge UTC-timer 06:30 Oslo-tid kan falle
-- på (04:30 UTC om sommeren/CEST, 05:30 UTC om vinteren/CET), og den indre sjekken avgjør hvilken som faktisk
-- er 06:30 i Oslo akkurat nå. Kaller funksjonen UBETINGET hver dag - selve AV/PÅ-bryteren ligger i funksjonen
-- (innstillinger.lager_forslag_aktiv), ikke her, slik at Henrik kan slå den på/av uten noen ny utrulling.
select cron.schedule(
  'lager-bestillingsforslag-kl-0630',
  '30 4,5 * * *',
  $$
  DO $do$
  BEGIN
    IF extract(hour from now() at time zone 'Europe/Oslo') = 6
       AND extract(minute from now() at time zone 'Europe/Oslo') = 30 THEN
      PERFORM public.lager_generer_bestillingsforslag();
    END IF;
  END $do$;
  $$
);
