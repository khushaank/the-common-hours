import { allRows, archivePhotoWeek, escape, imageSource, mediaId, missingColumn, missingFeature, readMediaImage, weekOf } from "./common.js";
import { publicData } from "./public-cache.js";

const weeklyFields = "id,week,media_id,title,alt,created_at";
const legacyFields = "month,media_id,alt,caption";
const cover = {
  id: "cover", title: "From the journal",
  alt: "A wooden jetty reaches into a mist-covered lake",
};
const photoLink = id => "?view=photo&photo=" + encodeURIComponent(id);
const dateLabel = (date, options) => new Date(date + "T00:00:00Z").toLocaleDateString("en", { timeZone: "UTC", ...options });

function legacyPhoto(photo) {
  return { ...photo, id: "month-" + photo.month.slice(0, 7), title: photo.caption || "From the journal" };
}

function archiveDate(photo) {
  return photo.week === archivePhotoWeek ? photo.created_at?.slice(0, 10) || archivePhotoWeek : photo.week || photo.month;
}

async function optional(task) {
  try { return await task; }
  catch (error) { if (missingFeature(error)) return []; throw error; }
}

async function getImage(get, photo, options) {
  if (photo.id === cover.id) return { src: "cover.jpg", width: 1200, height: 800 };
  const snapshot = featuredSnapshot();
  if (snapshot?.first?.id === photo.id && snapshot.first.media_id === photo.media_id) {
    return { src: "featured.webp?v=" + snapshot.version, width: snapshot.width, height: snapshot.height };
  }
  const record = await publicData("image:" + photo.media_id, () => readMediaImage(get, photo.media_id, options));
  const src = imageSource(record);
  if (!src) throw new Error("Photo unavailable.");
  return { src, width: record.width, height: record.height, alt: record.alt };
}

function featuredSnapshot() {
  return JSON.parse(document.querySelector("#featured-snapshot")?.dataset.value || "null");
}

async function featurePhotos(get) {
  const options = { timeout: 5000 };
  const rows = await optional(get("weekly_photos?select=" + weeklyFields + ",featured&and=(week.lte." + weekOf() +
    ",week.neq." + archivePhotoWeek + ")&order=week.desc,created_at.asc,id.asc&limit=100", options));
  if (rows.length) {
    const week = rows[0].week;
    if (rows.length === 100 && rows.at(-1).week === week) return allRows(path => get(path, options),
      "weekly_photos?select=" + weeklyFields + "&featured=eq.true&week=eq." + week + "&order=created_at.asc,id.asc");
    return rows.filter(photo => photo.week === week && photo.featured);
  }
  return [cover];
}

export async function startSlideshow(get, demo) {
  const figure = document.querySelector("#week-photo");
  figure.hidden = false;
  const picture = figure.querySelector("img");
  const caption = figure.querySelector("#photo-caption");
  const nextButton = figure.querySelector("#slide-next");
  const prevButton = figure.querySelector("#slide-prev");
  const count = figure.querySelector("#slide-count");
  const slide = figure.querySelector(".slide");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let hovered = false;
  let timer;
  let revision = 0;
  let index = 0;
  let requestedIndex = 0;
  const images = new Map();

  const photos = demo ? [cover] : await publicData("featured-v5", () => featurePhotos(get)).catch(() => []);
  if (!photos.length) { figure.hidden = true; return; }
  if (photos.length > 1) {
    slide.tabIndex = 0;
    slide.setAttribute("aria-label", "Photo carousel. Use Left and Right arrow keys to change photos.");
  }

  function schedule() {
    clearTimeout(timer);
    if (!motion.matches && !hovered && !slide.contains(document.activeElement) && !document.hidden && photos.length > 1) {
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
    requestedIndex = (next + photos.length) % photos.length;
    const target = requestedIndex;
    const photo = photos[target];
    let data;
    try {
      data = await prepare(photo);
      if (data.src !== picture.getAttribute("src")) {
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
      if (picture.hasAttribute("src")) { schedule(); return; }
      if (next < photos.length - 1) { await show(next + 1); return; }
      figure.hidden = true;
      return;
    }
    if (loading !== revision) return;
    index = target;
    picture.alt = photo.alt || data.alt || "";
    picture.width = data.width;
    picture.height = data.height;
    if (data.src !== picture.getAttribute("src")) picture.src = data.src;
    figure.removeAttribute("aria-busy");
    caption.textContent = photo.title;
    count.textContent = photos.length > 1 ? (index + 1) + " / " + photos.length : "";
    prevButton.hidden = nextButton.hidden = photos.length < 2;
    if (photos.length > 1) void prepare(photos[(index + 1) % photos.length]).catch(() => {});
    schedule();
  }

  nextButton.addEventListener("click", () => void show(requestedIndex + 1));
  prevButton.addEventListener("click", () => void show(requestedIndex - 1));
  slide.addEventListener("keydown", event => {
    if (photos.length < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    void show(requestedIndex + (event.key === "ArrowRight" ? 1 : -1));
  });
  let touch;
  slide.addEventListener("pointerdown", event => {
    if (event.isPrimary && event.pointerType !== "mouse" && !event.target.closest("button")) {
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  });
  slide.addEventListener("pointerup", event => {
    if (!touch || event.pointerId !== touch.id) return;
    const x = event.clientX - touch.x, y = event.clientY - touch.y;
    touch = undefined;
    if (photos.length > 1 && Math.abs(x) > 40 && Math.abs(x) > Math.abs(y) * 1.3) void show(requestedIndex + (x < 0 ? 1 : -1));
  });
  slide.addEventListener("pointercancel", () => { touch = undefined; });
  slide.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") { hovered = true; schedule(); } });
  slide.addEventListener("pointerleave", () => { hovered = false; schedule(); });
  slide.addEventListener("focusin", schedule);
  slide.addEventListener("focusout", () => setTimeout(schedule, 0));
  motion.addEventListener("change", schedule);
  document.addEventListener("visibilitychange", schedule);
  await show(0);
}

function photoDate(photo) {
  if (photo.week === archivePhotoWeek) return dateLabel(archiveDate(photo), { month: "long", day: "numeric", year: "numeric" });
  return photo.week ? "Week of " + dateLabel(photo.week, { month: "long", day: "numeric", year: "numeric" }) :
    photo.month ? dateLabel(photo.month, { month: "long", year: "numeric" }) : "";
}

async function showImage(get, picture, photo) {
  const frame = picture.parentElement;
  picture.title = photo.alt;
  try {
    const data = await getImage(get, photo);
    picture.alt = photo.alt || data.alt || "";
    picture.title = picture.alt;
    picture.width = data.width;
    picture.height = data.height;
    picture.src = data.src;
    try { await picture.decode(); }
    catch (error) {
      if (!data.src.startsWith("featured.webp?")) throw error;
      const live = await publicData("image:" + photo.media_id, () => readMediaImage(get, photo.media_id));
      const src = imageSource(live);
      if (!src) throw error;
      picture.width = live.width;
      picture.height = live.height;
      picture.src = src;
      await picture.decode();
    }
    frame.classList.add("photo-ready");
  } catch {
    const unavailable = document.createElement("span");
    unavailable.className = "photo-unavailable";
    unavailable.textContent = "Photo unavailable";
    frame.replaceChildren(unavailable);
  }
}

function archiveCard(photo) {
  return '<li><a href="' + escape(photoLink(photo.id)) + '"><div class="photo-thumb"><img width="320" height="213" decoding="async" alt="' +
    escape(photo.alt) + '"></div><div class="photo-card-caption"><strong>' + escape(photo.title) + '</strong><small>' + escape(photoDate(photo)) +
    (photo.series ? ' · ' + escape(photo.series) : '') + '</small></div></a></li>';
}

async function archiveWeekly(get) {
  const order = "&order=week.desc,created_at.asc,id.asc";
  try { return await optional(allRows(get, "weekly_photos?select=" + weeklyFields + ",series" + order)); }
  catch (error) {
    if (!missingColumn(error)) throw error;
    return optional(allRows(get, "weekly_photos?select=" + weeklyFields + order));
  }
}

export async function renderPhotoView(content, get, demo, view, id) {
  const archiveLink = '<a class="back" href="?view=photos">← Photo archive</a>';
  if (view === "photos") {
    document.title = "Photo archive — The Common Hours";
    const [weekly, legacy] = demo ? [[], []] : await publicData("photo-archive", () => Promise.all([
      archiveWeekly(get),
      optional(allRows(get, "photos?select=" + legacyFields + "&order=month.desc")),
    ]));
    const photos = [...weekly, ...legacy.map(legacyPhoto)].sort((a, b) =>
      archiveDate(b).localeCompare(archiveDate(a)));
    const archive = content.querySelector(".photo-archive");
    archive.classList.remove("route-skeleton");
    content.querySelectorAll(".route-skeleton, .loading").forEach(item => item.remove());
    const year = content.querySelector("#photo-year");
    const month = content.querySelector("#photo-month");
    const series = content.querySelector("#photo-series");
    const result = content.querySelector("#photo-results");
    const count = content.querySelector("#photo-count");
    const clear = content.querySelector("#photo-clear");
    const params = new URLSearchParams(location.search);
    const photoMonth = photo => archiveDate(photo).slice(0, 7);
    const photoYear = photo => photoMonth(photo).slice(0, 4);
    const unique = values => [...new Set(values)];
    year.replaceChildren(new Option("All years", ""), ...unique(photos.map(photoYear)).map(name => new Option(name)));
    series.replaceChildren(new Option("All series", ""), ...[...new Set(photos.map(photo => photo.series).filter(Boolean))].sort().map(name => new Option(name)));
    const choose = (select, value) => { select.value = [...select.options].some(option => option.value === value) ? value : ""; };
    function loadMonths(value) {
      const months = unique(photos.filter(photo => !year.value || photoYear(photo) === year.value).map(photoMonth));
      month.replaceChildren(new Option("All months", ""), ...months.map(key => new Option(
        dateLabel(key + "-01", { month: "long", ...(year.value ? {} : { year: "numeric" }) }), key)));
      choose(month, value);
    }
    choose(year, params.get("year"));
    choose(series, params.get("series"));
    loadMonths(params.get("month"));
    for (const input of [year, month, series]) input.disabled = false;
    let observer;
    const cards = new Map();
    const grid = document.createElement("ul");
    grid.className = "photo-grid";
    result.replaceChildren(grid);
    const empty = document.createElement("p");
    empty.className = "photo-empty";
    empty.textContent = photos.length ? "No photos match these filters." : "There are no photos in the archive yet.";
    result.append(empty);
    function render() {
      observer?.disconnect();
      const matches = photos.filter(photo => (!year.value || photoYear(photo) === year.value) &&
        (!month.value || photoMonth(photo) === month.value) && (!series.value || photo.series === series.value));
      count.textContent = matches.length + (matches.length === 1 ? " photo" : " photos");
      clear.disabled = !(year.value || month.value || series.value);
      empty.hidden = Boolean(matches.length);
      grid.hidden = !matches.length;
      const byPicture = new Map();
      grid.replaceChildren(...matches.map(photo => {
        if (!cards.has(photo.id)) {
          const card = document.createElement("template");
          card.innerHTML = archiveCard(photo);
          cards.set(photo.id, card.content.firstElementChild);
        }
        const item = cards.get(photo.id);
        const picture = item.querySelector("img:not([data-requested])");
        if (picture) byPicture.set(picture, photo);
        return item;
      }));
      const reveal = (picture, photo) => {
        picture.dataset.requested = "";
        void showImage(get, picture, photo);
      };
      if (typeof IntersectionObserver !== "function") { byPicture.forEach((photo, image) => reveal(image, photo)); return; }
      observer = new IntersectionObserver(entries => {
        for (const { isIntersecting, target } of entries) {
          if (!isIntersecting) continue;
          observer.unobserve(target);
          reveal(target, byPicture.get(target));
        }
      }, { rootMargin: "180px" });
      byPicture.forEach((_, picture) => observer.observe(picture));
    }
    const update = () => {
      const state = new URLSearchParams({ view: "photos" });
      if (year.value) state.set("year", year.value);
      if (month.value) state.set("month", month.value);
      if (series.value) state.set("series", series.value);
      history.replaceState(null, "", "?" + state);
      render();
    };
    year.addEventListener("change", () => { loadMonths(month.value); update(); });
    month.addEventListener("change", update);
    series.addEventListener("change", update);
    clear.addEventListener("click", () => { year.value = series.value = ""; loadMonths(""); update(); });
    render();
    return;
  }

  let photo = id === cover.id ? cover : undefined;
  if (!demo && mediaId.test(id || "")) {
    [photo] = await publicData("photo-detail:" + id, () => optional(get("weekly_photos?select=" + weeklyFields + ",description&id=eq." + id)));
  }
  if (!demo && /^month-\d{4}-(0[1-9]|1[0-2])$/.test(id || "")) {
    const [legacy] = await publicData("photo-detail:" + id, () => optional(get("photos?select=" + legacyFields + "&month=eq." + id.slice(6) + "-01")));
    if (legacy) photo = legacyPhoto(legacy);
  }
  if (!photo) {
    document.title = "Photo unavailable — The Common Hours";
    content.innerHTML = archiveLink + "<h1>Photo unavailable</h1>";
    return;
  }
  document.title = photo.title + " — The Common Hours";
  const date = photoDate(photo);
  content.innerHTML = archiveLink + '<article class="photo-detail"><h1>' + escape(photo.title) + '</h1>' +
    (date ? '<p class="meta">' + escape(date) + '</p>' : '') +
    '<div class="photo-detail-image"><img width="1200" height="800" alt="' + escape(photo.alt) + '" decoding="async" fetchpriority="high"></div>' +
    (photo.description ? '<p class="photo-description">' + escape(photo.description) + '</p>' : '') + '</article>';
  void showImage(get, content.querySelector(".photo-detail img"), photo);
}
