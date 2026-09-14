-- Kostpris (materialer, eks. mva) per oppskrift - lar oss regne dekningsbidrag på
-- ekstra utstyr-linjer på samme måte som allerede gjøres for ombygging (fra kalkylearket).
alter table lager_oppskrifter add column if not exists kostpris numeric;
