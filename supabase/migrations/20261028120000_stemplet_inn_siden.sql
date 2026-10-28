-- Kjørt: 2026-10-28
-- Bakgrunn: Henrik ba om å kunne se hvem av de ansatte som fortsatt er stemplet inn
-- (har startet sin daglige Timer-klokke, men ikke stoppet den ennå) - typisk for å vite hvem
-- som faktisk er på jobb akkurat nå, bl.a. i forbindelse med å velge sjåfør til kjøreseddel.
--
-- Dette var IKKE mulig å se fra noen annen enhet/økt før: "timerStart" (når klokka ble
-- startet) har hele tiden kun levd som en ren lokal variabel + localStorage i NETTLESEREN
-- som startet den - en timer_entries-rad opprettes først når klokka STOPPES (se lagreTimer()
-- i js/timer.js), så det fantes ingen database-tilstand noen andre kunne lese for å se en
-- PÅGÅENDE innstempling.
--
-- Løsning: ett nytt felt direkte på ansatte-raden (samme mønster som session_token - en
-- enkelt skalarkolonne på den ansattes EGEN rad, skrevet av den ansatte selv, ingen
-- samtidighets-/låse-problematikk siden det aldri er mer enn én skriver per rad). Settes av
-- doStartTimer() ved innstempling, nullstilles av lagreTimer() sin hale ved utstempling.
-- Realtime-abonnementet på "ansatte"-tabellen (se core.js) propagerer automatisk endringen
-- til alle åpne økter, inkludert en admin som ser på "stemplet inn nå"-oversikten.

alter table public.ansatte add column if not exists stemplet_inn_siden timestamptz;
