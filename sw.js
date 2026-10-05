/* SANIX CRM Pro — Service worker (application installable + mode hors ligne).
   Garde en cache l'application (index.html) et les bibliothèques CDN (Chart.js, Leaflet, polices) pour
   qu'elle s'ouvre sans connexion. Les données restent dans le navigateur (localStorage) et la synchro
   Supabase ne passe pas par ici (requêtes non interceptées). */
const VERSION = 'sanixcrm-v5';
const CACHE_CDN = 'sanixcrm-cdn';
const COQUILLE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-192.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
const BIBLIOTHEQUES = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap'
];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(VERSION).then((c) => Promise.all(COQUILLE.map((u) => c.add(u).catch(() => {})))),
    caches.open(CACHE_CDN).then((c) => Promise.all(BIBLIOTHEQUES.map((u) => c.match(u).then((deja) => deja || fetch(new Request(u, { mode: 'no-cors' }))
      .then((res) => (res.ok || res.type === 'opaque') ? c.put(u, res) : null).catch(() => {})))))
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) { if (k !== VERSION && k !== CACHE_CDN) await caches.delete(k); }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Application : réseau d'abord (dernière version), cache si hors ligne
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copie = res.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })
        .then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
    return;
  }
  // Bibliothèques CDN : cache d'abord, mise à jour en arrière-plan
  if (CDN.test(req.url)) {
    e.respondWith(caches.open(CACHE_CDN).then((c) => c.match(req).then((enCache) => {
      const reseau = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; });
      if (enCache) { reseau.catch(() => {}); return enCache; }
      return reseau;
    })));
  }
});
