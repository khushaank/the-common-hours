import { imageSource, missingFeature, showFailure } from "./common.js";
import { loadCatalog } from "./media-catalog.js";

const types = { image: "Image", pdf: "PDF", document: "Document", file: "File" };
const pageSize = 18;

export function setupMediaEditor(api, storage) {
  const search = document.querySelector("#media-search");
  const filter = document.querySelector("#media-filter");
  const status = document.querySelector("#media-status");
  const grid = document.querySelector("#media-results");
  const more = document.querySelector("#media-more");
  const dialog = document.querySelector("#media-dialog");
  const form = document.querySelector("#media-form");
  const picture = document.querySelector("#media-preview");
  const download = document.querySelector("#media-download");
  const close = document.querySelector("#media-close");
  const save = form.querySelector('[type="submit"]');
  const message = document.querySelector("#media-edit-status");
  let catalog = [];
  let limit = pageSize;
  let selected;
  let revision = 0;
  let observer;
  const previews = new Map();

  async function showImage(image, id) {
    if (!previews.has(id)) previews.set(id, storage.image(id).then(imageSource));
    try {
      const src = await previews.get(id);
      if (image.dataset.id === id && image.isConnected && src) image.src = src;
    } catch { previews.delete(id); }
  }

  function render() {
    observer?.disconnect();
    const query = search.value.trim().toLowerCase();
    const matches = catalog.filter(asset => (filter.value === "all" || filter.value === asset.type) &&
      [asset.title, asset.original, asset.alt, asset.description].some(value => value?.toLowerCase().includes(query)));
    status.textContent = matches.length ? matches.length + (matches.length === 1 ? " item" : " items") : "No media matches.";
    grid.replaceChildren();
    more.hidden = matches.length <= limit;
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          void showImage(entry.target, entry.target.dataset.id);
        }
      });
    }
    for (const asset of matches.slice(0, limit)) {
      const button = document.createElement("button");
      const name = document.createElement("strong");
      const type = document.createElement("small");
      button.type = "button";
      name.textContent = asset.title || asset.alt || "Untitled image";
      type.textContent = types[asset.type];
      if (asset.kind === "image") {
        const image = document.createElement("img");
        image.alt = "";
        image.dataset.id = asset.id;
        image.decoding = "async";
        button.append(image);
        if (observer) observer.observe(image);
        else void showImage(image, asset.id);
      }
      button.append(name, type);
      button.addEventListener("click", () => edit(asset));
      grid.append(button);
    }
  }

  async function load() {
    const loading = ++revision;
    status.textContent = "Loading media…";
    grid.replaceChildren();
    more.hidden = true;
    try {
      const assets = await loadCatalog(api, storage.list);
      if (loading !== revision) return;
      catalog = assets;
      render();
    } catch {
      if (loading === revision) showFailure(status, "Media could not load.", load);
    }
  }

  function edit(asset) {
    selected = asset;
    const isImage = asset.kind === "image";
    form.reset();
    message.textContent = "";
    form.elements.namedItem("title").value = asset.title;
    form.elements.namedItem("alt").value = asset.alt || "";
    form.elements.namedItem("alt").required = isImage;
    form.elements.namedItem("description").value = asset.description;
    document.querySelector("#media-alt-label").hidden = !isImage;
    picture.hidden = !isImage;
    picture.removeAttribute("src");
    picture.dataset.id = asset.id;
    picture.alt = asset.alt || "";
    download.hidden = isImage;
    document.querySelector("#media-info").textContent = types[asset.type] +
      (asset.size ? " · " + new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(asset.size / 1024) + " KB" : "");
    dialog.showModal();
    if (isImage) void showImage(picture, asset.id);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (save.disabled) return;
    const fields = new FormData(form);
    const record = {
      title: fields.get("title").trim(), alt: fields.get("alt").trim(), description: fields.get("description").trim(),
    };
    if (selected.kind === "image" && !record.alt) { message.textContent = "Enter alt text for this image."; return; }
    save.disabled = close.disabled = true;
    try {
      await storage.save(selected, record);
      Object.assign(selected, record);
      render();
      dialog.close();
      status.textContent = "Media details saved.";
    } catch (error) {
      message.textContent = missingFeature(error) || error.code === "PGRST202" ? "Apply the editor upgrade to save media details." : error.message;
    } finally {
      save.disabled = close.disabled = false;
    }
  });
  download.addEventListener("click", async () => {
    download.disabled = true;
    try {
      const asset = selected;
      const url = URL.createObjectURL(await storage.download(asset.id));
      const link = document.createElement("a");
      link.href = url;
      link.download = asset.original || asset.title;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { message.textContent = "The file could not download."; }
    finally { download.disabled = false; }
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (save.disabled) event.preventDefault(); });
  const applyFilters = () => { limit = pageSize; render(); };
  search.addEventListener("input", applyFilters);
  filter.addEventListener("change", applyFilters);
  more.addEventListener("click", () => { limit += pageSize; render(); });
  return {
    load,
    clear() {
      revision++;
      observer?.disconnect();
      catalog = [];
      previews.clear();
      grid.replaceChildren();
      if (dialog.open) dialog.close();
    },
  };
}
