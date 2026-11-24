import { pageHref } from "./page-url.js";
import { escape } from "./text.js";
import { noteCard } from "./archive.js";

const legacySeriesId = name => "series-" + btoa(String.fromCharCode(...new TextEncoder().encode(name))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const seriesSlug = name => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function seriesId(name, posts) {
  const slug = seriesSlug(name);
  if (!slug) return legacySeriesId(name);
  const id = "series-" + slug;
  const conflict = posts.some(({ series }) => series && series !== name &&
    (seriesSlug(series) === slug || legacySeriesId(series) === id));
  return conflict ? legacySeriesId(name) : id;
}

const seriesHref = (name, posts) => "series.html#" + seriesId(name, posts);

export function seriesEntries(posts, series) {
  return posts.filter(post => post.series === series).sort((a, b) =>
    (a.series_order ?? 10000) - (b.series_order ?? 10000) || a.published_on.localeCompare(b.published_on) || a.id.localeCompare(b.id));
}

export function seriesMembership(post, posts) {
  if (!post.series) return "";
  const label = post.series_order == null ? "Part of the series" : "Part " + post.series_order + " of the series";
  return `<p class="article-series">${escape(label)} <a href="${seriesHref(post.series, posts)}">${escape(post.series)}</a></p>`;
}

export function seriesNavigation(posts, post) {
  if (!post.series) return "";
  const group = seriesEntries(posts, post.series);
  const next = group[group.findIndex(item => item.id === post.id) + 1];
  return `<nav class="series-navigation" aria-label="Article series"><h2>In this series</h2>
    ${next ? `<a href="${escape(pageHref({ post: next.slug }))}">Next in the series · ${escape(next.title)}</a>` : ""}
    <a href="${seriesHref(post.series, posts)}">See the full series</a></nav>`;
}

export function seriesDirectory(posts) {
  const names = [...new Set(posts.map(post => post.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const groups = names.map(name => {
    const id = seriesId(name, posts);
    const legacy = legacySeriesId(name);
    const parts = seriesEntries(posts, name);
    return `<details class="series-group">
      <summary><span class="series-name">${escape(name)}</span><span class="section-note">${parts.length} ${parts.length === 1 ? "part" : "parts"}</span></summary>
      <span id="${id}" class="series-anchor" aria-hidden="true"></span>
      ${legacy !== id ? `<span id="${legacy}" class="series-anchor" aria-hidden="true"></span>` : ""}
      <ol class="series-parts">${parts.map(post => `<li class="series-part">
        ${post.series_order == null ? "" : `<span class="series-part-number">Part ${escape(post.series_order)}</span>`}
        ${post.is_note ? noteCard(post, date => date) : `<div><h2 class="entry-title"><a href="${escape(pageHref({ post: post.slug }))}">${escape(post.title)}</a></h2>
          <p class="series-excerpt">${escape(post.excerpt)}</p></div>`}</li>`).join("")}</ol></details>`;
  });
  return `<a class="back" href="archive.html">← Archive</a><div class="section-head"><h1>Series</h1><span class="section-note">${names.length} series</span></div>
    <div class="series-directory">${groups.join("") || "<p>No series have been published yet.</p>"}</div>`;
}
