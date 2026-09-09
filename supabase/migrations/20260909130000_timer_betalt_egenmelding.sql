-- Lar admin markere om en Egenmelding-dag faktisk skal lønnes (bedriften betaler normalt
-- lønn for egenmelding, men admin kan skru av for enkeltdager ved behov - se
-- adminSettTimerBetalt() i js/ansatte-utstyr.js). Standard er "betalt" (true), siden det er
-- normalen - admin trenger bare å gjøre noe i unntakstilfeller.
alter table timer_entries add column if not exists betalt boolean not null default true;
