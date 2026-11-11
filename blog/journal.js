import { url, publishableKey, getProjectOrigin } from "./config.js";

const content = document.querySelector("#content");
const sidebar = document.querySelector("#sidebar");
const params = new URLSearchParams(location.search);
const view = params.get("view");
const slug = params.get("post");
const month = params.get("month");
const tag = params.get("tag");
const demo = !url && !publishableKey;
const pageSize = 5;

const escape = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const link = values => "?" + escape(new URLSearchParams(values).toString());
const format = (date, options) => new Date(date).toLocaleDateString("en", { timeZone: "UTC", ...options });
const dateLabel = date => format(date, { month: "short", day: "numeric", year: "numeric" });
const monthLabel = date => format(date + "-01", { month: "long", year: "numeric" });
const postLink = post => link({ post: post.slug });
const isJournal = !view && !slug && !month && !tag && !params.has("page");

document.querySelector("#hero").hidden = !isJournal;
const currentNav = view === "about" ? "about" : view === "archive" || month ? "archive" : "journal";
document.querySelector("#" + currentNav + "-link").setAttribute("aria-current", "page");

async function request(path, body) {
  const headers = { apikey: publishableKey };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers.Prefer = "return=minimal";
  }
  const response = await fetch(getProjectOrigin() + "/rest/v1/qmargin_b74_" + path, {
    headers, cache: "no-store", method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error("The journal could not reach its data.");
  if (!body) return response.json();
}

async function allRows(path) {
  const rows = [];
  // Supabase projects can cap the number of rows returned in one response.
  while (true) {
    const batch = await request(path + "&limit=100&offset=" + rows.length);
    if (!batch.length) return rows;
    rows.push(...batch);
  }
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
  return `<p class="meta"><time datetime="${escape(post.published_on)}">${dateLabel(post.published_on)}</time><span aria-hidden="true">·</span>
    <a class="tag" href="${link({ tag: post.tag })}">${escape(post.tag)}</a>${byline ? "<span>· By Ellis Vale</span>" : ""}</p>`;
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
  content.innerHTML = `<div class="section-head"><${heading}>${escape(title)}</${heading}><span class="section-note">${filtered.length} ${filtered.length === 1 ? "ENTRY" : "ENTRIES"}</span></div>
    ${entries.map(post => `<article class="entry">${metadata(post)}
      <${entryHeading} class="entry-title"><a href="${postLink(post)}"><span class="headline">${escape(post.title)}</span><span class="arrow" aria-hidden="true">↗</span></a></${entryHeading}>
      <p>${escape(post.excerpt)}</p></article>`).join("") || "<p>No entries here yet.</p>"}
    ${filtered.length ? `<nav class="pagination" aria-label="Journal pages">
      ${page > 1 ? `<a href="${pageLink(page - 1)}" rel="prev" aria-label="Previous page">←</a>` : ""}
      ${pages.map((number, i) => `${i && number - pages[i - 1] > 1 ? " … " : ""}<a href="${pageLink(number)}" aria-label="Page ${number}" ${number === page ? 'aria-current="page"' : ""}>${number}</a>`).join("")}
      ${page < totalPages ? `<a href="${pageLink(page + 1)}" rel="next" aria-label="Next page">→</a>` : ""}
      <span class="section-note">Page ${page} of ${totalPages}</span></nav>` : ""}`;
  if (!isJournal) document.title = title + " — The Common Hours";
}

async function renderPost(posts, index) {
  const post = posts[index];
  if (!post) {
    content.innerHTML = '<h1>Entry not found</h1><p><a class="back" href="./">← Return to the journal</a></p>';
    return;
  }
  if (!demo) {
    const [detail] = await request("posts?" + new URLSearchParams({ select: "body", id: "eq." + post.id, published: "eq.true" }));
    if (!detail) return renderPost([], 0);
    post.body = detail.body;
  }
  document.title = post.title + " — The Common Hours";
  const nav = (neighbor, label) => neighbor
    ? `<a href="${postLink(neighbor)}"><span>${label}</span>${escape(neighbor.title)}</a>` : "<div></div>";
  content.innerHTML = `<a class="back" href="./">← Back to the journal</a><article class="article">
    <h1>${escape(post.title)}</h1>${metadata(post, true)}
    <div class="prose">${post.body.split(/\n\s*\n/).map(paragraph => `<p>${escape(paragraph)}</p>`).join("")}</div></article>
    <nav class="post-nav" aria-label="Adjacent posts">${nav(posts[index + 1], "← Previous post")}${nav(posts[index - 1], "Next post →")}</nav>
    <section class="comments"><h2>Comments</h2><div id="comment-list" aria-live="polite"></div>
    <form id="comment-form" method="post"><h3>Leave a comment</h3>
    <label>Display name <input name="display_name" required maxlength="60"></label>
    <label>Comment <textarea name="body" required maxlength="2000" rows="4"></textarea></label>
    <p class="status">${demo ? "Preview mode. Comments stay in this browser." : "Comments appear after moderation."}</p>
    <button>Submit comment</button><p class="status" role="status" id="comment-status"></p></form></section>`;
  const list = document.querySelector("#comment-list");
  const form = document.querySelector("#comment-form");
  const status = document.querySelector("#comment-status");
  const storageKey = "qmargin-preview:" + post.slug;

  function showComments(comments) {
    list.innerHTML = comments.map(comment => `<article class="comment"><h3>${escape(comment.display_name)}</h3>
      <p>${escape(comment.body)}</p></article>`).join("") || '<p class="status">No comments yet.</p>';
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const fields = new FormData(form);
    const display_name = fields.get("display_name").trim();
    const body = fields.get("body").trim();
    if (!display_name || !body) {
      status.textContent = "Enter a display name and comment.";
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      if (demo) {
        const comments = JSON.parse(localStorage.getItem(storageKey) || "[]");
        comments.push({ display_name, body });
        localStorage.setItem(storageKey, JSON.stringify(comments));
        showComments(comments);
      } else {
        await request("comments", { post_id: post.id, display_name, body });
      }
      form.reset();
      status.textContent = demo ? "Comment saved in this browser." : "Comment submitted for moderation.";
    } catch {
      status.textContent = "Your comment could not be saved. Please try again.";
    } finally {
      button.disabled = false;
    }
  });

  try {
    const comments = demo ? JSON.parse(localStorage.getItem(storageKey) || "[]") : await allRows(
      "comments?select=display_name,body&approved=eq.true&order=created_at.asc,id.asc&post_id=eq." + encodeURIComponent(post.id)
    );
    showComments(comments);
  } catch {
    list.textContent = "Comments could not be loaded.";
  }
}

async function start() {
  if (view === "about") {
    document.title = "About — The Common Hours";
    content.innerHTML = `<article class="about"><h1>About the journal</h1>
      <div class="prose"><p>I write here as Ellis Vale. I started The Common Hours to make sense of the small things that rarely make it into conversation.</p>
      <p>The essays tend to come back to time: how we spend it, what we notice, and what we remember.</p></div></article>`;
  }
  const posts = demo ? (await import("./demo.js")).default : await allRows(
    "posts?select=id,slug,title,tag,excerpt,published_on&published=eq.true&order=published_on.desc,id.desc"
  );
  const months = grouped(posts, post => post.published_on.slice(0, 7));
  const topics = grouped(posts, post => post.tag);
  const archives = sideLinks(months, "month", monthLabel, month);
  sidebar.innerHTML = `<section class="side-section"><h2 class="side-title">Blog archive</h2>
    <ul class="side-list">${sideLinks(new Map([...months].filter(([name], index) => index < 8 || name === month)), "month", monthLabel, month)}</ul>
    ${months.size > 8 ? '<p><a class="back" href="?view=archive">All months →</a></p>' : ""}
    ${!months.size ? '<p class="status">No published entries yet.</p>' : ""}</section>
    ${topics.size ? `<section class="side-section"><h2 class="side-title">Topics</h2><ul class="side-list">${sideLinks(topics, "tag", name => name, tag)}</ul></section>` : ""}`;
  if (view === "about") return;
  if (view === "archive") {
    document.title = "Archive — The Common Hours";
    content.innerHTML = `<div class="section-head"><h1>Archive</h1></div><ul class="side-list">${archives}</ul>${archives ? "" : "<p>No entries yet.</p>"}`;
  } else if (slug) {
    await renderPost(posts, posts.findIndex(post => post.slug === slug));
  } else {
    renderList(posts);
  }
}

start().catch(() => {
  const message = "<p role=\"alert\">The journal could not load. Please try again shortly.</p>";
  if (view === "about") sidebar.innerHTML = message;
  else content.innerHTML = message;
});
