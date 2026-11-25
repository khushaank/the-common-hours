import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { renderPublicPages } from "./prerender.mjs";
import { photoTitle } from "./shared/photo-text.js";

const template = await readFile(new URL("./blog/index.html", import.meta.url), "utf8");
const photosSource = await readFile(new URL("./blog/photos.js", import.meta.url), "utf8");

test("prebuilt pages render readable content without a page preloader or fallback hero", () => {
  const pages = renderPublicPages(template, { posts: [], photos: [], images: new Map(), files: new Map() });
  const home = pages.get("index.html");
  assert.doesNotMatch(home, /src="cover\.jpg"/);
  assert.match(home, /aria-label="Featured Photo" aria-busy="true" hidden/);
  assert.match(home, /class="published-copy"/);
  assert.doesNotMatch(home, /data-refresh-pending=""/);
  assert.doesNotMatch(home, /id="script-notice"/);
  assert.match(home, /id="site-notice"[^>]*hidden/);
  assert.match(home, /<noscript><dialog[^>]+open[^>]+JavaScript unavailable/);
  assert.doesNotMatch(home, /data-skeleton=/);
});

test("the featured photo and footer navigation are available in the initial homepage HTML", () => {
  const featured = {
    first: { title: "Lake & mist", alt: "A quiet lake" }, width: 1000, height: 600, version: "0123456789abcdef",
    markup: '<template id="featured-snapshot"></template>',
  };
  const pages = renderPublicPages(template, { posts: [], photos: [], images: new Map(), files: new Map() }, featured);
  assert.match(pages.get("index.html"), /aria-label="Featured Photo">[\s\S]+src="featured\.webp\?v=0123456789abcdef" width="1000" height="600"/);
  assert.match(pages.get("index.html"), /id="photo-caption">Lake &amp; mist/);
  const untitled = renderPublicPages(template, { posts: [], photos: [], images: new Map(), files: new Map() },
    { ...featured, first: { ...featured.first, title: "Unnamed photo" } }).get("index.html");
  assert.match(untitled, /id="photo-caption" aria-busy="true"><\/span>/);
  assert.doesNotMatch(untitled, /Unnamed photo|Untitled photograph/);
  for (const file of ["index.html", "archive.html"]) {
    const html = pages.get(file);
    const footer = html.match(/<footer class="site-footer">[\s\S]+?<\/footer>/)[0];
    assert.match(footer, /class="back-to-top" href="#top"/);
    assert.doesNotMatch(footer, /<(?:img|picture)\b/);
    assert.doesNotMatch(html.match(/<header[\s\S]+?<\/header>/)[0], /Featured Photo|#featured-photo/);
  }
  assert.doesNotMatch(pages.get("archive.html"), /featured\.webp|id="featured-snapshot"/);
});

function carousel(get, reducedMotion = true) {
  const attributes = new Map();
  let advance;
  const element = () => {
    const handlers = new Map();
    const attrs = new Map();
    return {
      hidden: false, textContent: "", addEventListener: (key, handler) => handlers.set(key, handler),
      dispatch: (key, event) => handlers.get(key)(event), setAttribute: (key, val) => attrs.set(key, val),
      getAttribute: key => attrs.get(key),
      removeAttribute: key => attrs.delete(key), hasAttribute: key => attrs.has(key),
      toggleAttribute: key => attrs.has(key) ? attrs.delete(key) : attrs.set(key, ""),
      setPointerCapture() {}, contains: () => false,
    };
  };
  const picture = { ...element(), getAttribute: name => attributes.get(name), hasAttribute: name => attributes.has(name),
    set src(value) { attributes.set("src", value); } };
  const caption = { ...element(), busy: false, setAttribute() { this.busy = true; }, removeAttribute() { this.busy = false; } };
  const status = element();
  const items = { img: picture, "#photo-caption": caption, "#slide-next": element(), "#slide-count": element(), ".slide": element() };
  const figure = { ...element(), hidden: true, querySelector: selector => items[selector], removeAttribute() {} };
  const source = photosSource.slice(photosSource.indexOf("async function optional"), photosSource.indexOf("\nasync function getImage")) +
    photosSource.slice(photosSource.indexOf("async function featurePhotos"), photosSource.indexOf("\nfunction photoDate"));
  const run = runInNewContext(source.replace("export ", "") + "\nstartSlideshow", {
    document: { querySelector: selector => selector === "#featured-photo-status" ? status : figure, addEventListener() {}, hidden: false },
    matchMedia: () => ({ matches: reducedMotion, addEventListener() {} }),
    publicData: () => { throw new Error("The featured list must not reuse a cached fallback"); },
    publicPhoto: photo => photo,
    photoTitle,
    showFailure(element, message, retry) { element.textContent = message; element.retry = retry; },
    cover: { id: "cover", title: "Cover" },
    allRows: (get, path) => get(path), weeklyFields: "id,week,media_id",
    getImage: async (_, photo) => ({ src: photo.id === "cover" ? "cover.jpg" : "live.jpg", width: 1200, height: 800 }),
    Image: class { async decode() {} }, clearTimeout() {}, setTimeout(callback) { advance = callback; },
  });
  return { run: () => run(get, false), attributes, figure, caption, status, slide: items[".slide"], arrow: items["#slide-next"],
    advance: () => advance() };
}

test("the featured slideshow loops through the next button, keyboard, and autoplay", async () => {
  const view = carousel(async () => [{ id: "first", title: "First" }, { id: "second", title: "Second" }], false);
  await view.run();
  const step = async action => {
    action();
    await new Promise(resolve => setImmediate(resolve));
  };
  await step(() => view.slide.dispatch("keydown", { key: "ArrowLeft", preventDefault() {} }));
  assert.equal(view.caption.textContent, "Second");
  await step(() => view.arrow.dispatch("click"));
  assert.equal(view.caption.textContent, "First");
  await step(view.advance);
  assert.equal(view.caption.textContent, "Second");
  await step(view.advance);
  assert.equal(view.caption.textContent, "First");
  assert.doesNotMatch(template, /id="slide-previous"/);
});

test("tapping the featured photo reveals the next arrow without changing the photo", async () => {
  const view = carousel(async () => [{ id: "first", title: "First" }, { id: "second", title: "Second" }]);
  await view.run();
  assert.equal(view.slide.hasAttribute("data-controls-open"), false);
  const tap = { pointerId: 1, pointerType: "touch", clientX: 40, clientY: 80 };
  view.slide.dispatch("pointerdown", { ...tap, button: 0, isPrimary: true, target: { closest: () => null } });
  view.slide.dispatch("pointerup", tap);
  assert.equal(view.slide.hasAttribute("data-controls-open"), true);
  assert.equal(view.arrow.hidden, false);
  assert.equal(view.caption.textContent, "First");
});

test("startup notices appear on script failure but stay hidden on a saved page", async () => {
  const code = await readFile(new URL("./blog/boot.js", import.meta.url), "utf8");
  const handlers = new Map();
  const listen = prefix => (name, handler) => handlers.set(prefix + name, handler);
  const label = {};
  const notice = { hidden: true, querySelector: selector => selector === "p" ? label : { addEventListener: listen("close:") } };
  runInNewContext(code, {
    navigator: { onLine: false }, window: { addEventListener: listen("window:") },
    document: { querySelector: selector => selector === "#site-notice" ? notice : { addEventListener: listen("script:") },
      documentElement: { hasAttribute: name => name === "data-offline-copy" } },
  });
  assert.equal(notice.hidden, true);
  assert.equal(handlers.has("window:offline"), false);
  handlers.get("window:error")({ target: { id: "journal-start" } });
  assert.equal(notice.hidden, false);
  assert.match(label.textContent, /JavaScript could not load/);
  handlers.get("close:click")();
  assert.equal(notice.hidden, true);
});

test("hero stays hidden during a delayed request, then shows the decoded photo directly", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const view = carousel(path => {
    assert.match(path, /week=is\.null&featured=eq\.true/);
    return pending;
  });
  const loading = view.run();
  assert.equal(view.attributes.has("src"), false);
  assert.equal(view.figure.hidden, true);
  assert.equal(view.caption.busy, true);
  resolve([{ id: "real", week: null, title: "Real photograph" }]);
  await loading;
  assert.equal(view.attributes.get("src"), "live.jpg");
  assert.equal(view.figure.hidden, false);
  assert.equal(view.caption.textContent, "Real photograph");
  assert.equal(view.caption.busy, false);
});

test("cover is used only after a successful empty result, never a request error", async () => {
  const empty = carousel(async () => []);
  await empty.run();
  assert.equal(empty.attributes.get("src"), "cover.jpg");
  let attempts = 0;
  const failed = carousel(async () => {
    if (!attempts++) throw new Error("Network unavailable");
    return [{ id: "new", title: "The Mountain" }];
  });
  await failed.run();
  assert.equal(failed.attributes.has("src"), false);
  assert.equal(failed.figure.hidden, true);
  assert.match(failed.status.textContent, /Featured photos could not load/);
  assert.equal(failed.caption.busy, false);
  await failed.status.retry();
  assert.equal(failed.caption.textContent, "The Mountain");
  const unavailable = carousel(async () => { throw Object.assign(new Error("Table unavailable"), { code: "PGRST205" }); });
  await unavailable.run();
  assert.equal(unavailable.attributes.has("src"), false);
  assert.match(unavailable.status.textContent, /Featured photos could not load/);
});

test("photo media is refreshed before display, and deleted media is not replaced with a cover", async () => {
  const source = photosSource.slice(photosSource.indexOf("async function getImage"), photosSource.indexOf("\nasync function featurePhotos"));
  let record = { src: "current.jpg", width: 800, height: 600 };
  let snapshot = { first: { id: "photo", media_id: "media" }, version: "not-a-content-hash", width: 800, height: 600 };
  const getImage = runInNewContext(source + "\ngetImage", {
    cover: { id: "cover" }, document: { querySelector: () => ({ dataset: { value: JSON.stringify(snapshot) } }) },
    publicData: async (key, fetch, age) => { assert.equal(age, 0); return fetch(); },
    readMediaImage: async () => record, imageSource: image => image?.src,
  });
  const photo = { id: "photo", media_id: "media" };
  assert.equal((await getImage(null, photo)).src, "current.jpg");
  snapshot.version = "0123456789abcdef";
  assert.equal((await getImage(null, photo)).src, "featured.webp?v=0123456789abcdef");
  snapshot = null;
  record = undefined;
  await assert.rejects(getImage(null, photo), /Photo unavailable/);
});
