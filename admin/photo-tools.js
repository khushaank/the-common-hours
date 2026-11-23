import { allRows, imageSource, journalToday, missingFeature, weekOf } from "./common.js";
import { loadImage, uploadImage } from "./editor-tools.js";
import { photoText } from "./photo-text.js";

const fields = "id,week,media_id,title,alt,featured";

async function refreshPublicPhotos() {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open("common-hours-public-v1");
    await cache.delete(new URL("../?__journal_cache=featured-v5", location.href));
  } catch { /* Public pages recheck soon if storage is unavailable. */ }
}

export function setupPhotoTools(api, openLibrary) {
  const form = document.querySelector("#photo-form");
  const week = document.querySelector("#photo-week");
  const list = document.querySelector("#weekly-photos");
  const count = document.querySelector("#weekly-count");
  const files = form.elements.namedItem("files");
  const upload = document.querySelector("#photo-upload");
  const uploadDetails = document.querySelector("#photo-upload-details");
  const editPanel = document.querySelector("#photo-edit");
  const status = document.querySelector("#photo-status");
  const save = document.querySelector("#save-photo");
  const newPhoto = document.querySelector("#new-photo");
  const preview = document.querySelector("#photo-preview");
  const clear = document.querySelector("#clear-slideshow");
  const pick = document.querySelector("#pick-week-photo");
  const remove = document.querySelector("#remove-week-photo");
  let selected;
  let pending = [];
  let ready = false;
  let revision = 0;
  const currentWeek = () => weekOf(week.value);

  week.value = weekOf();

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
    const start = week.value;
    selected = photo;
    form.reset();
    week.value = start;
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
    save.textContent = photo ? "Save photo" : "Add to week";
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
    const start = currentWeek();
    const loading = ++revision;
    clear.disabled = true;
    if (!start) {
      ready = false;
      save.disabled = true;
      count.textContent = "";
      list.replaceChildren();
      list.removeAttribute("aria-busy");
      status.textContent = "Choose a date for the week.";
      return;
    }
    week.value = start;
    if (!preserve) edit();
    ready = false;
    count.textContent = "Loading…";
    list.setAttribute("aria-busy", "true");
    list.innerHTML = '<li class="photo-placeholder" aria-hidden="true"></li>';
    save.disabled = newPhoto.disabled = pick.disabled = true;
    try {
      const photos = await allRows(api, "weekly_photos?select=" + fields + "&week=eq." + start +
        "&featured=eq.true&order=created_at.desc,id.desc");
      if (loading !== revision) return;
      list.replaceChildren();
      count.textContent = photos.length + (photos.length === 1 ? " photo" : " photos");
      if (!photos.length) {
        const empty = document.createElement("li");
        empty.className = "empty-week";
        empty.textContent = "No photos for this week.";
        list.append(empty);
      }
      for (const photo of photos) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        const state = document.createElement("small");
        button.type = "button";
        button.dataset.id = photo.id;
        button.textContent = photo.title;
        button.setAttribute("aria-pressed", String(photo.id === selected?.id));
        state.textContent = photo.week > journalToday() ? "Scheduled" : "In slideshow";
        button.append(state);
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
      status.textContent = missingFeature(error) ? "Apply the Supabase writing desk upgrade to manage weekly photos." : error.message;
    } finally {
      if (loading === revision) {
        list.removeAttribute("aria-busy");
        newPhoto.disabled = pick.disabled = false;
      }
    }
  }

  async function removePhotos(photo) {
    const start = weekOf(week.value);
    if (!ready || clear.disabled || !start) return;
    if (!confirm(photo ? "Remove this photo from the week? It will stay in Media." : "Clear this week’s slideshow? The photos will stay in Media.")) return;
    clear.disabled = form.inert = week.disabled = true;
    status.textContent = "Clearing the slideshow queue…";
    try {
      await api("weekly_photos?week=eq." + start + "&featured=eq.true" + (photo ? "&id=eq." + photo.id : ""), {
        method: "PATCH", body: { featured: false }, prefer: "return=minimal",
      });
      await refreshPublicPhotos();
      await loadPhoto();
      if (ready) status.textContent = photo ? "Photo removed from the week. It is still in Media." : "Slideshow cleared. The photos are still in Media.";
    } catch (error) {
      status.textContent = error.message;
      clear.disabled = false;
    } finally { form.inert = week.disabled = false; }
  }
  clear.addEventListener("click", () => void removePhotos());
  remove.addEventListener("click", () => { if (selected) void removePhotos(selected); });

  newPhoto.addEventListener("click", () => { edit(); files.focus(); });
  week.addEventListener("change", () => void loadPhoto());
  function preparePhotos(entries) {
    pending = entries;
    uploadDetails.replaceChildren(...pending.map(entry => {
      const group = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = entry.file?.name || entry.title || "Image from Media";
      group.append(legend);
      for (const [name, title, maxLength] of [["title", "Photo title", 160], ["alt", "Alt text — describe what the image shows", 200]]) {
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
    const start = currentWeek();
    if (!start) { status.textContent = "Choose a date for the week."; return; }
    const formData = new FormData(form);
    const current = selected;
    save.disabled = week.disabled = newPhoto.disabled = true;
    form.inert = list.inert = true;
    try {
      if (current) {
        const record = {
          title: formData.get("title").trim(), alt: formData.get("alt").trim(),
        };
        if (!record.title || !record.alt) throw new Error("Enter a title and alt text.");
        if (!photoText(record.title) || !photoText(record.alt)) throw new Error("Use descriptive titles and alt text, without filenames or URLs.");
        status.textContent = "Saving photo…";
        const [saved] = await api("weekly_photos?id=eq." + current.id, {
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
          entry.media ??= await uploadImage(api, entry.file, entry.alt);
          rows.push({ id: entry.id, week: start, media_id: entry.media.id, title: entry.title, alt: entry.alt, featured: true });
        }
        await api("weekly_photos?on_conflict=id", {
          method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=minimal",
        });
        edit();
      }
      await refreshPublicPhotos();
      await loadPhoto({ preserve: true });
      if (ready) status.textContent = current ? "Photo saved." : "Photos added to the week.";
    } catch (error) {
      status.textContent = missingFeature(error) ? "Apply the Supabase writing desk upgrade to manage weekly photos." : error.message;
      save.disabled = false;
    } finally {
      form.inert = list.inert = week.disabled = newPhoto.disabled = false;
    }
  });

  return { loadPhoto };
}
