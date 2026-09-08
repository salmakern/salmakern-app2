-- Lar en lagervare knyttes til en bilmodell (f.eks. "EV9"), i tillegg til den vanlige
-- kategorien (f.eks. "Modul-system"). Modell blir et nytt navigasjonsnivå OVER kategori i
-- Lager-fanen: trykk inn på modellen, så underkategoriene for akkurat den modellen - se
-- renderLagerListe()/visModellDetalj()/renderModellDetalj() i lager.js. Varer uten modell
-- satt (f.eks. generelle deler som "Beslag og dempere") vises som i dag, direkte i den
-- flate kategori-oversikten.
alter table lagervarer add column if not exists modell text default '';
