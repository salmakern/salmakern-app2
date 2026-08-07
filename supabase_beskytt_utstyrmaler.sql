-- ============================================================
-- Salmaker'n – Databasevern mot utilsiktet tømming av utstyr_maler
-- Kjør dette i Supabase → SQL Editor → New Query → Run
-- ============================================================
-- Nekter enhver oppdatering som ville tømt utstyr_maler helt (fra >0 til 0
-- punkter). Dette har skjedd flere ganger, sannsynligvis fra en gammel/
-- utdatert nettleserfane et sted som skriver over hele raden med tomme
-- standardverdier. Sletter man siste utstyrsmal med vilje, blokkeres det
-- også (dette scenarioet er ekstremt sjeldent sammenlignet med risikoen).

create or replace function beskytt_utstyr_maler_fn()
returns trigger as $$
begin
  if jsonb_array_length(coalesce(old.utstyr_maler, '[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(new.utstyr_maler, '[]'::jsonb)) = 0 then
    new.utstyr_maler := old.utstyr_maler;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists beskytt_utstyr_maler on innstillinger;
create trigger beskytt_utstyr_maler
  before update on innstillinger
  for each row
  execute function beskytt_utstyr_maler_fn();
