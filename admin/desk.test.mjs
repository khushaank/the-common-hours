import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("./editor-tools.js", import.meta.url), "utf8");
const deskSource = await readFile(new URL("./desk.js", import.meta.url), "utf8");
const statsSource = await readFile(new URL("./stats.js", import.meta.url), "utf8");

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

function editorTools(value, start = 0, end = value.length) {
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
    document: { querySelector: query, createElement: element }, Event,
    allowedImages: new Set(), readMediaImage() {},
  });
  const tools = setup(editor, () => {}, {}, () => []);
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
  const slash = editorTools("/list", 5, 5);
  slash.body.dispatchEvent(new Event("input"));
  slash.body.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(slash.body.value, "\n\n- List item\n\n");
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
  assert.deepEqual(names, ["list", "square", "numbered", "letters", "quote", "image", "library", "video", "file", "pdf", "link", "entry", "footnote", "divider"]);
  for (const name of ["heading", "bold", "italic"]) {
    const removed = editorTools("/" + name, name.length + 1, name.length + 1);
    removed.body.dispatchEvent(new Event("input"));
    assert.equal(removed.query("#command-menu").hidden, true);
  }
});

test("toolbar honors the body limit, passes selected link text, and exposes remaining tools", () => {
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
  menu.query(".format-tools").dispatchEvent({ type: "click", target: { closest: () => ({ id: "more-formats" }) } });
  assert.equal(menu.query("#command-menu").hidden, false);
  assert.ok(menu.query("#command-menu").children.some(button => button.dataset.command === "file"));
  assert.ok(menu.query("#command-menu").children.some(button => button.dataset.command === "image"));
  menu.query("#preview-mode").dispatchEvent(new Event("click"));
  assert.equal(menu.query("#write-panel").hidden, true);
  assert.equal(menu.query(".format-tools").hidden, true);
  assert.equal(menu.query("#write-mode").hidden, false);
  assert.equal(menu.query("#preview-mode").hidden, false);
  menu.tools.write();
  assert.equal(menu.query("#write-panel").hidden, false);
  assert.equal(menu.query(".format-tools").hidden, false);
  assert.equal(menu.query("#preview-mode").hidden, false);
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
  const render = runInNewContext(deskSource.slice(deskSource.indexOf("function renderPostList()"), deskSource.indexOf("\nconst tags =")) + "\nrenderPostList", {
    postList: list, search, entryFilter: filter, posts, current: "one",
    document: { querySelector: () => count, createElement: element },
  });
  list.scrollTop = 240;
  render();
  assert.equal(list.children.length, 3);
  assert.equal(list.scrollTop, 240);
  filter.value = "published";
  search.value = "QUIET";
  render();
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, "Market");
  assert.equal(count.textContent, "1 of 3 entries");
  filter.value = "draft";
  render();
  assert.equal(list.children[0].children[0].textContent, "Elephant");
  search.value = "Missing";
  render();
  assert.equal(list.children[0].textContent, "No matching entries.");
  assert.equal(count.textContent, "0 of 3 entries");
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

test("layout preserves all entry fields, previews, dialogs, and review controls", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  for (const name of ["title", "slug", "tag", "excerpt", "published_on", "series", "series_order", "start_here", "reader_prompt", "paired_photo", "collection", "collection_intro", "photo_essay", "body"]) {
    assert.ok(html.includes('name="' + name + '"'), name);
  }
  for (const id of ["write-mode", "preview-mode", "review-entry", "review-result", "reconnect-review", "insert-dialog", "entry-link-dialog", "library-dialog", "media-dialog"]) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(html, /<section[^>]+id="entry-details"/);
  assert.doesNotMatch(html, /<details[^>]+id="entry-details"/);
  for (const id of ["entries-panel", "compose-panel", "stats-panel", "comments-panel"]) assert.ok(html.includes('id="' + id + '" data-desk-panel'));
  for (const id of ["collapse-rail", "desk-logout"]) {
    const button = html.match(new RegExp('<button[^>]+id="' + id + '"[^>]*>[\\s\\S]*?</button>'))[0];
    assert.doesNotMatch(button, /nav-label/);
    assert.match(button, /aria-label=/);
  }
});

test("Dashboard, Entries, and the editor are separate screens with the correct navigation state", () => {
  const panels = ["stats", "entries", "compose", "comments"].map(name => ({ id: name + "-panel", hidden: true }));
  const nav = ["stats", "entries", "comments"].map(name => ({ dataset: { section: name }, setAttribute(key, value) { this[key] = value; } }));
  let writing;
  const show = runInNewContext(deskSource.slice(deskSource.indexOf("function showSection("), deskSource.indexOf("async function loadPrivacyRequests")) + "\nshowSection", {
    sections: nav, entryListScroll: 0, window: { scrollY: 240, scrollTo() {} }, document: { querySelector: () => panels[1], querySelectorAll: () => panels, body: { classList: { toggle(name, value) { writing = value; } } } },
  });
  for (const screen of ["stats", "entries", "compose", "entries", "comments"]) {
    show(screen);
    assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.id), [screen + "-panel"]);
    assert.equal(writing, screen === "compose");
    assert.equal(nav.find(button => button["aria-pressed"] === "true").dataset.section, screen === "compose" ? "entries" : screen);
  }
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
    showSection(value) { screen = value; }, editorTitle: { focus() { focused = true; } },
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
