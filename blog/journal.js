import { url, publishableKey } from "./config.js";
import { allRows, escape, fetchAttachment, markdownMarker, missingColumn, missingFeature, readMediaImage, request, showFailure, table } from "./common.js";
import { publicData } from "./public-cache.js";

const content = document.querySelector("#content");
const sidebar = document.querySelector("#sidebar");
const params = new URLSearchParams(location.search);
const view = ["archive", "topics", "privacy", "terms", "photo", "photos", "start", "review"].includes(params.get("view")) ? params.get("view") : null;
const slug = params.get("post");
const month = params.get("month");
const tag = params.get("tag");
const series = params.get("series")?.slice(0, 100);
const demo = !url && !publishableKey;
const pageSize = 5;

const link = values => "?" + escape(new URLSearchParams(values).toString());
const format = (date, options) => new Date(date).toLocaleDateString("en", { timeZone: "UTC", ...options });
const dateLabel = date => format(date, { month: "short", day: "numeric", year: "numeric" });
const monthLabel = date => format(date + "-01", { month: "long", year: "numeric" });
const postLink = post => link({ post: post.slug });
const isJournal = document.documentElement.classList.contains("home-page");

const isLegal = view === "privacy" || view === "terms";
const isPhoto = view === "photo" || view === "photos";
if (!isLegal && view !== "review") {
  const currentNav = isPhoto ? "photos" : view === "archive" || month ? "archive" :
    view === "start" ? "start" : "journal";
  document.querySelector("#" + currentNav + "-link").setAttribute("aria-current", "page");
}
const canonical = document.createElement("link");
canonical.rel = "canonical";
const canonicalUrl = new URL("https://commonhours.qd.je/");
for (const key of ["view", "post", "month", "tag", "page", "photo", "series", "q", "year"]) {
  const value = key === "view" ? view : params.get(key);
  if (value) canonicalUrl.searchParams.set(key, value);
}
canonical.href = canonicalUrl;
document.head.append(canonical);

const get = (path, options) => request(table(path), options);
const insert = (path, body) => get(path, { method: "POST", body, prefer: "return=minimal" });

async function loadPublicPosts() {
  if (demo) return (await import("./demo.js")).default;
  return publicData("posts", fetchPublicPosts);
}

async function fetchPublicPosts() {
  const fields = "id,slug,title,tag,excerpt,published_on";
  const filter = "&published=eq.true&order=published_on.desc,id.desc";
  try { return await allRows(get, "posts?select=" + fields + ",series,series_order,start_here" + filter); }
  catch (error) {
    if (!missingColumn(error)) throw error;
    return allRows(get, "posts?select=" + fields + filter);
  }
}

function loadBody(currentSlug) {
  return publicData("post:" + currentSlug, async () => {
    const [post] = await get("posts?" + new URLSearchParams({ select: "body", slug: "eq." + currentSlug, published: "eq.true" }));
    return post || null;
  });
}

function saveLatestForOffline(posts) {
  if (demo || !navigator.onLine || !("caches" in window) || navigator.connection?.saveData) return;
  const save = async () => {
    for (const post of posts.slice(0, pageSize)) {
      if (!navigator.onLine) break;
      try { await loadBody(post.slug); } catch { break; }
    }
  };
  if ("requestIdleCallback" in window) requestIdleCallback(() => void save());
  else setTimeout(() => void save(), 0);
}

async function resolveEntry(posts) {
  const index = posts.findIndex(post => post.slug === slug);
  if (index >= 0 || demo || !/^[a-z0-9-]{1,120}$/.test(slug)) return index;
  let alias;
  try { [alias] = await publicData("alias:" + slug, () => get("entry_slugs?select=post_id&slug=eq." + slug)); }
  catch (error) { if (!missingFeature(error)) throw error; }
  const target = alias && posts.find(post => post.id === alias.post_id);
  if (!target) return -1;
  const next = new URL(location.href);
  next.searchParams.set("post", target.slug);
  history.replaceState(null, "", next.href);
  canonicalUrl.searchParams.set("post", target.slug);
  canonical.href = canonicalUrl;
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

function grouped(posts, value) {
  const groups = new Map();
  for (const post of posts) {
    const name = value(post);
    groups.set(name, (groups.get(name) || 0) + 1);
  }
  return groups;
}

function sideLinks(groups, key, label, selected) {
  return [...groups].map(([name, count]) =>
    `<li><a href="${link({ [key]: name })}" ${name === selected ? 'aria-current="page"' : ""}>${escape(label(name))}<span>${count}</span></a></li>`
  ).join("");
}

function metadata(post, byline = false) {
  return `<p class="meta"><time datetime="${escape(post.published_on)}">${dateLabel(post.published_on)}</time>
    <a class="tag" href="${link({ tag: post.tag })}">${escape(post.tag)}</a>${byline ? '<span class="byline">By Ellis Vale</span>' : ""}</p>`;
}

function renderList(posts) {
  const filtered = posts.filter(post => (!month || post.published_on.startsWith(month + "-")) && (!tag || post.tag === tag));
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
  if (!isJournal) document.title = title + " — The Common Hours";
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
    post.body = detail.body;
  }
  const hasFormatting = post.body.startsWith(markdownMarker);
  const renderer = hasFormatting ? await import("./rich.js").catch(() => null) : null;
  document.title = post.title + " — The Common Hours";
  const nav = (neighbor, label) => neighbor
    ? `<a href="${postLink(neighbor)}"><span>${label}</span>${escape(neighbor.title)}</a>` : "<div></div>";
  content.innerHTML = `<a class="back" href="./">← Back to the journal</a><article class="article">
    <h1>${escape(post.title)}</h1>${metadata(post, true)}
    <div class="prose" id="entry-body"></div></article>
    <nav class="post-nav" aria-label="Adjacent posts">${nav(posts[index + 1], "← Previous post")}${nav(posts[index - 1], "Next post →")}</nav>
    <section class="comments"><h2>Comments</h2><div id="comment-list" aria-live="polite"></div>
    <form id="comment-form" method="post"><h3>Leave a comment</h3>
    <label>Display name <input name="display_name" required maxlength="60"></label>
    <label>Comment <textarea name="body" required maxlength="2000" rows="4"></textarea></label>
    <p class="status">${demo ? "Preview mode. Comments stay in this browser." : 'Approved comments are public. <a href="?view=privacy">Privacy</a>'}</p>
    <button>Submit comment</button><p class="status" role="status" id="comment-status"></p></form></section>`;
  const bodyElement = document.querySelector("#entry-body");
  if (renderer) {
    renderer.renderText(bodyElement, post.body, id => publicData("image:" + id, () => readMediaImage(get, id)), { loadAttachment: fetchAttachment, preparePrint: true });
  } else if (hasFormatting) {
    showFailure(bodyElement, "The article could not load.", () => location.reload());
  } else {
    bodyElement.innerHTML = post.body.split(/\n\s*\n/).map(paragraph => `<p>${escape(paragraph)}</p>`).join("");
  }
  if (renderer || !hasFormatting) {
    const prose = bodyElement.cloneNode(true);
    prose.querySelectorAll(".media-slot, .attachment, .attachment-status, .video, .footnote-backref").forEach(node => node.remove());
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
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
  const { restoreArticleAnchors, seriesNavigation } = await import("./reading.js");
  restoreArticleAnchors(bodyElement);
  bodyElement.closest("article").insertAdjacentHTML("afterend", seriesNavigation(posts, post));
  const form = document.querySelector("#comment-form");
  const status = document.querySelector("#comment-status");
  const button = form.querySelector("button");
  if (!window.isSecureContext) {
    button.disabled = true;
    status.textContent = "Use the HTTPS address to leave a comment.";
  }
  const storageKey = "qmargin-preview:" + post.slug;

  function showComments(comments) {
    list.innerHTML = comments.map(comment => `<article class="comment"><h3>${escape(comment.display_name)}</h3>
      <p>${escape(comment.body)}</p></article>`).join("") || '<p class="status">No comments yet.</p>';
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
    } catch {
      status.textContent = "Your comment could not be saved. Please try again.";
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
      showFailure(list, "Comments could not load.", loadComments);
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
    document.title = (view === "privacy" ? "Privacy" : "Terms") + " — The Common Hours";
    renderLegal(content, view, demo);
    recordView(view);
    return;
  }
  if (isPhoto) {
    const { renderPhotoView } = await import("./photos.js");
    await renderPhotoView(content, get, demo, view, params.get("photo"));
    recordView(view);
    return;
  }
  const body = !view && slug && !demo && /^[a-z0-9-]{1,120}$/.test(slug) ? loadBody(slug).catch(() => undefined) : null;
  const posts = await loadPublicPosts();
  if (view === "start" || series) {
    const { renderReadingList, seriesEntries } = await import("./reading.js");
    if (series) renderReadingList(content, series, seriesEntries(posts, series));
    else renderReadingList(content, "Start here", posts.filter(post => post.start_here), "No starter entries have been selected yet.");
    return;
  }
  const months = grouped(posts, post => post.published_on.slice(0, 7));
  const topics = [...grouped(posts, post => post.tag)].sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b));
  const topTopics = topics.slice(0, 10);
  const archives = sideLinks(months, "month", monthLabel, month);
  const sidebarMarkup = `<section class="side-section"><h2 class="side-title">Blog archive</h2>
    <ul class="side-list">${sideLinks(new Map([...months].filter(([name], index) => index < 8 || name === month)), "month", monthLabel, month)}</ul>
    ${months.size > 8 ? '<p><a class="back" href="?view=archive">All months →</a></p>' : ""}
    ${!months.size ? '<p class="status">No published entries yet.</p>' : ""}</section>
    ${topics.length ? `<section class="side-section sidebar-topics"><h2 class="side-title">Topics</h2><ul class="side-list">${sideLinks(topTopics, "tag", name => name, tag)}</ul>
    ${topics.length > topTopics.length ? '<a class="back" href="?view=topics">All topics →</a>' : ""}</section>` : ""}`;
  if (view === "topics") {
    document.title = "All topics — The Common Hours";
    content.innerHTML = `<div class="section-head"><h1>All topics</h1><span class="section-note">${topics.length} ${topics.length === 1 ? "topic" : "topics"}</span></div>` +
      (topics.length ? `<ul class="side-list all-topics">${sideLinks(topics, "tag", name => name, tag)}</ul>` : "<p>No topics yet.</p>");
    return;
  } else if (view === "archive") {
    document.title = "Archive — The Common Hours";
    recordView("archive");
    content.innerHTML = `<div class="section-head"><h1>Archive</h1></div><ul class="side-list">${archives}</ul>${archives ? "" : "<p>No entries yet.</p>"}`;
  } else if (slug) {
    await renderPost(posts, await resolveEntry(posts), body);
  } else {
    renderList(posts);
    if (isJournal) saveLatestForOffline(posts);
    recordView("journal");
  }
  sidebar.innerHTML = sidebarMarkup;
}

async function load() {
  content.setAttribute("aria-busy", "true");
  try {
    await start();
  } catch {
    if (view === "photos" && content.querySelector("#photo-results")) {
      content.querySelector(".photo-archive").classList.remove("route-skeleton");
      content.querySelectorAll(".route-skeleton, .loading").forEach(item => item.remove());
      const count = content.querySelector("#photo-count");
      const results = content.querySelector("#photo-results");
      count.textContent = "";
      showFailure(results, "The photos could not load. Try again.", () => {
        results.replaceChildren();
        count.textContent = "Loading photos…";
        void load();
      });
    } else showFailure(content, navigator.onLine ? "The journal could not load. Check your connection and try again." :
      "This page hasn’t been saved on this device. Reconnect to open it.", load);
  } finally {
    content.setAttribute("aria-busy", "false");
  }
}

if (isJournal) void import("./photos.js").then(({ startSlideshow }) => startSlideshow(get, demo)).catch(() => {});
void load();
