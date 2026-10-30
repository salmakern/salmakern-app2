-- Lagrer adressen til Fiken-fakturakladden som ble opprettet for denne ordren (s09-006 i
-- Henger igjen-lista). I dag kastes denne adressen etter at edge-funksjonen fiken-fakturer
-- svarer - admin må lete den opp selv inne i Fiken. Brukes også til å gjøre selve kallet
-- idempotent: fiken-fakturer sjekker denne FØR den oppretter en ny kladd, slik at to
-- administratorer som trykker fakturer nesten samtidig (fra ulike enheter, før Realtime har
-- rukket å vise den andres endring) ikke lenger kan lage to kladder for samme ordre.
alter table public.ordrer add column if not exists fiken_kladd_url text;
