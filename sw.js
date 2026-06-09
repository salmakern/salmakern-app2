// v3 - aldri cache HTML
const CACHE = 'salmakern-v3';
const STATIC = [
  '/salmakern-app2/manifest.json',
  '/salmakern-app2/icon.svg'
];

// Installer: cache kun statiske filer (IKKE html)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC))
  );
  self.skipWaiting();
});

// Aktiver: slett gamle cacher
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch-strategi:
// - HTML: alltid nett, aldri cache
// - Supabase: aldri cache
// - Alt annet: nett først, cache som reserve (offline)
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Aldri cache Supabase
  if (url.includes('supabase.co')) return;

  // HTML: alltid hent fra nett, ingen cache
  if (url.endsWith('.html') || url.includes('salmakern.html')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Alt annet: nett først, cache som reserve
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
