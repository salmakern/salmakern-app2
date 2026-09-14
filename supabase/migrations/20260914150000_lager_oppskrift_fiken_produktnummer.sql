-- Fiken-produktnummer på "Ekstra utstyr"-oppskrifter - lar avkrysning av utstyret på en
-- ordre skrive direkte til fakturalinjene (fikenLinjer), i stedet for bare å legge navnet
-- inn i fritekstboksen "Utstyr - Skal ha etter visning" og håpe noen henter det derfra.
alter table lager_oppskrifter add column if not exists fiken_produktnummer text;
