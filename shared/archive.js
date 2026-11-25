import { articleTopics, escape } from "./text.js";
import { pageHref } from "./page-url.js";
import { noteBody, noteExtras, noteImageSlot, noteText, readNote } from "./note.js";
import { plainNoteText } from "./rich.js";

export const archivePageSize = 15;

export function publicationRevision(posts, detail = false) {
  const values = JSON.stringify(posts.map(post => [
    post.id, post.slug, post.title, post.tag, post.excerpt, post.published_on,
    post.series || "", post.series_order ?? null, Boolean(post.start_here), Boolean(post.is_note),
    detail || post.is_note ? post.body ?? null : null,
  ]));
  let hash = 2166136261;
  for (let index = 0; index < values.length; index++) {
    hash = Math.imul(hash ^ values.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function archiveTitle(params) {
  const selection = [params.get("year"), params.get("month"), params.get("tag"), params.get("page") && "Page " + params.get("page")].filter(Boolean).join(" · ");
  return "Archive" + (selection ? " · " + selection : "");
}
const href = values => escape(pageHref({ view: "archive", ...values }));
const monthLabel = value => new Date(value + "-01T00:00:00Z").toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });

export function grouped(posts, value) {
  const groups = new Map();
  for (const name of posts.flatMap(value)) groups.set(name, (groups.get(name) || 0) + 1);
  return groups;
}

export function sideLinks(groups, key, label, selected) {
  return [...groups].map(([name, count]) =>
    `<li><a href="${href({ [key]: name })}" ${name === selected ? 'aria-current="page"' : ""}>${escape(label(name))}<span>${count}</span></a></li>`
  ).join("");
}

export function renderSidebar(months, topics, month, tag) {
  const archives = sideLinks(new Map([...months].filter(([name], index) => index < 8 || name === month)), "month", monthLabel, month);
  return `<section class="side-section"><h2 class="side-title">Blog archive</h2>
    <ul class="side-list">${archives}</ul>
    ${months.size > 8 ? '<p><a class="back" href="archive.html">All months →</a></p>' : ""}
    ${!months.size ? '<p class="status">No published entries yet.</p>' : ""}</section>
    ${topics.length ? `<section class="side-section sidebar-topics"><h2 class="side-title">Topics</h2><ul class="side-list">${sideLinks(topics.slice(0, 10), "tag", name => name, tag)}</ul>
    ${topics.length > 10 ? '<a class="back" href="topics.html">All topics →</a>' : ""}</section>` : ""}`;
}

export function noteCard(post, dateLabel, picture, discussion) {
  const text = post.body === undefined ? post.excerpt : readNote(post.body).text;
  const permalink = escape(pageHref({ post: post.slug }));
  const date = `<p class="meta"><a class="note-permalink" href="${permalink}" aria-label="${escape("Read note: " + post.title)}">${discussion ? "" : "Note · "}<time datetime="${escape(post.published_on)}">${escape(dateLabel(post.published_on))}</time></a></p>`;
  if (!discussion) return `<article class="entry journal-note">${date}${noteText(text)}${noteExtras(post.body, picture)}</article>`;
  const title = noteHeading(post, text);
  const recent = commentCards(discussion.slice(-2));
  return `<article class="entry journal-note note-row"><div class="note-copy">${date}
    ${title ? `<h2 class="note-title"><a href="${permalink}">${escape(title)}</a></h2>` : ""}
    ${noteText(text)}${noteExtras(post.body, picture, true)}
    <a class="back note-open" href="${permalink}">Open note</a></div>
    <aside class="note-rail" aria-label="Note conversation">${noteLike(post)}<a class="note-comments-link" href="${permalink}#comments">${commentLabel(discussion.length)}</a><div class="note-comment-preview">${recent}</div></aside></article>`;
}

export const commentLabel = count => count ? count + (count === 1 ? " comment" : " comments") : "Leave a comment";

function noteLike(post) {
  return `<button class="note-like quiet-button" type="button" data-note-like="${escape(post.id)}" aria-pressed="false" disabled hidden><span aria-hidden="true">♡</span> <span class="like-label">Like</span> <span class="like-count"></span></button>`;
}

function noteHeading(post, text) {
  const first = plainNoteText((text || "").split(/\r?\n/, 1)[0]);
  return post.title && post.title !== first ? post.title : "";
}

export function renderNotes(posts, dateLabel, picture, comments = new Map()) {
  return `<div class="notes-feed"><header class="notes-mast"><h1>Notes</h1><p>Brief observations, passing thoughts, and photographs.</p></header>
    ${posts.filter(post => post.is_note).map(post => noteCard(post, dateLabel, picture, comments.get(post.id) || [])).join("") || '<p>No notes have been published yet.</p>'}</div>`;
}

export function renderNoteDetail(post, dateLabel, picture, discussion = "") {
  const title = noteHeading(post, readNote(post.body).text) || "Note";
  return `<a class="back note-back" href="notes.html">← Back to Notes</a>
    <div class="note-detail-layout"><article class="article journal-note" data-publication="${publicationRevision([post], true)}">
      <p class="meta"><time datetime="${escape(post.published_on)}">${escape(dateLabel(post.published_on))}</time> <span class="byline">By Ellis Vale</span></p>
      <h1>${escape(title)}</h1><div class="prose" id="entry-body">${noteBody(post.body, picture, true)}</div></article>
      <aside class="note-rail note-discussion"><section class="comments" id="comments"><header><h2>Comments</h2>${noteLike(post)}</header>
        <div id="comment-list" aria-live="polite">${discussion || '<p class="status">No comments yet.</p>'}</div></section></aside></div>`;
}

export function renderRecentNotes(posts, dateLabel, thumbnail = noteImageSlot) {
  const notes = posts.filter(post => post.is_note).slice(0, 3);
  return `<section class="side-section"><h2 class="side-title">Recent notes</h2>
    ${notes.length ? '<ul class="recent-notes">' + notes.map(post => {
      const { text, photos } = readNote(post.body ?? post.excerpt);
      const date = escape(dateLabel(post.published_on));
      return `<li><a href="${escape(pageHref({ post: post.slug }))}">${photos[0] ? `<span class="note-thumb">${thumbnail(photos[0])}</span>` : ""}
        <span><time datetime="${escape(post.published_on)}">${date}</time><span class="note-preview">${escape(plainNoteText(text) || "Photo note")}</span></span></a></li>`;
    }).join("") + '</ul>' : '<p class="status">No published notes yet.</p>'}
    <a class="back" href="notes.html">View all notes</a></section>`;
}

export function renderLatest(posts, dateLabel, limit) {
  const entries = posts.filter(post => !post.is_note).slice(0, limit);
  return `<div class="section-head"><h1>Latest entries</h1></div>${entries.map(post => `<article class="entry">
    <p class="meta"><time datetime="${escape(post.published_on)}">${escape(dateLabel(post.published_on))}</time>
      ${articleTopics(post).map(tag => `<a class="tag" href="${href({ tag })}">${escape(tag)}</a>`).join(" · ")}</p>
    <h2 class="entry-title"><a href="${escape(pageHref({ post: post.slug }))}">${escape(post.title)}</a></h2>
    <p>${escape(post.excerpt)}</p></article>`).join("") || '<p>No entries here yet.</p>'}
    <p><a class="back" href="archive.html">Browse all articles</a></p>`;
}

export function renderTopics(topicCounts) {
  const topics = [...topicCounts].sort(([a], [b]) => a.localeCompare(b));
  return `<div class="section-head"><h1>All topics</h1><span class="section-note">${topics.length} ${topics.length === 1 ? "topic" : "topics"}</span></div>` +
    (topics.length ? `<ul class="side-list all-topics">${sideLinks(topics, "tag", name => name)}</ul>` : "<p>No topics have been published yet.</p>");
}

export function commentCards(comments) {
  return comments.map(comment => `<article class="comment"><h3>${escape(comment.display_name)}</h3>
    <p>${escape(comment.body)}</p></article>`).join("");
}

export function archiveEntries(posts, params) {
  return posts.filter(post => (!params.get("year") || post.published_on.startsWith(params.get("year") + "-")) &&
    (!params.get("month") || post.published_on.startsWith(params.get("month") + "-")) &&
    (!params.get("tag") || articleTopics(post).includes(params.get("tag"))));
}

export function renderArchive(posts, params, picture) {
  const entries = archiveEntries(posts, params);
  const totalPages = Math.max(1, Math.ceil(entries.length / archivePageSize));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(params.get("page"), 10) || 1));
  const selected = Object.fromEntries(["year", "month", "tag"].filter(key => params.get(key)).map(key => [key, params.get(key)]));
  const unique = values => [...new Set(values)];
  const links = (key, values, label = value => value) => values.map(value => `<a href="${href({ [key]: value })}"${selected[key] === value ? ' aria-current="page"' : ""}>${escape(label(value))}</a>`).join(" ");
  const selection = [selected.year, selected.month && monthLabel(selected.month), selected.tag].filter(Boolean).join(" · ");
  return `<div class="section-head"><h1>Archive</h1><span class="section-note">${entries.length} ${entries.length === 1 ? "entry" : "entries"}</span></div>
    <nav class="archive-browse" aria-label="Browse the archive">
      <p><a href="archive.html">All entries</a> · <a href="topics.html">Topics</a> · <a href="series.html">Series</a></p>
      <details${selection ? " open" : ""}><summary>Browse by year, month, or topic</summary>
        <h2>Year</h2><div>${links("year", unique(posts.map(post => post.published_on.slice(0, 4))))}</div>
        <h2>Month</h2><div>${links("month", unique(posts.map(post => post.published_on.slice(0, 7))), monthLabel)}</div>
        <h2>Topic</h2><div>${links("tag", unique(posts.flatMap(articleTopics)).sort((a, b) => a.localeCompare(b)))}</div>
      </details>
    </nav>${selection ? `<p class="status">Showing ${escape(selection)}</p>` : ""}
    ${entries.slice((page - 1) * archivePageSize, page * archivePageSize).map(post => post.is_note ? noteCard(post, value => value, picture) : `<article class="entry">
      <p class="meta"><time datetime="${escape(post.published_on)}">${escape(post.published_on)}</time>${articleTopics(post).map(tag => `<a href="${href({ tag })}">${escape(tag)}</a>`).join(" · ")}</p>
      <h2 class="entry-title"><a href="${escape(pageHref({ post: post.slug }))}">${escape(post.title)}</a></h2><p>${escape(post.excerpt)}</p></article>`).join("") || "<p>No entries here yet.</p>"}
    ${totalPages > 1 ? `<nav class="pagination" aria-label="Archive pages">
      ${page > 1 ? `<a rel="prev" href="${href({ ...selected, page: page - 1 })}">← Previous</a>` : ""}
      <span class="section-note">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a rel="next" href="${href({ ...selected, page: page + 1 })}">Next →</a>` : ""}</nav>` : ""}`;
}
