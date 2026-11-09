// Keeps the app itself available offline. Downloaded city maps live in the "navi-data-v1" cache (see app.js).
const VERSION = '9a808cd813';
const SHELL = 'navi-shell-' + VERSION;

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
  await (await caches.open(SHELL)).addAll(list);
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('navi-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.endsWith('/data/cities.json')) {
    // network first so new maps show up; cached copy when offline
    e.respondWith(fetch(e.request).then(async (r) => {
      if (r.ok) await (await caches.open(SHELL)).put(e.request, r.clone());
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  if (u.pathname.includes('/data/')) return; // map downloads go straight to the network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
