import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { generatedFile, loadPublicSnapshot, renderPublicPages } from "./prerender.mjs";
import { pageHref, pageParams } from "./shared/page-url.js";
import { escape, markdownMarker, searchExcerpt } from "./shared/text.js";
import { renderFeed } from "./feed.mjs";
import { archiveEntries, archivePageSize, renderArchive } from "./shared/archive.js";
import { photoText, publicPhoto } from "./shared/photo-text.js";
import { writeNote } from "./shared/note.js";
import { carouselMarkup } from "./shared/carousel.js";

const template = await readFile(new URL("./blog/index.html", import.meta.url), "utf8");
const initialRouteScript = template.match(/<script>(.*?)<\/script>/is)[1];
const imageId = "12345678-1234-1234-1234-123456789abc";
const post = { id: "one", slug: "first-entry", title: '$& <a "title">', excerpt: '$& An "excerpt"', tag: "Notes", published_on: "2026-11-16", body: markdownMarker + '**Hello**\n\n![An image](media:' + imageId + ' "A caption")\n\n<script>alert(1)</script>\n\n[Old entry](?post=first-entry)', start_here: true, photo_essay: true, collection: "Places", collection_intro: "A collection" };
const photo = { id: imageId, media_id: imageId, title: '$& "A photograph"', alt: "An image", description: "The description", week: "1900-01-01", created_at: "2026-11-16T00:00:00Z" };

test("static pages contain readable content, public links, safe formatting, and distinct metadata", () => {
  const pages = renderPublicPages(template, {
    posts: [post], photos: [photo], files: new Map(),
    comments: [{ post_id: post.id, display_name: "Reader", body: "Approved & visible" }],
    images: new Map([[imageId, { src: "media-" + imageId + ".jpg", width: 800, height: 600 }]]),
  });
  const article = pages.get("entry-first-entry.html");
  assert.match(article, /<title>\$&amp; &lt;a &quot;title&quot;&gt; - The Common Hours<\/title>/);
  assert.match(article, /<strong>Hello<\/strong>/);
  assert.doesNotMatch(article, /A caption|Paired photo/);
  assert.match(article, /src="media-12345678-1234-1234-1234-123456789abc.jpg"/);
  assert.match(article, /class="zoom-image" href="media-12345678-1234-1234-1234-123456789abc.jpg"/);
  assert.match(article, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(article, /<script>alert/);
  assert.match(article, /href="entry-first-entry"/);
  assert.match(article, /<h2>Comments<\/h2>[\s\S]+Approved &amp; visible/);
  assert.doesNotMatch(article, /id="comment-form"/);
  for (const name of ["index", "archive", "start"]) assert.match(pages.get(name + ".html"), /href="entry-first-entry"/);
  const topics = pages.get("topics.html");
  assert.doesNotMatch(topics, /Notes<span>/);
  assert.doesNotMatch(topics, /href="entry-first-entry"/);
  assert.match(pages.get("notes.html"), /<h1>Notes<\/h1>/);
  assert.match(article, /alt="An image" draggable="false"/);
  assert.match(article, /og:image" content="https:\/\/commonhours\.qd\.je\/media-/);
  assert.match(pages.get("sitemap.xml"), /<image:loc>https:\/\/commonhours\.qd\.je\/media-/);
  assert.match(pages.get("privacy.html"), /<h1>Privacy<\/h1>/);
  assert.match(pages.get("privacy.html"), /What the journal collects/);
  assert.match(pages.get("terms.html"), /<h1>Terms<\/h1>/);
  assert.match(pages.get("photos.html"), /url=\.\/#featured-photo/);
  assert.doesNotMatch(pages.get("sitemap.xml"), /\/(photos|collections|photo-essays)<\/loc>|\.html<\/loc>/);
  assert.doesNotMatch(pages.get("photo-" + imageId + ".html"), /The description/);
  const canonicals = [];
  for (const [name, html] of pages) {
    if (!name.endsWith(".html") || ["photos.html", "collections.html", "photo-essays.html", pageHref({ view: "archive", tag: "Notes" }, { filename: true })].includes(name)) continue;
    const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
    canonicals.push(canonical);
    assert.match(html, /aria-busy="false" data-prerendered="true"/);
    const published = html.match(/<div class="published-copy">([\s\S]*?)<\/div>\s*<p class="loading/)[1];
    assert.doesNotMatch(published, /Loading (?:journal|photos|image)…/);
    assert.doesNotMatch(html, /data-refresh-pending=""/);
    assert.doesNotMatch(html, /data-skeleton="/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, name + " has duplicate IDs");
    assert.match(pages.get("sitemap.xml"), new RegExp(canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(new Set(canonicals).size, canonicals.length);
});

test("a failed live refresh preserves the published copy and exposes retry", async () => {
  const source = await readFile(new URL("./blog/journal.js", import.meta.url), "utf8");
  const load = source.slice(source.indexOf("async function load()"), source.indexOf("\nif (isJournal"));
  let retry;
  let busy;
  let status;
  const content = { dataset: { prerendered: "true" }, setAttribute: (_, value) => { busy = value; }, after: value => { status = value; } };
  await runInNewContext(load + "\nload()", {
    content, offline: () => false,
    location: { search: "" },
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

test("a successful refresh keeps the published marker when the published DOM is retained", async () => {
  const source = await readFile(new URL("./blog/journal.js", import.meta.url), "utf8");
  const load = source.slice(source.indexOf("async function load()"), source.indexOf("\nif (isJournal"));
  for (const retained of [true, false]) {
    const content = { dataset: { prerendered: "true" }, querySelector: () => retained, setAttribute(name, value) { this[name] = value; } };
    await runInNewContext(load + "\nload()", {
      content, location: { search: "" }, document: { querySelector: () => null }, start: async () => {},
      view: null, offline: () => false, loadCarousels: async () => {}, publicCarousel() {}, publicImage() {}, publicCarouselCover() {},
    });
    assert.equal(content.dataset.prerendered, retained ? "true" : undefined);
    assert.equal(content["aria-busy"], "false");
  }
});

test("search highlights the matching context and escapes the entire excerpt", async () => {
  const source = await readFile(new URL("./blog/reading.js", import.meta.url), "utf8");
  const render = runInNewContext(source.slice(source.indexOf("function searchCards"), source.indexOf("export async function renderReview")) +
    "\nsearchCards", { escape, searchExcerpt, entryHref: slug => pageHref({ post: slug }) });
  const results = render([{ slug: "field-notes", title: "Along the valley", excerpt: "A different excerpt",
    snippet: "…near the <quiet> footbridge (old) at dawn…" }], "footbridge (old)");
  assert.match(results, /&lt;quiet&gt; <mark>footbridge \(old\)<\/mark> at dawn/);
  assert.doesNotMatch(results, /A different excerpt/);
});

test("offline navigation does not display the homepage as an entry or intercept private reviews", async () => {
  const source = (await readFile(new URL("./blog/static-cache.js", import.meta.url), "utf8")).replace('"__OFFLINE_ASSETS__"', '["index.html"]');
  const handlers = {};
  const cached = renderPublicPages(template, { posts: [post], photos: [], images: new Map(), files: new Map() }).get("index.html");
  runInNewContext(source, {
    URL, AbortSignal, Headers, Request: class { constructor(request, options) { Object.assign(this, request, options); } }, Response, Set,
    self: { registration: { scope: "https://example.com/" }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    fetch: async () => { throw new Error("Offline"); },
    caches: { open: async () => ({ keys: async () => [] }), match: async key => String(key) === "https://example.com/index.html" ? new Response(cached) : undefined },
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
  let status = 200;
  const cache = {
    put: async (request, response) => saved.set(request.url, response),
    keys: async () => [...saved.keys()].map(url => ({ url })),
    delete: async (request, { ignoreSearch = false } = {}) => {
      for (const url of saved.keys()) {
        if (url === request.url || ignoreSearch && url.split("?")[0] === request.url.split("?")[0]) saved.delete(url);
      }
    },
  };
  runInNewContext(source, {
    URL, Response, Headers, AbortSignal, Set, Request: class { constructor(request, options) { Object.assign(this, request, options); } },
    self: { registration: { scope: "https://example.com/" }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    fetch: async request => {
      assert.equal(request.cache, "no-cache");
      if (!online) throw new Error("Offline");
      return new Response("Privacy document", { status });
    },
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
  for (const removed of [404, 410]) {
    online = true;
    status = 200;
    const entry = "https://example.com/entry-retired.html";
    const alternate = entry + "?from=archive";
    assert.equal((await navigate(entry)).status, 200);
    assert.equal((await navigate(alternate)).status, 200);
    status = 500;
    assert.equal((await navigate(entry)).status, 200);
    status = removed;
    assert.equal((await navigate(entry)).status, removed);
    online = false;
    assert.equal((await navigate(entry)).status, 503);
    assert.equal((await navigate(alternate)).status, 503);
    assert.equal((await navigate("https://example.com/privacy.html")).status, 200);
  }
});

test("the first online visit saves recent articles and offers them on the offline screen", async () => {
  const entry = "entry-first-entry.html";
  const articleUrl = "https://example.com/" + entry;
  const imageUrl = "https://example.com/media-" + imageId + ".jpg";
  const source = (await readFile(new URL("./blog/static-cache.js", import.meta.url), "utf8"))
    .replace('"__OFFLINE_ASSETS__"', '["index.html","style.css"]')
    .replace('"__OFFLINE_ENTRIES__"', JSON.stringify([entry]));
  const handlers = {};
  const stores = new Map();
  const urlFor = key => key.url ?? String(key);
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const items = stores.get(name);
      return {
        addAll: async urls => { for (const url of urls) items.set(urlFor(url), new Response("Asset")); },
        match: async key => items.get(urlFor(key))?.clone(),
        put: async (key, response) => items.set(urlFor(key), response),
        keys: async () => [...items.keys()].map(url => ({ url })),
      };
    },
    async match(key, { cacheName }) { return (await this.open(cacheName)).match(key); },
  };
  let online = true;
  runInNewContext(source, {
    URL, Response, Headers, AbortSignal, caches,
    Request: class { constructor(request, options) { this.url = request.url || String(request); Object.assign(this, options); } },
    self: { registration: { scope: "https://example.com/" }, addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting() {} },
    fetch: async request => {
      if (!online) throw new Error("Offline");
      if (request.url === articleUrl || request.url.endsWith("entry-read-first.html")) return new Response(
        '<html><title>Saved &amp; readable - The Common Hours</title><p>Original article</p><img src="media-' + imageId + '.jpg"></html>');
      assert.equal(request.url, imageUrl);
      return new Response("Photo");
    },
  });
  let install;
  handlers.install({ waitUntil: task => { install = task; } });
  await install;
  handlers.message({ data: "save-public-page", source: { url: "https://example.com/entry-read-first.html" },
    waitUntil: task => { install = task; } });
  await install;
  online = false;
  async function request(path, options) {
    let result;
    handlers.fetch({ request: { url: "https://example.com" + path, method: "GET", ...options },
      waitUntil() {}, respondWith: task => { result = task; } });
    return result;
  }
  const offlineHome = await request("/", { mode: "navigate" });
  const policy = offlineHome.headers.get("content-security-policy");
  assert.match(policy, /default-src 'none';.*font-src 'self'/);
  assert.doesNotMatch(policy, /unsafe-eval|script-src/);
  const home = await offlineHome.text();
  assert.match(home, /You’re offline/);
  assert.match(home, /Available offline/);
  assert.match(home, /href="https:\/\/example\.com\/entry-first-entry\.html">Saved &amp; readable/);
  assert.match(home, /href="https:\/\/example\.com\/entry-read-first\.html"/);
  assert.match(await (await request("/" + entry, { mode: "navigate" })).text(), /<html data-offline-copy>.*Original article/);
  assert.equal(await (await request(new URL(imageUrl).pathname, { destination: "image" })).text(), "Photo");
});

test("archives have accessible pagination and static year, month, and Unicode topic routes", () => {
  const posts = Array.from({ length: 32 }, (_, index) => ({ ...post, slug: "entry-" + index, tag: index % 2 ? "प्रकृति & art" : "Notes", published_on: index < 20 ? "2026-11-16" : "2025-10-14" }));
  const pages = renderPublicPages(template, { posts, photos: [], images: new Map(), files: new Map() });
  for (const values of [{ view: "archive", page: "2" }, { view: "archive", year: "2026" }, { view: "archive", month: "2025-10" }, { view: "archive", tag: "प्रकृति & art", page: "2" }]) {
    const file = pageHref(values, { filename: true });
    assert.equal(generatedFile.test(file), true);
    const url = new URL(file, "https://example.com/");
    assert.deepEqual(Object.fromEntries(pageParams(url.search, url.pathname)), values);
    assert.ok(pages.has(file), file);
  }
  assert.equal((pages.get("archive.html").match(/<article class="entry">/g) || []).length, archivePageSize);
  assert.match(pages.get("archive.html"), /rel="next" href="archive-page-2"/);
  assert.match(pages.get("archive-page-2.html"), /rel="prev" href="archive"/);
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
  for (const name of ["photo-essays.html", "collections.html"]) assert.match(pages.get(name), /url=archive"/);
});

test("notes render without an entry title and support inline formatting and links", () => {
  const body = "First line\n**Second line** with [a link](https://example.com/)";
  const note = { ...post, slug: "short-note", title: "First line", body, excerpt: body, is_note: true };
  const pages = renderPublicPages(template, { posts: [note], photos: [], images: new Map(), files: new Map() });
  for (const name of ["notes", "archive", "entry-short-note"]) {
    assert.match(pages.get(name + ".html"), /class="note-text">First line<br>\n<strong>Second line<\/strong> with <a[^>]+href="https:\/\/example.com\/"/);
  }
  assert.match(pages.get("entry-short-note.html"), /<h1>Note<\/h1>/);
});

test("note photos and references appear on notes and archive pages, with carousels on the feed and permalink", () => {
  const second = "22345678-1234-1234-1234-123456789abc";
  const photos = [{ id: imageId, alt: "First & best" }, { id: second, alt: "Second" }];
  const references = [{ slug: post.slug, title: "Related <article>" }];
  const note = { ...post, id: "note", slug: "photo-note", title: "Photo note", excerpt: "Photo note", is_note: true,
    body: writeNote("", { photos, references }) };
  const images = new Map(photos.map(({ id }) => [id, { src: "media-" + id + ".jpg", width: 800, height: 600 }]));
  const thumb = `note-thumb-${imageId}.webp`;
  const older = Array.from({ length: 3 }, (_, index) => ({ ...note, id: `old-${index}`, slug: `old-${index}`, body: "Earlier note" }));
  const pages = renderPublicPages(template, { posts: [note, ...older, post], photos: [], images, files: new Map([[thumb, new Uint8Array()]]) });
  for (const file of ["notes.html", "archive.html", "entry-photo-note.html"]) {
    const html = pages.get(file);
    assert.match(html, /class="note-gallery" data-count="2"/);
    assert.match(html, /class="zoom-image" href="media-12345678-1234-1234-1234-123456789abc\.jpg" aria-label="Enlarge photo: First &amp; best"/);
    assert.match(html, /href="entry-first-entry">Related &lt;article&gt;/);
    assert.doesNotMatch(html, /common-hours-note-extras/);
    assert.equal(html.includes('data-carousel role="group"'), file !== "archive.html");
  }
  const homepage = pages.get("index.html");
  assert.match(homepage, /<h1>Latest entries<\/h1>[\s\S]*?href="entry-first-entry"/);
  assert.match(homepage, new RegExp(`<img src="${thumb}" width="144" height="144"`));
  assert.match(homepage, /href="notes">View all notes/);
  assert.equal((homepage.match(/<span class="note-preview">/g) ?? []).length, 3);
  assert.doesNotMatch(homepage, /class="note-gallery"|href="entry-old-2"|src="media-/);
});

test("a saved carousel renders in an article and a numbered Note", () => {
  const id = "30000000-0000-0000-0000-000000000001";
  const photos = Array.from({ length: 20 }, (_, index) => ({
    id: "40000000-0000-0000-0000-" + String(index).padStart(12, "0"), alt: "Photo " + (index + 1),
  }));
  const article = { ...post, body: markdownMarker + "Before\n\n" + carouselMarkup(id) + "\n\nAfter" };
  const note = { ...post, id: "short", slug: "short-note", is_note: true, note_number: 7, body: writeNote("", { photos: [], references: [], carousels: [id] }) };
  const images = new Map(photos.map(({ id }) => [id, { src: "media-" + id + ".jpg", width: 800, height: 600 }]));
  const chosen = photos.at(-1).id;
  const thumb = "note-thumb-" + chosen + ".webp";
  const pages = renderPublicPages(template, { posts: [note, article], photos: [], images, files: new Map([[thumb, new Uint8Array()]]),
    carousels: new Map([[id, photos]]), carouselCovers: new Map([[id, chosen]]),
    comments: [{ post_id: note.id, display_name: "Reader", body: "Hidden Note comment" }] });
  for (const file of ["entry-first-entry.html", "entry-short-note.html", "notes.html"]) {
    const html = pages.get(file);
    assert.match(html, /class="note-gallery" data-count="20"/);
    assert.match(html, /Enlarge photo: Photo 20/);
    assert.ok(html.includes('data-photos="' + photos.map(photo => photo.id).join(",") + '"'));
    assert.doesNotMatch(html, /Hidden Note comment|data-note-like/);
  }
  assert.match(pages.get("notes.html"), /Note 007/);
  assert.match(pages.get("entry-short-note.html"), /rel="canonical" href="https:\/\/commonhours\.qd\.je\/entry-short-note"/);
  assert.doesNotMatch(pages.get("entry-short-note.html"), /<h2>Comments<\/h2>/);
  assert.match(pages.get("entry-first-entry.html"), /<h2>Comments<\/h2>/);
  assert.ok(pages.get("index.html").includes('data-carousel-cover="' + id + '" data-photos="' + chosen + '"'));
  assert.ok(pages.get("index.html").includes('src="' + thumb + '"'));
  for (const file of ["entry-short-note.html", "entry-first-entry.html"]) {
    assert.ok(pages.get(file).includes('property="og:image" content="https://commonhours.qd.je/media-' + chosen + '.jpg"'));
  }
});

test("series articles show membership before the title and keep links in part order", () => {
  const series = "Making you dream big & bold";
  const first = { ...post, series, series_order: 1 };
  const second = { ...post, id: "two", slug: "second-part", title: "Second part", series, series_order: 3 };
  const unnumbered = { ...post, id: "three", slug: "older-part", series };
  const standalone = { ...post, id: "four", slug: "standalone" };
  const pages = renderPublicPages(template, { posts: [second, unnumbered, standalone, first], photos: [], images: new Map(), files: new Map() });
  const article = pages.get("entry-first-entry.html");
  const [, seriesAnchor] = article.match(/class="article-series">Part 1 of the series <a draggable="false" href="series#(series-[\w-]+)">Making you dream big &amp; bold<\/a><\/p><h1>/);
  assert.match(article, /href="entry-second-part">Next in the series · Second part/);
  assert.ok(article.includes('href="series#' + seriesAnchor + '">See the full series'));
  const directory = pages.get("series.html");
  assert.equal(seriesAnchor, "series-making-you-dream-big-bold");
  assert.ok(directory.includes('id="series-' + Buffer.from(series).toString("base64url") + '"'));
  assert.ok(directory.includes('id="' + seriesAnchor + '"'));
  assert.match(directory, /<h1>Series<\/h1>[\s\S]*<details class="series-group">\s*<summary><span class="series-name">Making you dream big &amp; bold<\/span>[\s\S]*<ol class="series-parts">/);
  assert.match(directory, /class="series-part-number">Part 1<\/span>[\s\S]*?<h2 class="entry-title">/);
  assert.ok(directory.indexOf('href="entry-first-entry"') < directory.indexOf('href="entry-second-part"'));
  assert.match(pages.get("entry-older-part.html"), /class="article-series">Part of the series/);
  assert.doesNotMatch(pages.get("entry-standalone.html"), /class="(?:article-series|series-navigation)"/);
});

test("series with similar names keep distinct links and fragment targets", () => {
  const entries = [
    { ...post, series: "Field notes" },
    { ...post, id: "two", slug: "another-entry", series: "Field-notes" },
  ];
  const pages = renderPublicPages(template, { posts: entries, photos: [], images: new Map(), files: new Map() });
  const directory = pages.get("series.html");
  assert.match(directory, /<h1>Series<\/h1>/);
  for (const entry of entries) {
    const target = "series-" + Buffer.from(entry.series).toString("base64url");
    assert.ok(pages.get("entry-" + entry.slug + ".html").includes('href="series#' + target + '"'));
    assert.ok(directory.includes('id="' + target + '"'));
  }
});

test("photo metadata keeps accessible alt text and suppresses filenames and tracking URLs", () => {
  assert.equal(photoText("Blue ridges beneath a pale morning sky"), "Blue ridges beneath a pale morning sky");
  for (const value of ["IMG_1234.jpg", "250px Billie Jean Single.jpg utm source=en.wikipedia", "https://example.com/x", "sayan nath FWnbuCU8Axk unsplash"]) assert.equal(photoText(value), "");
  const clean = publicPhoto({ title: "IMG_1234.jpg", alt: "https://example.com/x" });
  assert.equal(clean.title, "Untitled photograph");
  assert.equal(clean.alt, "Photograph");
  assert.equal(publicPhoto({ title: "Misty hills", alt: "image.jpg" }, "Fog over a wooded ridge").alt, "Fog over a wooded ridge");
  const pages = renderPublicPages(template, { posts: [], photos: [{ ...photo, title: "bad.jpg", alt: "bad.jpg" }], images: new Map(), files: new Map() });
  assert.doesNotMatch(pages.get("photos.html"), /bad.jpg/);
});

test("published attachments become binary direct downloads without exposing credentials or draft files", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (address, options) => {
    calls.push(address);
    assert.equal(options.redirect, "error");
    if (address.includes("/storage/")) {
      assert.ok(address.endsWith("/" + imageId));
      assert.equal(options.headers.Authorization, "Bearer public");
      return new Response("Published PDF bytes");
    }
    if (address.includes("_posts?")) return Response.json([{ ...post, body: markdownMarker + '[Guide.pdf](attachment:' + imageId + ' "A guide")' }]);
    if (address.includes("_comments?")) return Response.json([]);
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
  const path = pageHref({ view: "archive", tag: "AI" });
  assert.match(pages.get(path + ".html"), /href="entry-first-entry"/);
  assert.ok(pages.get("entry-first-entry.html").includes('href="' + path + '">AI</a>'));
  const oldNotes = pageHref({ view: "archive", tag: "Notes" }, { filename: true });
  assert.match(pages.get(oldNotes), /url=notes"/);
  assert.doesNotMatch(pages.get("topics.html"), /Notes<span>/);
  assert.equal(pages.has(pageHref({ view: "archive", tag: "ai" }, { filename: true })), false);
});

test("new routes and legacy query links resolve to the same entries and filters", () => {
  for (const values of [{ post: "first-entry" }, { view: "notes" }, { view: "privacy" }, { view: "photo", photo: imageId }, { view: "photos", year: "2026", series: "A & B" }, { view: "review" }, { tag: "A & B", page: "2" }]) {
    const url = new URL(pageHref(values), "https://example.com/");
    assert.deepEqual(Object.fromEntries(pageParams(url.search, url.pathname)), values);
  }
  assert.equal(pageParams("?post=old-entry", "/").get("post"), "old-entry");
  assert.equal(pageParams("?view=archive&tag=Notes", "/").get("view"), "notes");
  assert.equal(pageParams("?view=photo-essays", "/").get("view"), "archive");
  assert.equal(pageParams("", "/collections.html").get("view"), "archive");
  assert.equal(pageHref({ post: "../../private" }), "./?post=..%2F..%2Fprivate");
  for (const name of ["../entry-a.html", "folio.html", "media-../x.jpg"]) assert.equal(generatedFile.test(name), false);
});

test("new publications use working query links until their HTML pages exist", async () => {
  const source = await readFile(new URL("./shared/page-url.js", import.meta.url), "utf8");
  const link = runInNewContext(source.replaceAll("export ", "") + "\npageHref", {
    URLSearchParams,
    document: { querySelector: () => ({ dataset: { files: "entry-first-entry.html photo-" + imageId + ".html" } }) },
  });
  assert.equal(link({ post: "first-entry" }), "entry-first-entry");
  assert.equal(link({ post: "just-published" }), "./?post=just-published");
  assert.equal(link({ view: "photo", photo: "cover" }), "./?view=photo&photo=cover");
  assert.equal(link({ view: "photo-essays" }), "archive");
});

test("RSS uses extensionless links without changing existing subscription identifiers", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json([post]));
  const feed = await renderFeed({ origin: "https://example.com", key: "public" });
  assert.match(feed, /<link>https:\/\/commonhours.qd.je\/entry-first-entry<\/link>/);
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
  for (const view of ["archive", "topics", "photos", "start", "series", "privacy", "terms", "collections", "photo-essays", "review", "https://bad.example"]) {
    const url = new URL("https://commonhours.qd.je/?view=" + encodeURIComponent(view) + "&year=2026#contact");
    let redirected;
    const location = { href: url.href, search: url.search, pathname: url.pathname, hash: url.hash, replace: address => { redirected = address; } };
    runInNewContext(script, { URL, URLSearchParams, location, document: { documentElement: { dataset: {}, classList: { add() {}, remove() {} } } } });
    assert.equal(redirected, ["review", "https://bad.example"].includes(view) ? undefined : "https://commonhours.qd.je/" + view + "?year=2026#contact");
  }
});

test("the build only reads public data, paginates, supports older schemas, and fails closed on API errors", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async address => {
    const url = new URL(address);
    calls.push(url);
    if (url.pathname.endsWith("_posts")) {
      assert.equal(url.searchParams.get("published"), "eq.true");
      if (url.searchParams.get("select").includes("is_note")) return Response.json({ code: "42703" }, { status: 400 });
      return Response.json(Number(url.searchParams.get("offset")) === 0 ? Array.from({ length: 100 }, (_, id) => ({ ...post, id, body: "Plain text" })) : [{ ...post, body: "Plain text" }]);
    }
    if (url.pathname.endsWith("_comments")) {
      assert.equal(url.searchParams.get("approved"), "eq.true");
      assert.equal(url.searchParams.get("select"), "post_id,display_name,body");
      return Response.json([{ post_id: post.id, display_name: "Reader", body: "Approved comments" }]);
    }
    return Response.json({ code: "PGRST205" }, { status: 404 });
  });
  const snapshot = await loadPublicSnapshot({ origin: "https://example.com", key: "public" });
  assert.equal(snapshot.posts.length, 101);
  assert.equal(snapshot.photos.length, 0);
  assert.equal(snapshot.comments.length, 1);
  assert.ok(calls.every(url => /_(posts|weekly_photos|photos|comments)$/.test(url.pathname)));
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "unavailable" }, { status: 503 }));
  await assert.rejects(loadPublicSnapshot({ origin: "https://example.com", key: "public" }), /Could not pre-render/);
});
