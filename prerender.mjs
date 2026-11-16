import { escape, imageSource, markdownMarker, mediaId } from "./shared/text.js";
import { mediaReferences, renderMarkup } from "./shared/rich.js";
import { pageHref } from "./shared/page-url.js";
import { notice, terms } from "./blog/legal-content.js";
import { photoArchiveShell } from "./blog/photo-shell.js";

const home = "https://commonhours.qd.je/";
export const generatedFile = /^(?:(?:archive|topics|photos|start|privacy|terms|collections|photo-essays|entry-[a-z0-9-]{1,120}|photo-(?:[0-9a-f-]{36}|month-\d{4}-\d{2}))\.html|media-[0-9a-f-]{36}\.jpg|sitemap\.xml|robots\.txt)$/i;
const missingColumn = error => ["42703", "PGRST204"].includes(error.code);
const missingTable = error => ["42P01", "PGRST205"].includes(error.code);
const date = value => new Date(value).toLocaleDateString("en", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
const href = values => escape(pageHref(values));
const photoDate = photo => photo.week === "1900-01-01" ? photo.created_at.slice(0, 10) : photo.week || photo.month;

export async function loadPublicSnapshot(config) {
  const files = new Map();
  const images = new Map();
  if (!config.origin) return { posts: [], photos: [], files, images };
  async function get(path) {
    const response = await fetch(config.origin + "/rest/v1/qmargin_b74_" + path, {
      headers: { apikey: config.key }, signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error("Could not pre-render public journal data (" + response.status + ")."), { code: data?.code });
    if (!Array.isArray(data)) throw new Error("Unexpected public journal data.");
    return data;
  }
  async function rows(table, selections, filter, optional = false) {
    for (const [index, select] of selections.entries()) {
      try {
        const result = [];
        for (;;) {
          const batch = await get(table + "?select=" + select + filter + "&limit=100&offset=" + result.length);
          result.push(...batch);
          if (batch.length < 100) return result;
        }
      } catch (error) {
        if (optional && missingTable(error)) return [];
        if (!missingColumn(error) || index === selections.length - 1) throw error;
      }
    }
  }
  const base = "id,slug,title,tag,excerpt,published_on,body";
  const weekly = "id,week,media_id,title,alt,created_at";
  const [posts, weeks, months] = await Promise.all([
    rows("posts", [base + ",series,series_order,start_here,paired_photo,collection,collection_intro,photo_essay", base + ",series,series_order,start_here", base], "&published=eq.true&order=published_on.desc,id.desc"),
    rows("weekly_photos", [weekly + ",series,description", weekly + ",description", weekly], "&order=week.desc,created_at.asc,id.asc", true),
    rows("photos", ["month,media_id,alt,caption"], "&order=month.desc", true),
  ]);
  const photos = [...weeks, ...months.map(photo => ({ ...photo, id: "month-" + photo.month.slice(0, 7), title: photo.caption || "From the journal" }))]
    .sort((a, b) => photoDate(b).localeCompare(photoDate(a)));
  const ids = new Set(photos.map(photo => photo.media_id));
  for (const post of posts) for (const reference of mediaReferences(post.body)) if (reference.kind === "image") ids.add(reference.id);
  for (const id of ids) {
    if (!mediaId.test(id || "")) continue;
    const [image] = await rows("media", ["encoded,width,height,alt", "encoded,width,height"], "&id=eq." + id);
    if (!imageSource(image)) continue;
    const src = "media-" + id + ".jpg";
    files.set(src, Buffer.from(image.encoded, "base64"));
    images.set(id, { ...image, encoded: undefined, src });
  }
  return { posts, photos, files, images };
}

export function renderPublicPages(template, { posts, photos, images, files }) {
  const pages = new Map(files);
  const publicFiles = new Set([
    ...posts.map(post => pageHref({ post: post.slug })),
    ...photos.map(photo => pageHref({ view: "photo", photo: photo.id })),
  ]);
  const cards = entries => entries.map(post => `<article class="entry"><p class="meta"><time datetime="${escape(post.published_on)}">${date(post.published_on)}</time> ${escape(post.tag)}</p><h2 class="entry-title"><a href="${href({ post: post.slug })}">${escape(post.title)}</a></h2><p>${escape(post.excerpt)}</p></article>`).join("") || "<p>No entries here yet.</p>";
  const picture = (id, alt) => {
    const image = images.get(id);
    return image ? `<img src="${image.src}" width="${Number(image.width)}" height="${Number(image.height)}" alt="${escape(alt || image.alt || "")}" loading="lazy" decoding="async">` : `<span class="photo-unavailable">${escape(alt || "Photo unavailable")}</span>`;
  };
  const sidebar = `<section class="side-section"><h2 class="side-title">Blog archive</h2><p><a href="archive.html">Browse all entries →</a></p><p><a href="collections.html">Themed collections →</a></p></section>`;
  function page(values, title, content, description, classes = "wide-page") {
    const address = pageHref(values);
    const file = address === "./" ? "index.html" : address;
    if (file !== "index.html" && !generatedFile.test(file)) throw new Error("Invalid public page filename.");
    const canonical = new URL(address, home).href;
    const fullTitle = title + " — The Common Hours";
    let html = template.replace('<html lang="en">', () => `<html lang="en" class="${classes}" data-route="${escape(new URLSearchParams(values))}">`)
      .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escape(fullTitle)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escape(description)}">`)
      .replace("</head>", () => `<link rel="canonical" href="${escape(canonical)}"><meta property="og:title" content="${escape(fullTitle)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:type" content="${values.post ? "article" : "website"}"></head>`)
      .replace(/<!-- public-content -->[\s\S]*?<!-- \/public-content -->/, () => content)
      .replace("</body>", () => `<template id="public-pages" data-files="${escape([...publicFiles].join(" "))}"></template></body>`)
      .replace('aria-label="Journal content" aria-busy="true"', 'aria-label="Journal content" aria-busy="false" data-prerendered="true"')
      .replace('<aside id="sidebar" aria-label="Blog archive"></aside>', `<aside id="sidebar" aria-label="Blog archive">${sidebar}</aside>`);
    if (!values.view && !values.post) {
      html = html.replace('aria-label="Photo of the Week" aria-busy="true"', 'aria-label="Photo of the Week"')
        .replace('<img width="1200" height="800" alt="" draggable=', '<img src="cover.jpg" width="1200" height="800" alt="A wooden jetty reaches into a mist-covered lake" draggable=');
    }
    pages.set(file, html);
  }
  const heading = title => `<div class="section-head"><h1>${escape(title)}</h1></div>`;
  page({}, "An independent journal", heading("Latest entries") + cards(posts.slice(0, 5)) + '<p><a class="back" href="archive.html">Browse all entries →</a></p>', "An independent journal by Ellis Vale.", "home-page");
  page({ view: "archive" }, "Archive", heading("Archive") + '<p><a href="collections.html">Themed collections →</a></p>' + cards(posts), "Browse every published entry in The Common Hours.");
  page({ view: "start" }, "Start here", heading("Start here") + cards(posts.filter(post => post.start_here)), "Selected entries to begin reading The Common Hours.");
  page({ view: "photo-essays" }, "Photo essays", heading("Photo essays") + cards(posts.filter(post => post.photo_essay)), "Stories told through photographs in The Common Hours.");
  for (const [view, body] of [["privacy", notice], ["terms", terms]]) {
    page({ view }, view === "privacy" ? "Privacy" : "Terms", `<article class="legal">${body}</article>`, `Read the ${view === "privacy" ? "privacy policy" : "terms"} for The Common Hours.`, "policy-page");
  }
  const topics = [...new Set(posts.map(post => post.tag))].sort();
  page({ view: "topics" }, "All topics", heading("All topics") + topics.map(topic => `<section><h2>${escape(topic)}</h2>${cards(posts.filter(post => post.tag === topic))}</section>`).join(""), "Browse the journal by topic.");
  const collections = [...new Set(posts.map(post => post.collection).filter(Boolean))].sort();
  page({ view: "collections" }, "Themed collections", heading("Themed collections") + (collections.map(name => {
    const entries = posts.filter(post => post.collection === name);
    return `<section><h2>${escape(name)}</h2><p class="collection-intro">${escape(entries.find(post => post.collection_intro)?.collection_intro || "")}</p>${cards(entries)}</section>`;
  }).join("") || "<p>No collections have been published yet.</p>"), "Explore themed collections of entries.");
  for (const post of posts) {
    if (!/^[a-z0-9-]{1,120}$/.test(post.slug)) throw new Error("Invalid published entry slug.");
    let body = post.body.startsWith(markdownMarker) ? renderMarkup(post.body) : post.body.split(/\n\s*\n/).map(text => `<p>${escape(text)}</p>`).join("");
    body = body.replace(/<span class="media-slot"[^>]*data-image="([^"]+)" data-alt="([^"]*)">Loading image…<\/span>/g, (_, id, alt) =>
      images.has(id) ? `<span class="media-slot">${picture(id, images.get(id).alt).replace('alt=""', () => `alt="${alt}"`)}</span>` : `<span>${alt || "Image unavailable"}</span>`)
      .replace(/<a href="#" data-attachment="[^"]+" class="attachment"[^>]*>([\s\S]*?)<\/a>/g, "$1 (download with JavaScript)")
      .replace(/href="\?post=([a-z0-9-]+)"/g, (_, slug) => `href="${publicFiles.has("entry-" + slug + ".html") ? "entry-" + slug + ".html" : "./?post=" + slug}"`);
    const paired = photos.find(photo => photo.id === post.paired_photo);
    if (paired) body += `<figure class="captioned-photo">${picture(paired.media_id, paired.alt)}<figcaption><a href="${href({ view: "photo", photo: paired.id })}">Paired photo · ${escape(paired.title)}</a></figcaption></figure>`;
    page({ post: post.slug }, post.title, `<a class="back" href="./">← Back to the journal</a><article class="article"><h1>${escape(post.title)}</h1><p class="meta"><time datetime="${escape(post.published_on)}">${date(post.published_on)}</time> ${escape(post.tag)} · By Ellis Vale</p><div class="prose" id="entry-body">${body}</div></article><noscript><p>Enable JavaScript to read or leave comments.</p></noscript>`, post.excerpt, "article-page");
  }
  let archive = photoArchiveShell.replace("Loading photos…", photos.length + (photos.length === 1 ? " photo" : " photos"));
  archive = archive.replace(/<div id="photo-results">[\s\S]*$/, () => `<div id="photo-results">${photos.length ? '<ul class="photo-grid">' + photos.map(photo => `<li><a href="${href({ view: "photo", photo: photo.id })}"><div class="photo-thumb photo-ready">${picture(photo.media_id, photo.alt)}</div><div class="photo-card-caption"><strong>${escape(photo.title)}</strong><small>${date(photoDate(photo))}${photo.series ? " · " + escape(photo.series) : ""}</small></div></a></li>`).join("") + "</ul>" : '<p class="photo-empty">There are no photos in the archive yet.</p>'}</div></section>`);
  page({ view: "photos" }, "Photo archive", archive, "Browse the journal’s photographs by date or series.");
  for (const photo of photos) {
    page({ view: "photo", photo: photo.id }, photo.title, `<a class="back" href="photos.html">← Photo archive</a><article class="photo-detail"><h1>${escape(photo.title)}</h1><p class="meta">${date(photoDate(photo))}</p><div class="photo-detail-image photo-ready">${picture(photo.media_id, photo.alt)}</div>${photo.description ? `<p class="photo-description">${escape(photo.description)}</p>` : ""}</article>`, photo.description || photo.alt || photo.title);
  }
  pages.set("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + [...pages.keys()].filter(file => file.endsWith(".html")).map(file => `<url><loc>${escape(new URL(file === "index.html" ? "./" : file, home).href)}</loc></url>`).join("") + "</urlset>\n");
  pages.set("robots.txt", "User-agent: *\nAllow: /\nSitemap: " + home + "sitemap.xml\n");
  return pages;
}
