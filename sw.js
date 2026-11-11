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
const CACHE = 'salmakern-v58';
const BILDE_CACHE = 'salmakern-bilder-v1';
const STATIC = [
  '/manifest.json',
  '/icon-192.png'
];

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

  if (url.includes('/storage/v1/object/')) {
    e.respondWith((async () => {
      const c = await caches.open(BILDE_CACHE);
      const cached = await c.match(e.request);
      if (cached) return cached;
      const res = await fetch(e.request);
      // <img>-forespørsler til en annen origin (Storage) er som standard "no-cors",
      // så svaret blir "opaque" - status er da alltid 0, aldri 200, selv om
      // nedlastingen lyktes. Sjekken må derfor også godta opaque-svar, ellers
      // blir INGENTING noensinne lagret i cachen og alt lastes ned på nytt hver gang.
      if (res && (res.status === 200 || res.type === 'opaque')) e.waitUntil(c.put(e.request, res.clone()));
      return res;
    })());
    return;
  }

  if (url.includes('supabase.co')) return;
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
