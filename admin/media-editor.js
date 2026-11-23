import { imageSource, missingFeature, showFailure } from "./common.js";
import { loadCatalog } from "./media-catalog.js";
import { isSupportedImage, promptImageAlt } from "./editor-tools.js";

const types = { image: "Image", pdf: "PDF", document: "Document", file: "File" };
const pageSize = 18;
const fileBadge = extension => {
  if (/^(pptx?|odp)$/.test(extension)) return ["PPT", "slides"];
  if (/^(xlsx?|ods|csv)$/.test(extension)) return ["XLS", "sheet"];
  if (/^(docx?|odt|rtf)$/.test(extension)) return ["DOC", "document"];
  return [/^[a-z\d]{1,4}$/.test(extension) ? extension.toUpperCase() : "FILE", extension === "pdf" ? "pdf" : "file"];
};

export function setupMediaEditor(api, storage) {
  const search = document.querySelector("#media-search");
  const filter = document.querySelector("#media-filter");
  const status = document.querySelector("#media-status");
  const grid = document.querySelector("#media-results");
  const more = document.querySelector("#media-more");
  const dialog = document.querySelector("#media-dialog");
  const form = document.querySelector("#media-form");
  const picture = document.querySelector("#media-preview");
  const pictureFrame = document.querySelector("#media-preview-frame");
  const description = document.querySelector("#media-description-label");
  const download = document.querySelector("#media-download");
  const close = document.querySelector("#media-close");
  const remove = document.querySelector("#media-delete");
  const add = document.querySelector("#media-add");
  const fileInput = document.querySelector("#media-file");
  const save = form.querySelector('[type="submit"]');
  const message = document.querySelector("#media-edit-status");
  let catalog = [];
  let limit = pageSize;
  let selected;
  let revision = 0;
  let observer;
  const previews = new Map();
  const covers = new Map();

  async function showImage(image, id) {
    const frame = image.parentElement;
    if (!previews.has(id)) previews.set(id, storage.image(id).then(imageSource));
    try {
      const src = await previews.get(id);
      if (image.dataset.id !== id || !image.isConnected || !src) return;
      image.src = src;
      await image.decode();
      if (image.dataset.id === id) image.hidden = false;
    } catch { previews.delete(id); }
    finally { if (image.dataset.id === id) frame.removeAttribute("aria-busy"); }
  }

  async function showCover(frame, id) {
    if (!covers.has(id)) {
      covers.set(id, import("./pdf-thumbnail.js")
        .then(async ({ pdfThumbnail }) => pdfThumbnail(await storage.download(id)))
        .catch(() => undefined));
    }
    const src = await covers.get(id);
    if (!src || !frame.isConnected) return;
    const image = document.createElement("img");
    image.alt = "";
    image.src = src;
    frame.replaceChildren(image);
  }

  function render() {
    observer?.disconnect();
    const query = search.value.trim().toLowerCase();
    const matches = catalog.filter(asset => (filter.value === "all" || filter.value === asset.type) &&
      [asset.title, asset.original, asset.alt, asset.kind === "file" ? asset.description : ""].some(value => value?.toLowerCase().includes(query)));
    status.textContent = matches.length ? matches.length + (matches.length === 1 ? " item" : " items") : "No media matches.";
    grid.replaceChildren();
    more.hidden = matches.length <= limit;
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const { id, type } = entry.target.dataset;
          if (type === "pdf") void showCover(entry.target, id);
          else void showImage(entry.target, id);
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
      const frame = document.createElement("span");
      frame.className = "media-thumbnail";
      frame.setAttribute("aria-hidden", "true");
      if (asset.kind === "image") {
        const image = document.createElement("img");
        image.alt = "";
        image.dataset.id = asset.id;
        image.decoding = "async";
        frame.setAttribute("aria-busy", "true");
        frame.append(image);
        if (observer) observer.observe(image);
        else void showImage(image, asset.id);
      } else {
        const [label, style] = fileBadge(asset.extension);
        const badge = document.createElement("span");
        badge.className = "media-file-badge";
        badge.dataset.format = style;
        badge.textContent = label;
        frame.append(badge);
        if (asset.type === "pdf") {
          frame.dataset.id = asset.id;
          frame.dataset.type = "pdf";
          if (observer) observer.observe(frame);
          else void showCover(frame, asset.id);
        }
      }
      button.append(frame, name, type);
      button.addEventListener("click", () => edit(asset));
      grid.append(button);
    }
  }

  async function load() {
    const loading = ++revision;
    status.textContent = "Loading media…";
    observer?.disconnect();
    grid.setAttribute("aria-busy", "true");
    grid.replaceChildren(document.querySelector("#media-skeleton").content.cloneNode(true));
    search.disabled = filter.disabled = true;
    more.hidden = true;
    try {
      const assets = await loadCatalog(api, storage.list);
      if (loading !== revision) return;
      catalog = assets;
      render();
    } catch {
      if (loading === revision) {
        grid.replaceChildren();
        showFailure(status, "Media could not load.", load);
      }
    } finally {
      if (loading === revision) {
        grid.removeAttribute("aria-busy");
        search.disabled = filter.disabled = false;
      }
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
    description.hidden = isImage;
    form.elements.namedItem("description").value = isImage ? "" : asset.description;
    document.querySelector("#media-alt-label").hidden = !isImage;
    pictureFrame.hidden = !isImage;
    picture.hidden = true;
    if (isImage) pictureFrame.setAttribute("aria-busy", "true");
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
      title: fields.get("title").trim(), alt: fields.get("alt").trim(),
      description: selected.kind === "image" ? selected.description : fields.get("description").trim(),
    };
    if (selected.kind === "image" && !record.alt) { message.textContent = "Enter alt text for this image."; return; }
    save.disabled = close.disabled = remove.disabled = true;
    try {
      await storage.save(selected, record);
      Object.assign(selected, record);
      render();
      dialog.close();
      status.textContent = "Media details saved.";
    } catch (error) {
      message.textContent = missingFeature(error) || error.code === "PGRST202" ? "Apply the editor upgrade to save media details." : error.message;
    } finally {
      save.disabled = close.disabled = remove.disabled = false;
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
  add.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const [file] = fileInput.files;
    fileInput.value = "";
    if (!file) return;
    add.disabled = true;
    try {
      const image = isSupportedImage(file);
      const alt = image ? promptImageAlt(file) : "";
      if (image && !alt) return;
      status.textContent = "Uploading " + file.name + "…";
      await storage.upload(file, alt);
      search.value = "";
      filter.value = "all";
      await load();
    } catch (error) { status.textContent = error.message; }
    finally { add.disabled = false; }
  });
  remove.addEventListener("click", async () => {
    if (!confirm("Permanently delete this media item?")) return;
    const asset = selected;
    save.disabled = close.disabled = remove.disabled = download.disabled = true;
    message.textContent = "Deleting…";
    try {
      await storage.remove(asset);
      catalog = catalog.filter(item => item !== asset);
      previews.delete(asset.id);
      covers.delete(asset.id);
      dialog.close();
      render();
      status.textContent = "Media deleted.";
    } catch (error) {
      message.textContent = error.code === "PGRST202" ? "Apply the writing desk workflow SQL to delete media." : error.message;
    } finally { save.disabled = close.disabled = remove.disabled = download.disabled = false; }
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
      covers.clear();
      grid.replaceChildren();
      if (dialog.open) dialog.close();
    },
  };
}
