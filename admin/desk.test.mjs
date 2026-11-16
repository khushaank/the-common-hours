import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("./editor-tools.js", import.meta.url), "utf8");
const deskSource = await readFile(new URL("./desk.js", import.meta.url), "utf8");

function element() {
  const listeners = new Map();
  return {
    value: "", textContent: "", hidden: false, scrollTop: 0, dataset: {}, children: [], parentElement: { firstChild: {} },
    classList: { toggle() {} }, setAttribute() {}, focus() {}, scrollIntoView() {},
    addEventListener(type, listener) { listeners.set(type, [...listeners.get(type) || [], listener]); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
    append(child) { this.children.push(child); },
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
    ["heading", "A heading", "## A heading"],
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
  const slash = editorTools("/bold", 5, 5);
  slash.body.dispatchEvent(new Event("input"));
  slash.body.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(slash.body.value, "**Bold text**");
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
