import { allRows, imageSource, journalToday, missingColumn, missingFeature, weekOf } from "./common.js";
import { loadImage, uploadImage } from "./editor-tools.js";

const fields = "id,week,media_id,title,alt,description,featured";

export function setupPhotoTools(api) {
  const form = document.querySelector("#photo-form");
  const week = document.querySelector("#photo-week");
  const list = document.querySelector("#weekly-photos");
  const count = document.querySelector("#weekly-count");
  const files = form.elements.namedItem("files");
  const upload = document.querySelector("#photo-upload");
  const editPanel = document.querySelector("#photo-edit");
  const status = document.querySelector("#photo-status");
  const save = document.querySelector("#save-photo");
  const newPhoto = document.querySelector("#new-photo");
  const preview = document.querySelector("#photo-preview");
  const clear = document.querySelector("#clear-slideshow");
  let selected;
  let pending = [];
  let ready = false;
  let revision = 0;
  let supportsSeries = true;

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
    status.textContent = "";
    upload.hidden = files.disabled = Boolean(photo);
    editPanel.hidden = !photo;
    files.required = !photo;
    for (const name of ["title", "alt", "description", "series"]) {
      const field = form.elements.namedItem(name);
      field.value = photo?.[name] || "";
      field.required = Boolean(photo) && (name === "title" || name === "alt");
    }
    form.elements.namedItem("featured").checked = photo?.featured ?? true;
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
    const start = weekOf(week.value);
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
    save.disabled = newPhoto.disabled = true;
    try {
      const filter = "&week=eq." + start + "&order=created_at.asc,id.asc";
      let photos;
      try { photos = await allRows(api, "weekly_photos?select=" + fields + ",series" + filter); }
      catch (error) {
        if (!missingColumn(error)) throw error;
        supportsSeries = false;
        photos = await allRows(api, "weekly_photos?select=" + fields + filter);
      }
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
        state.textContent = photo.featured ? (photo.week > journalToday() ? "Scheduled" : "In slideshow") : "Archive only";
        button.append(state);
        button.addEventListener("click", () => {
          edit(photo);
          form.elements.namedItem("title").focus();
        });
        item.append(button);
        list.append(item);
      }
      ready = true;
      clear.disabled = !photos.some(photo => photo.featured);
      save.disabled = !selected && !pending.length;
    } catch (error) {
      if (loading !== revision) return;
      list.replaceChildren();
      count.textContent = "";
      status.textContent = missingFeature(error) ? "Apply the Supabase writing desk upgrade to manage weekly photos." : error.message;
    } finally {
      if (loading === revision) {
        list.removeAttribute("aria-busy");
        newPhoto.disabled = false;
      }
    }
  }

  clear.addEventListener("click", async () => {
    const start = weekOf(week.value);
    if (!ready || clear.disabled || !start) return;
    if (!confirm("Clear this week’s slideshow queue? The photos will stay in the archive.")) return;
    clear.disabled = form.inert = week.disabled = true;
    status.textContent = "Clearing the slideshow queue…";
    try {
      await api("weekly_photos?week=eq." + start + "&featured=eq.true", {
        method: "PATCH", body: { featured: false }, prefer: "return=minimal",
      });
      if (selected) form.elements.namedItem("featured").checked = false;
      await loadPhoto({ preserve: true });
      if (ready) status.textContent = "Slideshow queue cleared. The photos are still in the archive.";
    } catch (error) {
      status.textContent = error.message;
      clear.disabled = false;
    } finally { form.inert = week.disabled = false; }
  });

  newPhoto.addEventListener("click", () => { edit(); files.focus(); });
  week.addEventListener("change", () => void loadPhoto());
  files.addEventListener("change", () => {
    pending = [...files.files].map(file => ({ file, id: crypto.randomUUID(), media: undefined }));
    save.disabled = !ready || !pending.length;
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (save.disabled) return;
    const start = weekOf(week.value);
    if (!start) { status.textContent = "Choose a date for the week."; return; }
    const formData = new FormData(form);
    const current = selected;
    save.disabled = week.disabled = newPhoto.disabled = true;
    form.inert = list.inert = true;
    try {
      if (current) {
        const record = {
          title: formData.get("title").trim(), alt: formData.get("alt").trim(),
          description: formData.get("description").trim(), featured: formData.has("featured"),
        };
        const series = formData.get("series").trim();
        if (supportsSeries) record.series = series;
        else if (series) throw new Error("Apply the editor upgrade to save photo series.");
        if (!record.title || !record.alt) throw new Error("Enter a title and alt text.");
        status.textContent = "Saving photo…";
        const [saved] = await api("weekly_photos?id=eq." + current.id, {
          method: "PATCH", body: record, prefer: "return=representation",
        });
        if (!saved) throw new Error("The photo could not be saved.");
        edit(saved);
      } else {
        if (!pending.length) throw new Error("Choose one or more photos.");
        const rows = [];
        for (const [index, entry] of pending.entries()) {
          status.textContent = "Preparing photo " + (index + 1) + " of " + pending.length + "…";
          entry.media ??= await uploadImage(api, entry.file);
          const title = entry.file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 160) || "Untitled photo";
          rows.push({ id: entry.id, week: start, media_id: entry.media.id, title, alt: title });
        }
        await api("weekly_photos?on_conflict=id", {
          method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=minimal",
        });
        edit();
      }
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
