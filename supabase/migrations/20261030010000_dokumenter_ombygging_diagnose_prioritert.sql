-- Dokumenterer kolonner som allerede finnes live, men mangler i repoet (s09-011 i
-- Henger igjen-lista: "repoet er sannheten"). Ingen reell endring - bare fanger opp
-- eksisterende skjema. Standardverdier/nullability bekreftet mot live DB 2026-10-30.
alter table public.ordrer add column if not exists ombygging jsonb default '{}'::jsonb;
alter table public.ordrer add column if not exists diagnose boolean default false;
alter table public.ordrer add column if not exists diagnose_av text default ''::text;
alter table public.ordrer add column if not exists prioritert boolean not null default false;
