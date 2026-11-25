import { pageHref, pageParams } from "./page-url.js";
import { url, publishableKey } from "./config.js";
import { allRows, escape, fetchAttachment, markdownMarker, missingColumn, missingFeature, readMediaImage, request, showFailure, table } from "./common.js";
import { publicData } from "./public-cache.js";
import { archiveTitle, commentCards, grouped, publicationRevision, renderArchive, renderLatest, renderNoteDetail, renderNotes, renderRecentNotes, renderSidebar, renderTopics } from "./archive.js";
import { seriesDirectory, seriesEntries, seriesMembership, seriesNavigation } from "./series.js";
import { startIntroduction, startEmpty } from "./reading-copy.js";
import { articleTopics } from "./text.js";
import { loadCarousels } from "./image-viewer.js";

const content = document.querySelector("#content");
const sidebar = document.querySelector("#sidebar");
const params = pageParams();
const view = ["archive", "notes", "topics", "privacy", "terms", "photo", "photos", "start", "series", "review"].includes(params.get("view")) ? params.get("view") : null;
const slug = params.get("post");
const month = params.get("month");
const tag = params.get("tag");
const series = params.get("series")?.slice(0, 100);
const demo = !url && !publishableKey;
const pageSize = 5;

const link = values => escape(pageHref(values));
const format = (date, options) => new Date(date).toLocaleDateString("en", { timeZone: "UTC", ...options });
const dateLabel = date => format(date, { month: "short", day: "numeric", year: "numeric" });
const monthLabel = date => format(date + "-01", { month: "long", year: "numeric" });
const postLink = post => link({ post: post.slug });
const isJournal = document.documentElement.classList.contains("home-page");

const isLegal = view === "privacy" || view === "terms";
const isPhoto = view === "photo";
const offline = () => !navigator.onLine || document.documentElement.hasAttribute("data-offline-copy");
const currentNav = ["archive", "series", "topics"].includes(view) || month ? "archive" :
  view === "notes" || document.documentElement.classList.contains("note-page") ? "notes" : view === "start" ? "start" : "journal";
function setCurrentNav(name) {
  for (const item of document.querySelectorAll(".mast nav a")) {
    if (item.id === name + "-link") item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
}
setCurrentNav(isLegal || view === "review" ? "" : currentNav);
const canonical = document.querySelector('link[rel="canonical"]') || document.createElement("link");
canonical.rel = "canonical";
const canonicalParams = new URLSearchParams();
for (const key of ["view", "post", "month", "tag", "page", "photo", "series", "q", "year"]) {
  const value = key === "view" ? view : params.get(key);
  if (value) canonicalParams.set(key, value);
}
const canonicalUrl = new URL(pageHref(canonicalParams), "https://commonhours.qd.je/");
canonical.href = canonicalUrl;
document.head.append(canonical);

const get = (path, options) => request(table(path), options);
const insert = (path, body) => get(path, { method: "POST", body, prefer: "return=minimal" });
const publicImage = id => publicData("image:" + id, () => readMediaImage(get, id));
const publicCarousel = id => publicData("carousel:" + id, async () =>
  (await allRows(get, "carousel_photos?select=media_id,alt&carousel_id=eq." + encodeURIComponent(id) + "&order=position"))
    .map(row => ({ id: row.media_id, alt: row.alt })), 0);

async function loadPublicPosts() {
  if (demo) return [];
  return publicData("posts", fetchPublicPosts, 0);
}

async function fetchPublicPosts() {
  const fields = "id,slug,title,tag,excerpt,published_on";
  const filter = "&published=eq.true&order=published_on.desc,id.desc";
  for (const extra of [",series,series_order,start_here,is_note,note_number", ",series,series_order,start_here,is_note", ",series,series_order,start_here", ",is_note", ""]) {
    try {
      const posts = await allRows(get, "posts?select=" + fields + extra + filter);
      if (!posts.some(post => post.is_note)) return posts;
      const notes = await allRows(get, "posts?select=id,body&published=eq.true&is_note=eq.true&order=id.asc");
      const bodies = new Map(notes.map(note => [note.id, note.body]));
      return posts.map(post => post.is_note ? { ...post, body: bodies.get(post.id) } : post);
    }
    catch (error) { if (!extra || !missingColumn(error)) throw error; }
  }
}

function loadBody(currentSlug) {
  return publicData("post:" + currentSlug, async () => {
    const read = select => get("posts?" + new URLSearchParams({ select, slug: "eq." + currentSlug, published: "eq.true" }));
    try { return (await read("body,reader_prompt"))[0] || null; }
    catch (error) {
      if (!missingColumn(error)) throw error;
      return (await read("body"))[0] || null;
    }
  });
}

function saveLatestForOffline(posts) {
  if (demo || !navigator.onLine || !("caches" in window) || navigator.connection?.saveData) return;
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then(async () => {
    for (const post of posts.slice(0, pageSize)) {
      if (!navigator.onLine) break;
      if ("requestIdleCallback" in window) await new Promise(resolve => requestIdleCallback(resolve));
      try { await loadBody(post.slug); } catch { break; }
    }
  });
}

async function resolveEntry(posts) {
  const index = posts.findIndex(post => post.slug === slug);
  if (index >= 0 || demo || !/^[a-z0-9-]{1,120}$/.test(slug)) return index;
  let alias;
  try { [alias] = await publicData("alias:" + slug, () => get("entry_slugs?select=post_id&slug=eq." + slug)); }
  catch (error) { if (!missingFeature(error)) throw error; }
  const target = alias && posts.find(post => post.id === alias.post_id);
  if (!target) return -1;
  history.replaceState(null, "", pageHref({ post: target.slug }));
  canonical.href = new URL(pageHref({ post: target.slug }), "https://commonhours.qd.je/");
  return posts.indexOf(target);
}

function recordView(page, post = null) {
  if (demo || !navigator.onLine || navigator.globalPrivacyControl || navigator.doNotTrack === "1") return;
  let visit = true;
  try {
    const key = "common-hours-last-view";
    const now = Date.now();
    const last = Number(sessionStorage.getItem(key));
    visit = !last || now < last || now - last >= 30 * 60 * 1000;
    sessionStorage.setItem(key, String(now));
  } catch { /* Count the view if storage is unavailable. */ }
  const send = () => void request("/rest/v1/rpc/qmargin_b74_record_view", {
    method: "POST", body: { p_page: page, p_post: post, p_visit: visit }, keepalive: true,
  }).catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(send, { timeout: 1500 });
  else setTimeout(send, 0);
}

function metadata(post, byline = false) {
  return `<p class="meta"><time datetime="${escape(post.published_on)}">${dateLabel(post.published_on)}</time>
    ${articleTopics(post).map(tag => `<a class="tag" href="${link({ view: "archive", tag })}">${escape(tag)}</a>`).join(" · ")}${byline ? '<span class="byline">By Ellis Vale</span>' : ""}</p>`;
}

function renderList(posts) {
  const filtered = posts.filter(post => !post.is_note && (!month || post.published_on.startsWith(month + "-")) && (!tag || articleTopics(post).includes(tag)));
  const title = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? monthLabel(month) : tag || "Latest entries";
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(params.get("page"), 10) || 1));
  const entries = filtered.slice((page - 1) * pageSize, page * pageSize);
  const heading = isJournal ? "h2" : "h1";
  const entryHeading = isJournal ? "h3" : "h2";
  const pageLink = number => link({ ...(month && { month }), ...(tag && { tag }), page: number });
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(number => number === 1 || number === totalPages || Math.abs(page - number) <= 1);
  content.innerHTML = `<div class="section-head"><${heading}>${escape(title)}</${heading}><span class="section-note">${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}</span></div>
    ${entries.map(post => `<article class="entry">${metadata(post)}
      <${entryHeading} class="entry-title"><a href="${postLink(post)}"><span class="headline">${escape(post.title)}</span><span class="arrow" aria-hidden="true">↗</span></a></${entryHeading}>
      <p>${escape(post.excerpt)}</p></article>`).join("") || "<p>No entries here yet.</p>"}
    ${totalPages > 1 ? `<nav class="pagination" aria-label="Journal pages">
      ${page > 1 ? `<a href="${pageLink(page - 1)}" rel="prev" aria-label="Previous page">←</a>` : ""}
      ${pages.map((number, i) => `${i && number - pages[i - 1] > 1 ? " … " : ""}<a href="${pageLink(number)}" aria-label="Page ${number}" ${number === page ? 'aria-current="page"' : ""}>${number}</a>`).join("")}
      ${page < totalPages ? `<a href="${pageLink(page + 1)}" rel="next" aria-label="Next page">→</a>` : ""}
      <span class="section-note">Page ${page} of ${totalPages}</span></nav>` : ""}`;
  if (!isJournal) document.title = title + " - The Common Hours";
}

async function renderPost(posts, index, firstBody) {
  const post = posts[index];
  if (!post) {
    content.innerHTML = '<h1>Entry not found</h1><p><a class="back" href="./">← Return to the journal</a></p>';
    return;
  }
  if (!demo) {
    const prefetched = post.slug === slug && firstBody ? await firstBody : undefined;
    const detail = prefetched === undefined ? await loadBody(post.slug) : prefetched;
    if (!detail) return renderPost([], 0);
    Object.assign(post, detail);
  }
  if (post.is_note) {
    setCurrentNav("notes");
    document.documentElement.classList.add("note-page");
  }
  const hasFormatting = !post.is_note && post.body.startsWith(markdownMarker);
  const published = content.querySelector(".published-copy .article");
  const retain = content.dataset.refreshPending === undefined && published?.dataset.publication === publicationRevision([post], true) &&
    (!post.is_note || published.closest(".note-detail-layout"));
  const renderer = !retain && hasFormatting ? await import("./rich.js").catch(() => null) : null;
  document.title = post.title + " - The Common Hours";
  const nav = (neighbor, label) => neighbor
    ? `<a href="${postLink(neighbor)}"><span>${label}</span>${escape(neighbor.title)}</a>` : "<div></div>";
  const previousNext = `<nav class="post-nav" aria-label="Adjacent posts">${nav(posts[index + 1], "← Previous post")}${nav(posts[index - 1], "Next post →")}</nav>`;
  if (post.is_note) {
    if (!retain) content.innerHTML = renderNoteDetail(post, dateLabel);
    const notes = posts.filter(item => item.is_note);
    const position = notes.indexOf(post);
    content.querySelector(".note-detail-layout").insertAdjacentHTML("afterend",
      `<nav class="post-nav" aria-label="Adjacent notes">${nav(notes[position + 1], "← Older note")}${nav(notes[position - 1], "Newer note →")}</nav>`);
    const { restoreArticleAnchors } = await import("./reading.js");
    restoreArticleAnchors(content.querySelector("#entry-body"));
    recordView("post", post.id);
    return;
  } else if (!retain) content.innerHTML = `<a class="back" href="./">← Back to the journal</a><article class="article">
    ${seriesMembership(post, posts)}<h1>${escape(post.title)}</h1>${metadata(post, true)}
    <div class="prose" id="entry-body"></div></article>
    ${seriesNavigation(posts, post)}
    ${previousNext}<section class="comments"><h2>Comments</h2><div id="comment-list" aria-live="polite"></div></section>`;
  else {
    const navigation = seriesNavigation(posts, post);
    const existingSeries = content.querySelector(".series-navigation");
    if (existingSeries) existingSeries.outerHTML = navigation;
    else if (navigation) published.insertAdjacentHTML("afterend", navigation);
    content.querySelector(".comments").insertAdjacentHTML("beforebegin", previousNext);
  }
  const discussion = content.querySelector(".comments");
  discussion.insertAdjacentHTML("beforeend", `
    <form id="comment-form" method="post"><h3>Leave a comment</h3>
    ${post.reader_prompt ? `<p class="reader-prompt">${escape(post.reader_prompt)}</p>` : ""}
    <label>Display name <input name="display_name" autocomplete="name" required maxlength="60"></label>
    <label>Comment <textarea name="body" required maxlength="2000" rows="4"></textarea></label>
    <p class="status">${demo ? "Preview mode. Comments stay in this browser." : 'Approved comments are public. <a href="privacy">Privacy</a>'}</p>
    <button>Submit comment</button><p class="status" role="status" id="comment-status"></p></form>`);
  discussion.hidden = false;
  const bodyElement = document.querySelector("#entry-body");
  if (retain) {
    if (bodyElement.querySelector("[data-player], .video-poster")) {
      void import("./rich.js").then(({ enhanceVideos }) => enhanceVideos(bodyElement)).catch(() => {});
    }
  } else if (renderer) {
    renderer.renderText(bodyElement, post.body, publicImage, { loadAttachment: fetchAttachment, preparePrint: true, enlargeImages: true });
  } else if (hasFormatting) {
    showFailure(bodyElement, "The article could not load.", () => location.reload());
  } else {
    bodyElement.innerHTML = post.body.split(/\n\s*\n/).map(paragraph => `<p>${escape(paragraph)}</p>`).join("");
  }
  if (retain || renderer || !hasFormatting) {
    const walker = document.createTreeWalker(bodyElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, node => {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return node.matches(".media-slot, .attachment, .attachment-status, .video, .footnote-backref") ?
        NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    });
    const text = [];
    while (walker.nextNode()) text.push(walker.currentNode.data);
    const words = text.join(" ").match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu)?.length || 0;
    if (words) {
      const estimate = document.createElement("span");
      estimate.className = "read-time";
      estimate.textContent = Math.ceil(words / 220) + " min read";
      bodyElement.previousElementSibling.append(estimate);
    }
  }
  const list = document.querySelector("#comment-list");
  const { restoreArticleAnchors } = await import("./reading.js");
  restoreArticleAnchors(bodyElement);
  const form = document.querySelector("#comment-form");
  const status = document.querySelector("#comment-status");
  const button = form.querySelector("button");
  if (!window.isSecureContext) {
    button.disabled = true;
    status.textContent = "Use the HTTPS address to leave a comment.";
  }
  const storageKey = "qmargin-preview:" + post.slug;

  function showComments(comments) {
    list.innerHTML = commentCards(comments) || '<p class="status">No comments yet.</p>';
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!window.isSecureContext) return;
    const fields = new FormData(form);
    const display_name = fields.get("display_name").trim();
    const body = fields.get("body").trim();
    if (!display_name || !body) {
      status.textContent = "Enter a display name and comment.";
      return;
    }
    button.disabled = true;
    status.textContent = "Submitting…";
    try {
      if (demo) {
        const comments = JSON.parse(localStorage.getItem(storageKey) || "[]");
        comments.push({ display_name, body });
        localStorage.setItem(storageKey, JSON.stringify(comments));
        showComments(comments);
      } else {
        await insert("comments", { post_id: post.id, display_name, body });
      }
      form.reset();
      status.textContent = demo ? "Comment saved in this browser." : "Comment submitted for moderation.";
    } catch (error) {
      status.textContent = error.status === 429 ? error.message : "Your comment could not be saved. Please try again.";
    } finally {
      button.disabled = false;
    }
  });

  async function loadComments() {
    list.setAttribute("aria-busy", "true");
    try {
      const comments = demo ? JSON.parse(localStorage.getItem(storageKey) || "[]") : await publicData("comments:" + post.id, () => allRows(get,
        "comments?select=display_name,body&approved=eq.true&order=created_at.asc,id.asc&post_id=eq." + encodeURIComponent(post.id)
      ));
      showComments(comments);
    } catch {
      if (!list.childElementCount) showFailure(list, "Comments could not load.", loadComments);
    } finally {
      list.setAttribute("aria-busy", "false");
    }
  }
  void loadComments();
  recordView("post", post.id);
}

async function start() {
  if (view === "review") {
    const reading = await import("./reading.js");
    await reading.renderReview(content);
    return;
  }
  if (isLegal) {
    const { renderLegal } = await import("./legal.js");
    document.title = (view === "privacy" ? "Privacy" : "Terms") + " - The Common Hours";
    renderLegal(content, view, demo, content.dataset.prerendered && content.dataset.refreshPending === undefined);
    recordView(view);
    return;
  }
  if (isPhoto) {
    const { renderPhotoView } = await import("./photos.js");
    await renderPhotoView(content, get, demo, params.get("photo"));
    recordView(view);
    return;
  }
  const body = !view && slug && !demo && /^[a-z0-9-]{1,120}$/.test(slug) ? loadBody(slug).catch(() => undefined) : null;
  const posts = await loadPublicPosts();
  const unchanged = content.dataset.refreshPending === undefined &&
    document.querySelector("#public-pages")?.dataset.publication === publicationRevision(posts);
  if (unchanged && !slug) {
    if (isJournal) {
      saveLatestForOffline(posts);
      recordView("journal");
    } else if (view === "archive") recordView("archive");
    return;
  }
  if (view === "series") {
    document.title = "Series - The Common Hours";
    content.innerHTML = seriesDirectory(posts);
    const target = document.getElementById(location.hash.slice(1));
    const group = target?.closest("details.series-group");
    if (group) {
      group.open = true;
      group.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  if (view === "notes") {
    document.title = "Notes - The Common Hours";
    content.innerHTML = renderNotes(posts, dateLabel);
    return;
  }
  if (view === "start" || series) {
    const { renderReadingList } = await import("./reading.js");
    if (series) renderReadingList(content, series, seriesEntries(posts, series));
    else {
      renderReadingList(content, "Start here", posts.filter(post => post.start_here), startEmpty);
      content.querySelector(".section-head").insertAdjacentHTML("afterend", startIntroduction);
    }
    return;
  }
  const months = grouped(posts, post => post.published_on.slice(0, 7));
  const topics = [...grouped(posts, articleTopics)].sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b));
  if (view === "topics") {
    document.title = "All topics - The Common Hours";
    content.innerHTML = renderTopics(topics);
    return;
  } else if (view === "archive") {
    document.title = archiveTitle(params) + " - The Common Hours";
    recordView("archive");
    content.innerHTML = renderArchive(posts, params);
  } else if (slug) {
    await renderPost(posts, await resolveEntry(posts), body);
  } else {
    if (isJournal) {
      content.innerHTML = renderLatest(posts, dateLabel, pageSize);
      saveLatestForOffline(posts);
    } else renderList(posts);
    recordView("journal");
  }
  if (!unchanged) sidebar.innerHTML = (isJournal ? renderRecentNotes(posts, dateLabel) : "") + renderSidebar(months, topics, month, tag);
}

async function load() {
  if (content.dataset.prerendered && location.search) {
    const rendered = new URLSearchParams(document.documentElement.dataset.route);
    if (["view", "post", "series", "month", "tag", "year", "page", "photo"].some(key => rendered.get(key) !== params.get(key))) {
      content.dataset.refreshPending = "";
    }
  }
  content.setAttribute("aria-busy", "true");
  document.querySelector("#refresh-status")?.remove();
  try {
    if (content.dataset.prerendered && content.dataset.refreshPending === undefined && offline()) return;
    await start();
    if (view !== "review") await loadCarousels(content.parentElement, publicCarousel, publicImage);
    if (!content.querySelector(":scope > .published-copy")) delete content.dataset.prerendered;
  } catch {
    if (content.dataset.prerendered) {
      const status = document.createElement("div");
      status.id = "refresh-status";
      status.className = "unexpected-error";
      content.after(status);
      showFailure(status, "The latest updates could not load. You can still read this published copy.", load, "Try again", () => status.remove());
    } else showFailure(content, navigator.onLine ? "The journal could not load. Check your connection and try again." :
      "This page hasn’t been saved on this device. Reconnect to open it.", load, "Try again", true);
  } finally {
    delete content.dataset.refreshPending;
    content.setAttribute("aria-busy", "false");
  }
}

if (isJournal && !offline()) void import("./photos.js").then(({ startSlideshow }) => startSlideshow(get, demo)).catch(() => {
  document.querySelector("#photo-caption")?.removeAttribute("aria-busy");
  const status = document.querySelector("#featured-photo-status");
  status.hidden = false;
  showFailure(status, "Featured Photo could not start.", () => location.reload(), "Reload", () => { status.hidden = true; });
});
void load();
