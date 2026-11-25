// v58 - to av tre "trenger konkret svar"-punkter (Henrik 11.11, svarte på avklaringsspørsmål):
// (1) flåte-vekter: den automatisk utregnede "Endring" (vegvesenBeregnOgSettEndring) synker nå
// ut til resten av flåten via synkroniserFraPrimaer() - før ble bare primærbilen oppdatert;
// (2) ny "Reisetid pr. kontrollstasjon" under Mer (admin) - "Time på biltilsynet"-varselet kan
// nå bruke en egen reisetid per stasjonsnavn i stedet for alltid faste 30 min (edge-funksjonen
// send-push leser innstillinger.biltilsyn_reisetider). Det tredje punktet (rabatt på ekstra
// utstyr) er en reell fakturerings-/penger-sak som venter på Henriks avklaring - ikke bygget.
// v56 - tre småfiks (Henrik valgte "alle under liten jobb" fra backloggen 11.11): (1) "Tilbake"
// fra en ordre åpnet på OVERSIKT går nå dit (ikke til Ordre-lista) - ny openedFraOversikt-flagg,
// Ordre-lista sine egne kort er UENDRET (de går fortsatt tilbake til Ordre-lista); (2) varsler
// (visToast) står nå 8 sek i stedet for 5; (3) logChange() gjør ett nytt forsøk ved mislykket
// lagring og varsler synlig hvis begge feiler, i stedet for å forsvinne stille.
// v51 - XSS-sikkerhetsgjennomgang (s90-20261105-sikkerhet, punkt 5): 13 bekreftede steder der
// ansatt-/eksternt fritekst (utstyr-malnavn/biltype/punkter, "Time bekreftet"-sted, "Ventende
// timer", ansattnavn/-mobil under redigering, drivstoffsats-navn, Vegvesen-oppslagets
// merke/modell/aar) nådde innerHTML uten esc() - rettet i admin-ark.js, ansatte-utstyr.js,
// arkiv-mer.js, ordre-detalj.js og ordre-diverse.js (2026-11-11).
// v41 - rettet (funnet av portal-øktas kritiker-gjennomgang): sw.js ble IKKE bumpet ved forrige
// to commits (5828a1c: synkroniserOmbyggingFikenLinjer fjernet ikke lenger en frosset
// portalrabatt + portalBekreftOrdre avventer nå RPC-ene i rekkefølge; 106bbac: Admin-ark bevarer
// scrollposisjon + stopper limet ved mislykket lagring) - en fane åpnet før disse commitene ville
// kjørt den gamle, buggy koden på ubestemt tid (oppdateringsvarselet utløses kun når sw.js selv
// endres). Ingen annen endring i selve service workeren (2026-11-04).
// v40 - s90-20261104-x: automatisk frakt-forberedelse ved status "Klar for henting"
// (frakt_forberedt_at på admin_ark, satt av en ny databasetrigger) - "📧 Bestill"-knappen i
// Admin-ark viser nå en gul, pulserende "Bekreft bestilling"-tilstand når dette har skjedd
// og venter på ett bekreftelsestrykk (2026-11-04)
// v13 - appen sender nå den innloggede ansattes token til edge-funksjonene (edgeFetch i
// core.js) og utlogging avslutter Auth-sesjonen på ekte. Cache-navnet er bumpet slik at åpne
// PWA-er henter den nye koden; uten bump ville de fortsatt sendt bare den offentlige nøkkelen.
// v12 - HTML/JS-grenen under hentet alltid ferskt over nett (riktig), men lagret
// ALDRI resultatet i cachen - caches.match(e.request) i catch-fallbacken hadde derfor
// ingenting å falle tilbake på. Konsekvens: appen fungerte i praksis ikke frakoblet i
// det hele tatt, stikk i strid med at den har egen offline-kø for mislykkede lagringer.
// Fikset ved å skrive et vellykket svar til cachen (samme synkrone res.clone()-mønster
// som den generiske fallback-grenen lenger ned, se v9-notatet), uten å endre selve
// nett-først-oppførselen.
// v11 - icon.svg var en skjør wrapper som viste seg å rendres helt sort som
// app-ikon (samme mønster som en tidligere favicon-bug) - byttet til de
// ekte icon-192/512.png-filene overalt. Cache-navnet er bumpet igjen.
// v10 - salmaker.as er nå eget domene (ikke lenger github.io/salmakern-app2/),
// så alle faste /salmakern-app2/-stier under er rettet til rot-stier. Cache-navnet
// er bumpet for å tvinge nettlesere til å forkaste den gamle, feilaktige cachen.
// v9 - fikser "Response body is already used"-feil i fetch-handleren under (res.clone()
// ble kalt inni en asynkron .then() i stedet for synkront med en gang - kunne feile hvis
// svar-kroppen allerede var i bruk et annet sted når det asynkrone kallet endelig kjørte)
// v8 - push-varsler + aldri cache HTML + cache Supabase Storage-filer selv
// (Storage sender Cache-Control: no-cache uansett opplastingsinnstilling,
//  men bilde/signatur-filnavn er unike/uforanderlige - trygt å cache for alltid)
// v15 - PORTAL-merke, filter og Bekreft/Avvis for ordre fra Forhandlerportalen (2026-10-30)
// v16 - status-nedtrekket (statusDropdown) fikk egen SVG-pil + appearance:none, mot
// mobilnettlesere som tegnet sin egen pil klemt inntil lang statustekst (2026-10-30)
// v17 - status-boksen i Oversikt (Aktive ordrer/Ikke påbegynt) kunne presse seg utenfor
// kortets ramme på smale skjermer - radene manglet flex-wrap (2026-10-30)
// v19 - Vegvesen-dokumenter varsler nå synlig (i stedet for stille) når modellen ikke
// gjenkjennes og Egenerklæringen må bruke en generisk mal (2026-10-31)
// v20 - felles ord for kontaktpersonen hos forhandleren (s08-054): "selger" byttet til
// "kontaktperson" i teksten brukerne ser på portal-bestillinger (2026-10-31)
// v21 - s09-012 steg 2: Fiken-ombygging-matching bruker nå modellen fra portal-bestillingen
// (portal_modell_slug) i stedet for ordrens frie merke/modell-tekst når de finnes, pluss et
// varsel i ordredetaljen hvis de avviker (2026-10-31)
// v22 - s08-048 grunnlag: Bekreft av en portal-ordre kan fylle «Skal ha etter visning» og
// fiken_linjer fra bestillingens produktlinjer (o.portalLinjer) - helt inert til
// portal_koble_bestilling v5 og portal-bestilling faktisk sender feltet (2026-10-31)
// v42 - steg 2+3 i fakturering/sikkerhet (Henrik 5.11, via portal-økta): "Klar til
// fakturering"-kortet på Oversikt + delt fakturaSjekk(o) (26ee3ef), og tre pengefeller rettet i
// ordre-detalj.js - "Bekreft kunde for Fiken-faktura" overskriver ikke lenger en avtalt rabatt,
// og «Fakturert»-avkrysningen har nå en bekreftelsesdialog og lagrer leveranse-arkivering riktig
// v43 - lager-forslag punkt 1 (Henrik 5.11): oppskrift-trekk/angre i js/lager.js
// (trekkOppskriftForOrdre/angreLagerBatch) er nå atomisk og idempotent via to nye RPC-er
// (lager_trekk_oppskrift/lager_angre_oppskrift_trekk) i stedet for et lokalt batch-objekt
// med to separate databasekall - lukker en reell dobbelttrekk-bug (to ordre/oppskrift-par
// allerede trukket to ganger i ekte data)
// v44 - to funn fra portal-øktas uavhengige gjennomgang (5.11): fakturaSjekk() oppdager nå
// NULL i én rabattkategori (viste tidligere grønt for ordre serveren avviser), "prøv igjen"
// droppes på en permanent 4xx-avvisning. Pluss "Hent selgere fra portalen"-knappen i
// Kontakter (edge-funksjonen er ikke utlagt ennå, så knappen gir feil til den er det)
// v47 - Ombygging-klokka, etterkontroll 9.11: reparerManglendeStempling overskriver en gammel (glemt) databasestempling når den lokale klokka er ung, påmelding melder bare av gamle ordrer når den nye selv
// tidtas, selvhelIkkeStemplet beholder beskjeden når gjenopptakelsen feilet, og min egen stemplingstilstand synkes etter reparasjon ved oppstart (ellers oppdages ikke en senere admin-utstempling)
// v50 - ordre-lapp på Leitz Icon (js/ordre-lapp.js): utskriftsstasjon skriver ut en 60 x 25 mm lapp med QR for hver ny bil-ordre (Henrik 11.11)
// v52 - ordre-lapp: stående side 25 x 60 mm med rotert innhold (Leitz-driverens rull «Continuous - 1"» er stående; liggende side ga en tom lapp)
// v53 - ordre-lapp: ryddigere kort i Mer (avkrysning til venstre, riktig tekst om stasjonsvinduet og papiret «Ordre-lapp 25 x 60 mm»)
// v54 - skanning av ordre-lapper inne i appen (📷 Skann på Ordre-siden): iPhone åpner kamera-QR i Safari, ikke i appen på hjemskjermen
// v55 - «🖨 Lapp» i ordredetaljen (bare der Leitz-stasjonen er slått på): lapp til eldre ordrer og ny lapp ved behov
// v57 - del-lapp 50 mm (merke + modell og chassis, stor skrift) som valg per PC ved siden av ordre-lappen 25 mm
// v70 - timesats (kr/time) og frosset effektiv ordretid ved status Hentet, med kostnad på Bil-effektivitet-badgen (s09-020)
// v71 - chassis-tastefeil rettet på en ordre fra Forhandlerportalen synker nå automatisk portal_bestillinger.ident (s08-058)
// v72 - forhandler_kontakt_id skiller forhandler-avdelinger som deler org.nr fra hverandre (s08-004)
// v73 - grønn pulserende glød på ordrekort (Ordre-lista og Oversikt) og "Ansatte på ordren"-kortet når noen er meldt på
// v80 - Sentry-opprydding (startside-oppgave t1hi): reg.update() fanger egne feil, og pinByttSkjerm/Mer-knappene
// tåler at elementet mangler (HTML eldre enn skriptene)
// v82 - filer i Storage vises via kortlevde signerte lenker (forberedelse til private bøtter); bildecachen
// bruker filens faste adresse som nøkkel og lagrer bare ekte 200-svar
// v83 - en full innlasting overskriver ikke lenger en ordre som nettopp er endret på enheten (dokumenter som
// «forsvant»); Sentry er av på localhost
// v88 - «Kun ekstrautstyr (ingen ombygging)» på bil-ordrer: ingen tvangsflyt/utstyrsmal, bare Ekstra utstyr i Varer fra lager, ikke i Admin-ark
// v89 - trinn 4: egen side «Fakturering» (admin) og kortere Oversikt-kort «Klar til fakturering»
// v90 - «Hent selgere fra portalen» viser navn og grunn for forhandlere som trenger et manuelt blikk
// v91 - fiks: S.nextId forgiftet av timer-ID-stripping, blokkerte ny ansatt-oppretting
// v92 - trinn 5: bestilling på e-post (merke og Bekreft på ordren, «Innkommende» på Oversikt, antall i «Skal på bilen»)
// v93 - KIA EV9: spørsmålet «180 eller ikke?» og dørbeskyttere (bare deler) i «Skal på bilen»
// v94 - Oversikt: «Klar til fakturering»-kortet fjernet, «Innkommende» flyttet til en knapp på Ordre-siden, «På jobb nå»/«Stemplet inn nå» side om side
// v97 - Fakturering-siden: biler kun Klar for henting/Hentet (ikke lenger Vist på biltilsynet), leveranser med status Sendt lagt til
// v98 - «På jobb nå» er nå admin-only (var synlig for alle roller)
// v100 - «Kun ekstrautstyr»: enklere ordre (uten vekter, drivstoff, dokumenter, biltilsyn m.m.) og bare statusene På vei, Ikke påbegynt, Påbegynt, Klar for henting og Hentet (Hentet kreves for å lukke)
// v101 - Ordre-siden: «Hengerfeste først» i sorteringen og søk på forhandler.nr
// v102 - «Kun ekstrautstyr»: rydder de andre stedene (Arkiv, kalenderkort og -linjer, kundehistorikk og PDF-rapport viser ikke lenger det som er skjult i ordren); Hentet skriver ikke til Admin-ark for en kun-ordre, og «Hengerfeste først» regner ikke en kun-ordre som hengerfeste
// v103 - KGM Rexton: 2400 og 2401 (to varianter av samme ombygging) kan ikke lenger stå på samme faktura; en portalvariant med frosset rabatt vinner over avkrysningen
// v104 - fakturaSjekk bruker Forhandlerportalens rabatt først (som fiken-fakturer); portal-linje uten rabatt_prosent låses ikke lenger til 0 %
// v105 - Strengere krav for å starte en ordre (gjelder alle hopp til Påbegynt/videre, krever alle 6 ankomstbilder + diagnose, admin kan overstyre); delt stasjonskonto (Booking Salmaker) krever posisjon innenfor verkstedets GPS-radius for å logge inn; lager: automatisk bestillingsforslag (bryter av som standard, ingen synlig endring før Henrik slår den på)
// v106 - manglende Fiken-kontaktperson oppdages og løses ved fakturering (needsKontaktperson, ny modal); hardt stopp, ingen unnslippingsluke (Henriks ja, fjernet "Fortsett uten kontaktperson")
// v107 - Fabrikantattest for Brukt Kjøretøy: «FABRIKANT 2»-raden heter nå «OMBYGGING» (gjelder alle modeller; Nytt Kjøretøy er uendret)
// v108 - Hengerfeste-filter på Ordre-siden; Modul-System-logoen i headeren er større (28 -> 40 px)
// v109 - Diagnose-kravet fra 2026-11-20 er fjernet igjen (Henrik 25.11: «diagnose skal ikke være der») - blokkerer ikke lenger overgangen til Påbegynt. Ansatt-/bildekravet er uendret
// v110 - Fakturalinjer: en lagring som databasen avviser vises nå som feil, og skjermen rulles tilbake til det som faktisk er lagret (s90-20261104-6)
const CACHE = 'salmakern-v110';
const BILDE_CACHE = 'salmakern-bilder-v1';
const STATIC = [
  '/manifest.json',
  '/icon-192.png'
];

// Fast cache-nøkkel for en fil i Storage: samme fil har samme nøkkel enten den hentes med den
// gamle offentlige adressen eller en signert lenke. null = ikke en fil som skal caches.
function bildeCacheNokkel(url) {
  const m = /^(https:\/\/[^/]+\/storage\/v1\/object\/)(?:public|sign)\/([^?#]+)/.exec(String(url || ''));
  return m ? m[1] + 'public/' + m[2] : null;
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== BILDE_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Filer i Storage (bilder, dokumenter). Fra v82 vises de via KORTLEVDE signerte lenker
  // (.../object/sign/<bøtte>/<sti>?token=..., se «SIGNERTE FIL-LENKER» i js/core.js), og tokenet er
  // nytt hver gang. Cache-nøkkelen er derfor filens faste adresse uten token (bildeCacheNokkel),
  // ellers ville hver ny lenke gitt en ny nedlasting og en ny kopi i cachen. Filen hentes med
  // CORS (Storage svarer med Access-Control-Allow-Origin: *) så statusen er lesbar: bare et ekte
  // 200-svar lagres. Før ble «opaque»-svar lagret usett, og et feilsvar (utløpt lenke, privat
  // bøtte) ville da blitt liggende i cachen som om det var bildet. Opplasting, sletting og
  // nedlasting med innlogging (.../object/<bøtte>/..., /authenticated/) går rett forbi.
  const filNokkel = e.request.method === 'GET' ? bildeCacheNokkel(url) : null;
  if (filNokkel) {
    e.respondWith((async () => {
      const c = await caches.open(BILDE_CACHE);
      const cached = await c.match(filNokkel);
      if (cached) return cached;
      let res;
      try { res = await fetch(url, { mode: 'cors', credentials: 'omit' }); }
      catch (err) { return fetch(e.request); }
      if (res && res.status === 200) e.waitUntil(c.put(filNokkel, res.clone()).catch(() => {}));
      return res;
    })());
    return;
  }

  if (url.includes('supabase.co')) return;
  // Lappskriver-hjelperen på del-lapp-PC-en (http://localhost:47811): aldri via cachen, ellers kunne et gammelt «ok» fra /status bli svart uten at hjelperen kjører.
  if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) return;
  if (url.endsWith('.html') || url.includes('salmakern.html') || url.includes('/js/')) {
    // no-store: GitHub Pages sender Cache-Control: max-age=600 på både HTML-
    // filen og js/-filene, så en vanlig fetch() kan bli servert fra nettleserens
    // egen HTTP-cache i opptil 10 minutter selv om en ny versjon er deployet.
    // Appens logikk ligger nå i js/-filene (ikke lenger inline i HTML-en), så
    // de må ferskest mulig - ellers kan gammel klientkode og ny database-
    // struktur komme ut av sync med hverandre rett etter en deploy.
    e.respondWith(
      fetch(e.request, {cache:'no-store'})
        .then(res => {
          // En sidelasting med søkestreng (?h=<hylle> fra en QR-etikett, ?ordre=<id> fra et varsel) lagres ikke: da ville hver hylle fått sin egen
          // kopi av hele siden i cachen. Uten nett finner fallbacken under den vanlige kopien (ignoreSearch).
          if (res && res.status === 200 && !(e.request.mode === 'navigate' && new URL(url).search)) {
            // res.clone() MÅ kalles synkront her, med en gang - se v9-notatet lenger ned.
            // Uten dette har catch-fallbacken under ingenting å falle tilbake på ved
            // reelt nettverksbrudd - appen lastet da ikke i det hele tatt frakoblet.
            const kopi = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, kopi));
          }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          // res.clone() MÅ kalles synkront her, med en gang - kalles den inni den asynkrone
          // caches.open()-kjeden i stedet (som den gjorde før), kan svar-kroppen allerede
          // være i bruk et annet sted (f.eks. av selve siden som leser den samme responsen)
          // når klon-kallet endelig kjører, og feiler da med "Response body is already used".
          const kopi = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, kopi));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Push-varsler
self.addEventListener('push', e => {
  let data = { title: "🚗 Salmaker'n", body: 'Ny oppdatering' };
  try { data = e.data?.json() || data; } catch(_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'salmakern',
      renotify: true,
      data: { url: data.url || '/salmakern.html' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/salmakern.html';
  // Varsler om en bestemt ordre har ?ordre=<id> i url-en (satt av send-push).
  const ordreId = new URL(url, self.location.origin).searchParams.get('ordre');
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
      const existing = all.find(c => c.url.includes('salmakern'));
      if (existing) {
        // App-en kjører allerede - bare å fokusere gjør ingenting med selve
        // innholdet, appen må få beskjed om å hoppe til riktig ordre selv.
        if (ordreId) existing.postMessage({ type: 'navigate-ordre', ordreId });
        return existing.focus();
      }
      return clients.openWindow(url);
    })
  );
});
