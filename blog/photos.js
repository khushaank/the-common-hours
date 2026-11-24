import { allRows, archivePhotoWeek, escape, imageSource, mediaId, missingFeature, readMediaImage, showFailure } from "./common.js";
import { publicData } from "./public-cache.js";
import { photoText, photoTitle, publicPhoto } from "./photo-text.js";

const weeklyFields = "id,week,media_id,title,alt,created_at";
const legacyFields = "month,media_id,alt,caption";
const cover = {
  id: "cover", title: "From the journal",
  alt: "A wooden jetty reaches into a mist-covered lake",
};
const dateLabel = (date, options) => new Date(date + "T00:00:00Z").toLocaleDateString("en", { timeZone: "UTC", ...options });

function legacyPhoto(photo) {
  return { ...photo, id: "month-" + photo.month.slice(0, 7), title: photo.caption || "From the journal" };
}

async function optional(task) {
  try { return await task; }
  catch (error) { if (missingFeature(error)) return []; throw error; }
}

async function getImage(get, photo, options) {
  if (photo.id === cover.id) return { src: "cover.jpg", width: 1200, height: 800 };
  const snapshot = featuredSnapshot();
  if (snapshot?.first?.id === photo.id && snapshot.first.media_id === photo.media_id &&
      typeof snapshot.version === "string" && /^[0-9a-f]{16}$/.test(snapshot.version)) {
    return { src: "featured.webp?v=" + encodeURIComponent(snapshot.version), width: snapshot.width, height: snapshot.height };
  }
  const record = await publicData("image:" + photo.media_id, () => readMediaImage(get, photo.media_id, options), 0);
  const src = imageSource(record);
  if (!src) throw new Error("Photo unavailable.");
  return { src, width: record.width, height: record.height, alt: record.alt };
}

function featuredSnapshot() {
  try { return JSON.parse(document.querySelector("#featured-snapshot")?.dataset.value || "null"); }
  catch { return null; }
}

async function featurePhotos(get) {
  const options = { timeout: 5000 };
  const rows = await allRows(path => get(path, options),
    "weekly_photos?select=" + weeklyFields + "&week=is.null&featured=eq.true&order=created_at.asc,id.asc");
  return rows.length ? rows : [cover];
}

export async function startSlideshow(get, demo) {
  const figure = document.querySelector("#week-photo");
  const picture = figure.querySelector("img");
  const caption = figure.querySelector("#photo-caption");
  const status = document.querySelector("#featured-photo-status");
  const nextButton = figure.querySelector("#slide-next");
  const count = figure.querySelector("#slide-count");
  const slide = figure.querySelector(".slide");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let hovered = false;
  let timer;
  let revision = 0;
  let index = 0;
  let requestedIndex = 0;
  const images = new Map();

  if (!photoTitle(caption.textContent)) {
    caption.textContent = "";
    caption.setAttribute("aria-busy", "true");
  }
  status.hidden = true;

  function photoFailure(message, retry) {
    figure.removeAttribute("aria-busy");
    caption.removeAttribute("aria-busy");
    status.hidden = false;
    showFailure(status, message, retry, "Try again", () => { status.hidden = true; });
  }

  let photos;
  try {
    photos = demo ? [cover] : await featurePhotos(get);
  } catch {
    photoFailure("Featured photos could not load.", () => startSlideshow(get, demo));
    return;
  }
  if (!photos.length) photos.push(cover);
  if (photos.length > 1) {
    slide.tabIndex = 0;
    slide.setAttribute("aria-label", "Photo carousel. Use Left and Right arrow keys to change photos.");
  }

  function schedule() {
    clearTimeout(timer);
    if (!motion.matches && !hovered && !slide.hasAttribute("data-controls-open") &&
        !slide.contains(document.activeElement) && !document.hidden && photos.length > 1) {
      timer = setTimeout(() => void show(requestedIndex + 1), 10000);
    }
  }

  function prepare(photo) {
    if (!images.has(photo.id)) images.set(photo.id, getImage(get, photo, { timeout: 6500 }).catch(error => {
      images.delete(photo.id);
      throw error;
    }));
    return images.get(photo.id);
  }

  async function show(next) {
    clearTimeout(timer);
    const loading = ++revision;
    requestedIndex = (next % photos.length + photos.length) % photos.length;
    const target = requestedIndex;
    const photo = photos[target];
    status.hidden = true;
    let data;
    try {
      data = await prepare(photo);
      if (data.src !== picture.getAttribute("src") || (picture.complete && !picture.naturalWidth)) {
        const ready = new Image();
        ready.src = data.src;
        try { await ready.decode(); }
        catch (error) {
          if (!data.src.startsWith("featured.webp?") || !photo.media_id) throw error;
          const live = await readMediaImage(get, photo.media_id, { timeout: 6500 });
          const src = imageSource(live);
          if (!src) throw error;
          ready.src = src;
          await ready.decode();
          data = { ...live, src };
          images.set(photo.id, Promise.resolve(data));
        }
      }
    } catch {
      if (loading !== revision) return;
      if (!picture.hasAttribute("src") && next < photos.length - 1) { await show(next + 1); return; }
      photoFailure("This photo could not load.", () => show(target));
      nextButton.hidden = figure.hidden || photos.length < 2;
      return;
    }
    if (loading !== revision) return;
    index = target;
    const details = publicPhoto(photo, data.alt);
    picture.alt = details.alt;
    picture.width = data.width;
    picture.height = data.height;
    if (data.src !== picture.getAttribute("src")) picture.src = data.src;
    figure.hidden = false;
    figure.removeAttribute("aria-busy");
    caption.removeAttribute("aria-busy");
    caption.textContent = photoTitle(photo.title);
    count.textContent = photos.length > 1 ? (index + 1) + " / " + photos.length : "";
    nextButton.hidden = photos.length < 2;
    if (photos.length > 1) void prepare(photos[(index + 1) % photos.length]).catch(() => {});
    schedule();
  }

  nextButton.addEventListener("click", () => void show(requestedIndex + 1));
  slide.addEventListener("keydown", event => {
    if (photos.length < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    void show(requestedIndex + (event.key === "ArrowRight" ? 1 : -1));
  });
  let drag;
  slide.addEventListener("pointerdown", event => {
    if (photos.length < 2 || !event.isPrimary || event.button !== 0 || event.target.closest("button")) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    slide.setPointerCapture(event.pointerId);
  });
  slide.addEventListener("pointerup", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const x = event.clientX - drag.x, y = event.clientY - drag.y;
    drag = undefined;
    if (Math.abs(x) > 40 && Math.abs(x) > Math.abs(y) * 1.3) void show(requestedIndex + (x < 0 ? 1 : -1));
    else if (Math.abs(x) < 12 && Math.abs(y) < 12 &&
        (event.pointerType !== "mouse" || matchMedia("(max-width: 760px)").matches)) {
      slide.toggleAttribute("data-controls-open");
      schedule();
    }
  });
  slide.addEventListener("lostpointercapture", event => { if (event.pointerId === drag?.id) drag = undefined; });
  slide.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") { hovered = true; schedule(); } });
  slide.addEventListener("pointerleave", () => { hovered = false; schedule(); });
  slide.addEventListener("focusin", schedule);
  slide.addEventListener("focusout", () => setTimeout(schedule, 0));
  motion.addEventListener("change", schedule);
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("pointerdown", event => {
    if (!slide.hasAttribute("data-controls-open") || slide.contains(event.target)) return;
    slide.removeAttribute("data-controls-open");
    schedule();
  });
  await show(0);
}

function photoDate(photo) {
  if (photo.month) return dateLabel(photo.month, { month: "long", year: "numeric" });
  const date = photo.week && photo.week !== archivePhotoWeek ? photo.week : photo.created_at?.slice(0, 10);
  return date ? dateLabel(date, { month: "long", day: "numeric", year: "numeric" }) : "";
}

async function showImage(get, picture, photo) {
  const frame = picture.parentElement;
  try {
    const data = await getImage(get, photo);
    picture.alt = publicPhoto(photo, data.alt).alt;
    picture.width = data.width;
    picture.height = data.height;
    picture.src = data.src;
    try { await picture.decode(); }
    catch (error) {
      if (!data.src.startsWith("featured.webp?")) throw error;
      const live = await publicData("image:" + photo.media_id, () => readMediaImage(get, photo.media_id), 0);
      const src = imageSource(live);
      if (!src) throw error;
      picture.width = live.width;
      picture.height = live.height;
      picture.src = src;
      await picture.decode();
    }
    frame.classList.add("photo-ready");
  } catch {
    const unavailable = document.createElement("div");
    unavailable.className = "photo-unavailable";
    frame.replaceChildren(unavailable);
    showFailure(unavailable, "This photo could not load.", () => {
      frame.replaceChildren(picture);
      return showImage(get, picture, photo);
    });
  }
}

async function loadArchivePhoto(get, id) {
  if (mediaId.test(id || "")) {
    const [photo] = await publicData("photo-detail:" + id, () => optional(get("weekly_photos?select=" + weeklyFields + "&id=eq." + id)), 0);
    return photo;
  }
  if (/^month-\d{4}-(0[1-9]|1[0-2])$/.test(id || "")) {
    const [photo] = await publicData("photo-detail:" + id, () => optional(get("photos?select=" + legacyFields + "&month=eq." + id.slice(6) + "-01")), 0);
    if (photo) return legacyPhoto(photo);
  }
}

export async function renderPhotoView(content, get, demo, id) {
  const backLink = '<a class="back" href="./#featured-photo">← Featured Photo</a>';

  const record = id === cover.id ? cover : demo ? undefined : await loadArchivePhoto(get, id);
  if (!record) {
    document.title = "Photo unavailable - The Common Hours";
    content.innerHTML = backLink + "<h1>Photo unavailable</h1>";
    return;
  }
  const photo = publicPhoto(record);
  document.title = photo.title + " - The Common Hours";
  const current = content.querySelector(".photo-detail");
  const existing = current?.querySelector("img[src]");
  if (existing && current.dataset.photoMedia === photo.media_id && content.dataset.refreshPending === undefined &&
      (!existing.complete || existing.naturalWidth)) {
    current.querySelector("h1").textContent = photo.title;
    if (photoText(record.alt)) existing.alt = photo.alt;
    return;
  }
  const date = photoDate(photo);
  content.innerHTML = backLink + '<article class="photo-detail" data-photo-media="' + escape(photo.media_id || "") + '"><h1>' + escape(photo.title) + '</h1>' +
    (date ? '<p class="meta">' + escape(date) + '</p>' : '') +
    '<div class="photo-detail-image"><img width="1200" height="800" alt="' + escape(photo.alt) + '" draggable="false" decoding="async" fetchpriority="high"></div></article>';
  void showImage(get, content.querySelector(".photo-detail img"), record);
}
