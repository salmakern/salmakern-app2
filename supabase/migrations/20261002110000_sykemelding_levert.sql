-- Kjørt: 2026-10-02
-- Bakgrunn: Henrik må kunne notere om en ansatt faktisk har levert selve sykemeldingen
-- (legeerklæringen) for en "syk"-registrering - uten den kan ikke arbeidsgiver kreve
-- refusjon fra NAV for perioden etter arbeidsgiverperioden. Samme mønster som den
-- eksisterende "betalt"-kolonnen for egenmelding (20260909130000) - en enkel, manuell
-- admin-avkrysning, standard usann siden den normalt ikke er levert ved registrering.
alter table timer_entries add column if not exists sykemelding_levert boolean not null default false;
