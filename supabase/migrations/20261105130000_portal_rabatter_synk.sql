-- Ikke kjørt ennå (bygges 5.11 lokalt, per Henriks ja i Salmaker'n-økta: "Ja det er bare å
-- starte" - steg 1 av portal-øktas avtalte rekkefølge for rabatt-prosjektet: "bygg+verifiser
-- henting av portalsatser". IKKE steg 2-4 (faktura-sammenligning, omdøping av
-- fiken_kunde_rabatt, fjerning av appens skrivevei) - dette gjøres KUN etter at steg 1 er
-- verifisert og Henrik har sagt ja til neste steg. Denne migrasjonen rører ALDRI
-- fiken_kunde_rabatt/fiken_kunde_alias.
--
-- Henrik 5.11 (direkte i portal-økta): "faktureringa må hente ut rabatter fra portalen",
-- senere presisert: forhandlere i portalen får portalens satser, de appens-kundene UTEN
-- portalforhandler BEHOLDER fiken_kunde_rabatt som reserve (ingen total fjerning av tabellen).
--
-- Hvorfor en EGEN tabell (portal_kunde_rabatt) og IKKE rett inn i fiken_kunde_rabatt: denne
-- tabellen er nøkkelet på PORTALENS id-er (kontakt_id = Salmakern sin Kontakter-id,
-- portal_forhandler_id = portalens egen forhandler-id), mens fiken_kunde_rabatt er nøkkelet på
-- Fiken sin fiken_contact_id - det finnes i dag INGEN pålitelig id-til-id-bro mellom disse to
-- (kartlagt 5.11: en vanlig ordre har bare ordrer.kunde som fri tekst, ingen kontakt_id-kolonne;
-- se samtalen for full kartlegging). Å skrive portalens satser rett inn i fiken_kunde_rabatt nå
-- ville krevd en navnetekst-gjetning akkurat der en feilgjetning koster penger. Denne tabellen
-- er derfor bevisst en RÅ, verifiserbar KOPI av det portalen sier - selve bruken i fakturering
-- (hvordan en ordre finner riktig rad, hva som skjer med delte kontakt_id-er på tvers av flere
-- portal_forhandler_id som i BOS-gruppen) er en EGEN avgjørelse Henrik tar i steg 2, med faktisk
-- faktura-sammenligning som grunnlag - IKKE gjettet frem her.
--
-- Samme kontakt_id kan stå på FLERE rader (delt Kontakter-kontakt, f.eks. BOS-gruppen med 8
-- portalforhandlere) - derfor er portal_forhandler_id (portalens EGEN unike id), ikke
-- kontakt_id, den unike nøkkelen her.
--
-- En portal-rad med ugyldig/manglende rabattsats (NaN/uendelig/negativ/over 100) skal ALDRI nå
-- hit som et tall - edge-funksjonen hent-rabatter-fra-portalen avviser HELE svaret (502) hvis et
-- rabattfelt verken er null eller et gyldig tall 0-100. Databasen har i tillegg egne
-- check-constraints som ekstra sikkerhetsnett (forsvar i dybden, ikke stol på kun ett lag).
--
-- Rollback: drop function if exists public.portal_rabatter_synk(jsonb);
--           drop table if exists public.portal_kunde_rabatt;

create table if not exists portal_kunde_rabatt (
  id bigint generated always as identity primary key,
  portal_forhandler_id text not null unique,
  kontakt_id text not null,
  kontakt_navn text not null default '',
  orgnr text,
  rabatt_standard numeric check (rabatt_standard is null or (rabatt_standard >= 0 and rabatt_standard <= 100)),
  rabatt_ekstrautstyr numeric check (rabatt_ekstrautstyr is null or (rabatt_ekstrautstyr >= 0 and rabatt_ekstrautstyr <= 100)),
  rabatt_modulsystem numeric check (rabatt_modulsystem is null or (rabatt_modulsystem >= 0 and rabatt_modulsystem <= 100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portal_kunde_rabatt_kontakt_id_idx on portal_kunde_rabatt (kontakt_id);

alter table portal_kunde_rabatt enable row level security;

-- Kun lesing for admin (en fremtidig visningsside) - ingen insert/update/delete-policy finnes
-- bevisst (RLS avviser da alt annet enn select som standard): all skriving skjer via RPC-en
-- under, kalt av service_role (som omgår RLS), aldri direkte fra klienten.
create policy "lese_portal_kunde_rabatt" on portal_kunde_rabatt for select
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

-- Hvorfor en HELT NY funksjon og ikke en admin-RPC: samme begrunnelse som portal_selgere_synk
-- (migrasjon 20261105120000) - en fremtidig cron-trigget henting har ingen ansatt-sesjon, så
-- funksjonen må være service_role-only. hent-rabatter-fra-portalen er den eneste døra inn
-- (admin-knapp i v1; server/cron-variant IKKE bygget ennå - avklares med Henrik først).
--
-- Settbasert upsert i ÉN insert-setning (ikke en rad-for-rad-løkke) - idempotent av
-- konstruksjon: kjøring nummer to med samme input endrer ingenting mer (treffer "uendret" via
-- IS DISTINCT FROM-sjekken i where-leddet). Ett enkelt SQL-statement er også race-fritt ved to
-- samtidige kall (vanlig Postgres ON CONFLICT-atomisitet per rad), uten behov for eksplisitt
-- radlås slik portal_selgere_synk trenger for sin jsonb-blob-redigering.
create or replace function public.portal_rabatter_synk(p_forhandlere jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opprettet int;
  v_oppdatert int;
  v_uendret int;
  v_ugyldig_rad int;
  v_ukjent_kontakt_id int;
begin
  if p_forhandlere is null or jsonb_typeof(p_forhandlere) <> 'array' then
    raise exception 'UGYLDIG_INPUT';
  end if;

  -- "on commit drop" dropper tabellen ved COMMIT, ikke mellom hvert funksjonskall - to kall til
  -- portal_rabatter_synk i SAMME transaksjon (f.eks. en test, eller en fremtidig kaller som
  -- bevisst wrapper flere kall) ville ellers feilet med "already exists" på andre kall. Derfor
  -- "if not exists" (lages bare én gang per transaksjon/sesjon) + truncate (alltid tom før bruk).
  create temp table if not exists _portal_rabatt_innkommende (
    portal_forhandler_id text, kontakt_id text, kontakt_navn text, orgnr text,
    rabatt_standard numeric, rabatt_ekstrautstyr numeric, rabatt_modulsystem numeric
  ) on commit drop;
  truncate _portal_rabatt_innkommende;
  insert into _portal_rabatt_innkommende
  select
    nullif(trim(x.portal_forhandler_id), '') as portal_forhandler_id,
    nullif(trim(x.kontakt_id), '') as kontakt_id,
    coalesce(x.kontakt_navn, '') as kontakt_navn,
    nullif(trim(x.orgnr), '') as orgnr,
    x.rabatt_standard, x.rabatt_ekstrautstyr, x.rabatt_modulsystem
  from jsonb_to_recordset(p_forhandlere) as x(
    portal_forhandler_id text, kontakt_id text, kontakt_navn text, orgnr text,
    rabatt_standard numeric, rabatt_ekstrautstyr numeric, rabatt_modulsystem numeric
  );

  select count(*) into v_ugyldig_rad from _portal_rabatt_innkommende
    where portal_forhandler_id is null or kontakt_id is null;
  delete from _portal_rabatt_innkommende where portal_forhandler_id is null or kontakt_id is null;

  -- Rapportert, men IKKE en grunn til å hoppe over raden - portalen kan kjenne en forhandler
  -- Salmakern ennå ikke har lagt inn i Kontakter. Lagres likevel, slik at satsen står klar den
  -- dagen Kontakter-raden opprettes (se migrasjonsnotatet øverst).
  select count(*) into v_ukjent_kontakt_id
  from _portal_rabatt_innkommende i
  where not exists (
    select 1 from innstillinger s, jsonb_array_elements(coalesce(s.kontakter, '[]'::jsonb)) k
    where s.id = 1 and k->>'id' = i.kontakt_id
  );

  with endret as (
    select
      i.portal_forhandler_id,
      (p.portal_forhandler_id is null) as er_ny,
      (p.portal_forhandler_id is not null and (
        p.kontakt_id is distinct from i.kontakt_id or
        p.kontakt_navn is distinct from i.kontakt_navn or
        p.orgnr is distinct from i.orgnr or
        p.rabatt_standard is distinct from i.rabatt_standard or
        p.rabatt_ekstrautstyr is distinct from i.rabatt_ekstrautstyr or
        p.rabatt_modulsystem is distinct from i.rabatt_modulsystem
      )) as er_endret
    from _portal_rabatt_innkommende i
    left join portal_kunde_rabatt p on p.portal_forhandler_id = i.portal_forhandler_id
  )
  select
    count(*) filter (where er_ny),
    count(*) filter (where not er_ny and er_endret),
    count(*) filter (where not er_ny and not er_endret)
  into v_opprettet, v_oppdatert, v_uendret
  from endret;

  insert into portal_kunde_rabatt (portal_forhandler_id, kontakt_id, kontakt_navn, orgnr, rabatt_standard, rabatt_ekstrautstyr, rabatt_modulsystem)
  select portal_forhandler_id, kontakt_id, kontakt_navn, orgnr, rabatt_standard, rabatt_ekstrautstyr, rabatt_modulsystem
  from _portal_rabatt_innkommende
  on conflict (portal_forhandler_id) do update set
    kontakt_id = excluded.kontakt_id,
    kontakt_navn = excluded.kontakt_navn,
    orgnr = excluded.orgnr,
    rabatt_standard = excluded.rabatt_standard,
    rabatt_ekstrautstyr = excluded.rabatt_ekstrautstyr,
    rabatt_modulsystem = excluded.rabatt_modulsystem,
    updated_at = now()
  where
    portal_kunde_rabatt.kontakt_id is distinct from excluded.kontakt_id or
    portal_kunde_rabatt.kontakt_navn is distinct from excluded.kontakt_navn or
    portal_kunde_rabatt.orgnr is distinct from excluded.orgnr or
    portal_kunde_rabatt.rabatt_standard is distinct from excluded.rabatt_standard or
    portal_kunde_rabatt.rabatt_ekstrautstyr is distinct from excluded.rabatt_ekstrautstyr or
    portal_kunde_rabatt.rabatt_modulsystem is distinct from excluded.rabatt_modulsystem;

  return jsonb_build_object(
    'opprettet', v_opprettet, 'oppdatert', v_oppdatert, 'uendret', v_uendret,
    'ugyldigRad', v_ugyldig_rad, 'ukjentKontaktId', v_ukjent_kontakt_id
  );
end;
$$;
revoke all on function public.portal_rabatter_synk(jsonb) from public, anon, authenticated;
grant execute on function public.portal_rabatter_synk(jsonb) to service_role;
