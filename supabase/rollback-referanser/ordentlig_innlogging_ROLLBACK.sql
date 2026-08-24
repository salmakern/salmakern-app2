-- ============================================================
-- NØDBREMS: Kjør denne HVIS noe går galt etter at
-- supabase_ordentlig_innlogging.sql er kjørt og appen ikke virker.
-- Setter tilgangsreglene tilbake til slik de var før (åpne for alle med
-- nøkkelen, som i dag) - IKKE en permanent løsning, kun for å få appen
-- til å virke igjen med en gang mens vi finner ut hva som gikk galt.
-- ============================================================
do $$
declare
  pol record;
  tbl text;
begin
  foreach tbl in array array['ordrer','ansatte','flater','lagervarer','lagerhistorikk','lager_oppskrifter','innstillinger','push_abonnement','timer_entries']
  loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy %I on %I', pol.policyname, tbl);
    end loop;
    execute format('create policy "midlertidig_apen" on %I for all using (true) with check (true)', tbl);
  end loop;
end $$;
