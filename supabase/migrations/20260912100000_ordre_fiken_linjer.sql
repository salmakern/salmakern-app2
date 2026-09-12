-- Fakturalinjer (produktnummer + antall) som skal sendes til Fiken ved fakturering.
-- Forberedelse for Fiken-integrasjonen - selve faktura-opprettelsen kommer i en senere endring.
alter table ordrer add column if not exists fiken_linjer jsonb not null default '[]'::jsonb;
