-- Kjørt: 2026-10-30 (uavhengig gjennomgang av database og app først: ingen blokkerende funn. Kontrollert før/etter: 160 ordrer, innholdet i alle
-- eksisterende kolonner byte-likt (samme md5), 65 -> 68 kolonner, nye kolonner NULL på alle rader, begge tabeller tomme med RLS på og
-- kun SELECT til authenticated via admin-policy, ingen rettigheter til anon.)
-- Fase 2 av «Bestill»-koblingen mot Forhandlerportalen, STEG 1 (Henrik 2026-10-30: «kjør på, bare sørg for at det blir gjort ordentlig»).
-- Plan: C:/Users/GroAnitaMartinsen/.claude/bestill-fase2/plan-salmakern.md (G1). Dette steget er RENT TILLEGG og har ingen virkning på daglig bruk:
--   * ingen kode i appen leser eller skriver noe av dette ennå,
--   * ingen funksjon eller trigger er laget (det kommer i senere steg, hvert for seg),
--   * ingen eksisterende rad endres (nye kolonner er NULL).
--
-- Hva som opprettes:
--   1) portal_bestillinger: én rad per bestilling portalen har sendt hit (portalens Bestilling.id er primærnøkkel = idempotens: samme
--      bestilling to ganger gir aldri to ordrer). Beholder også «gravstein»-status når en feilopprettet ordre slettes (derfor INGEN
--      fremmednøkkel mot ordrer: slettes ordren, skal sporet bli stående så et nytt forsøk ikke gjenoppliver den).
--   2) portal_modell_kobling: oversetter portalens modell (slug) til appens merke/modell (portalen bruker markedsføringsnavn som ikke
--      passer appens utstyrmaler og lageroppskrifter). Fylles manuelt etter Henriks godkjenning.
--   3) Tre nullable kolonner på ordrer som merker en ordre som kom fra portalen og om de ansatte har bekreftet den.
--      Ligger i EGNE kolonner som appens lagring (ordreToDb/save) ikke skriver, så en ansatt som lagrer et annet felt kan aldri
--      nullstille bekreftelsen.
-- Forhandlerkoblingen (portalforhandler -> Kontakter-forhandler) ligger i PORTALEN (Dealer.salmakernKontaktId), ikke her: Salmaker'n-appen
-- er fasit, og funksjonen i et senere steg validerer id og org.nr mot Kontakter ved hvert kall. Derfor ingen portal_forhandler_kobling.
--
-- Tilgang: RLS på, ingen rettigheter til klienten utenom LESING for administratorer. Skriving skjer kun via service-rolle (edge-funksjonen)
-- og SECURITY DEFINER-funksjoner i senere steg, som omgår RLS.
-- Rollback: supabase/rollback-referanser/portal_bestilling_grunnlag_ROLLBACK.sql (kun trygt så lenge ingen senere steg er kjørt og
-- ingen portal-ordrer finnes).

-- Sikkerhetsbelte: får ikke ALTER TABLE ordrer låsen innen 5 sekunder, AVBRYTES kjøringen (alt under er idempotent og kan kjøres på nytt)
-- i stedet for at appens lagringer køer bak den.
set lock_timeout = '5s';

create table if not exists public.portal_bestillinger (
  portal_bestilling_id  text primary key,               -- portalens Bestilling.id (cuid)
  portal_nr             text not null,                  -- «B-2026-0001»
  mottatt_at            timestamptz not null default now(),
  oppdatert_at          timestamptz not null default now(),
  -- mottatt | koblet | ny_ordre | admin_ark | venter_forhandler | venter_modell | avklaring_chassis | avklaring_annen_forhandler
  -- | avklaring_modell | avvist (gravstein) | feilet. Tekst (ikke enum) så utfallene kan utvides uten migrasjon.
  status                text not null default 'mottatt',
  detalj                text,                           -- siste utfall i klartekst (leses bare av admin; vises aldri for selger)
  ordre_id              text,                           -- ordrer.id. Ingen fremmednøkkel, se over.
  admin_ark_id          text,                           -- admin_ark.id for serienummer-bestillinger
  ident_type            text not null check (ident_type in ('CHASSIS', 'SERIENUMMER')),
  ident                 text not null,                  -- normalisert chassis.nr (17 tegn, store bokstaver) eller serienummer
  forhandler_kontakt_id text,                           -- Kontakter-id (innstillinger.kontakter[].id)
  forhandler_orgnr      text,
  forhandler_navn       text,
  selger_navn           text,
  selger_epost          text,
  portal_modell_slug    text,
  merke                 text,
  modell                text,
  payload               jsonb not null default '{}'::jsonb   -- sanert nyttelast slik den kom fra portalen (ingen priser, ingen kundedata)
);
create index if not exists portal_bestillinger_ident_idx on public.portal_bestillinger (ident_type, ident);
create index if not exists portal_bestillinger_status_idx on public.portal_bestillinger (status);
create index if not exists portal_bestillinger_ordre_id_idx on public.portal_bestillinger (ordre_id) where ordre_id is not null;

create table if not exists public.portal_modell_kobling (
  portal_modell_slug text primary key,
  merke              text not null,
  modell             text not null,
  godkjent_at        timestamptz not null default now(),
  godkjent_av        text
);

alter table public.ordrer
  add column if not exists portal_bestilling_id text,        -- satt når ordren er opprettet av/koblet til en portal-bestilling
  add column if not exists portal_bekreftet_at timestamptz,  -- NULL + portal_bestilling_id satt = «ikke bekreftet fra portal»
  add column if not exists portal_bekreftet_av text;         -- ansattens navn
create index if not exists ordrer_portal_bestilling_id_idx on public.ordrer (portal_bestilling_id) where portal_bestilling_id is not null;

-- RLS: kun administratorer får LESE; ingen skrive-policy, så klienten kan ikke endre noe her (service-rolle og SECURITY DEFINER omgår RLS).
alter table public.portal_bestillinger enable row level security;
alter table public.portal_modell_kobling enable row level security;
revoke all on public.portal_bestillinger from public, anon, authenticated;
revoke all on public.portal_modell_kobling from public, anon, authenticated;
grant select on public.portal_bestillinger to authenticated;
grant select on public.portal_modell_kobling to authenticated;
drop policy if exists "kun_admin_leser" on public.portal_bestillinger;
create policy "kun_admin_leser" on public.portal_bestillinger for select
  using (exists (select 1 from public.current_ansatt() where rolle = 'admin'));
drop policy if exists "kun_admin_leser" on public.portal_modell_kobling;
create policy "kun_admin_leser" on public.portal_modell_kobling for select
  using (exists (select 1 from public.current_ansatt() where rolle = 'admin'));
