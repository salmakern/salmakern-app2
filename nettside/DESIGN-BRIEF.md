# Design-brief: redesign av salmaker.as

Lim denne inn i en ny Claude Code-samtale (åpnet i `Claude app/nettside`) for å
starte et redesign-prosjekt for nettsiden.

---

Jeg vil redesigne nettsiden vår (salmaker.as) til å se moderne og tøff ut —
noe folk faktisk blir imponert over når de kommer inn, ikke bare en grei
bedriftsside. Tenk high-end bilbransje-følelse (à la Tesla/Rivian/premium
SUV-merker), ikke en generisk håndverker-nettside.

## Kontekst

- Telemark Salmakerverksted bygger om personbiler til varebil (skillevegg,
  gulv, oppbevaringskasser) - premium SUV-er og personbiler, Skien.
- Nettsiden ligger i `nettside/`-mappen her, ren statisk HTML/CSS/JS, ingen
  byggesteg, deployes til GitHub Pages på salmaker.as.
- **VIKTIG**: samme repo inneholder OGSÅ et internt bookingverktøy
  (`salmakern.html`, PIN-beskyttet) - ikke rør den filen eller noe under den.
- Sidene henter ombyggingsvarianter (navn, bilder, produktnummer - ALDRI
  pris) live fra Forhandlerportalens offentlige API via `model-sync.js` og
  `model-list-sync.js`. Ikke bryt denne synk-mekanismen i redesignet.
- Logofiler ligger i `../logoer/` (én mappe opp) - spør før du bruker en
  logofil du er usikker på hvilken variant av.
- Vi har egne sider per bilmodell (KIA EV9, Mercedes GLS, osv.) pluss en
  generisk modell-side (`modell.html`) for nye modeller lagt til i admin.
- Vi jobber også med SEO for å bli synlig i hele Norge - strukturert
  innhold og god sidestruktur bør henge sammen med redesignet, ikke
  ofres for visuell stil.

## Nåværende fargepalett (`site.css`)

**Primærfarge (merkevare-rød)**
- `#c0392b` — hovedfarge: knapper, lenker, aktive faner, ikoner, uthevinger
- `#a52f22` — mørkere rød, hover-tilstand på primærknapper

**Mørke bakgrunner**
- `#1a1a1a` — nesten svart, hero-gradient og footer-aksent
- `#2d2d2d` — hovedmørk bakgrunn (header, footer, mørke seksjoner)
- `#3d3d3d` — border/hover på mørk bakgrunn

**Lyse bakgrunner**
- `#f2f1ef` — sidens grunnbakgrunn
- `#faf9f7` — kort/bokser (modellkort, produktkort)
- `#fff` — hvit

**Tekst**
- `#111` — hovedtekst (nesten svart)
- `#6b7280` — sekundærtekst (grå)
- `#9ca3af` — enda lysere grå tekst
- `#4b5563` — footer-tekst
- `#8892a4` — lys blågrå tekst på mørk bakgrunn

**Kanter/border**
- `#e5e7eb`, `#e2e0dc`, `#d1d5db` — lyse grå kanter

**Status/spesielle**
- `#ecfdf5` / `#6ee7b7` / `#065f46` — grønn (suksessmelding på bestillingsskjema)
- `#eff6ff` / `#60a5fa` — lys blå (ikon-bakgrunn på mørke seksjoner)

Dette er dagens palett, ikke et krav - foreslå gjerne en helt ny hvis det
tjener den nye retningen bedre.

## Hvordan jeg vil jobbe

- Vis meg ekte alternativer side om side (faktisk rendret, riktig
  størrelse/bakgrunn) for store designvalg - ikke bestem én retning selv
  og presenter den som eneste svar.
- Se kritisk på resultatet i nettleseren før du sier noe er ferdig - ikke
  bare at koden bygger.
- Foreslå gjerne en helt ny visuell retning (typografi, layout, bruk av
  bilder/video, mikroanimasjoner, mørk vs lys som hovedtema) - jeg er åpen
  for å bryte med dagens utseende hvis det blir bedre.

Start med å foreslå 2-3 helt forskjellige designretninger (moodboard-
aktig beskrivelse + hvorfor det ville funket for oss), så velger jeg
retning før vi bygger.
