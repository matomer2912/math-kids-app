// Offline cache: network-first (so updates arrive when online), cache fallback when offline.
const CACHE = 'dd-v9b';
const FILES = ['./', 'index.html', 'manifest.json', 'icon.svg', 'net.js', 'lib/three.min.js', 'lib/qrcode.js', 'lib/jsQR.js', 'lib/peerjs.min.js',
  'js/data.js', 'js/look.js', 'js/dungeon.js', 'js/models.js', 'js/decor.js', 'js/decor-kits-b.js', 'js/sim.js', 'js/core.js', 'js/render.js', 'js/ui.js', 'js/shop.js', 'js/social.js', 'js/main.js', 'fonts/lilita-one.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(r => {
      if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
