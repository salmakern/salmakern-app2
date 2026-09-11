-- Ordretid deles i to uavhengige tidtakere: Ombygging (den eksisterende
-- ordre_timer_sessions-kolonnen, uendret) og Klargjøring (ny kolonne, samme form).
alter table ordrer add column if not exists klargjoring_timer_sessions jsonb not null default '[]'::jsonb;
