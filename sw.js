// Opal web app: keeps the app itself available offline. Live data (records, storms) always comes fresh from the network.
const CACHE = 'opal-v1.2.0';
const SHELL = ['./', 'index.html', 'nearby.js', 'house.js', 'hub.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'assets/icon.png', 'assets/fonts/Bungee-400.woff2', 'assets/fonts/OpenSans-400.woff2', 'assets/fonts/OpenSans-600.woff2'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // live data: straight to the network
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
