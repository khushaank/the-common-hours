import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { noteReferenceLimit, readNote, writeNote } from "../shared/note.js";

const source = await readFile(new URL("./editor-tools.js", import.meta.url), "utf8");
const deskSource = await readFile(new URL("./desk.js", import.meta.url), "utf8");
const statsSource = await readFile(new URL("./stats.js", import.meta.url), "utf8");
const photosSource = await readFile(new URL("./photo-tools.js", import.meta.url), "utf8");

function element() {
  const listeners = new Map();
  return {
    value: "", textContent: "", hidden: false, scrollTop: 0, dataset: {}, style: {}, children: [], parentElement: { firstChild: {} },
    classList: { toggle() {}, add() {} }, setAttribute() {}, removeAttribute() {}, focus() {}, scrollIntoView() {},
    addEventListener(type, listener) { listeners.set(type, [...listeners.get(type) || [], listener]); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; this.scrollTop = 0; },
    querySelector() { return this.children[0]; },
    contains(child) { return this.children.includes(child); },
  };
}

function editorTools(value, start = 0, end = value.length, getReferences, getEntries = () => [], openLibrary, attachments = {}) {
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
  editor.toggleAttribute = () => {};
  query("#insert-form").elements = { namedItem: query };
  query("#insert-form").reset = () => {};
  query("#insert-dialog").showModal = () => { query("#insert-dialog").open = true; };
  query("#entry-preview").hidden = true;
  const editorSource = source.slice(source.indexOf("const markdownLabel")).replaceAll("export ", "")
    .replace('import("./image-library.js")', "loadLibrary()");
  const document = Object.assign(element(), { querySelector: query, createElement: element });
  const setup = runInNewContext(editorSource + "\nsetupEditorTools", {
    document, Event, URL,
    allowedImages: new Set(), async readMediaImage() {}, imageSource() {}, createVisualEditor: () => ({}), renderText() {},
    loadLibrary: async () => ({ setupImageLibrary: () => openLibrary }),
    noteReferenceLimit, readNote, writeNote,
  });
  const tools = setup(editor, () => {}, attachments, getEntries, getReferences);
  const format = key => query(".format-tools").dispatchEvent({ type: "click", target: { closest: () => ({ dataset: { format: key } }) } });
  return { body, query, tools, format, document };
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
  assert.deepEqual(names, ["image", "carousel", "file", "pdf", "entry", "poll", "footnote"]);
  for (const name of ["heading", "bold", "italic", "list", "numbered", "quote", "library", "video", "divider"]) {
    const removed = editorTools("/" + name, name.length + 1, name.length + 1);
    removed.body.dispatchEvent(new Event("input"));
    assert.equal(removed.query("#command-menu").hidden, true);
  }
});

test("slash opens the poll in notes and articles and closes on outside clicks or unrelated typing", () => {
  for (const note of [false, true]) {
    let opened = 0;
    const view = editorTools("/", 1, 1, undefined, undefined, undefined, { poll() { opened++; } });
    if (note) view.tools.setNote(true, "/");
    const menu = view.query("#command-menu");
    view.body.dispatchEvent(new Event("input"));
    assert.equal(menu.hidden, false);
    view.document.dispatchEvent({ type: "pointerdown", target: view.body });
    assert.equal(menu.hidden, true);
    view.body.value = "/something";
    view.body.setSelectionRange(10, 10);
    view.body.dispatchEvent(new Event("input"));
    assert.equal(menu.hidden, true);
    view.body.value = note ? "/poll" : "/p";
    view.body.setSelectionRange(view.body.value.length, view.body.value.length);
    view.body.dispatchEvent(new Event("input"));
    if (!note) {
      view.body.dispatchEvent({ type: "keydown", key: "ArrowUp", preventDefault() {} });
      view.body.dispatchEvent({ type: "keydown", key: "ArrowUp", preventDefault() {} });
      view.body.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault() {} });
    }
    view.body.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
    assert.equal(opened, 1);
    assert.equal(view.body.value, "");
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

test("the note slash picker links published articles without using the note's character limit", () => {
  const text = "A quick thought. /field notes";
  const view = editorTools(text, text.length, text.length, undefined, () => [
    { slug: "field-notes", title: "Field Notes", published: true },
    { slug: "next", title: "More Field Notes", published: false },
    { slug: "short-note", title: "Field Notes follow-up", is_note: true, published: true },
  ]);
  view.tools.setNote(true, text);
  view.body.dispatchEvent({ type: "input" });
  assert.equal(view.query("#command-menu").children.length, 1);
  view.body.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(view.body.value, "A quick thought. ");
  assert.deepEqual(readNote(view.tools.noteBody()).references, [{ slug: "field-notes", title: "Field Notes" }]);
});

test("Enter on the note @image command opens Media Library and replaces the command with an attachment", async () => {
  const text = "A quick thought.\n@image";
  const image = { id: "12345678-1234-1234-1234-123456789abc", alt: "River" };
  let choosePhoto;
  const view = editorTools(text, text.length, text.length, undefined, undefined, pick => { choosePhoto = pick; });
  view.tools.setNote(true, text);
  view.body.dispatchEvent({ type: "input" });
  assert.equal(view.query("#command-menu").children[0].dataset.command, "@image");
  let prevented = false;
  view.body.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  choosePhoto(image);
  assert.equal(view.body.value, "A quick thought.\n");
  assert.deepEqual(readNote(view.tools.noteBody()).photos, [image]);
});

test("entry type and status combine with search, and the Notes screen only shows notes", () => {
  const list = element();
  const count = element();
  const search = { value: "" };
  const filter = { value: "all" };
  const type = { value: "all" };
  const posts = [
    { id: "one", title: "Market", tag: "Quiet pages", published: true, published_on: "2026-11-13" },
    { id: "two", title: "Elephant", tag: "Quiet pages", published: false, published_on: "2026-11-12" },
    { id: "three", title: "Footbridge", tag: "Walking", is_note: true, published: true, published_on: "2026-11-11" },
  ];
  const draft = { id: "draft:one", slot: "one", source: posts[0], title: "Untitled", slug: "market", tag: "Quiet pages", published: false, published_on: "2026-11-16" };
  const context = {
    postList: list, search, entryFilter: filter, entryType: type, listScreen: "entries", posts, drafts: [draft], localDrafts: () => [],
    draftEntry: row => row, selectedEntry: "one",
    document: { querySelector: () => count, createElement: element, addEventListener() {} },
  };
  const render = runInNewContext(deskSource.slice(deskSource.indexOf("function renderPostList()"), deskSource.indexOf("\nasync function deleteEntry")) + "\nrenderPostList", context);
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
  assert.equal(list.children[0].children[1].tabIndex, 0);
  assert.equal(count.textContent, "1 of 4 entries");
  filter.value = "draft";
  render();
  assert.deepEqual(Array.from(list.children, row => row.children[1].textContent), ["Untitled", "Elephant"]);
  type.value = "notes";
  search.value = "";
  render();
  assert.equal(list.children[0].textContent, "No matching entries.");
  filter.value = "published";
  render();
  assert.equal(list.children[0].children[1].textContent, "Footbridge");
  search.value = "Missing";
  render();
  assert.equal(list.children[0].textContent, "No matching entries.");
  assert.equal(count.textContent, "0 of 4 entries");
  context.listScreen = "notes";
  type.value = "articles";
  search.value = "";
  render();
  assert.equal(list.children[0].children[1].textContent, "Footbridge");
  assert.equal(count.textContent, "1 note");
  assert.deepEqual(posts.map(post => post.id), ["one", "two", "three"]);
});

test("entry arrows and mouse movement share one saved selection without intercepting form controls", () => {
  const document = element();
  const panel = element();
  const stored = new Map();
  const rows = ["first", "second", "third"].map(entryId => Object.assign(element(), {
    dataset: { entryId }, matches: selector => selector.includes(".entry-open"),
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    focus() { document.activeElement = this; },
  }));
  document.querySelector = selector => selector === "#entries-panel" ? panel : null;
  const postList = Object.assign(element(), {
    querySelector: () => rows.find(row => row["aria-current"]),
    querySelectorAll: () => rows,
    contains: node => rows.includes(node),
  });
  runInNewContext(deskSource.slice(deskSource.indexOf("function rememberEntry("), deskSource.indexOf("function entryIcon(")), {
    document, postList, draftOwner: "editor", selectedEntry: undefined, selectedEntryKey: () => "entry-selection",
    localStorage: { setItem: (key, value) => stored.set(key, value) },
  });
  const neutral = { matches: () => false, closest: () => null };
  const press = (key, target = document.activeElement || neutral) =>
    document.dispatchEvent({ type: "keydown", key, target, preventDefault() {} });
  press("ArrowDown");
  assert.equal(document.activeElement, rows[0]);
  press("ArrowDown");
  assert.equal(document.activeElement, rows[1]);
  assert.equal(stored.get("entry-selection"), "second");
  press("ArrowUp", { matches: () => false, closest: () => true });
  assert.equal(document.activeElement, rows[1]);
  postList.dispatchEvent({ type: "pointermove", pointerType: "mouse", target: { closest: () => rows[2] } });
  assert.equal(document.activeElement, rows[2]);
  assert.equal(stored.get("entry-selection"), "third");
  assert.deepEqual(rows.filter(row => row["aria-current"]), [rows[2]]);
  press("ArrowUp");
  assert.equal(document.activeElement, rows[1]);
  press("ArrowUp");
  assert.equal(document.activeElement, rows[0]);
  assert.deepEqual(rows.map(row => row.tabIndex), [0, -1, -1]);
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
  for (const name of ["title", "slug", "tag", "excerpt", "published_on", "series", "series_order", "start_here", "reader_prompt", "body"]) {
    assert.ok(html.includes('name="' + name + '"'), name);
  }
  for (const id of ["write-mode", "preview-mode", "edit-entry-settings", "close-entry-settings", "new-note", "insert-dialog", "entry-link-dialog", "library-dialog", "media-dialog"]) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(html, /<section[^>]+id="entry-details"[^>]+hidden>/);
  assert.match(html, /id="entry-type"[^>]*><option value="articles" selected>Articles/);
  assert.equal(html.match(/value="draft" formnovalidate/g).length, 1);
  assert.match(html, /class="editor-mode[^"]*"[^>]*>[\s\S]*?id="preview-mode" aria-pressed="true"[\s\S]*?id="edit-entry-settings"/);
  assert.doesNotMatch(html, /name="(?:paired_photo|photo_essay|collection|collection_intro)"|id="entry-actions"/);
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

test("the Writing Desk shows one startup screen while checking a saved session", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /id="desk-loading"[^>]* role="status">/);
  assert.match(html, /<form id="login"[^>]* hidden>/);
  const source = deskSource.slice(deskSource.indexOf("async function initializeDesk()"), deskSource.indexOf('login.addEventListener("submit"'));
  for (const saved of [null, { access_token: "test", refresh_token: "test", expires: Date.now() + 30000 }]) {
    const signIn = { disabled: true };
    const login = { hidden: true, querySelector: () => signIn };
    const deskLoading = { hidden: false };
    const status = {};
    let rejectCheck;
    const check = new Promise((_, reject) => { rejectCheck = reject; });
    const loaded = runInNewContext(source + "\ninitializeDesk()", {
      login, deskLoading, status, session: undefined, window: { isSecureContext: true },
      getProjectOrigin() {}, sessionKey: () => "session", sessionStorage: { getItem: () => JSON.stringify(saved) },
      openVerifiedDesk: () => check, resetLogin() { login.hidden = false; },
    });
    if (saved) {
      assert.equal(login.hidden, true);
      assert.equal(deskLoading.hidden, false);
      rejectCheck(new Error("Your session expired."));
    }
    await loaded;
    assert.equal(login.hidden, false);
    assert.equal(signIn.disabled, false);
    assert.equal(deskLoading.hidden, true);
    if (saved) assert.equal(status.textContent, "Your session expired.");
  }
});

test("a published entry can be copied to a draft and a saved draft is private by default", () => {
  const draftButton = element();
  const publishButton = element();
  const context = { activePost: { published: true }, activeDraft: undefined, dirty: () => false,
    draftButton, publishButton, shareButton: element(), busy: false, isNote: false };
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
    entryTags: value => value.split(",").map(tag => tag.trim()), mediaId: /^valid$/, readNote,
  });
  const invalid = { title: "", body: "", tag: "", published_on: "", slug: "bad slug" };
  assert.deepEqual([...validate(invalid).keys()], ["title", "body", "tag", "published_on", "slug"]);
  assert.equal(validate({ ...invalid, is_note: true, body: "x".repeat(501) }).get("body"), "Use 500 characters or fewer for the note.");
  assert.equal(validate({ title: "A title", body: "Body", tag: "Notes, AI", published_on: "2026-11-23", slug: "a-title", excerpt: "" }).size, 0);
});

test("Dashboard, Entries, and the editor are separate screens with the correct navigation state", () => {
  const panels = ["stats", "entries", "compose", "comments"].map(name => ({ id: name + "-panel", hidden: true }));
  const nav = ["stats", "entries", "notes", "comments"].map(name => ({ dataset: { section: name }, setAttribute(key, value) { this[key] = value; } }));
  const title = element();
  let writing;
  let referenceLoads = 0;
  const show = runInNewContext(deskSource.slice(deskSource.indexOf("function showSection("), deskSource.indexOf("async function loadPrivacyRequests")) + "\nshowSection", {
    openedSections: new Set(), loadReferences() { referenceLoads++; },
    sections: nav, listScreen: "entries", isListScreen: section => ["entries", "notes"].includes(section),
    entryType: element(), entryFilter: element(), newPost: element(), newNote: element(), postList: element(), search: element(), renderPostList() {},
    entryListScroll: 0, updateDeskAddress() {}, window: { scrollY: 240, scrollTo() {} }, document: { querySelector: selector => selector === "#entries-panel" ? panels[1] : title, querySelectorAll: () => panels, body: { classList: { toggle(name, value) { writing = value; } } } },
  });
  for (const screen of ["stats", "entries", "compose", "entries", "comments"]) {
    show(screen);
    assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.id), [screen + "-panel"]);
    assert.equal(writing, screen === "compose");
    assert.equal(nav.find(button => button["aria-pressed"] === "true").dataset.section, screen === "compose" ? "entries" : screen);
  }
  show("notes");
  assert.equal(panels[1].hidden, false);
  assert.equal(nav[2]["aria-pressed"], "true");
  show("compose");
  assert.equal(nav[2]["aria-pressed"], "true");
  assert.equal(referenceLoads, 1);
});

test("desk navigation loads private lists only once per tab", () => {
  const calls = [];
  const inbox = {};
  const open = runInNewContext(deskSource.slice(deskSource.indexOf("function openSection("), deskSource.indexOf("async function restoreDeskSection")) + "\nopenSection", {
    openedSections: new Set(), showSection() {}, inbox,
    photoTools: { loadPhoto() { calls.push("site"); } },
    loadPrivacyRequests() { calls.push("inbox"); }, openComments() { calls.push("comments"); },
  });
  for (let visit = 0; visit < 3; visit++) {
    for (const section of ["entries", "site", "inbox", "comments"]) open(section);
  }
  assert.deepEqual(calls, ["site", "inbox", "comments"]);
});

test("section links retain their screen on refresh and preserve private draft addresses", () => {
  const sections = ["stats", "entries", "notes", "site", "media", "references", "comments", "inbox"].map(section => ({ dataset: { section } }));
  const location = new URL("https://example.test/desk/");
  const navigations = [];
  const history = {
    pushState(_, __, url) { navigations.push("push"); location.href = url.href; },
    replaceState(_, __, url) { navigations.push("replace"); location.href = url.href; },
  };
  const routes = runInNewContext(deskSource.slice(deskSource.indexOf("const isListScreen"), deskSource.indexOf("function showSection(")) +
    "\n({ deskSection, composeAddress, updateDeskAddress })", { sections, location, history, URL, URLSearchParams, listScreen: "entries",
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
  assert.equal(location.searchParams.get("post"), "my-post/draft");
  assert.equal(location.hash, "#entries");
  assert.equal(routes.composeAddress(routes.deskSection()).draft, "draft-id");
  routes.updateDeskAddress("media", true);
  assert.equal(location.search, "");
  assert.equal(routes.composeAddress("media").draft, undefined);
  assert.deepEqual(navigations, ["replace", "push", "push", "push", "replace", "push"]);
});

test("reopening the selected entry shows its editor without resetting unsaved content", async () => {
  let screen;
  let pending;
  let requests = 0;
  let focused = false;
  const edit = runInNewContext(deskSource.slice(deskSource.indexOf("function editEntry("), deskSource.indexOf("const tags =")) + "\neditEntry", {
    busy: false, editingId: () => "one", isNote: false, canLeaveDraft: () => true, rememberEntry() {}, renderPostList() {},
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

test("New entry and New note open fresh compositions and keep earlier local drafts accessible", () => {
  const first = "new-12345678-1234-1234-1234-123456789abc";
  const second = "new-12345678-1234-1234-1234-123456789abc".replace(/abc$/, "abd");
  const opened = [];
  const ids = [first.slice(4), second.slice(4)];
  const backups = {
    ["draft:" + first]: { saved_at: "2026-11-24T00:00:00Z", fields: { title: "Earlier entry" } },
    "draft:new-note": { saved_at: "2026-11-23T00:00:00Z", fields: { body: "Earlier note", is_note: "true" } },
    "draft:draft:server": { saved_at: "2026-11-23T00:00:00Z", fields: { title: "Server draft edit" } },
  };
  const functions = runInNewContext(deskSource.slice(deskSource.indexOf("const localSlotPattern"), deskSource.indexOf("const slot =")) +
    deskSource.slice(deskSource.indexOf("function localDrafts()"), deskSource.indexOf("function removeBackup(")) +
    deskSource.slice(deskSource.indexOf("function newComposition("), deskSource.indexOf("newPost.addEventListener")) +
    "\n({ newComposition, localDrafts })", {
    current: undefined, busy: false, draftOwner: "editor", canLeaveDraft: () => true,
    crypto: { randomUUID: () => ids.shift() }, run: (_button, action) => Promise.resolve(action()),
    showSection() {}, editorTools: { focus() {} }, recoverDraft() { throw new Error("New must start blank"); },
    openEditor: (...args) => opened.push(args), backupKey: id => "draft:" + id, localStorage: backups,
    readBackup: id => backups["draft:" + id],
  });
  functions.newComposition(element(), false);
  functions.newComposition(element(), true);
  assert.deepEqual(opened, [[undefined, undefined, false, first], [undefined, undefined, true, second]]);
  assert.deepEqual(Array.from(functions.localDrafts(), row => row.slot), [first, "new-note"]);
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

test("Dashboard sums daily traffic and waits for Refresh to fetch another period", async () => {
  const nodes = new Map();
  const query = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  query("#stats-period").value = "30";
  query("#stats-report").querySelector = () => query("chart");
  const paths = [];
  let changePeriod;
  query("#stats-period").addEventListener = (_, listener) => { changePeriod = listener; };
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
  assert.equal(query("#last-published-date").textContent, "Published Nov 13, 2026");
  assert.match(query("#stats-report").innerHTML, /<summary>Daily counts<\/summary><p class="muted">Busiest day · Nov 15, 2026 · 11 page views/);
  assert.match(query("#stats-report").innerHTML, /<details class="traffic-table"><summary>Most-read entries<\/summary>/);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^traffic\?/);
  stats.renderPublishing();
  query("#stats-period").value = "7";
  changePeriod();
  assert.equal(paths.length, 1);
  assert.match(query("#stats-status").textContent, /Choose Refresh/);
  await stats.load();
  assert.equal(paths.length, 2);
  assert.match(paths[1], /day=gte\.2026-11-10/);
});

test("Comments includes published and pending comments and filters them independently of Inbox", async () => {
  const comments = element();
  const filter = { value: "all" };
  const rows = [{ id: "a", display_name: "A reader", approved: true, body: "Published comment", post_id: "one" },
    { id: "b", display_name: "Another reader", approved: false, body: "Pending comment", post_id: "one" },
    { id: "c", display_name: "A reader", approved: false, ignored: true, body: "Ignored comment", post_id: "one" }];
  const summary = element();
  let requests = 0;
  const { loadComments, renderComments } = runInNewContext(deskSource.slice(deskSource.indexOf("let commentRows"), deskSource.indexOf("async function openDesk(")) + "\n({loadComments,renderComments})", {
    comments, commentsRevision: 0, posts: [{ id: "one", title: "Market" }], api() {},
    updateModerationCount() {},
    allRows: async () => { requests++; return rows; },
    document: { querySelector: selector => selector === "#comment-filter" ? filter : summary, createElement: element },
  });
  await loadComments();
  assert.equal(comments.children.length, 3);
  assert.match(comments.children[0].children[1].children[1].textContent, /^Published/);
  filter.value = "published";
  renderComments();
  assert.equal(comments.children.length, 1);
  assert.equal(comments.children[0].children[1].children[2].textContent, "Published comment");
  filter.value = "pending";
  renderComments();
  assert.equal(comments.children[0].children[0].textContent, "#2");
  assert.equal(comments.children[0].children[1].children[2].textContent, "Pending comment");
  assert.equal(comments.children[0].children[2].children[1].title, "Ignore comment");
  filter.value = "ignored";
  renderComments();
  assert.equal(comments.children[0].children[1].children[2].textContent, "Ignored comment");
  assert.equal(requests, 1);
});

test("the homepage selection features photos without dates and can unfeature them without touching media", async () => {
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
  let added;
  const photo = { id: "photo", media_id: "media", title: "A real photograph", alt: "Trees by the river", week: null, featured: true };
  const setup = runInNewContext(photosSource.replace(/^import[^\n]+\n/gm, "").replaceAll("export ", "") + "\nsetupPhotoTools", {
    document: { querySelector: query, createElement: photoNode }, confirm: () => true, crypto: { randomUUID: () => "new-photo" },
    allRows: (api, path) => api(path), loadImage: async () => null, imageSource: () => "", photoText: () => true,
    missingColumn: () => false, missingFeature: () => false,
    FormData: class { get(name) { return query(name).value; } has(name) { return Boolean(query(name).checked); } },
  });
  const tools = setup(async (path, options) => {
    paths.push(path);
    if (options?.method === "PATCH") { saved = options.body; return [{ ...photo, ...saved }]; }
    if (options?.method === "POST") { added = options.body[0]; return; }
    return [photo];
  }, pick => pick({ id: "new-media", title: "New photo", alt: "A green hill" }));
  await tools.loadPhoto();
  assert.match(paths[0], /week=is\.null&featured=eq\.true/);
  query("#featured-photos").children[0].children[0].fire("click");
  await form.fire("submit");
  assert.equal(saved.featured, undefined);
  query("#pick-featured-photo").fire("click");
  await form.fire("submit");
  assert.equal(added.week, null);
  assert.equal(added.featured, true);
  assert.equal(added.media_id, "new-media");
  query("#featured-photos").children[0].children[0].fire("click");
  query("#remove-featured-photo").fire("click");
  assert.match(paths.at(-1), /weekly_photos\?week=is\.null&featured=eq\.true&id=eq\.photo/);
  assert.equal(saved.featured, false);
  assert.ok(paths.every(path => path.startsWith("weekly_photos?")));
});
