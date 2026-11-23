import { pageHref } from "./page-url.js";
import { escape } from "./text.js";
import { noteCard } from "./archive.js";

const seriesId = name => "series-" + btoa(String.fromCharCode(...new TextEncoder().encode(name))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const seriesHref = series => "series.html#" + seriesId(series);

export function seriesEntries(posts, series) {
  return posts.filter(post => post.series === series).sort((a, b) =>
    (a.series_order ?? 10000) - (b.series_order ?? 10000) || a.published_on.localeCompare(b.published_on) || a.id.localeCompare(b.id));
}

export function seriesMembership(post) {
  if (!post.series) return "";
  const label = post.series_order == null ? "Part of the series" : "Part " + post.series_order + " of the series";
  return `<p class="article-series">${escape(label)} <a href="${seriesHref(post.series)}">${escape(post.series)}</a></p>`;
}

export function seriesNavigation(posts, post) {
  if (!post.series) return "";
  const group = seriesEntries(posts, post.series);
  const next = group[group.findIndex(item => item.id === post.id) + 1];
  return `<nav class="series-navigation" aria-label="Article series"><h2>In this series</h2>
    ${next ? `<a href="${escape(pageHref({ post: next.slug }))}">Next in the series · ${escape(next.title)}</a>` : ""}
    <a href="${seriesHref(post.series)}">See the full series</a></nav>`;
}

export function seriesDirectory(posts) {
  const names = [...new Set(posts.map(post => post.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const groups = names.map(name => `<section class="series-group" id="${seriesId(name)}"><h2>${escape(name)}</h2>
    ${seriesEntries(posts, name).map(post => post.is_note ? noteCard(post, date => date) : `<article class="entry">
      <h3 class="entry-title"><a href="${escape(pageHref({ post: post.slug }))}">${escape(post.title)}</a></h3>
      ${post.series_order == null ? "" : `<p class="meta">Part ${escape(post.series_order)}</p>`}<p>${escape(post.excerpt)}</p></article>`).join("")}</section>`);
  return '<div class="section-head"><h1>Series</h1></div>' + (groups.join("") || "<p>No series have been published yet.</p>");
}
