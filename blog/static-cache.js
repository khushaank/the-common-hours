// Public documents are cached by their exact URL. Private reviews and writes
// always go to the network; a different page is never used as an HTML fallback.
const prefix = "common-hours-static-";
const cacheName = prefix + "__STATIC_REVISION__";
const pageCache = cacheName + "-pages";
const paths = "__OFFLINE_ASSETS__";
const scope = new URL(self.registration.scope);
const shell = new URL("index.html", scope);
const urls = new Set(Array.isArray(paths) ? paths.map(path => new URL(path, scope).href) : []);
const publicPage = /^(?:index|archive(?:-(?:year-\d{4}|month-\d{4}-\d{2}|tag-[A-Za-z0-9_~]+))?(?:-page-[1-9]\d*)?|topics|photos|start|privacy|terms|collections|photo-essays|entry-[a-z0-9-]{1,120}|photo-(?:[0-9a-f-]{36}|month-\d{4}-\d{2}))\.html$/i;

self.addEventListener("install", event => {
  if (!urls.size) return;
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(
    [...urls].map(url => new Request(url, { cache: "reload" }))
  )).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  if (!urls.size) return;
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith(prefix) && name !== cacheName && name !== pageCache).map(name => caches.delete(name))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !urls.size) return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && (url.pathname === scope.pathname || publicPage.test(url.pathname.slice(scope.pathname.length))) &&
      url.origin === scope.origin && url.searchParams.get("view") !== "review") {
    const online = fetch(new Request(request, { cache: "no-cache" })).then(response => {
      if (response.status >= 500) throw new Error("The journal is temporarily unavailable.");
      return response;
    });
    event.waitUntil(online.then(async response => {
      if (!response.ok) return;
      const copy = response.clone();
      const cache = await caches.open(pageCache);
      await cache.put(request, copy);
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - 30))) await cache.delete(key);
    }).catch(() => {}));
    event.respondWith(online.catch(async () => {
      const cached = await caches.match(request, { cacheName: pageCache });
      if (cached) return cached;
      if ((url.pathname === scope.pathname || url.pathname === shell.pathname) && !url.search) {
        const homepage = await caches.match(shell, { cacheName });
        if (homepage) return homepage;
      }
      return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline — The Common Hours</title><h1>This page isn’t saved for offline reading</h1><p>Reconnect to open it, or <a href="' + scope.href + '">return to the journal</a>.</p></html>',
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }));
  } else if (urls.has(request.url)) {
    event.respondWith(caches.match(request, { cacheName }).then(cached => cached || fetch(request)));
  }
});
