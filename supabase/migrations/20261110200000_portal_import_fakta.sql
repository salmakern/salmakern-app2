-- Ikke kjørt ennå (skrives 10.11, kjøres etter Henriks eget ja).
--
-- Gir Forhandlerportalen et SKRIVEBESKYTTET øyeblikksbilde av aktive bil-ordrer, til bruk for å vise aktive biler i selgernes «Mine bestillinger» hos
-- portalen (etappe 1, import for godkjente kunder). Portalen HENTER (pull) via edge-funksjonen portal-import-fakta og eier all matching mot forhandlere,
-- oppretting og skjuling selv; appen skriver aldri til portalen, og portalen skriver aldri hit. Funksjonen er den ENESTE appsiden av dette, sammen med
-- edge-funksjonen (som bare er døra inn).
--
-- Skrivebeskyttet av konstruksjon: STABLE (Postgres avviser en INSERT/UPDATE/DELETE i en stable-funksjon) og SECURITY INVOKER (ingen utvidede rettigheter).
-- Kan BARE kalles av service_role (revoke fra public/anon/authenticated). service_role omgår RLS og har select på ordrer, innstillinger og
-- portal_bestillinger. De andre portal-funksjonene er security definer; her er det unødvendig siden bare service_role kan kalle den.
--
-- Hva den returnerer (kontrakt versjon 1, se supabase/README.md «Importerte biler til portalen»):
--   aktive:   ALLE bil-ordrer (ordretype = 'bil') som ikke er arkivert, sortert på ordre_id. «Arkivert» er coalesce(nullif(btrim(status), ''), 'aktiv') =
--             'arkivert', lik appens egen lesing (js/core.js: status || 'aktiv'); portal_koble_bestilling krever status = 'aktiv' strengt, men i dagens data
--             (ingen NULL/tom status) gir de samme svar. Høyst 500 (ellers FOR_MANGE_AKTIVE).
--   utvalgte: ÉN oppføring per id i p_ider (dedupet, sortert): hele raden pluss finnes = true (uansett ordretype og status), eller bare
--             {ordre_id, finnes: false} når ordren ikke finnes. Portalen ber om id-ene til importradene den allerede har, for å få positivt bevis for dem.
--   Hver rad har ALLTID de samme 15 feltene (null er eksplisitt der kontrakten sier det): ordre_id, ordretype, kunde, chassis, eier, merke, modell,
--   ordre_status, status, opprettet, kontakt_treff, kontakt_id, kontakt_navn, kontakt_orgnr, portal_bestilling_ider.
--
-- Valgene og hvorfor:
--  * coalesce på ALLE nullable kolonner (kunde, eier, chassis, merke, modell, status, ordre_status, created_at/updated_at): `ordre_status <> 'hentet'`
--    utelater NULL (en tidligere bitt), så portalen regner «hentet» av den normaliserte ordre_status, aldri med <>.
--  * Normalisering BARE her (aldri på nytt i portalen): kunde, eier, merke, modell og kontakt_navn renses likt (tegnklassen c_skjult under, samme sett som
--    tekst() i portalens lib/salmakernFelles.ts; hvitt mellomrom blir ett mellomrom; trimmet; kappet til 200 tegn og trimmet på nytt); chassis er store
--    bokstaver uten mellomrom og bindestrek, kappet til 40; org.nr er bare siffer, kappet til 20. Kontakter med tom id eller id over 120 tegn utelates.
--    Appens SQL kapper selv, slik at en lang tekst tastet av en ansatt aldri kan gi ugyldig svar for hele importen.
--  * Tegnklassen c_skjult er skrevet med \u-escapes, IKKE med rå tegn: rå usynlige tegn kan forsvinne ved kopiering og skriving, og et rått U+2028 i et
--    regex er en syntaksfeil. Postgres' ARE støtter \u i tegnklasser (målt 2026-11-10 mot portal-databasen: alle 92 tegn i settet fjernes, og norske
--    bokstaver, tab, linjeskift, mellomrom og nbsp blir stående). Tab, linjeskift, CR og nbsp fjernes ikke av klassen, men blir ett mellomrom
--    (c_mellomrom: \s pluss uttrykkelig nbsp og de andre Unicode-mellomrommene, så resultatet ikke avhenger av databasens lc_ctype), så to ord aldri slås sammen.
--    Filen skal ALDRI inneholde rå usynlige tegn (kontrolleres av kommandoen i spesifikasjonens 14.5).
--  * Kontakter leses fra innstillinger rad id = 1 (samme som portal_koble_bestilling), bare type = 'Forhandler', og bare hvis kontakter er en JSON-liste
--    (ellers tom liste, aldri feil). kontakt_treff er antall slike kontakter med samme rensede navn som kunden (uavhengig av store/små bokstaver);
--    kontakt_id/-navn/-orgnr settes bare ved nøyaktig ett treff.
--  * portal_bestilling_ider: portalens Bestilling.id-er appen kjenner for ordren: ordrer.portal_bestilling_id, portal_bestillinger der ordre_id = ordren,
--    og portal_bestillinger der ident_type = 'CHASSIS' og ident = ordrens chassis (de to siste med status <> 'avvist', så en slettet ordres gravstein ikke teller).
--  * ider valideres (høyst 500, hver ^[A-Za-z0-9_.-]{1,64}$): én rar id avviser HELE kallet (UGYLDIG_INPUT: ider), og portalen sender aldri en slik id.
--    Ordrens EGEN id valideres ikke (en eldre id utenfor mønsteret står i aktive uten feil; portalen håndterer den).
--
-- Rollback: supabase/rollback-referanser/portal_import_fakta_ROLLBACK.sql (migrasjonen endrer ingen data). Test: supabase/tester/portal_import_fakta_TEST_body.sql
-- (alltid i en transaksjon som rulles tilbake; kjøring står øverst i filen).

create or replace function public.portal_import_fakta(p_ider text[] default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  c_ider_maks   constant int  := 500;
  c_aktive_maks constant int  := 500;
  -- Tegn som aldri hører hjemme i en tekst: samme sett som tekst() i portalens lib/salmakernFelles.ts. Skrevet med \u-escapes (ikke rå tegn; standard_conforming_strings er på, så backslash står urørt til regex-motoren).
  c_skjult      constant text := '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]';
  -- Hvitt mellomrom: \s pluss uttrykkelig de Unicode-mellomrommene (nbsp m.fl.), fordi hva \s regner som mellomrom avhenger av databasens lc_ctype (målt: i PGlite matcher \s ikke nbsp).
  -- Da får tab, linjeskift, CR og nbsp samme resultat uansett locale: ett mellomrom, så ord aldri slås sammen.
  c_mellomrom   constant text := '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+';
  c_chassis_ut  constant text := '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000-]';
  v_ider text[];
  v_aktive jsonb;
  v_utvalgte jsonb;
begin
  v_ider := coalesce(p_ider, '{}'::text[]);
  if cardinality(v_ider) > c_ider_maks
     or exists (select 1 from unnest(v_ider) x(id) where x.id is null or x.id !~ '^[A-Za-z0-9_.-]{1,64}$') then
    raise exception 'UGYLDIG_INPUT: ider';
  end if;

  with
  rene as (
    select
      o.id,
      o.ordretype,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.kunde, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as kunde,
      left(upper(regexp_replace(coalesce(o.chassis, ''), c_chassis_ut, '', 'g')), 40) as chassis,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.eier, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as eier,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.merke, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as merke,
      btrim(left(btrim(regexp_replace(regexp_replace(coalesce(o.modell, ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as modell,
      coalesce(nullif(btrim(o.ordre_status), ''), 'ikke_paabegynt') as ordre_status,
      case when coalesce(nullif(btrim(o.status), ''), 'aktiv') = 'arkivert' then 'arkivert' else 'aktiv' end as status,
      coalesce(o.created_at, o.updated_at) as opprettet,
      o.portal_bestilling_id
    from public.ordrer o
    where (o.ordretype = 'bil' and coalesce(nullif(btrim(o.status), ''), 'aktiv') <> 'arkivert')
       or o.id = any (v_ider)
  ),
  kontakter as (
    select k->>'id' as id,
           btrim(left(btrim(regexp_replace(regexp_replace(coalesce(k->>'navn', ''), c_skjult, '', 'g'), c_mellomrom, ' ', 'g')), 200)) as navn,
           left(regexp_replace(coalesce(k->>'orgnr', ''), '\D', '', 'g'), 20) as orgnr
    from public.innstillinger i,
         jsonb_array_elements(case when jsonb_typeof(i.kontakter) = 'array' then i.kontakter else '[]'::jsonb end) k
    where i.id = 1 and k->>'type' = 'Forhandler' and length(coalesce(k->>'id', '')) between 1 and 120
  ),
  fakta as (
    select r.*,
      t.antall as kontakt_treff,
      case when t.antall = 1 then t.id end as kontakt_id,
      case when t.antall = 1 then t.navn end as kontakt_navn,
      case when t.antall = 1 then nullif(t.orgnr, '') end as kontakt_orgnr,
      coalesce((
        select jsonb_agg(x.pid order by x.pid)
        from (
          select r.portal_bestilling_id as pid where r.portal_bestilling_id is not null
          union
          select pb.portal_bestilling_id from public.portal_bestillinger pb where pb.ordre_id = r.id and pb.status <> 'avvist'
          union
          select pb.portal_bestilling_id from public.portal_bestillinger pb
           where pb.ident_type = 'CHASSIS' and r.chassis <> '' and pb.ident = r.chassis and pb.status <> 'avvist'
        ) x
      ), '[]'::jsonb) as portal_bestilling_ider
    from rene r
    cross join lateral (
      select count(*)::int as antall, min(k.id) as id, min(k.navn) as navn, min(k.orgnr) as orgnr
      from kontakter k where r.kunde <> '' and lower(k.navn) = lower(r.kunde)
    ) t
  ),
  rad as (
    select f.id,
      jsonb_build_object(
        'ordre_id', f.id, 'ordretype', f.ordretype, 'kunde', f.kunde, 'chassis', f.chassis, 'eier', f.eier,
        'merke', f.merke, 'modell', f.modell, 'ordre_status', f.ordre_status, 'status', f.status,
        'opprettet', case when f.opprettet is null then null
                          else to_char(f.opprettet at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'kontakt_treff', f.kontakt_treff, 'kontakt_id', f.kontakt_id, 'kontakt_navn', f.kontakt_navn,
        'kontakt_orgnr', f.kontakt_orgnr, 'portal_bestilling_ider', f.portal_bestilling_ider
      ) as j,
      (f.ordretype = 'bil' and f.status = 'aktiv') as er_aktiv
    from fakta f
  )
  select
    coalesce((select jsonb_agg(r.j order by r.id) from rad r where r.er_aktiv), '[]'::jsonb),
    coalesce((
      select jsonb_agg(case when r.id is null then jsonb_build_object('ordre_id', u.id, 'finnes', false)
                            else r.j || jsonb_build_object('finnes', true) end order by u.id)
      from (select distinct unnest(v_ider) as id) u left join rad r on r.id = u.id
    ), '[]'::jsonb)
  into v_aktive, v_utvalgte;

  if jsonb_array_length(v_aktive) > c_aktive_maks then
    raise exception 'FOR_MANGE_AKTIVE';
  end if;

  return jsonb_build_object(
    'versjon', 1,
    'generert', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'aktive', v_aktive,
    'utvalgte', v_utvalgte
  );
end;
$function$;

revoke all on function public.portal_import_fakta(text[]) from public, anon, authenticated;
grant execute on function public.portal_import_fakta(text[]) to service_role;
