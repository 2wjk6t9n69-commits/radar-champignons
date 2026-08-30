const CACHE = 'radar-champignon-v32-1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './engine_v32.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

// App shell: cache-first. Tout le reste (tuiles carte, météo): réseau direct (pas de cache, données vivantes).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isShellRequest = url.origin === self.location.origin;
  if(!isShellRequest) return; // laisse passer tuiles OSM / API météo normalement

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
