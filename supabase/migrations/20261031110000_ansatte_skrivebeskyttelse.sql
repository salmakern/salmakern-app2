-- s09-032: funnet 31.10 under s08-017-testingen at en vanlig innlogget ansatt (ikke admin), med
-- et rått kall mot REST-API-et forbi appens knapper, kunne (1) opprette en NY ansatte-rad med
-- rolle admin, (2) sette en admin inaktiv (aktiv=false), (3) slette en admin-rad. Den eneste
-- eksisterende beskyttelsen (ansatte_hindre_selv_rolleendring, migrasjon 20260803162946) dekker
-- KUN endring av kolonnen rolle på en UPDATE - ikke INSERT, ikke DELETE, og ikke andre kolonner.
-- RLS-policyen på ansatte (krever_innlogget_ansatt) krever bare "er en innlogget ansatt", uten
-- noe rollekrav, fordi en vanlig ansatt skal kunne gjøre TO ting på sin EGEN rad uten admin-sjekk:
-- endre eget navn (endreAnsattNavn i ansatte-utstyr.js, kommentert "bare for seg selv og uten
-- admin-sjekk") og sette stemplet_inn_siden ved innstempling (timer.js). Alt annet (ny ansatt,
-- slette ansatt, aktiv/kan_fore_lonn/ansettelsesdato/rolle, eller noen andres rad i det hele
-- tatt) er i dag bare beskyttet av at appens UI skjuler knappene for ikke-admin - ingen reell
-- grense, akkurat som RLS på ordrer fra før portalen.
--
-- Kartlagt FØR denne skrives (slik s09-032 ba om): hvert sted appen selv skriver til ansatte er
-- sjekket i koden (js/ansatte-utstyr.js, js/timer.js, js/arkiv-mer.js) og mot opprett_ansatt-
-- RPC-en (SECURITY DEFINER, sjekker allerede 'KUN_ADMIN' selv FØR den insert-er - påvirkes ikke
-- av denne, siden den kjører med funksjonseierens rettigheter, ikke kallerens, MEN triggeren
-- under kjører uansett (triggere kjører alltid på selve INSERT/UPDATE/DELETE-setningen,
-- uavhengig av om den kom fra RLS-underlagt klientkode eller en SECURITY DEFINER-funksjon) -
-- siden samme sesjon allerede er admin der (opprett_ansatt sin egen sjekk har akkurat bekreftet
-- det), passerer triggeren uten problem. Eneste legitime ikke-admin-skriving er de to nevnt over.
--
-- Løsning: ny trigger (ved siden av den eksisterende, ikke en erstatning - mindre risiko for
-- denne sene kvelden) som krever admin for INSERT og DELETE, og for UPDATE krever enten admin
-- ELLER at raden er kallerens egen OG at ingen andre kolonner enn navn/stemplet_inn_siden
-- faktisk endrer verdi.
create or replace function public.ansatte_beskytt_skriving()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_er_admin boolean;
  v_egen_id integer;
begin
  v_er_admin := exists (select 1 from current_ansatt() where rolle = 'admin');
  if v_er_admin then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'KUN_ADMIN';
  end if;

  -- UPDATE: bare egen rad, og bare navn/stemplet_inn_siden kan endres av en ikke-admin.
  select id into v_egen_id from current_ansatt();
  if v_egen_id is null or new.id is distinct from v_egen_id then
    raise exception 'KUN_ADMIN';
  end if;
  if new.id is distinct from old.id
     or new.rolle is distinct from old.rolle
     or new.aktiv is distinct from old.aktiv
     or new.kan_fore_lonn is distinct from old.kan_fore_lonn
     or new.ansettelsesdato is distinct from old.ansettelsesdato
     or new.session_token is distinct from old.session_token
     or new.flere_enheter is distinct from old.flere_enheter
  then
    raise exception 'KUN_ADMIN';
  end if;
  return new;
end;
$$;

revoke all on function public.ansatte_beskytt_skriving() from public;

create trigger ansatte_beskytt_skriving_trigger
before insert or delete or update on public.ansatte
for each row execute function public.ansatte_beskytt_skriving();
