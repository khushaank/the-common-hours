document.addEventListener("contextmenu", event => {
  if (event.target.closest("img")) event.preventDefault();
});

const searchButton = document.querySelector("#search-link");
const searchPanel = document.querySelector("#nav-search");
const searchForm = document.querySelector("#entry-search");
const query = document.querySelector("#entry-query");
const results = document.querySelector("#search-results");
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
  results.setAttribute("aria-busy", String(Boolean(term)));
  results.textContent = term ? "Searching…" : "Search titles, article text, or topics.";
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
document.querySelector("#close-search").addEventListener("click", () => showSearch(false));
query.addEventListener("input", () => updateSearch(280));
searchForm.addEventListener("submit", event => { event.preventDefault(); updateSearch(0); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !searchPanel.hidden && !event.defaultPrevented) showSearch(false);
});
document.addEventListener("pointerdown", event => {
  if (!searchPanel.hidden && !searchPanel.contains(event.target) && !searchButton.contains(event.target)) showSearch(false, false);
});
const route = new URLSearchParams(location.search);
if (route.get("view") === "search") {
  query.value = (route.get("q") || "").slice(0, 100);
  showSearch(true);
  updateSearch(0);
}
if (route.get("view") !== "review" && "serviceWorker" in navigator) {
  const register = () => void navigator.serviceWorker.register("./static-cache.js").catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(register);
  else window.addEventListener("load", register, { once: true });
}
import("./journal.js").catch(() => {
  const content = document.querySelector("#content");
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
