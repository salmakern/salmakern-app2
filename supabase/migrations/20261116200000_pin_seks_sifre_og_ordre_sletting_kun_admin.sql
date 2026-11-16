-- Sikkerhetsgjennomgang 2026-11-16 (Henrik: PIN-ene «er satt nå», og «det er kun admin som skal kunne slette ordrer»).
--
-- 1) PIN: alle ti PIN-er er 6 sifre (kontrollert rett før kjøring). endre_egen_pin / admin_sett_pin / opprett_ansatt
--    krever allerede 6 sifre, men logg_inn_med_pin godtok en gammel 4-sifret PIN for alltid. En CHECK på selve
--    tabellen gjør at en kort PIN ikke kan FINNES, uten å røre innloggingsfunksjonene (se CLAUDE.md om hvor
--    følsomme de er). Med fellessperren på 30 feil per 10 min kunne alle 4-sifrede koder prøves på ca. 2,3 døgn.
--
-- 2) ordrer: én regel «innlogget ansatt kan ALT» (FOR ALL) lot enhver ansatt slette ordrer direkte mot databasen,
--    selv om appen bare viser «Slett ordre» for admin. Deles nå i lese/opprette/endre for alle innloggede ansatte
--    (uendret) og slette bare for admin. portal_avvis_ordre (admin + godkjenner, bare urørte portal-ordrer) er
--    SECURITY DEFINER og berøres ikke.
--
-- Rollback:
--   alter table public.ansatte_pin drop constraint ansatte_pin_seks_sifre;
--   drop policy ordrer_lese on public.ordrer; drop policy ordrer_opprette on public.ordrer;
--   drop policy ordrer_endre on public.ordrer; drop policy ordrer_slette_kun_admin on public.ordrer;
--   create policy krever_innlogget_ansatt on public.ordrer for all
--     using (exists (select 1 from current_ansatt())) with check (exists (select 1 from current_ansatt()));

begin;

alter table public.ansatte_pin
  add constraint ansatte_pin_seks_sifre check (pin ~ '^[0-9]{6}$');

drop policy krever_innlogget_ansatt on public.ordrer;

create policy ordrer_lese on public.ordrer for select
  using (exists (select 1 from current_ansatt()));
create policy ordrer_opprette on public.ordrer for insert
  with check (exists (select 1 from current_ansatt()));
create policy ordrer_endre on public.ordrer for update
  using (exists (select 1 from current_ansatt()))
  with check (exists (select 1 from current_ansatt()));
create policy ordrer_slette_kun_admin on public.ordrer for delete
  using (exists (select 1 from current_ansatt() where rolle = 'admin'));

commit;
