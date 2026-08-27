/* CM Program App — Service Worker (PWA)
   Rôle : permettre l'installation sur l'écran d'accueil et un fonctionnement
   hors-ligne partiel. On NE met JAMAIS en cache les appels IA (/api/…).
   À chaque mise à jour de l'app, change la version ci-dessous (v1 → v2…)
   pour forcer le rafraîchissement du cache chez les élèves. */
const CACHE = 'cmp-v3';
const CORE = [
  '/', '/index.html', '/manifest.webmanifest',
  '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
  '/login-bg.png', '/cm-program-logo.png', '/favicon-32.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                  // laisse passer les POST (proxy IA)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // ne gère que le même domaine
  if (url.pathname.startsWith('/api/')) return;      // jamais mettre l'IA en cache

  const isHtml = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  if (isHtml) {
    // Réseau d'abord : les mises à jour de l'app arrivent tout de suite ;
    // repli sur le cache si hors-ligne.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
  } else {
    // Cache d'abord pour les images/icônes.
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});
