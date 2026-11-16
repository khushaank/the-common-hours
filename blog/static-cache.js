// Only the public app shell is cached here. Drafts, reviews and API writes
// always go to the network. Public reading data has a separate bounded cache.
const prefix = "common-hours-static-";
const cacheName = prefix + "__STATIC_REVISION__";
const paths = "__OFFLINE_ASSETS__";
const scope = new URL(self.registration.scope);
const shell = new URL("index.html", scope);
const urls = new Set(Array.isArray(paths) ? paths.map(path => new URL(path, scope).href) : []);
const publicPage = /^(?:index|archive|topics|photos|start|privacy|terms|collections|photo-essays|entry-[a-z0-9-]{1,120}|photo-(?:[0-9a-f-]{36}|month-\d{4}-\d{2}))\.html$/i;

self.addEventListener("install", event => {
  if (!urls.size) return;
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(
    [...urls].map(url => new Request(url, { cache: "reload" }))
  )).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  if (!urls.size) return;
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith(prefix) && name !== cacheName).map(name => caches.delete(name))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !urls.size) return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && (url.pathname === scope.pathname || publicPage.test(url.pathname.slice(scope.pathname.length))) &&
      url.origin === scope.origin && url.searchParams.get("view") !== "review") {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.match(shell, { cacheName });
      if (!cached) return Response.error();
      if ((url.pathname === scope.pathname || url.pathname === shell.pathname) && !url.search) return cached;
      // Only the homepage is cached; let the app load this route's saved public data.
      const html = (await cached.text()).replace(/<section id="content"[\s\S]*?<aside id="sidebar"[^>]*>[\s\S]*?<\/aside>/,
        '<section id="content" tabindex="-1" aria-label="Journal content" aria-busy="true"></section><aside id="sidebar" aria-label="Blog archive"></aside>');
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }));
  } else if (urls.has(request.url)) {
    event.respondWith(caches.match(request, { cacheName }).then(cached => cached || fetch(request)));
  }
});
