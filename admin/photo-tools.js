import { allRows, imageSource, missingFeature, showFailure } from "./common.js";
import { loadImage, uploadImage } from "./editor-tools.js";
import { photoText } from "./photo-text.js";

const fields = "id,media_id,title,alt";
const activePhotos = "week=is.null&featured=eq.true";
const upgradeMessage = "Apply the Supabase Featured Photo upgrade to manage the homepage selection.";

export function setupPhotoTools(api, openLibrary, onMediaChange = () => {}) {
  const form = document.querySelector("#photo-form");
  const list = document.querySelector("#featured-photos");
  const count = document.querySelector("#featured-count");
  const files = form.elements.namedItem("files");
  const upload = document.querySelector("#photo-upload");
  const uploadDetails = document.querySelector("#photo-upload-details");
  const editPanel = document.querySelector("#photo-edit");
  const status = document.querySelector("#photo-status");
  const save = document.querySelector("#save-photo");
  const newPhoto = document.querySelector("#new-photo");
  const preview = document.querySelector("#photo-preview");
  const clear = document.querySelector("#clear-slideshow");
  const pick = document.querySelector("#pick-featured-photo");
  const remove = document.querySelector("#remove-featured-photo");
  let selected;
  let pending = [];
  let ready = false;
  let revision = 0;

  function clearImage(image) {
    image.hidden = true;
    image.removeAttribute("src");
    image.alt = "";
  }

  async function displayImage(target, photo, isCurrent) {
    clearImage(target);
    if (!photo) return;
    try {
      const src = imageSource(await loadImage(api, photo.media_id));
      if (!isCurrent() || !src) return;
      target.src = src;
      await target.decode();
      if (!isCurrent()) return;
      target.alt = photo.alt;
      target.hidden = false;
    } catch { /* The editor remains available when a preview cannot load. */ }
  }

  function edit(photo) {
    selected = photo;
    form.reset();
    pending = [];
    uploadDetails.replaceChildren();
    status.textContent = "";
    upload.hidden = files.disabled = Boolean(photo);
    editPanel.hidden = !photo;
    for (const name of ["title", "alt"]) {
      const field = form.elements.namedItem(name);
      field.value = photo?.[name] || "";
      field.required = Boolean(photo);
    }
    save.textContent = photo ? "Save photo" : "Feature photos";
    save.disabled = !ready || !photo;
    for (const button of list.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.id === photo?.id));
    }
    const frame = preview.parentElement;
    frame.hidden = !photo;
    if (photo) {
      frame.setAttribute("aria-busy", "true");
      void displayImage(preview, photo, () => selected === photo).finally(() => {
        if (selected === photo) {
          frame.removeAttribute("aria-busy");
          frame.hidden = preview.hidden;
        }
      });
    }
  }

  async function loadPhoto({ preserve = false } = {}) {
    const loading = ++revision;
    clear.disabled = true;
    if (!preserve) edit();
    status.textContent = "";
    ready = false;
    count.textContent = "Loading…";
    list.setAttribute("aria-busy", "true");
    list.innerHTML = '<li class="photo-placeholder" aria-hidden="true"></li>';
    save.disabled = newPhoto.disabled = pick.disabled = true;
    try {
      const photos = await allRows(api, "weekly_photos?select=" + fields + "&" + activePhotos + "&order=created_at.asc,id.asc");
      if (loading !== revision) return;
      list.replaceChildren();
      count.textContent = photos.length + (photos.length === 1 ? " photo" : " photos");
      if (!photos.length) {
        const empty = document.createElement("li");
        empty.className = "empty-selection";
        empty.textContent = "No photos featured.";
        list.append(empty);
      }
      for (const photo of photos) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.id = photo.id;
        button.textContent = photo.title;
        button.setAttribute("aria-pressed", String(photo.id === selected?.id));
        button.addEventListener("click", () => {
          edit(photo);
          form.elements.namedItem("title").focus();
        });
        item.append(button);
        list.append(item);
      }
      ready = true;
      clear.disabled = !photos.length;
      save.disabled = !selected && !pending.length;
    } catch (error) {
      if (loading !== revision) return;
      list.replaceChildren();
      count.textContent = "";
      showFailure(status, missingFeature(error) ? upgradeMessage : "Featured photos could not load.", () => loadPhoto({ preserve: true }));
    } finally {
      if (loading === revision) {
        list.removeAttribute("aria-busy");
        newPhoto.disabled = pick.disabled = false;
      }
    }
  }

  async function removePhotos(photo) {
    if (!ready || clear.disabled) return;
    if (!confirm(photo ? "Unfeature this photo? It will stay in Media." : "Clear the featured selection? The photos will stay in Media.")) return;
    clear.disabled = form.inert = true;
    status.textContent = photo ? "Unfeaturing photo…" : "Clearing the featured selection…";
    try {
      await api("weekly_photos?" + activePhotos + (photo ? "&id=eq." + photo.id : ""), {
        method: "PATCH", body: { featured: false }, prefer: "return=minimal",
      });
      await loadPhoto();
      if (ready) status.textContent = photo ? "Photo unfeatured. It is still in Media." : "Selection cleared. The photos are still in Media.";
    } catch (error) {
      status.textContent = error.message;
      clear.disabled = false;
    } finally { form.inert = false; }
  }
  clear.addEventListener("click", () => void removePhotos());
  remove.addEventListener("click", () => { if (selected) void removePhotos(selected); });

  newPhoto.addEventListener("click", () => { edit(); files.focus(); });
  function preparePhotos(entries) {
    pending = entries;
    uploadDetails.replaceChildren(...pending.map(entry => {
      const group = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = entry.file?.name || entry.title || "Image from Media";
      group.append(legend);
      for (const [name, title, maxLength] of [["title", "Photo title", 160], ["alt", "Alt text - describe what the image shows", 200]]) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        label.textContent = title;
        input.name = name + "-" + entry.id;
        input.required = true;
        input.maxLength = maxLength;
        input.value = entry[name];
        input.addEventListener("input", () => { entry[name] = input.value.trim(); });
        label.append(input);
        group.append(label);
      }
      return group;
    }));
    save.disabled = !ready || !pending.length;
  }
  files.addEventListener("change", () => {
    preparePhotos([...files.files].map(file => ({ file, id: crypto.randomUUID(), title: "", alt: "" })));
  });
  pick.addEventListener("click", () => openLibrary(image => {
    edit();
    preparePhotos([{ id: crypto.randomUUID(), media: image, title: image.title.slice(0, 160), alt: image.alt }]);
  }, () => pick.focus(), message => { status.textContent = message; }));

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (save.disabled) return;
    const formData = new FormData(form);
    const current = selected;
    save.disabled = newPhoto.disabled = true;
    form.inert = list.inert = true;
    try {
      if (current) {
        const record = {
          title: formData.get("title").trim(), alt: formData.get("alt").trim(),
        };
        if (!record.title || !record.alt) throw new Error("Enter a title and alt text.");
        if (!photoText(record.title) || !photoText(record.alt)) throw new Error("Use descriptive titles and alt text, without filenames or URLs.");
        status.textContent = "Saving photo…";
        const [saved] = await api("weekly_photos?" + activePhotos + "&id=eq." + current.id, {
          method: "PATCH", body: record, prefer: "return=representation",
        });
        if (!saved) throw new Error("The photo could not be saved.");
        edit(saved);
      } else {
        if (!pending.length) throw new Error("Choose one or more photos.");
        if (pending.some(entry => !photoText(entry.title) || !photoText(entry.alt))) throw new Error("Add a descriptive title and alt text for every photo, without filenames or URLs.");
        const rows = [];
        for (const [index, entry] of pending.entries()) {
          status.textContent = "Preparing photo " + (index + 1) + " of " + pending.length + "…";
          if (!entry.media) {
            entry.media = await uploadImage(api, entry.file, entry.alt);
            onMediaChange();
          }
          rows.push({ id: entry.id, week: null, media_id: entry.media.id, title: entry.title, alt: entry.alt, featured: true });
        }
        await api("weekly_photos?on_conflict=id", {
          method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=minimal",
        });
        edit();
      }
      await loadPhoto({ preserve: true });
      if (ready) status.textContent = current ? "Photo saved." : "Photos featured.";
    } catch (error) {
      status.textContent = missingFeature(error) || error.code === "23502" ? upgradeMessage : error.message;
      save.disabled = false;
    } finally {
      form.inert = list.inert = newPhoto.disabled = false;
    }
  });

  return { loadPhoto };
}
