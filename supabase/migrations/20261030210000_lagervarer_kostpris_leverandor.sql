-- Kjørt: 2026-10-30
-- s09-003 i Henger igjen-lista. Henrik: "Ja, begge deler" (kostpris+leverandør på
-- lagervarer, og en materialbehovsliste - denne migrasjonen er kun første del).
--
-- "Leverandør" fantes som eget fritekstfelt tidligere, men ble BYTTET UT med Tegningsnummer
-- 6. august (commit a9eb54d - et bevisst 1-til-1-bytte av samme feltplass, ikke en
-- tilfeldig fjerning). Denne gangen får begge sin egen kolonne i stedet for å dele plass -
-- Tegningsnummer røres ikke.
alter table public.lagervarer add column if not exists leverandor text;
alter table public.lagervarer add column if not exists kostpris numeric;
