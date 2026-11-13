import { escape } from "./common.js";

const storageKey = "common-hours:read-later";

function readBookmarks() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
  return new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
}

function saveBookmarks(saved) {
  localStorage.setItem(storageKey, JSON.stringify([...saved]));
}

export function addBookmarkButton(article, id) {
  const actions = document.createElement("div");
  const button = document.createElement("button");
  const status = document.createElement("span");
  actions.className = "reading-actions";
  button.className = "quiet-button";
  button.type = "button";
  button.textContent = "Read later";
  status.setAttribute("role", "status");
  const refresh = () => {
    try {
      const saved = readBookmarks().has(id);
      button.setAttribute("aria-pressed", String(saved));
      status.textContent = saved ? "Saved to Read later." : "";
    } catch { status.textContent = "Read later is unavailable in this browser."; }
  };
  button.addEventListener("click", () => {
    try {
      const saved = readBookmarks();
      if (saved.has(id)) saved.delete(id);
      else saved.add(id);
      saveBookmarks(saved);
      refresh();
    } catch { status.textContent = "This browser could not save your reading list."; }
  });
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) refresh();
  });
  refresh();
  actions.append(button, status);
  article.querySelector(".meta").after(actions);
}

export function renderBookmarks(content, posts) {
  document.title = "Read later — The Common Hours";
  const heading = '<div class="section-head"><h1>Read later</h1></div>';
  function render() {
    try {
      const byId = new Map(posts.map(post => [post.id, post]));
      const saved = [...readBookmarks()].reverse();
      const entries = saved.filter(id => byId.has(id));
      content.innerHTML = heading + (entries.length ? entries.map(id => {
        const post = byId.get(id);
        return '<article class="entry"><h2 class="entry-title"><a href="?post=' + encodeURIComponent(post.slug) +
          '">' + escape(post.title) + '</a></h2><p>' + escape(post.excerpt) +
          '</p><button class="quiet-button" type="button" data-remove="' + escape(id) +
          '" aria-label="Remove ' + escape(post.title) + ' from Read later">Remove</button></article>';
      }).join("") : "<p>Your reading list is empty.</p>");
    } catch { content.innerHTML = heading + "<p>Read later is unavailable in this browser.</p>"; }
  }
  content.addEventListener("click", event => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    try {
      const saved = readBookmarks();
      saved.delete(button.dataset.remove);
      saveBookmarks(saved);
      render();
      (content.querySelector("[data-remove]") || content).focus();
    } catch {
      button.textContent = "Could not remove. Try again.";
    }
  });
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) render();
  });
  render();
}
