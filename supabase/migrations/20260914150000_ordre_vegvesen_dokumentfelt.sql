-- ============================================================
-- Nye felt på ordren, trengs for å generere Egenerklæring/Vektfordeling/
-- Fabrikantattest/trinn 2-lapp/Melding om registrering automatisk.
-- ============================================================

-- Typegodkjenningsnummer (f.eks. "e4*2018/858*00178*04") - fylles inn manuelt fra COC,
-- finnes ikke i noen annen eksisterende kilde i appen.
alter table ordrer add column if not exists typegodkjenning text not null default '';

-- "Egenvekt Inn" i Fabrikantattest - egenvekt før ombygging, fra COC. Ikke det samme som
-- Vekter-tabellens Ved ankomst/Før visning (de er "tillatt totalvekt", ikke egenvekt).
alter table ordrer add column if not exists egenvekt_coc text not null default '';

-- Forhandlerens organisasjonsnummer - trengs på Melding om registrering når ordren ikke
-- er del av en flåte (da byttes "Eier" fra Salmakerverksted til forhandleren).
alter table ordrer add column if not exists forhandler_orgnr text not null default '';
