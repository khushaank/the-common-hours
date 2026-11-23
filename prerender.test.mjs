import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { generatedFile, loadPublicSnapshot, renderPublicPages } from "./prerender.mjs";
import { pageHref, pageParams } from "./shared/page-url.js";
import { markdownMarker } from "./shared/text.js";
import { renderFeed } from "./feed.mjs";
import { archiveEntries, archivePageSize, renderArchive } from "./shared/archive.js";
import { photoText, publicPhoto } from "./shared/photo-text.js";

const template = await readFile(new URL("./blog/index.html", import.meta.url), "utf8");
const initialRouteScript = template.match(/<script>(.*?)<\/script>/is)[1];
const imageId = "12345678-1234-1234-1234-123456789abc";
const post = { id: "one", slug: "first-entry", title: '$& <a "title">', excerpt: '$& An "excerpt"', tag: "Notes", published_on: "2026-11-16", body: markdownMarker + '**Hello**\n\n![An image](media:' + imageId + ' "A caption")\n\n<script>alert(1)</script>\n\n[Old entry](?post=first-entry)', start_here: true, photo_essay: true, collection: "Places", collection_intro: "A collection" };
const photo = { id: imageId, media_id: imageId, title: '$& "A photograph"', alt: "An image", description: "The description", week: "1900-01-01", created_at: "2026-11-16T00:00:00Z" };

test("static pages contain readable content, public links, safe formatting, and distinct metadata", () => {
  const pages = renderPublicPages(template, {
    posts: [post], photos: [photo], files: new Map(),
    images: new Map([[imageId, { src: "media-" + imageId + ".jpg", width: 800, height: 600 }]]),
  });
  const article = pages.get("entry-first-entry.html");
  assert.match(article, /<title>\$&amp; &lt;a &quot;title&quot;&gt; — The Common Hours<\/title>/);
  assert.match(article, /<strong>Hello<\/strong>/);
  assert.match(article, /A caption/);
  assert.match(article, /src="media-12345678-1234-1234-1234-123456789abc.jpg"/);
  assert.match(article, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(article, /<script>alert/);
  assert.match(article, /href="entry-first-entry.html"/);
  for (const name of ["index", "archive", "start", "photo-essays", "collections", "topics"]) assert.match(pages.get(name + ".html"), /href="entry-first-entry.html"/);
  assert.match(pages.get("privacy.html"), /<h1>Privacy<\/h1>/);
  assert.match(pages.get("privacy.html"), /What the journal collects/);
  assert.match(pages.get("terms.html"), /<h1>Terms<\/h1>/);
  assert.match(pages.get("photos.html"), /url=\.\/#week-photo/);
  assert.doesNotMatch(pages.get("sitemap.xml"), /\/photos\.html/);
  assert.match(pages.get("photo-" + imageId + ".html"), /The description/);
  const canonicals = [];
  for (const [name, html] of pages) {
    if (!name.endsWith(".html") || name === "photos.html") continue;
    const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
    canonicals.push(canonical);
    assert.match(html, /aria-busy="false" data-prerendered="true"/);
    const published = html.match(/<div class="published-copy">([\s\S]*?)<\/div>\s*<p class="loading/)[1];
    assert.doesNotMatch(published, /Loading (?:journal|photos|image)…/);
    assert.match(html, /data-refresh-pending=""/);
    assert.match(html, /data-skeleton="/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, name + " has duplicate IDs");
    assert.match(pages.get("sitemap.xml"), new RegExp(canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(new Set(canonicals).size, canonicals.length);
});

test("a failed live refresh preserves the published copy and exposes retry", async () => {
  const source = await readFile(new URL("./blog/journal.js", import.meta.url), "utf8");
  const load = source.slice(source.indexOf("async function load()"), source.indexOf("\nif (isJournal)"));
  let retry;
  let busy;
  let status;
  const content = { dataset: { prerendered: "true" }, setAttribute: (_, value) => { busy = value; }, after: value => { status = value; } };
  await runInNewContext(load + "\nload()", {
    content,
    document: { querySelector: () => null, createElement: () => ({}) },
    start: async () => { throw new Error("Network unavailable"); },
    showFailure: (element, message, action) => { assert.equal(element, status); assert.match(message, /still read this published copy/); retry = action; },
  });
  assert.equal(content.dataset.prerendered, "true");
  assert.equal(content.dataset.refreshPending, undefined);
  assert.equal(status.id, "refresh-status");
  assert.equal(busy, "false");
  assert.equal(typeof retry, "function");
});

test("offline navigation does not display the homepage as an entry or intercept private reviews", async () => {
  const source = (await readFile(new URL("./blog/static-cache.js", import.meta.url), "utf8")).replace('"__OFFLINE_ASSETS__"', '["index.html"]');
  const handlers = {};
  const cached = renderPublicPages(template, { posts: [post], photos: [], images: new Map(), files: new Map() }).get("index.html");
  runInNewContext(source, {
    URL, Request: class { constructor(request, options) { Object.assign(this, request, options); } }, Response, Set,
    self: { registration: { scope: "https://example.com/" }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    fetch: async () => { throw new Error("Offline"); },
    caches: { match: async key => String(key) === "https://example.com/index.html" ? new Response(cached) : undefined },
  });
  let result;
  handlers.fetch({ request: { url: "https://example.com/entry-first-entry.html", method: "GET", mode: "navigate" }, respondWith: response => { result = response; }, waitUntil: () => {} });
  const html = await (await result).text();
  assert.doesNotMatch(html, /data-prerendered/);
  assert.doesNotMatch(html, /<h1>Latest entries/);
  result = undefined;
  handlers.fetch({ request: { url: "https://example.com/?view=review", method: "GET", mode: "navigate" }, respondWith: response => { result = response; } });
  assert.equal(result, undefined);
});

test("offline documents retain their exact route, and live requests revalidate HTTP caches", async () => {
  const source = (await readFile(new URL("./blog/static-cache.js", import.meta.url), "utf8")).replace('"__OFFLINE_ASSETS__"', '["index.html"]');
  const handlers = {};
  const saved = new Map();
  const tasks = [];
  let online = true;
  const cache = {
    put: async (request, response) => saved.set(request.url, response),
    keys: async () => [...saved.keys()].map(url => ({ url })),
    delete: async request => saved.delete(request.url),
  };
  runInNewContext(source, {
    URL, Response, Set, Request: class { constructor(request, options) { Object.assign(this, request, options); } },
    self: { registration: { scope: "https://example.com/" }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    fetch: async request => { assert.equal(request.cache, "no-cache"); if (!online) throw new Error("Offline"); return new Response("Privacy document"); },
    caches: { open: async () => cache, match: async request => saved.get(request.url)?.clone() },
  });
  async function navigate(url) {
    let result;
    handlers.fetch({ request: { url, method: "GET", mode: "navigate" }, waitUntil: task => tasks.push(task), respondWith: task => { result = task; } });
    const response = await result;
    await Promise.all(tasks.splice(0));
    return response;
  }
  assert.equal(await (await navigate("https://example.com/privacy.html")).text(), "Privacy document");
  online = false;
  assert.equal(await (await navigate("https://example.com/privacy.html")).text(), "Privacy document");
  const other = await navigate("https://example.com/photos.html");
  assert.equal(other.status, 503);
  assert.doesNotMatch(await other.text(), /Privacy document/);
  assert.equal((await navigate("https://example.com/privacy.html?different=1")).status, 503);
});

test("archives have accessible pagination and static year, month, and Unicode topic routes", () => {
  const posts = Array.from({ length: 32 }, (_, index) => ({ ...post, slug: "entry-" + index, tag: index % 2 ? "प्रकृति & art" : "Notes", published_on: index < 20 ? "2026-11-16" : "2025-10-14" }));
  const pages = renderPublicPages(template, { posts, photos: [], images: new Map(), files: new Map() });
  for (const values of [{ view: "archive", page: "2" }, { view: "archive", year: "2026" }, { view: "archive", month: "2025-10" }, { view: "archive", tag: "प्रकृति & art", page: "2" }]) {
    const file = pageHref(values);
    assert.equal(generatedFile.test(file), true);
    const url = new URL(file, "https://example.com/");
    assert.deepEqual(Object.fromEntries(pageParams(url.search, url.pathname)), values);
    assert.ok(pages.has(file), file);
  }
  assert.equal((pages.get("archive.html").match(/<article class="entry">/g) || []).length, archivePageSize);
  assert.match(pages.get("archive.html"), /rel="next" href="archive-page-2.html"/);
  assert.match(pages.get("archive-page-2.html"), /rel="prev" href="archive.html"/);
  assert.equal(archiveEntries(posts, new URLSearchParams({ year: "2025" })).length, 12);
  assert.match(renderArchive(posts, new URLSearchParams({ page: "999" })), /Page 3 of 3/);
});

test("legal pages offer email without scripts, and reading sections explain their purpose", () => {
  const pages = renderPublicPages(template, { posts: [], photos: [], images: new Map(), files: new Map() });
  for (const file of ["privacy.html", "terms.html"]) {
    assert.match(pages.get(file), /href="mailto:uniquevara.ai@gmail.com"/);
    assert.match(pages.get(file), /This address protects the editor’s privacy/);
  }
  assert.match(pages.get("privacy.html"), /id="contact"/);
  assert.match(pages.get("start.html"), /Find your way in/);
  assert.match(pages.get("photo-essays.html"), /sequence of photographs/);
  assert.match(pages.get("collections.html"), /shared theme/);
});

test("photo metadata preserves descriptions and suppresses filenames and tracking URLs", () => {
  assert.equal(photoText("Blue ridges beneath a pale morning sky"), "Blue ridges beneath a pale morning sky");
  for (const value of ["IMG_1234.jpg", "250px Billie Jean Single.jpg utm source=en.wikipedia", "https://example.com/x", "sayan nath FWnbuCU8Axk unsplash"]) assert.equal(photoText(value), "");
  const clean = publicPhoto({ title: "IMG_1234.jpg", alt: "https://example.com/x" });
  assert.equal(clean.title, "Untitled photograph");
  assert.match(clean.alt, /description not yet provided/);
  const pages = renderPublicPages(template, { posts: [], photos: [{ ...photo, title: "bad.jpg", alt: "bad.jpg" }], images: new Map(), files: new Map() });
  assert.doesNotMatch(pages.get("photos.html"), /bad.jpg/);
});

test("published attachments become binary direct downloads without exposing credentials or draft files", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (address, options) => {
    calls.push(address);
    if (address.includes("/storage/")) {
      assert.ok(address.endsWith("/" + imageId));
      assert.equal(options.headers.Authorization, "Bearer public");
      return new Response("Published PDF bytes");
    }
    if (address.includes("_posts?")) return Response.json([{ ...post, body: markdownMarker + '[Guide.pdf](attachment:' + imageId + ' "A guide")' }]);
    return Response.json({ code: "PGRST205" }, { status: 404 });
  });
  const snapshot = await loadPublicSnapshot({ origin: "https://example.com", key: "public" });
  const file = "attachment-" + imageId + ".bin";
  assert.equal(snapshot.files.get(file).toString(), "Published PDF bytes");
  const article = renderPublicPages(template, snapshot).get("entry-first-entry.html");
  assert.match(article, new RegExp('href="' + file + '" download="Guide.pdf"'));
  assert.doesNotMatch(article, /download with JavaScript|Bearer public/);
  assert.equal(calls.filter(url => url.includes("/storage/")).length, 1);
});

test("an empty entry archive renders a readable empty state", () => {
  const pages = renderPublicPages(template, { posts: [], photos: [], images: new Map(), files: new Map() });
  assert.match(pages.get("archive.html"), /No entries here yet/);
  const published = pages.get("archive.html").match(/<div class="published-copy">([\s\S]*?)<\/div>\s*<p class="loading/)[1];
  assert.doesNotMatch(published, /Loading/);
});

test("each comma-separated tag gets its own linked topic and archive page", () => {
  const tagged = { ...post, tag: "Notes, AI, ai" };
  const pages = renderPublicPages(template, { posts: [tagged], photos: [], images: new Map(), files: new Map() });
  for (const tag of ["Notes", "AI"]) {
    const path = pageHref({ view: "archive", tag });
    assert.match(pages.get(path), /href="entry-first-entry.html"/);
    assert.ok(pages.get("entry-first-entry.html").includes('href="' + path + '">' + tag + "</a>"));
  }
  assert.equal(pages.has(pageHref({ view: "archive", tag: "ai" })), false);
});

test("new routes and legacy query links resolve to the same entries and filters", () => {
  for (const values of [{ post: "first-entry" }, { view: "privacy" }, { view: "photo-essays" }, { view: "photo", photo: imageId }, { view: "photos", year: "2026", series: "A & B" }, { view: "review" }, { tag: "A & B", page: "2" }]) {
    const url = new URL(pageHref(values), "https://example.com/");
    assert.deepEqual(Object.fromEntries(pageParams(url.search, url.pathname)), values);
  }
  assert.equal(pageParams("?post=old-entry", "/").get("post"), "old-entry");
  assert.equal(pageHref({ post: "../../private" }), "./?post=..%2F..%2Fprivate");
  for (const name of ["../entry-a.html", "folio.html", "media-../x.jpg"]) assert.equal(generatedFile.test(name), false);
});

test("new publications use working query links until their HTML pages exist", async () => {
  const source = await readFile(new URL("./shared/page-url.js", import.meta.url), "utf8");
  const link = runInNewContext(source.replaceAll("export ", "") + "\npageHref", {
    URLSearchParams,
    document: { querySelector: () => ({ dataset: { files: "entry-first-entry.html photo-" + imageId + ".html" } }) },
  });
  assert.equal(link({ post: "first-entry" }), "entry-first-entry.html");
  assert.equal(link({ post: "just-published" }), "./?post=just-published");
  assert.equal(link({ view: "photo", photo: "cover" }), "./?view=photo&photo=cover");
  assert.equal(link({ view: "photo-essays" }), "photo-essays.html");
});

test("RSS uses readable HTML links without changing existing subscription identifiers", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json([post]));
  const feed = await renderFeed({ origin: "https://example.com", key: "public" });
  assert.match(feed, /<link>https:\/\/commonhours.qd.je\/entry-first-entry.html<\/link>/);
  assert.match(feed, /<guid>https:\/\/commonhours.qd.je\/\?post=first-entry<\/guid>/);
});

test("the initial route script matches its CSP hash and handles direct and legacy links", () => {
  const script = initialRouteScript;
  assert.ok(template.includes("sha256-" + createHash("sha256").update(script).digest("base64")));
  for (const [pathname, search, expected] of [["/privacy.html", "", "policy-page"], ["/entry-first-entry.html", "", "article-page"], ["/", "?post=first-entry", "article-page"], ["/photos.html", "?year=2026", "wide-page"], ["/", "", "home-page"]]) {
    const classes = new Set();
    runInNewContext(script, { URLSearchParams, location: { pathname, search }, document: { documentElement: { dataset: {}, classList: { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)) } } } });
    assert.ok(classes.has(expected), pathname + search);
  }
});

test("legacy section URLs redirect to canonical pages while retaining filters and contact anchors", () => {
  const script = initialRouteScript;
  for (const view of ["archive", "topics", "photos", "start", "privacy", "terms", "collections", "photo-essays", "review", "https://bad.example"]) {
    const url = new URL("https://commonhours.qd.je/?view=" + encodeURIComponent(view) + "&year=2026#contact");
    let redirected;
    const location = { href: url.href, search: url.search, pathname: url.pathname, hash: url.hash, replace: address => { redirected = address; } };
    runInNewContext(script, { URL, URLSearchParams, location, document: { documentElement: { dataset: {}, classList: { add() {}, remove() {} } } } });
    assert.equal(redirected, ["review", "https://bad.example"].includes(view) ? undefined : "https://commonhours.qd.je/" + view + ".html?year=2026#contact");
  }
});

test("the build only reads public data, paginates, supports older schemas, and fails closed on API errors", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async address => {
    const url = new URL(address);
    calls.push(url);
    if (url.pathname.endsWith("_posts")) {
      assert.equal(url.searchParams.get("published"), "eq.true");
      if (url.searchParams.get("select").includes("collection")) return Response.json({ code: "42703" }, { status: 400 });
      return Response.json(Number(url.searchParams.get("offset")) === 0 ? Array.from({ length: 100 }, (_, id) => ({ ...post, id, body: "Plain text" })) : [{ ...post, body: "Plain text" }]);
    }
    return Response.json({ code: "PGRST205" }, { status: 404 });
  });
  const snapshot = await loadPublicSnapshot({ origin: "https://example.com", key: "public" });
  assert.equal(snapshot.posts.length, 101);
  assert.equal(snapshot.photos.length, 0);
  assert.ok(calls.every(url => /_(posts|weekly_photos|photos)$/.test(url.pathname)));
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "unavailable" }, { status: 503 }));
  await assert.rejects(loadPublicSnapshot({ origin: "https://example.com", key: "public" }), /Could not pre-render/);
});
