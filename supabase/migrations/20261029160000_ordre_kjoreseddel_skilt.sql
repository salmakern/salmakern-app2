-- Kjørt: 2026-10-29
-- Forberedelse til kjøreseddel-integrasjonen: hvilket av de 3 fysiske prøveskiltene
-- (AGV 99, ACR 62, AJR 83) som er i bruk på denne ordren/bilen akkurat nå. Ansatte velger
-- selv i ordre-detalj - se kjoreseddelBoksHTML() i js/ordre-detalj.js. Ingen fremmednøkkel
-- til noen egen "skilt"-tabell - det er kun 3 faste, fysiske skilt Henrik eier, hardkodet i
-- PROVESKILT_LISTE i samme fil (samme mønster som VEGVESEN_MODELLER).
alter table public.ordrer add column if not exists kjoreseddel_skilt text;
