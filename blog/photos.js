import { allRows, escape, imageSource, mediaId, missingColumn, missingFeature, monthNow, readMediaImage, weekOf } from "./common.js";

const weeklyFields = "id,week,media_id,title,alt";
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

async function optional(task) {
  try { return await task; }
  catch (error) { if (missingFeature(error)) return []; throw error; }
}

async function getImage(get, photo, options) {
  if (photo.id === cover.id) return { src: "cover.jpg", width: 1200, height: 800 };
  const record = await readMediaImage(get, photo.media_id, options);
  const src = imageSource(record);
  if (!src) throw new Error("Photo unavailable.");
  return { src, width: record.width, height: record.height, alt: record.alt };
}

async function featurePhotos(get, demo) {
  if (!demo) {
    const filter = "&featured=eq.true&week=lte." + weekOf();
    const [latest] = await optional(get("weekly_photos?select=week" + filter + "&order=week.desc&limit=1", { timeout: 3000 }));
    if (latest) {
      return allRows(path => get(path, { timeout: 3000 }),
        "weekly_photos?select=" + weeklyFields + "&featured=eq.true&week=eq." + latest.week + "&order=created_at.asc,id.asc");
    }
    const [legacy] = await optional(get("photos?select=" + legacyFields + "&month=eq." + monthNow() + "-01", { timeout: 1600 }));
    if (legacy) return [legacyPhoto(legacy)];
  }
  return [cover];
}

export async function startSlideshow(get, demo) {
  const figure = document.querySelector("#week-photo");
  if (!figure.hidden) return;
  const link = figure.querySelector("#featured-photo-link");
  const picture = link.querySelector("img");
  const caption = figure.querySelector("#photo-caption");
  const controls = figure.querySelector("#slide-controls");
  const count = figure.querySelector("#slide-count");
  const toggle = figure.querySelector("#slide-toggle");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = motion.matches;
  let timer;
  let revision = 0;
  let index = 0;
  const images = new Map();

  let photos;
  try { photos = await featurePhotos(get, demo); } catch { photos = [cover]; }
  if (!photos.length) photos = [cover];
  controls.hidden = toggle.hidden = photos.length < 2;
  toggle.textContent = paused ? "Play slideshow" : "Pause slideshow";

  function schedule() {
    clearTimeout(timer);
    if (!paused && !document.hidden && photos.length > 1) timer = setTimeout(() => void show(index + 1), 10000);
  }

  async function show(next) {
    clearTimeout(timer);
    const loading = ++revision;
    index = (next + photos.length) % photos.length;
    let photo = photos[index];
    let data;
    try {
      if (!images.has(photo.id)) {
        images.set(photo.id, getImage(get, photo, { timeout: 3000 }).catch(error => {
          images.delete(photo.id);
          throw error;
        }));
      }
      data = await images.get(photo.id);
    } catch {
      if (loading !== revision) return;
      photo = cover;
      data = await getImage(get, cover);
    }
    if (loading !== revision) return;
    picture.alt = photo.alt || data.alt || "";
    picture.title = picture.alt;
    picture.width = data.width;
    picture.height = data.height;
    picture.src = data.src;
    link.href = photoLink(photo.id);
    link.setAttribute("aria-label", "Open photo details: " + photo.title);
    caption.textContent = photo.title;
    count.textContent = photos.length > 1 ? (index + 1) + " / " + photos.length : "";
    schedule();
  }

  figure.querySelector("#slide-prev").addEventListener("click", () => void show(index - 1));
  figure.querySelector("#slide-next").addEventListener("click", () => void show(index + 1));
  toggle.addEventListener("click", () => {
    paused = !paused;
    toggle.textContent = paused ? "Play slideshow" : "Pause slideshow";
    schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  await show(0);
  await Promise.race([picture.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 500))]);
  figure.hidden = false;
}

function photoDate(photo) {
  return photo.week ? "Week of " + dateLabel(photo.week, { month: "long", day: "numeric", year: "numeric" }) :
    photo.month ? dateLabel(photo.month, { month: "long", year: "numeric" }) : "";
}

async function showImage(get, picture, photo) {
  picture.title = photo.alt;
  try {
    const data = await getImage(get, photo);
    picture.alt = photo.alt || data.alt || "";
    picture.title = picture.alt;
    picture.width = data.width;
    picture.height = data.height;
    picture.src = data.src;
  } catch {
    const unavailable = document.createElement("span");
    unavailable.className = "photo-unavailable";
    unavailable.textContent = "Photo unavailable";
    picture.replaceWith(unavailable);
  }
}

function archiveCard(photo) {
  return '<li><a href="' + escape(photoLink(photo.id)) + '"><img width="320" height="213" decoding="async" alt="' +
    escape(photo.alt) + '"><strong>' + escape(photo.title) + '</strong><small>' + escape(photoDate(photo)) + '</small></a></li>';
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
    const [weekly, legacy] = demo ? [[], []] : await Promise.all([
      archiveWeekly(get),
      optional(allRows(get, "photos?select=" + legacyFields + "&order=month.desc")),
    ]);
    const photos = [...weekly, ...legacy.map(legacyPhoto)].sort((a, b) =>
      (b.week || b.month).localeCompare(a.week || a.month));
    content.innerHTML = '<div class="section-head"><h1>Photo archive</h1></div>' +
      '<div class="photo-filters"><label>Year <select id="photo-year"></select></label>' +
      '<label>Series <select id="photo-series"></select></label></div><div id="photo-results"></div>';
    const year = content.querySelector("#photo-year");
    const series = content.querySelector("#photo-series");
    const result = content.querySelector("#photo-results");
    const params = new URLSearchParams(location.search);
    const photoYear = photo => (photo.week || photo.month).slice(0, 4);
    year.replaceChildren(new Option("All years", ""), ...[...new Set(photos.map(photoYear))].map(name => new Option(name)));
    series.replaceChildren(new Option("All series", ""), ...[...new Set(photos.map(photo => photo.series).filter(Boolean))].sort().map(name => new Option(name)));
    year.value = params.get("year") || "";
    series.value = params.get("series") || "";
    let observer;
    function render() {
      observer?.disconnect();
      const matches = photos.filter(photo => (!year.value || photoYear(photo) === year.value) && (!series.value || photo.series === series.value));
      result.innerHTML = matches.length ? '<ul class="photo-grid">' + matches.map(archiveCard).join("") + '</ul>' : "<p>No photos match these filters.</p>";
      const pictures = [...result.querySelectorAll("img")];
      if (typeof IntersectionObserver !== "function") {
        pictures.forEach((picture, index) => void showImage(get, picture, matches[index]));
        return;
      }
      const byPicture = new Map(pictures.map((picture, index) => [picture, matches[index]]));
      observer = new IntersectionObserver(entries => {
        for (const { isIntersecting, target } of entries) {
          if (!isIntersecting) continue;
          observer.unobserve(target);
          void showImage(get, target, byPicture.get(target));
        }
      }, { rootMargin: "180px" });
      pictures.forEach(picture => observer.observe(picture));
    }
    const update = () => {
      const state = new URLSearchParams({ view: "photos" });
      if (year.value) state.set("year", year.value);
      if (series.value) state.set("series", series.value);
      history.replaceState(null, "", "?" + state);
      render();
    };
    year.addEventListener("change", update);
    series.addEventListener("change", update);
    render();
    return;
  }

  let photo = id === cover.id ? cover : undefined;
  if (!demo && mediaId.test(id || "")) {
    [photo] = await optional(get("weekly_photos?select=" + weeklyFields + ",description&id=eq." + id));
  }
  if (!demo && /^month-\d{4}-(0[1-9]|1[0-2])$/.test(id || "")) {
    const [legacy] = await optional(get("photos?select=" + legacyFields + "&month=eq." + id.slice(6) + "-01"));
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
    '<img width="1200" height="800" alt="' + escape(photo.alt) + '" decoding="async" fetchpriority="high">' +
    (photo.description ? '<p class="photo-description">' + escape(photo.description) + '</p>' : '') + '</article>';
  await showImage(get, content.querySelector(".photo-detail img"), photo);
}
