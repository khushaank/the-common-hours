document.addEventListener("contextmenu", event => {
  if (event.target.closest("img")) event.preventDefault();
});

import("./journal.js").catch(() => {
  const content = document.querySelector("#content");
  if (!content) return;
  content.setAttribute("aria-busy", "false");
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "The journal could not start. Reload to try again.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "quiet-button";
  retry.textContent = "Reload";
  retry.addEventListener("click", () => location.reload());
  content.replaceChildren(message, retry);
});

const route = new URLSearchParams(location.search);
setupSearch();
if (route.get("view") !== "review" && "serviceWorker" in navigator) {
  const register = () => void navigator.serviceWorker.register("./static-cache.js").catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(register);
  else window.addEventListener("load", register, { once: true });
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
        if (current === revision) results.innerHTML = searchCards(entries);
      } catch {
        if (current === revision) results.textContent = "Search is unavailable. Try again.";
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
