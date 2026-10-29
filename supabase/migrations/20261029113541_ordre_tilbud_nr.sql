-- Kjørt: 2026-10-29
-- Bakgrunn: forberedelse til Forhandlerportal-integrasjonen (se samtalen 2026-10-28/29,
-- kartlagt sammen med den andre Claude-økten som jobber i forhandlerportal-app/). Når en
-- innkommet bestilling/akseptert tilbud i Forhandlerportalen senere skal opprette et
-- ordre-utkast her, trenger vi en stabil nøkkel for å gjenkjenne "dette tilbudet har vi
-- allerede laget en ordre for" (idempotens) - portalens eget tilbudsnummer (f.eks.
-- "2026-0184") er den naturlige nøkkelen siden det allerede finnes og er unikt der.
-- Unik indeks (ikke "not null") - de aller fleste ordre vil fortsatt opprettes manuelt i
-- Salmakern uten noe tilbud i bunnen, og Postgres tillater flere NULL-verdier under en
-- unik indeks uten konflikt.
alter table public.ordrer add column if not exists tilbud_nr text;
create unique index if not exists ordrer_tilbud_nr_unik on public.ordrer (tilbud_nr) where tilbud_nr is not null;
