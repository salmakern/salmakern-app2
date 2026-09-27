-- Kjørt: 2026-09-27
-- Bakgrunn: Henrik ba om å hente ekte, juridiske org.nr for forhandlerne fra
-- Brønnøysundregistrenes åpne API (data.brreg.no) og lagre dem på Kontakter, i stedet for
-- å skrive org.nr manuelt på hver ordre. Oppslaget mot brreg gjøres i nettleseren
-- (js/ansatte-utstyr.js: hentOrgnrForAlleForhandlere()), for MANGE forhandlere samtidig -
-- samme "aldri ett databasekall per rad i en løkke"-regel som resten av appen (se
-- CLAUDE.md/lagerBatchFlush) gjelder her også. Denne funksjonen samler alle treffene i ETT
-- kall, og - som kontakter_slett/kontakter_upsert (20260926120000) - beregner resultatet fra
-- kontakter-kolonnens FERSKE verdi i selve databasen, ikke fra en potensielt foreldet lokal
-- kopi i klienten.
create or replace function public.kontakter_orgnr_batch_oppdater(p_oppdateringer jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ny jsonb;
begin
  select coalesce(jsonb_agg(
    case
      when (select (o->>'orgnr') from jsonb_array_elements(p_oppdateringer) o where o->>'id' = k->>'id' limit 1) is not null
        then jsonb_set(k, '{orgnr}', to_jsonb((select (o->>'orgnr') from jsonb_array_elements(p_oppdateringer) o where o->>'id' = k->>'id' limit 1)))
      else k
    end
  ), '[]'::jsonb)
  into v_ny
  from innstillinger, jsonb_array_elements(kontakter) k
  where innstillinger.id = 1;

  update innstillinger set kontakter = coalesce(v_ny, '[]'::jsonb) where id = 1;
  return v_ny;
end;
$$;
