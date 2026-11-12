import { imageSource } from "./common.js";
import { loadCatalog } from "./media-catalog.js";

const pageSize = 12;

export function setupImageLibrary(api, loadImage) {
  const dialog = document.querySelector("#library-dialog");
  const search = document.querySelector("#library-search");
  const grid = document.querySelector("#library-results");
  const status = document.querySelector("#library-status");
  const more = document.querySelector("#library-more");
  let images = [];
  let limit = pageSize;
  let revision = 0;
  let observer;
  let pick;
  let restoreFocus;
  const sources = new Map();

  function render() {
    observer?.disconnect();
    const query = search.value.trim().toLowerCase();
    const matching = images.filter(image =>
      [image.alt, image.title, image.description].some(text => text?.toLowerCase().includes(query)));
    status.textContent = matching.length ? "" : query ? "No images match your search." : "No images have been uploaded yet.";
    more.hidden = matching.length <= limit;
    grid.replaceChildren();
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          void reveal(entry.target);
        }
      }, { root: dialog, rootMargin: "100px" });
    }
    for (const image of matching.slice(0, limit)) {
      const button = document.createElement("button");
      const picture = document.createElement("img");
      const label = document.createElement("strong");
      button.type = "button";
      picture.alt = "";
      picture.dataset.id = image.id;
      picture.title = image.alt;
      picture.decoding = "async";
      label.textContent = image.title || image.alt || "Untitled image";
      button.append(picture, label);
      if (image.alt && image.alt !== label.textContent) {
        const description = document.createElement("small");
        description.textContent = image.alt;
        button.append(description);
      }
      if (image.description) {
        const notes = document.createElement("small");
        notes.textContent = image.description;
        button.append(notes);
      }
      button.addEventListener("click", () => {
        try { pick(image); dialog.close(); }
        catch (error) { status.textContent = error.message; }
      });
      grid.append(button);
      if (observer) observer.observe(picture);
      else void reveal(picture);
    }
  }

  async function reveal(picture) {
    const id = picture.dataset.id;
    if (!sources.has(id)) sources.set(id, loadImage(id).then(imageSource));
    try {
      const src = await sources.get(id);
      if (src && picture.isConnected) picture.src = src;
    } catch { sources.delete(id); }
  }

  search.addEventListener("input", () => { limit = pageSize; render(); });
  more.addEventListener("click", () => {
    const firstNew = limit;
    limit += pageSize;
    render();
    grid.children[firstNew]?.focus();
  });
  document.querySelector("#library-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    revision++;
    observer?.disconnect();
    grid.replaceChildren();
    sources.clear();
    restoreFocus();
  });

  return async (onPick, onClose) => {
    const loading = ++revision;
    pick = onPick;
    restoreFocus = onClose;
    images = [];
    limit = pageSize;
    search.value = "";
    search.disabled = true;
    more.hidden = true;
    status.textContent = "Loading images…";
    dialog.showModal();
    try {
      const catalog = await loadCatalog(api);
      if (revision !== loading) return;
      images = catalog;
      search.disabled = false;
      render();
    } catch {
      if (revision === loading) status.textContent = "The image library could not load. Close it and try again.";
    }
  };
}
