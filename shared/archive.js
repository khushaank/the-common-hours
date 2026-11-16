import { escape } from "./text.js";
import { pageHref } from "./page-url.js";

export const archivePageSize = 15;
export function archiveTitle(params) {
  const selection = [params.get("year"), params.get("month"), params.get("tag"), params.get("page") && "Page " + params.get("page")].filter(Boolean).join(" · ");
  return "Archive" + (selection ? " · " + selection : "");
}
const href = values => escape(pageHref({ view: "archive", ...values }));
const monthLabel = value => new Date(value + "-01T00:00:00Z").toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });

export function archiveEntries(posts, params) {
  return posts.filter(post => (!params.get("year") || post.published_on.startsWith(params.get("year") + "-")) &&
    (!params.get("month") || post.published_on.startsWith(params.get("month") + "-")) &&
    (!params.get("tag") || post.tag === params.get("tag")));
}

export function renderArchive(posts, params) {
  const entries = archiveEntries(posts, params);
  const totalPages = Math.max(1, Math.ceil(entries.length / archivePageSize));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(params.get("page"), 10) || 1));
  const selected = Object.fromEntries(["year", "month", "tag"].filter(key => params.get(key)).map(key => [key, params.get(key)]));
  const unique = values => [...new Set(values)];
  const links = (key, values, label = value => value) => values.map(value => `<a href="${href({ [key]: value })}"${selected[key] === value ? ' aria-current="page"' : ""}>${escape(label(value))}</a>`).join(" ");
  const selection = [selected.year, selected.month && monthLabel(selected.month), selected.tag].filter(Boolean).join(" · ");
  return `<div class="section-head"><h1>Archive</h1><span class="section-note">${entries.length} ${entries.length === 1 ? "entry" : "entries"}</span></div>
    <nav class="archive-browse" aria-label="Browse the archive">
      <p><a href="archive.html">All entries</a> · <a href="collections.html">Themed collections</a></p>
      <details${selection ? " open" : ""}><summary>Browse by year, month, or topic</summary>
        <h2>Year</h2><div>${links("year", unique(posts.map(post => post.published_on.slice(0, 4))))}</div>
        <h2>Month</h2><div>${links("month", unique(posts.map(post => post.published_on.slice(0, 7))), monthLabel)}</div>
        <h2>Topic</h2><div>${links("tag", unique(posts.map(post => post.tag)).sort((a, b) => a.localeCompare(b)))}</div>
      </details>
    </nav>${selection ? `<p class="status">Showing ${escape(selection)}</p>` : ""}
    ${entries.slice((page - 1) * archivePageSize, page * archivePageSize).map(post => `<article class="entry">
      <p class="meta"><time datetime="${escape(post.published_on)}">${escape(post.published_on)}</time><a href="${href({ tag: post.tag })}">${escape(post.tag)}</a></p>
      <h2 class="entry-title"><a href="${escape(pageHref({ post: post.slug }))}">${escape(post.title)}</a></h2><p>${escape(post.excerpt)}</p></article>`).join("") || "<p>No entries here yet.</p>"}
    ${totalPages > 1 ? `<nav class="pagination" aria-label="Archive pages">
      ${page > 1 ? `<a rel="prev" href="${href({ ...selected, page: page - 1 })}">← Previous</a>` : ""}
      <span class="section-note">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a rel="next" href="${href({ ...selected, page: page + 1 })}">Next →</a>` : ""}</nav>` : ""}`;
}
