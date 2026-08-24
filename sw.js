// v9 - fikser "Response body is already used"-feil i fetch-handleren under (res.clone()
// ble kalt inni en asynkron .then() i stedet for synkront med en gang - kunne feile hvis
// svar-kroppen allerede var i bruk et annet sted når det asynkrone kallet endelig kjørte)
// v8 - push-varsler + aldri cache HTML + cache Supabase Storage-filer selv
// (Storage sender Cache-Control: no-cache uansett opplastingsinnstilling,
//  men bilde/signatur-filnavn er unike/uforanderlige - trygt å cache for alltid)
// Appen kjører under /salmakern-app2/ på GitHub Pages - faste stier, ikke relative
// (Safari løste relative manifest-stier feil, så vi tar ingen sjanser her heller).
const CACHE = 'salmakern-v9';
const BILDE_CACHE = 'salmakern-bilder-v1';
const STATIC = [
  '/salmakern-app2/manifest.json',
  '/salmakern-app2/icon.svg'
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
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(() => caches.match(e.request)));
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
      icon: '/salmakern-app2/icon.svg',
      badge: '/salmakern-app2/icon.svg',
      tag: 'salmakern',
      renotify: true,
      data: { url: data.url || '/salmakern-app2/salmakern.html' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/salmakern-app2/salmakern.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
      const existing = all.find(c => c.url.includes('salmakern'));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
