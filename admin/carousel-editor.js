import { imageSource, readMediaImage } from "./common.js";
import { carouselSummary, photoResolution, readCarouselCatalog } from "./media-catalog.js";
import { coverPhoto } from "./carousel.js";

export function setupCarouselEditor(api, openImages, deletePhoto, movePhoto) {
  const dialog = document.querySelector("#carousel-dialog");
  const form = document.querySelector("#carousel-form");
  const chooser = document.querySelector("#carousel-chooser");
  const select = document.querySelector("#carousel-select");
  const startNew = document.querySelector("#carousel-new");
  const close = document.querySelector("#carousel-close");
  const add = document.querySelector("#carousel-add");
  const insert = document.querySelector("#carousel-insert");
  const save = document.querySelector("#carousel-save");
  const title = form.elements.namedItem("title");
  const status = document.querySelector("#carousel-status");
  const list = document.querySelector("#carousel-photos");
  const summary = document.querySelector("#carousel-summary");
  const autoCover = document.querySelector("#carousel-auto-cover");
  let groups = [];
  let current;
  let pick;
  let onClose;
  let changed;
  let busy = false;
  let observer;

  function render() {
    const asset = groups.find(group => group.id === current);
    const cover = coverPhoto(asset?.photos, asset?.cover_media_id);
    title.value = asset?.title || "";
    summary.textContent = asset ? carouselSummary(asset) : "";
    select.replaceChildren(new Option("New carousel", ""), ...groups.map(group =>
      new Option(group.title + " (" + group.photos.length + ")", group.id)));
    select.value = current || "";
    save.textContent = current ? "Save title" : "Create carousel";
    add.hidden = !asset;
    autoCover.hidden = !asset?.cover_media_id;
    insert.hidden = !pick;
    insert.disabled = !asset?.photos.length;
    list.replaceChildren();
    observer?.disconnect();
    const reveal = async image => {
      try {
        const src = imageSource(await readMediaImage(api, image.dataset.id));
        if (image.isConnected && src) image.src = src;
      } catch { /* Alt text remains available. */ }
    };
    observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void reveal(entry.target);
      }
    }, { root: dialog, rootMargin: "120px" }) : null;
    for (const [index, photo] of (asset?.photos || []).entries()) {
      const row = document.createElement("li");
      row.dataset.photo = photo.id;
      const image = document.createElement("img");
      image.alt = "";
      image.width = 72;
      image.height = 56;
      image.dataset.id = photo.id;
      const label = document.createElement("span");
      label.textContent = (index + 1) + ". " + (photo.alt || "Photo") + (photoResolution(photo) ? " · " + photoResolution(photo) : "");
      if (photo.id === cover?.id) {
        const marker = document.createElement("strong");
        marker.className = "carousel-cover-label";
        marker.textContent = "Cover";
        label.append(marker);
      }
      const controls = document.createElement("div");
      controls.className = "carousel-photo-actions";
      for (const [direction, glyph, action] of [[-1, "↑", "Move up"], [1, "↓", "Move down"]]) {
        const move = document.createElement("button");
        move.type = "button";
        move.dataset.move = direction;
        move.textContent = glyph;
        move.title = action;
        move.setAttribute("aria-label", action + " " + (photo.alt || "photo " + (index + 1)));
        move.disabled = index + direction < 0 || index + direction >= asset.photos.length;
        move.addEventListener("click", () => void change(async () => {
          if (!await movePhoto(current, photo.id, direction)) throw new Error("This photo is already at the end of the list or was removed.");
          return "Photo order updated.";
        }, photo.id, '[data-move="' + direction + '"]'));
        controls.append(move);
      }
      const chooseCover = document.createElement("button");
      chooseCover.type = "button";
      chooseCover.dataset.setCover = "";
      chooseCover.textContent = "Set cover";
      chooseCover.disabled = photo.id === asset.cover_media_id;
      chooseCover.setAttribute("aria-label", "Set " + (photo.alt || "photo " + (index + 1)) + " as cover");
      chooseCover.addEventListener("click", () => void change(() => setCover(photo.id), photo.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove from carousel";
      remove.addEventListener("click", () => void change(async () => {
        await api("carousel_photos?carousel_id=eq." + current + "&media_id=eq." + photo.id, { method: "DELETE" });
        return "Photo removed from the carousel.";
      }));
      const erase = document.createElement("button");
      erase.type = "button";
      erase.textContent = "Delete photo…";
      erase.addEventListener("click", () => {
        if (busy || !confirm("Permanently delete this photo from Media and the current carousel?")) return;
        void change(async () => {
          if (!await deletePhoto(current, photo.id)) throw new Error("This photo is no longer in the carousel.");
          return "Photo deleted.";
        });
      });
      controls.append(chooseCover, remove, erase);
      row.append(image, label, controls);
      list.append(row);
      if (observer) observer.observe(image);
      else void reveal(image);
    }
  }

  async function setCover(id) {
    await api("carousels?id=eq." + current, { method: "PATCH", body: { cover_media_id: id } });
    return id ? "Carousel cover updated." : "The first photo is now the cover.";
  }
  autoCover.addEventListener("click", () => void change(() => setCover(null)));

  async function change(action, focusPhoto, control = "[data-set-cover]") {
    if (busy) return;
    busy = true;
    for (const element of dialog.querySelectorAll("button, input, select")) element.disabled = true;
    status.textContent = "Saving…";
    try {
      const message = await action();
      changed = true;
      groups = await readCarouselCatalog(api);
      status.textContent = message;
    } catch (error) { status.textContent = error.message; }
    finally {
      busy = false;
      for (const element of dialog.querySelectorAll("button, input, select")) element.disabled = false;
      render();
      if (focusPhoto) {
        const row = [...list.children].find(item => item.dataset.photo === focusPhoto);
        const preferred = row?.querySelector(control);
        (preferred && !preferred.disabled ? preferred : row?.querySelector("button:not(:disabled)"))?.focus();
      }
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const name = title.value.trim();
    if (!name) { status.textContent = "Enter a title."; return; }
    void change(async () => {
      if (current) await api("carousels?id=eq." + current, { method: "PATCH", body: { title: name } });
      else {
        const [saved] = await api("carousels", { method: "POST", body: { title: name }, prefer: "return=representation" });
        current = saved.id;
      }
      return "Carousel saved.";
    });
  });
  select.addEventListener("change", () => { current = select.value || null; status.textContent = ""; render(); });
  startNew.addEventListener("click", () => { current = null; status.textContent = ""; render(); title.focus(); });
  add.addEventListener("click", () => openImages(photo => {
    if (groups.find(group => group.id === current)?.photos.some(item => photo.id === item.id)) throw new Error("This photo is already in the carousel.");
    return change(async () => {
      await api("carousel_photos", { method: "POST", body: { carousel_id: current, media_id: photo.id, alt: photo.alt || "" } });
      return "Photo added.";
    });
  }, () => { if (!busy) add.focus(); }, message => { status.textContent = message; }));
  insert.addEventListener("click", () => {
    try {
      if (pick && !insert.disabled) pick(groups.find(group => group.id === current));
      dialog.close();
    } catch (error) { status.textContent = error.message; }
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { observer?.disconnect(); onClose?.(changed); });

  return async ({ id, onPick, onClose: done }) => {
    if (dialog.open) return;
    groups = await readCarouselCatalog(api);
    current = id || null;
    pick = onPick;
    onClose = done;
    changed = false;
    chooser.hidden = !pick;
    status.textContent = "";
    render();
    dialog.showModal();
    (pick ? select : title).focus();
  };
}
