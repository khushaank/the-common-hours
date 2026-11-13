// Cache only the journal's public artwork and fonts. Content and the desk
// always use their normal network requests.
const prefix = "common-hours-static-";
const cacheName = prefix + "__STATIC_REVISION__";
const assets = new Set(["cover.jpg", "footer-landscape.jpg", "serif.woff2", "serif-italic.woff2", "sans.woff2", "sans-semibold.woff2"]
  .map(name => new URL(name, self.registration.scope).href));

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName)
      .map(name => caches.delete(name)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !assets.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName).catch(() => null);
    const saved = await cache?.match(request).catch(() => null);
    if (saved) return saved;
    const response = await fetch(request);
    if (response.ok) await cache?.put(request, response.clone()).catch(() => {});
    return response;
  })());
});
