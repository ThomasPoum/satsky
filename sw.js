const V = 'satsky-v6';
const SHELL = ['./', 'index.html', 'satellite.min.js', 'core.js', 'kb.js', 'land.js', 'menu.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('satsky-') && k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Réseau d'abord, sans le cache HTTP du navigateur (GitHub Pages le garde 10 min) : une mise à jour arrive tout de suite.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
