import { pageHref } from "./page-url.js";
import { escape, request } from "./common.js";
import { cachedEntries } from "./public-cache.js";
import { noteCard } from "./archive.js";
import { noteBody } from "./note.js";
import { loadNoteImages } from "./image-viewer.js";
import { searchExcerpt } from "./text.js";

const entryHref = slug => pageHref({ post: slug });

function cards(posts) {
  return posts.map(post => post.is_note ? noteCard(post, date => date) : '<article class="entry"><a class="entry-title" href="' + entryHref(post.slug) + '">' +
    escape(post.title) + '</a><p>' + escape(post.excerpt) + '</p></article>').join("");
}

export function renderReadingList(content, title, entries, empty = "No entries here yet.") {
  document.title = title + " - The Common Hours";
  content.innerHTML = '<div class="section-head"><h1>' + escape(title) + '</h1></div>' +
    (entries.length ? cards(entries) : '<p>' + escape(empty) + '</p>');
}

export function restoreArticleAnchors(body) {
  const paragraphs = [...body.children].filter(element =>
    element.matches("p") && element.textContent.trim() && !element.querySelector(".media-slot, .attachment"));
  paragraphs.forEach((paragraph, index) => {
    paragraph.id = "p-" + (index + 1);
  });
  if (/^#(?:p-\d+|fn(?:ref)?[a-z0-9-]+)$/.test(location.hash)) {
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  }
}

export async function findEntries(query) {
  const { url } = await import("./config.js");
  if (!url) return [];
  if (!navigator.onLine) return cachedEntries(query);
  try {
    const options = { method: "POST", body: { p_query: query } };
    try { return await request("/rest/v1/rpc/qmargin_b74_search_previews", options); }
    catch (error) {
      if (!["PGRST202", "42883"].includes(error.code)) throw error;
      return await request("/rest/v1/rpc/qmargin_b74_search_posts", options);
    }
  } catch (error) {
    if (!error.status || error.status >= 500) {
      const entries = await cachedEntries(query);
      if (entries.length) return entries;
    }
    throw error;
  }
}

export function searchCards(entries, query) {
  if (!entries.length) return "<p>No matching entries.</p>";
  const term = query.trim();
  const escaped = term.replace(/[$^.*+?{}()|[\]\\]/g, "\\$&");
  const pattern = escaped ? new RegExp("(" + escaped + ")", "giu") : null;
  const highlight = text => pattern ? String(text).split(pattern).map((part, index) =>
    index % 2 ? "<mark>" + escape(part) + "</mark>" : escape(part)).join("") : escape(text);
  return entries.map(post => {
    const context = post.snippet || searchExcerpt(post.excerpt, term) || searchExcerpt(post.tag, term);
    const excerpt = context && context !== post.title ? context : post.excerpt;
    const title = post.is_note ? "Note · " + post.published_on : post.title;
    return '<article class="entry"><a class="entry-title" href="' + entryHref(post.slug) + '">' + highlight(title) + "</a>" +
      (excerpt ? '<p class="search-snippet">' + highlight(excerpt) + "</p>" : "") + "</article>";
  }).join("");
}

export async function renderReview(content) {
  document.title = "Draft review - The Common Hours";
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow, noarchive";
  document.head.append(robots);
  const token = location.hash.slice(1);
  const read = image => request("/rest/v1/rpc/qmargin_b74_read_review", {
    method: "POST", body: { p_token: token, p_image: image },
  });
  let draft;
  if (/^[0-9a-f]{64}$/.test(token)) {
    try { draft = await read(null); } catch { /* Treat an unavailable review as expired. */ }
  }
  if (!draft) {
    content.innerHTML = "<h1>Review link unavailable</h1><p>This link is invalid or has expired.</p>";
    return;
  }
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.published_slug || "")) {
    location.replace(pageHref({ post: draft.published_slug }));
    return;
  }
  if (draft.is_note) {
    content.innerHTML = '<article class="article journal-note"><p class="meta">Private draft review</p><h1>Note</h1>' +
      noteBody(draft.body, undefined, true) +
      (draft.reader_prompt ? '<p class="reader-prompt">' + escape(draft.reader_prompt) + '</p>' : '') + '</article>';
    await loadNoteImages(content, read);
    return;
  }
  const { renderText } = await import("./rich.js");
  content.innerHTML = '<article class="article"><p class="meta">Private draft review</p><h1>' +
    escape(draft.title || "Untitled entry") + '</h1><p class="meta">' + escape([draft.published_on, draft.tag].filter(Boolean).join(" · ")) +
    '</p><p>' + escape(draft.excerpt || "") + '</p><div id="entry-body" class="prose"></div>' +
    (draft.reader_prompt ? '<p class="reader-prompt">' + escape(draft.reader_prompt) + '</p>' : '') + '</article>';
  renderText(content.querySelector("#entry-body"), draft.body || "", read, {
    markdown: true,
    enlargeImages: true,
    loadAttachment: id => request("/functions/v1/review-attachment", {
      method: "POST", body: { token, id }, download: true, timeout: 120000,
    }),
  });
}
