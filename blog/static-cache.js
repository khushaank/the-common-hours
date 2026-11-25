// Cache public HTML by its exact URL. Reviews and the Writing Desk stay online.
const prefix = "common-hours-static-";
const cacheName = prefix + "__STATIC_REVISION__";
const pageCache = cacheName + "-pages";
const imageCache = cacheName + "-images";
const paths = "__OFFLINE_ASSETS__";
const entries = "__OFFLINE_ENTRIES__";
const scope = new URL(self.registration.scope);
const shell = new URL("index.html", scope);
const urls = new Set(Array.isArray(paths) ? paths.map(path => new URL(path, scope).href) : []);
const publicPage = /^(?:index|archive(?:-(?:year-\d{4}|month-\d{4}-\d{2}|tag-[A-Za-z0-9_~]+))?(?:-page-[1-9]\d*)?|notes|topics|photos|start|series|privacy|terms|collections|photo-essays|entry-[a-z0-9-]{1,120}|photo-(?:[0-9a-f-]{36}|month-\d{4}-\d{2}))(?:\.html)?$/i;
const entryPage = /^entry-[a-z0-9-]{1,120}(?:\.html)?$/i;
const mediaFile = /^(?:media-[0-9a-f-]{36}\.jpg|note-thumb-[0-9a-f-]{36}\.webp)$/i;
const file = url => url.pathname.slice(scope.pathname.length);
const inScope = url => url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
const home = url => url.pathname === scope.pathname || url.pathname === shell.pathname;
const readable = url => inScope(url) && (home(url) || publicPage.test(file(url))) && url.searchParams.get("view") !== "review";
const checkNetwork = request => fetch(new Request(request, { cache: "no-cache", signal: AbortSignal.timeout(8000) }));
const escapeAttribute = text => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

async function store(cacheKey, request, response, limit) {
  const cache = await caches.open(cacheKey);
  await cache.put(request, response);
  const keys = await cache.keys();
  for (const oldest of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(oldest);
}

async function loadMedia(request) {
  const response = await checkNetwork(request);
  if (response.status >= 500) throw new Error("Photo unavailable");
  if (response.ok) await store(imageCache, request, response.clone(), 36).catch(() => {});
  else if ([404, 410].includes(response.status)) {
    const cache = await caches.open(imageCache);
    await cache.delete(request, { ignoreSearch: true });
  }
  return response;
}

async function saveDocument(request, response) {
  if (!response.ok) return;
  const url = new URL(request.url);
  if (home(url) && (url.searchParams.has("post") || url.searchParams.has("view"))) return;
  const copy = response.clone();
  await store(pageCache, request, response, 30);
  if (/^notes(?:\.html)?$/.test(file(url))) return;
  const html = await copy.text();
  const photos = new Set([...html.matchAll(/<img src="(media-[0-9a-f-]{36}\.jpg)"/gi)].map(match => match[1]));
  await Promise.allSettled([...photos].map(async name => {
    const request = new Request(new URL(name, scope));
    if (!await caches.match(request, { cacheName: imageCache })) await loadMedia(request);
  }));
}

async function warmDocument(url) {
  const request = new Request(url);
  if (await caches.match(request, { cacheName: pageCache })) return;
  await saveDocument(request, await checkNetwork(request));
}

self.addEventListener("install", event => {
  if (!urls.size) return;
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(
    [...urls].map(url => new Request(url, { cache: "reload" }))
  )).then(async () => {
    if (Array.isArray(entries)) await Promise.allSettled(entries.map(name => warmDocument(new URL(name, scope))));
    await self.skipWaiting();
  }));
});

self.addEventListener("activate", event => {
  if (!urls.size) return;
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith(prefix) && ![cacheName, pageCache, imageCache].includes(name)).map(name => caches.delete(name))
  )).then(() => self.clients.claim()));
});

self.addEventListener("message", event => {
  if (!urls.size || event.data !== "save-public-page" || !event.source?.url) return;
  const url = new URL(event.source.url);
  if (readable(url) && !home(url)) event.waitUntil(warmDocument(url).catch(() => {}));
});

async function offlineCopy(response) {
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return new Response(html.replace(/<html(?=[\s>])/i, "<html data-offline-copy"), { headers, status: response.status });
}

async function offlineScreen(url) {
  const cache = await caches.open(pageCache);
  const articles = new Map();
  for (const request of (await cache.keys()).reverse()) {
    const address = new URL(request.url);
    if (!readable(address) || !entryPage.test(file(address)) || articles.has(address.pathname)) continue;
    const response = await cache.match(request);
    const title = (await response?.text())?.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/ - The Common Hours$/, "");
    if (title) articles.set(address.pathname, '<li><a href="' + escapeAttribute(address.href) + '">' + title + '</a></li>');
  }
  const style = [...urls].find(path => file(new URL(path)) === "style.css");
  const page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="theme-color" content="#fbfaf7"><title>Offline - The Common Hours</title>' +
    (style ? '<link rel="stylesheet" href="' + escapeAttribute(style) + '">' : '') +
    '<main class="wrap offline-page"><p>The Common Hours</p><h1>You’re offline</h1>' +
    (home(url) ? '' : '<p>This page isn’t saved on this device.</p>') +
    (articles.size ? '<h2>Available offline</h2><ul>' + [...articles.values()].join("") + '</ul>' : '<p>Visit the journal online to save articles for your next visit.</p>') +
    '<p><a class="back" href="' + escapeAttribute(url.href) + '">Try again</a></p></main></html>';
  return new Response(page, { status: 503, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'",
  } });
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !urls.size) return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && readable(url)) {
    const online = checkNetwork(request).then(response => {
      if (response.status >= 500) throw new Error("The journal is temporarily unavailable.");
      return response;
    });
    event.waitUntil(online.then(async response => {
      if ([404, 410].includes(response.status)) {
        const cache = await caches.open(pageCache);
        await cache.delete(request, { ignoreSearch: true });
      } else if (response.ok) await saveDocument(request, response.clone());
    }).catch(() => {}));
    event.respondWith(online.catch(async () => {
      if (!home(url)) {
        const cached = await caches.match(request, { cacheName: pageCache });
        if (cached) return offlineCopy(cached);
      }
      return offlineScreen(url);
    }));
  } else if (urls.has(request.url)) {
    event.respondWith(caches.match(request, { cacheName }).then(cached => cached || fetch(request)));
  } else if (inScope(url) && request.destination === "image" && mediaFile.test(file(url))) {
    event.respondWith(loadMedia(request).catch(async () => (await caches.match(request, { cacheName: imageCache })) || Response.error()));
  }
});
