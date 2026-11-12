import { allRows, imageSource, journalToday, missingFeature, weekOf } from "./common.js";
import { loadImage, uploadImage } from "./editor-tools.js";

const fields = "id,week,media_id,title,alt,description,featured";

export function setupPhotoTools(api) {
  const form = document.querySelector("#photo-form");
  const week = document.querySelector("#photo-week");
  const list = document.querySelector("#weekly-photos");
  const files = form.elements.namedItem("files");
  const details = document.querySelector("#photo-details");
  const status = document.querySelector("#photo-status");
  const save = document.querySelector("#save-photo");
  const newPhoto = document.querySelector("#new-photo");
  const preview = document.querySelector("#photo-preview");
  const overview = document.querySelector("#weekly-preview");
  const summary = document.querySelector("#weekly-summary");
  let selected;
  let pending = [];
  let revision = 0;
  let overviewRevision = 0;

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
    selected = photo;
    form.reset();
    pending = [];
    status.textContent = "";
    document.querySelector("#photo-editor-title").textContent = photo ? "Edit photo" : "Add photos";
    document.querySelector("#photo-files").hidden = files.disabled = Boolean(photo);
    document.querySelector("#photo-upload-help").hidden = Boolean(photo);
    files.required = !photo;
    details.hidden = !photo;
    for (const name of ["title", "alt", "description"]) {
      const field = form.elements.namedItem(name);
      field.value = photo?.[name] || "";
      field.required = Boolean(photo) && name !== "description";
    }
    form.elements.namedItem("featured").checked = photo?.featured ?? true;
    save.textContent = photo ? "Save photo" : "Add to this week";
    for (const button of list.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.id === photo?.id));
    }
    void displayImage(preview, photo, () => selected === photo);
  }

  async function loadOverview() {
    const loading = ++overviewRevision;
    try {
      const [photo] = await api("weekly_photos?select=media_id,alt&featured=eq.true&week=lte." + weekOf() +
        "&order=week.desc,created_at.asc,id.asc&limit=1");
      if (loading !== overviewRevision) return;
      summary.textContent = photo ? "Manage the homepage slideshow and its captions." : "Feature photographs on the journal homepage.";
      await displayImage(overview, photo, () => loading === overviewRevision);
    } catch { /* The Photos tab reports setup errors when opened. */ }
  }

  async function loadPhoto({ preserve = false } = {}) {
    const start = weekOf(week.value);
    const loading = ++revision;
    if (!start) { status.textContent = "Choose a date for the week."; return; }
    week.value = start;
    if (!preserve) edit();
    list.textContent = "Loading photos…";
    save.disabled = newPhoto.disabled = true;
    try {
      const photos = await allRows(api, "weekly_photos?select=" + fields + "&week=eq." + start + "&order=created_at.asc,id.asc");
      if (loading !== revision) return;
      list.replaceChildren();
      if (!photos.length) {
        const empty = document.createElement("li");
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
        button.addEventListener("click", () => edit(photo));
        item.append(button);
        list.append(item);
      }
      save.disabled = false;
    } catch (error) {
      if (loading !== revision) return;
      list.replaceChildren();
      status.textContent = missingFeature(error) ? "Apply the Supabase writing desk upgrade to manage weekly photos." : error.message;
    } finally {
      if (loading === revision) newPhoto.disabled = false;
    }
  }

  newPhoto.addEventListener("click", () => { edit(); files.focus(); });
  week.addEventListener("change", () => void loadPhoto());
  files.addEventListener("change", () => {
    pending = [...files.files].map(file => ({ file, id: crypto.randomUUID(), media: undefined }));
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
      if (!save.disabled) status.textContent = current ? "Photo saved." : "Photos added to the week.";
      void loadOverview();
    } catch (error) {
      status.textContent = missingFeature(error) ? "Apply the Supabase writing desk upgrade to manage weekly photos." : error.message;
      save.disabled = false;
    } finally {
      form.inert = list.inert = week.disabled = newPhoto.disabled = false;
    }
  });

  return {
    loadPhoto,
    loadOverview,
    clear() {
      revision++;
      overviewRevision++;
      week.value = weekOf();
      list.replaceChildren();
      edit();
      clearImage(overview);
      summary.textContent = "Feature photographs on the journal homepage.";
    },
  };
}
