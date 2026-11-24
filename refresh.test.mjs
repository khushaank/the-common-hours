import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { renderPublicPages } from "./prerender.mjs";

const template = await readFile(new URL("./blog/index.html", import.meta.url), "utf8");
const photosSource = await readFile(new URL("./blog/photos.js", import.meta.url), "utf8");

test("prebuilt pages keep readable copies and skeletons without painting the fallback hero", () => {
  const pages = renderPublicPages(template, { posts: [], photos: [], images: new Map(), files: new Map() });
  const home = pages.get("index.html");
  assert.doesNotMatch(home, /src="cover\.jpg"/);
  assert.match(home, /aria-label="Featured Photo" aria-busy="true" hidden/);
  assert.match(home, /class="published-copy"/);
  assert.doesNotMatch(home, /data-refresh-pending=""/);
  assert.match(home, /id="script-notice">JavaScript is unavailable/);
  assert.match(home, /data-skeleton="journal"/);
});

test("a built featured photo and footer are available in the initial homepage HTML", () => {
  const featured = {
    first: { title: "Lake & mist", alt: "A quiet lake" }, width: 1000, height: 600, version: "0123456789abcdef",
    markup: '<template id="featured-snapshot"></template>',
  };
  const pages = renderPublicPages(template, { posts: [], photos: [], images: new Map(), files: new Map() }, featured);
  assert.match(pages.get("index.html"), /aria-label="Featured Photo">[\s\S]+src="featured\.webp\?v=0123456789abcdef" width="1000" height="600"/);
  assert.match(pages.get("index.html"), /id="photo-caption">Lake &amp; mist/);
  for (const file of ["index.html", "archive.html"]) {
    const html = pages.get(file);
    assert.match(html, /<footer class="site-footer">\s*<img class="footer-landscape" src="footer-landscape\.jpg"[^>]*>[\s\S]+class="back-to-top" href="#top"/);
    assert.doesNotMatch(html.match(/<header[\s\S]+?<\/header>/)[0], /Featured Photo|#featured-photo/);
  }
  assert.doesNotMatch(pages.get("archive.html"), /featured\.webp|id="featured-snapshot"/);
});

function carousel(get) {
  const attributes = new Map();
  const element = () => ({ hidden: false, textContent: "", addEventListener() {}, setAttribute() {}, contains: () => false });
  const picture = { ...element(), getAttribute: name => attributes.get(name), hasAttribute: name => attributes.has(name),
    set src(value) { attributes.set("src", value); } };
  const caption = element();
  const items = { img: picture, "#photo-caption": caption, "#slide-next": element(), "#slide-count": element(), ".slide": element() };
  const figure = { ...element(), querySelector: selector => items[selector], removeAttribute() {} };
  const source = photosSource.slice(photosSource.indexOf("async function optional"), photosSource.indexOf("\nasync function getImage")) +
    photosSource.slice(photosSource.indexOf("async function featurePhotos"), photosSource.indexOf("\nfunction photoDate"));
  const run = runInNewContext(source.replace("export ", "") + "\nstartSlideshow", {
    document: { querySelector: () => figure, addEventListener() {}, hidden: false },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    publicData: () => { throw new Error("The featured list must not reuse a cached fallback"); },
    publicPhoto: photo => photo,
    cover: { id: "cover", title: "Cover" },
    allRows: (get, path) => get(path), weeklyFields: "id,week,media_id",
    getImage: async (_, photo) => ({ src: photo.id === "cover" ? "cover.jpg" : "live.jpg", width: 1200, height: 800 }),
    Image: class { async decode() {} }, clearTimeout() {}, setTimeout() {},
  });
  return { run: () => run(get, false), attributes, figure, caption };
}

test("hero stays a skeleton during a delayed request, then shows the real photo directly", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const view = carousel(path => {
    assert.match(path, /week=is\.null&featured=eq\.true/);
    return pending;
  });
  const loading = view.run();
  assert.equal(view.attributes.has("src"), false);
  resolve([{ id: "real", week: null, title: "Real photograph" }]);
  await loading;
  assert.equal(view.attributes.get("src"), "live.jpg");
  assert.equal(view.caption.textContent, "Real photograph");
});

test("cover is used only after a successful empty result, never a request error", async () => {
  const empty = carousel(async () => []);
  await empty.run();
  assert.equal(empty.attributes.get("src"), "cover.jpg");
  const failed = carousel(async () => { throw new Error("Network unavailable"); });
  await failed.run();
  assert.equal(failed.attributes.has("src"), false);
  assert.equal(failed.figure.hidden, false);
  assert.match(failed.caption.textContent, /Photo could not load/);
  const unavailable = carousel(async () => { throw Object.assign(new Error("Table unavailable"), { code: "PGRST205" }); });
  await unavailable.run();
  assert.equal(unavailable.attributes.has("src"), false);
  assert.match(unavailable.caption.textContent, /Photo could not load/);
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
