-- Skiller lager-oppskrifter i to kategorier: "ombygging" (selve karosseri-/
-- ombyggingsspesifikasjonen - kan bestå av flere uavhengige oppskrifter, f.eks. "Takluke"
-- og "Annet feste i gulvet" som begge kan gjelde samtidig) og "ekstra_utstyr" (valgfritt
-- tilleggsutstyr som tilhengerfeste, takstige o.l.). Begge vises som avkrysningslister på
-- ordren og trekker fra lager uavhengig av hverandre - se renderOrdreLagerbruk() i lager.js.
-- Eksisterende oppskrifter var alle av "ombygging"-typen før dette skillet fantes.
alter table lager_oppskrifter add column if not exists type text not null default 'ombygging';
alter table lager_oppskrifter drop constraint if exists lager_oppskrifter_type_check;
alter table lager_oppskrifter add constraint lager_oppskrifter_type_check check (type in ('ombygging','ekstra_utstyr'));
