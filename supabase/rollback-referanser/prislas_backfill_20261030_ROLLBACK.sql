-- Rollback for engangs-backfillen kjørt 2026-10-30/31 (s09-023/s05-003, prislås): fjerner
-- pris/mva/kilde/tidspunkt igjen fra alle linjer backfillen la dem til på (identifisert ved
-- kilde = 'fiken_priser_backfill' - linjer som ble frosset senere via den vanlige flyten,
-- f.eks. ved å endre produktnummer, har kilde = 'fiken_priser' og røres IKKE av dette).
-- Deterministisk reversering: fjerner nøyaktig de fire feltene backfillen la til, rører
-- ingen andre felt på linjen (id/produktnummer/antall/belop er uendret). Kjør kun manuelt.
update ordrer o
set fiken_linjer = (
  select jsonb_agg(
    case
      when l->>'kilde' = 'fiken_priser_backfill' then (l - 'pris' - 'mva' - 'kilde' - 'tidspunkt')
      else l
    end
  )
  from jsonb_array_elements(o.fiken_linjer) l
)
where exists (
  select 1 from jsonb_array_elements(o.fiken_linjer) l2 where l2->>'kilde' = 'fiken_priser_backfill'
);
