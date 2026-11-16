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
  assert.match(home, /aria-label="Photo of the Week" aria-busy="true"/);
  assert.match(home, /class="published-copy"/);
  assert.match(home, /data-refresh-pending=""/);
  assert.match(home, /data-skeleton="journal"/);
});

function carousel(get) {
  const attributes = new Map();
  const element = () => ({ hidden: false, textContent: "", addEventListener() {}, setAttribute() {}, contains: () => false });
  const picture = { ...element(), getAttribute: name => attributes.get(name), hasAttribute: name => attributes.has(name),
    set src(value) { attributes.set("src", value); } };
  const caption = element();
  const items = { img: picture, "#photo-caption": caption, "#slide-next": element(), "#slide-count": element(), ".slide": element() };
  const figure = { ...element(), querySelector: selector => items[selector], removeAttribute() {} };
  const source = photosSource.slice(photosSource.indexOf("async function featurePhotos"), photosSource.indexOf("\nfunction photoDate"));
  const run = runInNewContext(source.replace("export ", "") + "\nstartSlideshow", {
    document: { querySelector: () => figure, addEventListener() {}, hidden: false },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    publicData: async (key, fetch, age) => { assert.equal(age, 0); return fetch(); },
    publicPhoto: photo => photo,
    cover: { id: "cover", title: "Cover" }, archivePhotoWeek: "1900-01-01", weekOf: () => "2026-11-16",
    optional: async task => task, allRows: () => { throw new Error("Unexpected pagination"); }, weeklyFields: "id,week,media_id",
    getImage: async (_, photo) => ({ src: photo.id === "cover" ? "cover.jpg" : "live.jpg", width: 1200, height: 800 }),
    Image: class { async decode() {} }, clearTimeout() {}, setTimeout() {},
  });
  return { run: () => run(get, false), attributes, figure, caption };
}

test("hero stays a skeleton during a delayed request, then shows the real photo directly", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const view = carousel(path => {
    assert.match(path, /featured=eq\.true/);
    return pending;
  });
  const loading = view.run();
  assert.equal(view.attributes.has("src"), false);
  resolve([{ id: "real", week: "2026-11-16", featured: true, title: "Real photograph" }]);
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
});
