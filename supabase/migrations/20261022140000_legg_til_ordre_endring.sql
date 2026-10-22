-- Kjørt: 2026-10-22
-- Bakgrunn: Full gjennomgang (samme dag som dokumenter-kappløpet) avdekket at
-- ordrer.endringer (revisjonsloggen) skrives fra >10 uavhengige steder i appen -
-- logChange() (ordre-detalj.js) pusher en ny linje INN I NETTLESERENS EGEN MINNE, og
-- enten den generelle save() (core.js, som upserter HELE ordre-raden) eller en av flere
-- egne målrettede update()-kall (arkiver/gjenopprett/bekreftGodkjenn/endreStatus/
-- adminArkSpeilBestiltFraktPaaOrdre/adminArkLagreFelter m.fl.) skriver deretter HELE
-- endringer-arrayet tilbake. To uavhengige skrivinger til samme ordre tett i tid (f.eks.
-- to admin-brukere som hver gjør sin egen endring på samme ordre) kan dermed overskrive
-- hverandres nylig tilførte logglinjer - samme rotårsak-mønster som den bekreftede
-- dokumenter-kappløpshendelsen 2026-10-22, bare for revisjonsloggen.
--
-- Fiksen: en atomisk "legg til"-funksjon (radlås + ren tilvekst, aldri erstatt/fjern) som
-- logChange() nå kaller selv (se ordre-detalj.js) - uavhengig av hvilken av de mange
-- save()/update()-veiene som ellers skriver resten av ordren. save() og de målrettede
-- update()-kallene slutter samtidig å sende "endringer" i sin egen payload (se egne
-- endringer i core.js/arkiv-mer.js/ordre-diverse.js/oversikt-kalender.js/admin-ark.js),
-- slik at kolonnen kun noensinne skrives via denne ene, radlåste funksjonen.

create or replace function public.legg_til_ordre_endring(p_ordre_id text, p_av text, p_tid text, p_tekst text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endringer jsonb;
begin
  if not exists (select 1 from current_ansatt()) then
    raise exception 'IKKE_INNLOGGET';
  end if;

  select coalesce(endringer, '[]'::jsonb) into v_endringer
  from ordrer where id = p_ordre_id for update;

  if not found then
    raise exception 'ORDRE_FINNES_IKKE';
  end if;

  v_endringer := v_endringer || jsonb_build_array(jsonb_build_object('av', p_av, 'tid', p_tid, 'txt', p_tekst));
  update ordrer set endringer = v_endringer where id = p_ordre_id;

  return v_endringer;
end;
$$;
grant execute on function public.legg_til_ordre_endring(text, text, text, text) to anon, authenticated;
