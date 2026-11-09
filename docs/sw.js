// Keeps the app itself available offline. Downloaded city maps live in the "navi-data-v1" cache (see app.js).
const VERSION = '8c0d999bc9';
const SHELL = 'navi-shell-' + VERSION;

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
  // 'reload' skips the HTTP cache, so a new version never mixes with stale files
  await (await caches.open(SHELL)).addAll(list.map((u) => new Request(u, { cache: 'reload' })));
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
    // network first so new maps show up, but give up after 3 s: during outages the network often just hangs
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const net = fetch(e.request).then(async (r) => {
        if (r.ok) await (await caches.open(SHELL)).put(e.request, r.clone());
        return r;
      });
      if (!cached) return net;
      const timeout = new Promise((ok) => setTimeout(() => ok(cached), 3000));
      return Promise.race([net.catch(() => cached), timeout]);
    })());
    return;
  }
  if (u.pathname.includes('/data/')) return; // map downloads go straight to the network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
