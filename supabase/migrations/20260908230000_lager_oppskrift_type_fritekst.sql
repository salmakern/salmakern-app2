-- Gjør lager_oppskrifter.type om fra et fast valg (kun "ombygging"/"ekstra_utstyr") til
-- fritekst, slik at Henrik kan lage så mange kategorier han vil (f.eks. "Ombygging",
-- "Modul-system", "Plater", "Kasser") - ordresiden lager automatisk én nedtrekksliste per
-- kategori som faktisk finnes for modellen, se renderOrdreLagerbruk() i lager.js.
-- Normaliserer eksisterende rader til pene visningsnavn samtidig, slik at de havner i
-- samme kategori som nye oppskrifter man lager med samme (nå fritekst) navn.
alter table lager_oppskrifter drop constraint if exists lager_oppskrifter_type_check;
update lager_oppskrifter set type = 'Ombygging' where type = 'ombygging';
update lager_oppskrifter set type = 'Ekstra utstyr' where type = 'ekstra_utstyr';
alter table lager_oppskrifter alter column type set default 'Ombygging';
