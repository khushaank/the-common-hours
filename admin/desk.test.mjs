import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("./editor-tools.js", import.meta.url), "utf8");
const deskSource = await readFile(new URL("./desk.js", import.meta.url), "utf8");
const statsSource = await readFile(new URL("./stats.js", import.meta.url), "utf8");
const photosSource = await readFile(new URL("./photo-tools.js", import.meta.url), "utf8");

function element() {
  const listeners = new Map();
  return {
    value: "", textContent: "", hidden: false, scrollTop: 0, dataset: {}, style: {}, children: [], parentElement: { firstChild: {} },
    classList: { toggle() {} }, setAttribute() {}, focus() {}, scrollIntoView() {},
    addEventListener(type, listener) { listeners.set(type, [...listeners.get(type) || [], listener]); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; this.scrollTop = 0; },
    querySelector() { return this.children[0]; },
  };
}

function editorTools(value, start = 0, end = value.length, getReferences) {
  const nodes = new Map();
  const query = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const body = Object.assign(element(), {
    value, selectionStart: start, selectionEnd: end, maxLength: 99960,
    setRangeText(text, from, to) {
      this.value = this.value.slice(0, from) + text + this.value.slice(to);
      this.selectionStart = this.selectionEnd = from + text.length;
    },
    setSelectionRange(from, to) { this.selectionStart = from; this.selectionEnd = to; },
  });
  const editor = Object.assign(element(), { elements: { namedItem: name => name === "body" ? body : query(name) } });
  query("#insert-form").elements = { namedItem: query };
  query("#insert-form").reset = () => {};
  query("#insert-dialog").showModal = () => { query("#insert-dialog").open = true; };
  query("#entry-preview").hidden = true;
  const setup = runInNewContext(source.slice(source.indexOf("const markdownLabel")).replaceAll("export ", "") + "\nsetupEditorTools", {
    document: { querySelector: query, createElement: element }, Event, URL,
    allowedImages: new Set(), readMediaImage() {}, createVisualEditor: () => ({}), renderText() {},
  });
  const tools = setup(editor, () => {}, {}, () => [], getReferences);
  const format = key => query(".format-tools").dispatchEvent({ type: "click", target: { closest: () => ({ dataset: { format: key } }) } });
  return { body, query, tools, format };
}

test("toolbar formats only the selection and keeps slash command insertion working", () => {
  for (const [format, selected, result] of [
    ["bold", "some words", "**some words**"],
    ["italic", "some words", "*some words*"],
    ["quote", "First\nSecond", "> First\n> Second"],
    ["list", "First\nSecond", "- First\n- Second"],
    ["numbered", "First\nSecond", "1. First\n2. Second"],
  ]) {
    const view = editorTools("Before " + selected + " after", 7, 7 + selected.length);
    view.format(format);
    const formatted = ["bold", "italic"].includes(format) ? result : "\n\n" + result + "\n\n";
    assert.equal(view.body.value, "Before " + formatted + " after");
  }
  const empty = editorTools("", 0, 0);
  empty.format("bold");
  assert.equal(empty.body.value, "**Bold text**");
  const slash = editorTools("/footnote", 9, 9);
  slash.body.dispatchEvent(new Event("input"));
  slash.body.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(slash.body.value, "^[Footnote text]");
});

test("heading dropdown changes complete lines, replaces existing headings, and restores paragraphs", () => {
  const view = editorTools("Before\n## A heading\nAfter", 12, 15);
  const dropdown = view.query("#block-format");
  dropdown.value = "3";
  dropdown.dispatchEvent(new Event("change"));
  assert.equal(view.body.value, "Before\n### A heading\nAfter");
  assert.equal(dropdown.value, "3");
  dropdown.value = "";
  dropdown.dispatchEvent(new Event("change"));
  assert.equal(view.body.value, "Before\nA heading\nAfter");
  const multiple = editorTools("First\nSecond\nAfter", 0, 13);
  multiple.query("#block-format").value = "2";
  multiple.query("#block-format").dispatchEvent(new Event("change"));
  assert.equal(multiple.body.value, "## First\n## Second\nAfter");
  let prevented = false;
  view.query(".format-tools").dispatchEvent({ type: "mousedown", target: { closest: () => dropdown }, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

test("slash menu omits toolbar formatting and retains every other insert command", () => {
  const view = editorTools("/", 1, 1);
  view.body.dispatchEvent(new Event("input"));
  const names = Array.from(view.query("#command-menu").children, button => button.dataset.command);
  assert.deepEqual(names, ["image", "file", "pdf", "entry", "footnote"]);
  for (const name of ["heading", "bold", "italic", "list", "numbered", "quote", "library", "video", "divider"]) {
    const removed = editorTools("/" + name, name.length + 1, name.length + 1);
    removed.body.dispatchEvent(new Event("input"));
    assert.equal(removed.query("#command-menu").hidden, true);
  }
});

test("toolbar honors the body limit, passes selected link text, and opens the file picker", () => {
  const view = editorTools("A link");
  view.format("link");
  assert.equal(view.query("#insert-dialog").open, true);
  assert.equal(view.query("label").value, "A link");
  const full = editorTools("12345");
  full.body.maxLength = 5;
  full.format("bold");
  assert.equal(full.body.value, "12345");
  assert.match(full.query("#status").textContent, /length limit/);
  const menu = editorTools("");
  let picked = false;
  menu.query("#entry-file").click = () => { picked = true; };
  menu.query(".format-tools").dispatchEvent({ type: "click", target: { closest: () => ({ id: "more-formats" }) } });
  assert.equal(menu.query("#command-menu").hidden, true);
  assert.equal(picked, true);
  menu.query("#preview-mode").dispatchEvent(new Event("click"));
  assert.equal(menu.query("#write-panel").hidden, true);
  assert.equal(menu.query(".format-tools").hidden, false);
  assert.equal(menu.query("#write-mode").hidden, false);
  assert.equal(menu.query("#preview-mode").hidden, false);
  menu.query("#write-mode").dispatchEvent(new Event("click"));
  assert.equal(menu.query("#write-panel").hidden, false);
  assert.equal(menu.query(".format-tools").hidden, false);
  assert.equal(menu.query("#preview-mode").hidden, false);
});

test("an @ shortcut inserts the saved label and URL at the caret", () => {
  const view = editorTools("See @HAR", 8, 8, () => [{ alias: "harvey", label: "Harvey", url: "https://example.test/harvey" }]);
  view.body.dispatchEvent(new Event("input"));
  assert.equal(view.query("#command-menu").children[0].dataset.command, "@harvey");
  view.body.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(view.body.value, "See [Harvey](<https://example.test/harvey>)");
});

test("entry status filter combines with title and tag search without changing the source order", () => {
  const list = element();
  const count = element();
  const search = { value: "" };
  const filter = { value: "all" };
  const posts = [
    { id: "one", title: "Market", tag: "Quiet pages", published: true, published_on: "2026-11-13" },
    { id: "two", title: "Elephant", tag: "Quiet pages", published: false, published_on: "2026-11-12" },
    { id: "three", title: "Footbridge", tag: "Walking", published: true, published_on: "2026-11-11" },
  ];
  const draft = { id: "draft:one", slot: "one", source: posts[0], title: "Untitled", slug: "market", tag: "Quiet pages", published: false, published_on: "2026-11-16" };
  const render = runInNewContext(deskSource.slice(deskSource.indexOf("function renderPostList()"), deskSource.indexOf("\nasync function deleteEntry")) + "\nrenderPostList", {
    postList: list, search, entryFilter: filter, posts, drafts: [draft], draftEntry: row => row, current: "one",
    document: { querySelector: () => count, createElement: element },
  });
  list.scrollTop = 240;
  render();
  assert.equal(list.children.length, 4);
  assert.equal(list.children[0].children[1].textContent, "Untitled");
  assert.equal(list.scrollTop, 240);
  filter.value = "published";
  search.value = "QUIET";
  render();
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, "1.");
  assert.equal(list.children[0].children[1].textContent, "Market");
  assert.equal(count.textContent, "1 of 4 entries");
  filter.value = "draft";
  render();
  assert.deepEqual(Array.from(list.children, row => row.children[1].textContent), ["Untitled", "Elephant"]);
  search.value = "Missing";
  render();
  assert.equal(list.children[0].textContent, "No matching entries.");
  assert.equal(count.textContent, "0 of 4 entries");
  assert.deepEqual(posts.map(post => post.id), ["one", "two", "three"]);
});

test("sidebar collapse switches to icons and offers expansion", () => {
  const button = element();
  const attributes = new Map();
  button.setAttribute = (name, value) => attributes.set(name, value);
  const classes = new Set();
  runInNewContext(deskSource.slice(deskSource.indexOf("const collapseRail ="), deskSource.indexOf('document.querySelector("#back-entries")')), {
    document: { querySelector: () => button, body: { classList: { toggle(name) {
      if (classes.has(name)) { classes.delete(name); return false; }
      classes.add(name); return true;
    } } } },
  });
  button.dispatchEvent(new Event("click"));
  assert.equal(attributes.get("aria-expanded"), "false");
  assert.equal(attributes.get("aria-label"), "Expand sidebar");
  button.dispatchEvent(new Event("click"));
  assert.equal(attributes.get("aria-expanded"), "true");
  assert.equal(classes.size, 0);
});

test("layout keeps publishing settings opt-in and exposes one draft action", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  for (const name of ["title", "slug", "tag", "excerpt", "published_on", "series", "series_order", "start_here", "reader_prompt", "paired_photo", "collection", "collection_intro", "photo_essay", "body"]) {
    assert.ok(html.includes('name="' + name + '"'), name);
  }
  for (const id of ["write-mode", "preview-mode", "entry-actions", "insert-dialog", "entry-link-dialog", "library-dialog", "media-dialog"]) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(html, /<section[^>]+id="entry-details"[^>]+hidden>/);
  assert.equal(html.match(/value="draft" formnovalidate/g).length, 1);
  assert.match(html, /id="entry-actions"[^>]*>[\s\S]*?id="preview-mode" aria-pressed="true"[\s\S]*?id="edit-entry-settings"/);
  assert.match(html, /id="entry-heading">Untitled<\/span><button[^>]+id="edit-entry-title"/);
  assert.match(html, /<textarea[^>]+id="editor-title"[^>]+hidden/);
  assert.match(html, /id="preview-body" contenteditable="true"/);
  for (const id of ["entries-panel", "compose-panel", "stats-panel", "comments-panel"]) assert.ok(html.includes('id="' + id + '" data-desk-panel'));
  for (const id of ["collapse-rail", "desk-logout"]) {
    const button = html.match(new RegExp('<button[^>]+id="' + id + '"[^>]*>[\\s\\S]*?</button>'))[0];
    if (id === "desk-logout") assert.match(button, /nav-label/);
    assert.match(button, /aria-label=/);
  }
});

test("a published entry can be copied to a draft and a saved draft is private by default", () => {
  const draftButton = element();
  const publishButton = element();
  const context = { activePost: { published: true }, activeDraft: undefined, dirty: () => false,
    draftButton, publishButton, shareButton: element(), busy: false };
  const update = runInNewContext(deskSource.slice(deskSource.indexOf("function updatePublishActions("), deskSource.indexOf("function readBackup(")) + "\nupdatePublishActions", context);
  update();
  assert.equal(publishButton.hidden, true);
  assert.equal(draftButton.disabled, false);
  context.dirty = () => true;
  update();
  assert.equal(publishButton.textContent, "Update published entry");
  assert.equal(draftButton.disabled, false);
  assert.equal(draftButton.textContent, "Save draft");
  context.activePost = undefined;
  context.activeDraft = { source: { published: true } };
  context.dirty = () => false;
  update();
  assert.equal(draftButton.disabled, true);
  assert.equal(draftButton.textContent, "Draft saved");
  assert.equal(publishButton.hidden, false);
  context.activeDraft = undefined;
  update();
  assert.equal(publishButton.textContent, "Publish");
});

test("publish validation reports each invalid field and accepts a blank generated excerpt", () => {
  const validate = runInNewContext(deskSource.slice(deskSource.indexOf("function validateEntry("), deskSource.indexOf('editor.addEventListener("submit"')) + "\nvalidateEntry", {
    entryTags: value => value.split(",").map(tag => tag.trim()), mediaId: /^valid$/,
  });
  const invalid = { title: "", body: "", tag: "", published_on: "", slug: "bad slug", collection_intro: "Introduction", collection: "" };
  assert.deepEqual([...validate(invalid).keys()], ["title", "body", "tag", "published_on", "slug", "collection"]);
  assert.equal(validate({ title: "A title", body: "Body", tag: "Notes, AI", published_on: "2026-11-23", slug: "a-title", excerpt: "" }).size, 0);
});

test("Dashboard, Entries, and the editor are separate screens with the correct navigation state", () => {
  const panels = ["stats", "entries", "compose", "comments"].map(name => ({ id: name + "-panel", hidden: true }));
  const nav = ["stats", "entries", "comments"].map(name => ({ dataset: { section: name }, setAttribute(key, value) { this[key] = value; } }));
  let writing;
  const show = runInNewContext(deskSource.slice(deskSource.indexOf("function showSection("), deskSource.indexOf("async function loadPrivacyRequests")) + "\nshowSection", {
    sections: nav, entryListScroll: 0, updateDeskAddress() {}, window: { scrollY: 240, scrollTo() {} }, document: { querySelector: () => panels[1], querySelectorAll: () => panels, body: { classList: { toggle(name, value) { writing = value; } } } },
  });
  for (const screen of ["stats", "entries", "compose", "entries", "comments"]) {
    show(screen);
    assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.id), [screen + "-panel"]);
    assert.equal(writing, screen === "compose");
    assert.equal(nav.find(button => button["aria-pressed"] === "true").dataset.section, screen === "compose" ? "entries" : screen);
  }
});

test("section links retain their screen on refresh and preserve private draft addresses", () => {
  const sections = ["stats", "entries", "site", "media", "references", "comments", "inbox"].map(section => ({ dataset: { section } }));
  const location = new URL("https://example.test/desk/");
  const navigations = [];
  const history = {
    pushState(_, __, url) { navigations.push("push"); location.href = url.href; },
    replaceState(_, __, url) { navigations.push("replace"); location.href = url.href; },
  };
  const routes = runInNewContext(deskSource.slice(deskSource.indexOf("function sectionHash("), deskSource.indexOf("function showSection(")) +
    "\n({ deskSection, requestedDraft, updateDeskAddress })", { sections, location, history, URL, URLSearchParams,
      activeDraft: { slot: "draft-id", slug: "my-post" } });
  assert.equal(routes.deskSection(), "stats");
  routes.updateDeskAddress("stats");
  assert.equal(location.hash, "#dashboard");
  for (const [section, hash] of [["media", "#media"], ["site", "#photos"], ["inbox", "#inbox"]]) {
    routes.updateDeskAddress(section, true);
    assert.equal(location.hash, hash);
    assert.equal(routes.deskSection(), section);
  }
  routes.updateDeskAddress("compose");
  assert.match(location.href, /\?draft=draft-id&post=my-post\/draft#entries$/);
  assert.equal(routes.requestedDraft(routes.deskSection()), "draft-id");
  routes.updateDeskAddress("media", true);
  assert.equal(location.search, "");
  assert.equal(routes.requestedDraft("media"), null);
  assert.deepEqual(navigations, ["replace", "push", "push", "push", "replace", "push"]);
});

test("reopening the selected entry shows its editor without resetting unsaved content", async () => {
  let screen;
  let pending;
  let requests = 0;
  let focused = false;
  const edit = runInNewContext(deskSource.slice(deskSource.indexOf("function editEntry("), deskSource.indexOf("const tags =")) + "\neditEntry", {
    busy: false, current: "one", canLeaveDraft: () => true,
    run(button, action) { pending = Promise.resolve().then(action); return pending; },
    api() { requests++; throw new Error("The selected entry must stay in memory"); },
    showSection(value) { screen = value; }, editTitle: { focus() { focused = true; } },
  });
  edit({ id: "one" }, element());
  await pending;
  assert.equal(screen, "compose");
  assert.equal(requests, 0);
  assert.equal(focused, true);
});

test("publishing recency uses published dates, ignores future entries, and handles no publications", () => {
  const summary = runInNewContext(statsSource.slice(statsSource.indexOf("export function publishingSummary"), statsSource.indexOf("export function setupStats")).replaceAll("export ", "") + "\npublishingSummary");
  const posts = [{ id: "old", published: true, published_on: "2026-11-01" }, { id: "draft", published: false, published_on: "2026-11-16" },
    { id: "last", published: true, published_on: "2026-11-13" }, { id: "future", published: true, published_on: "2026-12-01" }];
  assert.equal(summary(posts, "2026-11-16").last.id, "last");
  assert.equal(summary(posts, "2026-11-16").days, 3);
  assert.equal(summary(posts, "2026-11-13").days, 0);
  assert.equal(summary([], "2026-11-16").days, null);
  assert.deepEqual(posts.map(post => post.id), ["old", "draft", "last", "future"]);
});

test("Dashboard sums daily page views for the busiest day without requesting hourly data", async () => {
  const nodes = new Map();
  const query = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  query("#stats-period").value = "30";
  query("#stats-report").querySelector = () => query("chart");
  const paths = [];
  const setup = runInNewContext(statsSource.replace(/^import[^\n]+\n/, "").replaceAll("export ", "") + "\nsetupStats", {
    document: { querySelector: query, createElement: element }, journalToday: () => "2026-11-16", escape: value => value,
    allRows: (api, path) => api(path), missingFeature: () => false,
  });
  const stats = setup(async path => {
    paths.push(path);
    return [{ day: "2026-11-15", page: "journal", views: 4, visits: 2 }, { day: "2026-11-15", page: "post/one", views: 7, visits: 3 },
      { day: "2026-11-14", page: "journal", views: 5, visits: 2 }];
  }, () => [{ id: "one", title: "Market", published: true, published_on: "2026-11-13" }], () => {});
  await stats.load();
  assert.equal(query("#last-published-entry").textContent, "Market");
  assert.equal(query("#publishing-age").textContent, "3");
  assert.equal(query("#active-day-note").textContent, "11 page views");
  assert.match(query("#active-day").textContent, /15/);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^traffic\?/);
});

test("Comments includes published and pending comments and filters them independently of Inbox", async () => {
  const comments = element();
  const filter = { value: "all" };
  const rows = [{ id: "a", display_name: "A reader", approved: true, body: "Published comment", post_id: "one" },
    { id: "b", display_name: "Another reader", approved: false, body: "Pending comment", post_id: "one" }];
  const load = runInNewContext(deskSource.slice(deskSource.indexOf("async function loadComments("), deskSource.indexOf("async function openDesk(")) + "\nloadComments", {
    comments, commentsRevision: 0, posts: [{ id: "one", title: "Market" }], api() {},
    allRows: async (_, path) => rows.filter(row => !path.includes("&approved=") || row.approved === path.includes("&approved=eq.true")),
    document: { querySelector: () => filter, createElement: element },
  });
  await load();
  assert.equal(comments.children.length, 2);
  assert.match(comments.children[0].children[1].textContent, /^Published/);
  filter.value = "published";
  await load();
  assert.equal(comments.children.length, 1);
  assert.equal(comments.children[0].children[2].textContent, "Published comment");
  filter.value = "pending";
  await load();
  assert.equal(comments.children[0].children[2].textContent, "Pending comment");
});

test("weekly photos can be removed from the slideshow without touching media", async () => {
  const nodes = new Map();
  function photoNode(tagName) {
    const node = element();
    const listeners = new Map();
    node.tagName = tagName;
    node.addEventListener = (type, handler) => listeners.set(type, handler);
    node.fire = type => listeners.get(type)?.({ preventDefault() {} });
    node.removeAttribute = () => {};
    node.querySelectorAll = () => node.children.flatMap(item => item.children).filter(item => item.tagName === "button");
    node.parentElement = { setAttribute() {}, removeAttribute() {} };
    return node;
  }
  const query = selector => { if (!nodes.has(selector)) nodes.set(selector, photoNode()); return nodes.get(selector); };
  const form = query("#photo-form");
  form.elements = { namedItem: query };
  form.reset = () => {};
  query("files").files = [];
  const paths = [];
  let saved;
  const photo = { id: "photo", media_id: "media", title: "A real photograph", alt: "Trees by the river", description: "", week: "2026-11-09", featured: true };
  const setup = runInNewContext(photosSource.replace(/^import[^\n]+\n/gm, "").replaceAll("export ", "") + "\nsetupPhotoTools", {
    document: { querySelector: query, createElement: photoNode }, window: {}, confirm: () => true,
    archivePhotoWeek: "1900-01-01", weekOf: () => "2026-11-16", journalToday: () => "2026-11-16",
    allRows: (api, path) => api(path), loadImage: async () => null, imageSource: () => "", photoText: () => true,
    missingColumn: () => false, missingFeature: () => false,
    FormData: class { get(name) { return query(name).value; } has(name) { return Boolean(query(name).checked); } },
  });
  const tools = setup(async (path, options) => {
    paths.push(path);
    if (options?.method === "PATCH") { saved = options.body; return [{ ...photo, ...saved }]; }
    return [photo];
  });
  await tools.loadPhoto();
  assert.match(paths[0], /week=eq\.2026-11-16&featured=eq\.true/);
  query("#weekly-photos").children[0].children[0].fire("click");
  await form.fire("submit");
  assert.equal(saved.featured, undefined);
  query("#remove-week-photo").fire("click");
  assert.match(paths.at(-1), /weekly_photos\?.*&id=eq\.photo/);
  assert.equal(saved.featured, false);
  assert.ok(paths.every(path => path.startsWith("weekly_photos?")));
});
