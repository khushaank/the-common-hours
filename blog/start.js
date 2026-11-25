import { showFailure, watchUnexpectedErrors } from "./feedback.js";
import { setupShortcuts } from "./keyboard.js";
import { pageHref, pageParams } from "./page-url.js";
import { setupImageViewer, setupNoteCarousels } from "./image-viewer.js";
import { trackFocusInput } from "./focus.js";

trackFocusInput();
watchUnexpectedErrors("Part of the journal ran into a problem. You can keep reading or reload the page.",
  () => document.documentElement.hasAttribute("data-interactive"));

document.addEventListener("contextmenu", event => {
  if (event.target.closest("img")) event.preventDefault();
});

document.addEventListener("dragstart", event => {
  if (event.target.closest("a, img")) event.preventDefault();
});

const route = pageParams();
if ((location.search || location.pathname.endsWith(".html")) && navigator.onLine &&
    !document.documentElement.hasAttribute("data-offline-copy")) {
  const address = pageHref(route);
  const target = new URL(address, location.href);
  target.hash = location.hash;
  if (target.pathname !== location.pathname && !address.startsWith("./")) location.replace(target.href);
}

import("./journal.js").catch(() => {
  const content = document.querySelector("#content");
  if (!content) return;
  delete content.dataset.refreshPending;
  content.setAttribute("aria-busy", "false");
  const status = document.createElement("div");
  if (content.dataset.prerendered) {
    status.className = "unexpected-error";
    content.after(status);
  }
  else content.replaceChildren(status);
  showFailure(status, "The journal’s JavaScript could not load. Reload to try again.", () => location.reload(), "Reload", () => status.remove());
});

setupSearch();
setupImageViewer();
setupNoteCarousels();
const activate = selector => () => document.querySelector(selector).click();
setupShortcuts("Journal shortcuts", [
  ["Alt + K", "Open journal search", activate("#search-link")],
  ["/ or @", "Open journal search"],
  ["Alt + J", "Go to the journal", activate("#journal-link")],
  ["Alt + N", "Go to Notes", activate("#notes-link")],
  ["Alt + O", "Open the current note", () => currentNoteLink()?.click(), () => Boolean(currentNoteLink())],
  ["Alt + A", "Browse the archive", activate("#archive-link")],
  ["Alt + T", "Back to top", activate(".back-to-top")],
  ["← / →", "Change photos while the carousel is focused"],
]);
function currentNoteLink() {
  if (document.activeElement.closest("input, textarea, select, [contenteditable]") ||
      document.querySelector("#content .article.journal-note")) return null;
  const notes = [...document.querySelectorAll(".notes-feed .note-row")];
  const visible = notes.find(note => note.getBoundingClientRect().bottom > innerHeight * .25) || notes.at(-1);
  return document.activeElement.closest(".journal-note")?.querySelector(".note-permalink") ||
    visible?.querySelector(".note-permalink") || document.querySelector(".recent-notes li > a");
}
document.documentElement.setAttribute("data-interactive", "");
if (route.get("view") !== "review" && "serviceWorker" in navigator) {
  const workers = navigator.serviceWorker;
  workers.addEventListener("controllerchange", () => workers.controller?.postMessage("save-public-page"));
  void workers.register("./static-cache.js", { updateViaCache: "none" }).then(() => workers.ready)
    .then(registration => registration.active?.postMessage("save-public-page")).catch(() => {});
}

function setupSearch() {
  const searchButton = document.querySelector("#search-link");
  const searchPanel = document.querySelector("#nav-search");
  const searchForm = document.querySelector("#entry-search");
  const query = document.querySelector("#entry-query");
  const results = document.querySelector("#search-results");
  const clearSearch = document.querySelector("#clear-search");
  if (!searchButton || !searchPanel || !searchForm || !query || !results || !clearSearch) return;

  let searchTimer;
  let revision = 0;
  function showSearch(open, restoreFocus = true) {
    searchPanel.hidden = !open;
    searchButton.setAttribute("aria-expanded", String(open));
    if (open) query.focus();
    else if (restoreFocus) searchButton.focus();
  }
  function updateSearch(delay) {
    clearTimeout(searchTimer);
    const term = query.value.trim();
    const current = ++revision;
    clearSearch.hidden = !query.value;
    results.setAttribute("aria-busy", String(Boolean(term)));
    const message = document.createElement("p");
    message.textContent = term ? "Searching…" : "Search titles, article text, or topics.";
    results.replaceChildren(message);
    if (!term) return;
    searchTimer = setTimeout(async () => {
      try {
        const { findEntries, searchCards } = await import("./reading.js");
        const entries = await findEntries(term);
        if (current === revision) results.innerHTML = searchCards(entries, term);
      } catch {
        if (current === revision) showFailure(results, "Search could not load.", () => updateSearch(0), "Try again", true);
      } finally {
        if (current === revision) results.removeAttribute("aria-busy");
      }
    }, delay);
  }
  searchButton.addEventListener("click", () => showSearch(searchPanel.hidden));
  clearSearch.addEventListener("click", () => {
    query.value = "";
    updateSearch(0);
    query.focus();
  });
  query.addEventListener("input", () => updateSearch(280));
  searchForm.addEventListener("submit", event => { event.preventDefault(); updateSearch(0); });
  searchPanel.addEventListener("keydown", event => {
    if (event.isComposing || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    const links = [...results.querySelectorAll("a[href]")];
    const index = links.indexOf(event.target);
    if (!links.length || (event.target !== query && index < 0)) return;
    event.preventDefault();
    const next = index < 0 ? (event.key === "ArrowDown" ? 0 : links.length - 1) : index + (event.key === "ArrowDown" ? 1 : -1);
    (links[next] || query).focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !searchPanel.hidden && !event.defaultPrevented) showSearch(false);
    if (!["/", "@"].includes(event.key) || event.defaultPrevented || event.isComposing ||
        event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
    event.preventDefault();
    showSearch(true);
  });
  document.addEventListener("pointerdown", event => {
    if (!searchPanel.hidden && !searchPanel.contains(event.target) && !searchButton.contains(event.target)) {
      showSearch(false, !event.target.closest("a, button, input, select, textarea, [tabindex]"));
    }
  });
  if (route.get("view") === "search") {
    query.value = (route.get("q") || "").slice(0, 100);
    showSearch(true);
    updateSearch(0);
  }
}
