const CACHE = 'salmakern-v' + Date.now(); // ny cache ved hver deploy
const ASSETS = [
  '/salmakern.html',
  '/manifest.json',
  '/icon.svg'
];

// Installer: cache kjernefiler
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting(); // ta over med en gang
});

// Aktiver: slett ALLE gamle cacher + varsle klienter om ny versjon
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => {
      // Varsle alle åpne faner om at ny versjon er klar
      return self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'NY_VERSJON' }));
      });
    })
  );
  self.clients.claim();
});

// Fetch: alltid nett først, cache som reserve (offline)
self.addEventListener('fetch', e => {
  if (e.request.url.includes('supabase.co')) return; // aldri cache Supabase

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)) // offline: bruk cache
  );
});
