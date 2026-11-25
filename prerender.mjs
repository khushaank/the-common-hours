import sharp from "sharp";
import { articleTopics, entryTags, escape, imageSource, markdownMarker, mediaId } from "./shared/text.js";
import { mediaReferences, renderMarkup } from "./shared/rich.js";
import { readNote } from "./shared/note.js";
import { carouselSlot, coverPhoto } from "./shared/carousel.js";
import { pageHref } from "./shared/page-url.js";
import { notice, terms } from "./blog/legal-content.js";
import { archiveEntries, archivePageSize, archiveTitle, commentCards, grouped, noteCard, publicationRevision, renderArchive, renderLatest, renderNoteDetail, renderNoteNavigation, renderNotes, renderRecentNotes, renderSidebar, renderTopics } from "./shared/archive.js";
import { seriesDirectory, seriesMembership, seriesNavigation } from "./shared/series.js";
import { startIntroduction, startEmpty } from "./blog/reading-copy.js";
import { photoText, photoTitle, publicPhoto } from "./shared/photo-text.js";

const home = "https://commonhours.qd.je/";
export const generatedFile = /^(?:(?:archive(?:-(?:year-\d{4}|month-\d{4}-\d{2}|tag-[A-Za-z0-9_~]+))?(?:-page-[1-9]\d*)?|notes|topics|photos|start|series|privacy|terms|collections|photo-essays|entry-[a-z0-9-]{1,120}|photo-(?:[0-9a-f-]{36}|month-\d{4}-\d{2}))\.html|media-[0-9a-f-]{36}\.jpg|note-thumb-[0-9a-f-]{36}\.webp|attachment-[0-9a-f-]{36}\.bin|sitemap\.xml|robots\.txt)$/i;
const missingColumn = error => ["42703", "PGRST204"].includes(error.code);
const missingTable = error => ["42P01", "PGRST205"].includes(error.code);
const date = value => new Date(value).toLocaleDateString("en", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
const href = values => escape(pageHref(values));
const photoDate = photo => photo.week && photo.week !== "1900-01-01" ? photo.week : photo.month || photo.created_at?.slice(0, 10) || "";

export async function loadPublicSnapshot(config) {
  const files = new Map();
  const images = new Map();
  const attachments = new Map();
  const carousels = new Map();
  const carouselCovers = new Map();
  if (!config.origin) return { posts: [], photos: [], comments: [], files, images, attachments, carousels, carouselCovers };
  async function get(path) {
    const response = await fetch(config.origin + "/rest/v1/qmargin_b74_" + path, {
      headers: { apikey: config.key }, signal: AbortSignal.timeout(12000), redirect: "error",
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
  const [posts, weeks, months, comments] = await Promise.all([
    rows("posts", [",series,series_order,start_here,is_note,note_number", ",series,series_order,start_here,is_note", ",series,series_order,start_here", ",is_note", ""].map(extra => base + extra), "&published=eq.true&order=published_on.desc,id.desc"),
    rows("weekly_photos", [weekly], "&order=week.desc,created_at.asc,id.asc", true),
    rows("photos", ["month,media_id,alt,caption"], "&order=month.desc", true),
    rows("comments", ["post_id,display_name,body"], "&approved=eq.true&order=created_at.asc,id.asc"),
  ]);
  const photos = [...weeks, ...months.map(photo => ({ ...photo, id: "month-" + photo.month.slice(0, 7), title: photo.caption || "From the journal" }))]
    .sort((a, b) => photoDate(b).localeCompare(photoDate(a)));
  const ids = new Set(photos.map(photo => photo.media_id));
  const carouselIds = new Set();
  const downloads = new Set();
  for (const post of posts) {
    if (post.is_note) {
      for (const photo of readNote(post.body).photos) ids.add(photo.id);
      for (const id of readNote(post.body).carousels) carouselIds.add(id);
      continue;
    }
    for (const reference of mediaReferences(post.body)) {
      if (reference.kind === "image") ids.add(reference.id);
      else if (reference.kind === "file") downloads.add(reference.id);
      else if (reference.kind === "carousel") carouselIds.add(reference.id);
    }
  }
  if (carouselIds.size) {
    const [members, galleries] = await Promise.all([
      rows("carousel_photos", ["carousel_id,media_id,alt"], "&order=position.asc", true),
      rows("carousels", ["id,cover_media_id", "id"], "&order=id.asc", true),
    ]);
    for (const { id, cover_media_id } of galleries) {
      if (carouselIds.has(id) && cover_media_id) carouselCovers.set(id, cover_media_id);
    }
    for (const { carousel_id, media_id, alt } of members) {
      if (!carouselIds.has(carousel_id)) continue;
      if (!carousels.has(carousel_id)) carousels.set(carousel_id, []);
      carousels.get(carousel_id).push({ id: media_id, alt });
      ids.add(media_id);
    }
  }
  const thumbnailIds = new Set(posts.filter(post => post.is_note).slice(0, 3).map(post => {
    const note = readNote(post.body);
    const gallery = note.carousels[0];
    return (note.photos[0] || coverPhoto(carousels.get(gallery), carouselCovers.get(gallery)))?.id;
  }));
  for (const id of ids) {
    if (!mediaId.test(id || "")) continue;
    const [image] = await rows("media", ["encoded,width,height,alt", "encoded,width,height"], "&id=eq." + id);
    if (!imageSource(image)) continue;
    const src = "media-" + id + ".jpg";
    const bytes = Buffer.from(image.encoded, "base64");
    files.set(src, bytes);
    images.set(id, { ...image, encoded: undefined, src });
    if (thumbnailIds.has(id)) {
      try {
        files.set(`note-thumb-${id}.webp`, await sharp(bytes).resize(144, 144).webp({ quality: 80 }).toBuffer());
      } catch { /* The full photo remains available if a thumbnail can't be encoded. */ }
    }
  }
  for (const id of downloads) {
    const response = await fetch(config.origin + "/storage/v1/object/qmargin-b74-attachments/" + id, {
      headers: { apikey: config.key, Authorization: "Bearer " + config.key },
      signal: AbortSignal.timeout(120000), redirect: "error",
    });
    if (!response.ok) throw new Error("Could not download a published attachment (" + response.status + ").");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 25 * 1024 * 1024) throw new Error("A published attachment exceeds the 25 MB limit.");
    // Serve untrusted files as binary downloads, never executable same-origin HTML.
    const src = "attachment-" + id + ".bin";
    files.set(src, bytes);
    attachments.set(id, src);
  }
  return { posts, photos, comments, files, images, attachments, carousels, carouselCovers };
}

export function renderPublicPages(template, { posts, photos, comments = [], images, files, attachments = new Map(), carousels = new Map(), carouselCovers = new Map() }, featured) {
  const pages = new Map(files);
  const pageImages = new Map();
  const commentsByPost = new Map();
  for (const comment of comments) {
    if (!commentsByPost.has(comment.post_id)) commentsByPost.set(comment.post_id, []);
    commentsByPost.get(comment.post_id).push(comment);
  }
  const revision = publicationRevision(posts);
  const loading = (template.match(/<!-- public-content -->([\s\S]*?)<!-- \/public-content -->/)?.[1] || "")
    .replace(/\bid="[^"]*"/g, "");
  photos = photos.map(photo => publicPhoto(photo, images.get(photo.media_id)?.alt));
  const archiveRoutes = [{ view: "archive" }];
  for (const [key, values] of [["year", posts.map(post => post.published_on.slice(0, 4))], ["month", posts.map(post => post.published_on.slice(0, 7))], ["tag", posts.flatMap(articleTopics)]]) {
    for (const value of new Set(values)) archiveRoutes.push({ view: "archive", [key]: value });
  }
  const archivePages = archiveRoutes.flatMap(values => Array.from({ length: Math.max(1, Math.ceil(archiveEntries(posts, new URLSearchParams(values)).length / archivePageSize)) }, (_, index) =>
    index ? { ...values, page: String(index + 1) } : values));
  const publicFiles = new Set([
    ...posts.map(post => pageHref({ post: post.slug }, { filename: true })),
    ...photos.map(photo => pageHref({ view: "photo", photo: photo.id }, { filename: true })),
    ...archivePages.map(values => pageHref(values, { filename: true })), ...attachments.values(),
  ]);
  const tagLinks = post => articleTopics(post).map(tag => `<a class="tag" href="${href({ view: "archive", tag })}">${escape(tag)}</a>`).join(" · ");
  const cards = entries => entries.map(post => post.is_note ? noteCard(post, date, notePicture) : `<article class="entry"><p class="meta"><time datetime="${escape(post.published_on)}">${date(post.published_on)}</time> ${tagLinks(post)}</p><h2 class="entry-title"><a href="${href({ post: post.slug })}">${escape(post.title)}</a></h2><p>${escape(post.excerpt)}</p></article>`).join("") || "<p>No entries here yet.</p>";
  const picture = (id, escapedAlt, eager = false) => {
    const image = images.get(id);
    const alt = photoText(escapedAlt) || escape(photoText(image?.alt));
    return image ? `<img src="${escape(image.src)}" width="${Number(image.width)}" height="${Number(image.height)}" alt="${alt || "Photograph"}" draggable="false" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : `<span class="photo-unavailable">${alt || "Photo unavailable"}</span>`;
  };
  const zoomPicture = (id, alt) => {
    const image = images.get(id);
    return image ? `<a class="zoom-image" href="${escape(image.src)}" aria-label="Enlarge photo: ${photoText(alt) || escape(photoText(image.alt)) || "Photograph"}">${picture(id, alt)}</a>` : picture(id, alt);
  };
  const notePicture = ({ id, alt }) => `<span class="media-slot">${zoomPicture(id, escape(alt))}</span>`;
  const thumbnail = ({ id, alt }) => {
    const src = `note-thumb-${id}.webp`;
    return files.has(src) ? `<img src="${src}" width="144" height="144" alt="${escape(photoText(alt) || photoText(images.get(id)?.alt) || "Photograph")}" loading="lazy" decoding="async">` : picture(id, escape(alt));
  };
  const months = grouped(posts, post => post.published_on.slice(0, 7));
  const topicCounts = [...grouped(posts, articleTopics)].sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b));
  function page(values, title, content, description, classes = "wide-page") {
    let galleryCover;
    content = content.replace(/<div class="carousel-embed" data-carousel-id="([a-f0-9-]{36})" data-photos=""><\/div>/g,
      (_, id) => {
        galleryCover ||= images.get(carouselCovers.get(id))?.src;
        return carouselSlot(id, false, carousels.get(id), notePicture);
      });
    const address = pageHref(values);
    const file = address === "./" ? "index.html" : pageHref(values, { filename: true });
    if (file !== "index.html" && !generatedFile.test(file)) throw new Error("Invalid public page filename.");
    const canonical = new URL(address, home).href;
    const fullTitle = title + " - The Common Hours";
    const imagePaths = new Set([...content.matchAll(/<img src="(media-[0-9a-f-]{36}\.jpg)"/g)].map(match => match[1]));
    if (file === "index.html" && featured) imagePaths.add("featured.webp");
    pageImages.set(file, imagePaths);
    const image = values.post && galleryCover || [...imagePaths][0];
    let html = template.replace('<html lang="en">', () => `<html lang="en" class="${classes}" data-route="${escape(new URLSearchParams(values))}">`)
      .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escape(fullTitle)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escape(description)}">`)
      .replace("</head>", () => `<link rel="canonical" href="${escape(canonical)}"><meta property="og:title" content="${escape(fullTitle)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:type" content="${values.post ? "article" : "website"}">${image ? `<meta property="og:image" content="${escape(new URL(image, home).href)}">` : ""}</head>`)
      .replace(/<!-- public-content -->[\s\S]*?<!-- \/public-content -->/, () => '<div class="published-copy">' + content + '</div>' + loading)
      .replace("</body>", () => `<template id="public-pages" data-files="${escape([...publicFiles].join(" "))}" data-publication="${revision}"></template></body>`)
      .replace('aria-label="Journal content" aria-busy="true"', 'aria-label="Journal content" aria-busy="false" data-prerendered="true"')
      .replace('<aside id="sidebar" aria-label="Journal index"></aside>', () =>
        `<aside id="sidebar" aria-label="Journal index">${file === "index.html" ? renderRecentNotes(posts, date, thumbnail, id => coverPhoto(carousels.get(id), carouselCovers.get(id))) : ""}${renderSidebar(months, topicCounts, values.month, values.tag)}</aside>`)
      .replace("<!-- featured-snapshot -->", file === "index.html" ? featured?.markup || "" : "");
    if (!["privacy", "terms"].includes(values.view)) {
      const active = classes.includes("note-page") || values.view === "notes" ? "notes" : ["archive", "series", "topics"].includes(values.view) ? "archive" : values.view === "start" ? "start" : "journal";
      html = html.replace(`id="${active}-link"`, `$& aria-current="page"`);
    }
    if (file === "index.html" && featured) {
      const photo = publicPhoto(featured.first, images.get(featured.first.media_id)?.alt);
      const caption = photoTitle(photos.find(row => row.id === featured.first.id && row.media_id === featured.first.media_id)?.title) || photoTitle(featured.first.title);
      html = html.replace('aria-label="Featured Photo" aria-busy="true" hidden', 'aria-label="Featured Photo"')
        .replace('<img width="1200" height="800" alt="" draggable="false" decoding="async" fetchpriority="high">',
          () => `<img src="featured.webp?v=${escape(featured.version)}" width="${featured.width}" height="${featured.height}" alt="${escape(photo.alt)}" draggable="false" decoding="async" fetchpriority="high">`);
      if (caption) html = html.replace('<span id="photo-caption" aria-busy="true"></span>', () => `<span id="photo-caption">${escape(caption)}</span>`);
    }
    pages.set(file, html.replace(/<a(?= )/g, '<a draggable="false"'));
  }
  const heading = title => `<div class="section-head"><h1>${escape(title)}</h1></div>`;
  page({}, "An independent journal", renderLatest(posts, date, 5), "An independent journal by Ellis Vale.", "home-page");
  page({ view: "notes" }, "Notes", renderNotes(posts, date, notePicture), "Short observations and photographs from The Common Hours.");
  for (const values of archivePages) {
    const selection = [values.year, values.month, values.tag, values.page && "Page " + values.page].filter(Boolean).join(" · ");
    page(values, archiveTitle(new URLSearchParams(values)), renderArchive(posts, new URLSearchParams(values), notePicture), "Browse the journal archive" + (selection ? " · " + selection : " by year, month, or topic") + ".");
  }
  const starters = posts.filter(post => post.start_here);
  page({ view: "start" }, "Start here", heading("Start here") + startIntroduction + (starters.length ? cards(starters) : `<p>${startEmpty}</p>`), "Selected entries to begin reading The Common Hours.");
  page({ view: "series" }, "Series", seriesDirectory(posts), "Explore published series in The Common Hours.");
  for (const [view, body] of [["privacy", notice], ["terms", terms]]) {
    page({ view }, view === "privacy" ? "Privacy" : "Terms", `<article class="legal">${body}</article>`, `Read the ${view === "privacy" ? "privacy policy" : "terms"} for The Common Hours.`, "policy-page");
  }
  page({ view: "topics" }, "All topics", renderTopics(topicCounts), "Browse the journal by topic.");
  const notes = posts.filter(post => post.is_note);
  for (const post of posts) {
    if (!/^[a-z0-9-]{1,120}$/.test(post.slug)) throw new Error("Invalid published entry slug.");
    const membership = seriesMembership(post, posts);
    const navigation = seriesNavigation(posts, post);
    const discussion = commentCards(commentsByPost.get(post.id) || []);
    const commentsSection = `<section class="comments"${discussion ? "" : " hidden"}><h2>Comments</h2><div id="comment-list" aria-live="polite">${discussion}</div></section>`;
    const postRevision = publicationRevision([post], true);
    if (post.is_note) {
      page({ post: post.slug }, post.title, renderNoteDetail(post, date, notePicture) + renderNoteNavigation(notes, post), post.excerpt || post.title, "article-page note-page");
      continue;
    }
    const attachmentNames = new Map(mediaReferences(post.body).filter(reference => reference.kind === "file").map(reference =>
      [reference.id, (reference.title || "Attachment").replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 200)]));
    let body = post.body.startsWith(markdownMarker) ? renderMarkup(post.body) : post.body.split(/\n\s*\n/).map(text => `<p>${escape(text)}</p>`).join("");
    body = body.replace(/<span class="media-slot"[^>]*data-image="([^"]+)" data-alt="([^"]*)"><\/span>/g, (_, id, alt) =>
      `<span class="media-slot">${zoomPicture(id, alt)}</span>`)
      .replace(/<a\b[^>]*\bdata-attachment="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, id, label) => {
        if (!attachments.has(id)) return label + " (attachment unavailable)";
        return `<a class="attachment" href="${attachments.get(id)}" download="${escape(attachmentNames.get(id) || "Attachment")}">${label}</a>`;
      })
      .replace(/href="\?post=([a-z0-9-]+)"/g, (_, slug) => `href="${publicFiles.has("entry-" + slug + ".html") ? pageHref({ post: slug }) : "./?post=" + slug}"`);
    page({ post: post.slug }, post.title, `<a class="back" href="./">← Back to the journal</a><article class="article" data-publication="${postRevision}">${membership}<h1>${escape(post.title)}</h1><p class="meta"><time datetime="${escape(post.published_on)}">${date(post.published_on)}</time> ${tagLinks(post)} · By Ellis Vale</p><div class="prose" id="entry-body">${body}</div></article>${navigation}${commentsSection}`, post.excerpt, "article-page");
  }
  for (const photo of photos) {
    const taken = photoDate(photo);
    page({ view: "photo", photo: photo.id }, photo.title, `<a class="back" href="./#featured-photo">← Featured Photo</a><article class="photo-detail" data-photo-media="${escape(photo.media_id)}"><h1>${escape(photo.title)}</h1>${taken ? `<p class="meta">${date(taken)}</p>` : ""}<div class="photo-detail-image photo-ready">${picture(photo.media_id, escape(photo.alt), true)}</div></article>`, photo.alt || photo.title);
  }
  const urls = [...pageImages].map(([file, images]) => `<url><loc>${escape(new URL(file === "index.html" ? "./" : file.replace(/\.html$/, ""), home).href)}</loc>` +
    [...images].map(src => `<image:image><image:loc>${escape(new URL(src, home).href)}</image:loc></image:image>`).join("") + "</url>");
  pages.set("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' + urls.join("") + "</urlset>\n");
  pages.set("robots.txt", "User-agent: *\nAllow: /\nSitemap: " + home + "sitemap.xml\n");
  const legacyNoteTags = new Set(["Notes", ...posts.flatMap(post => entryTags(post.tag)).filter(tag => tag.toLowerCase() === "notes")]);
  for (const tag of legacyNoteTags) {
    const oldPages = Math.ceil(posts.filter(post => entryTags(post.tag).includes(tag)).length / archivePageSize);
    for (let number = 1; number <= Math.max(1, oldPages); number++) {
      pages.set(pageHref({ view: "archive", tag, page: number }, { filename: true }), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Notes - The Common Hours</title><link rel="canonical" href="https://commonhours.qd.je/notes"><meta http-equiv="refresh" content="0; url=notes"><p><a href="notes">Read the notes</a></p></html>');
    }
  }
  for (const name of ["collections.html", "photo-essays.html"]) {
    pages.set(name, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Archive - The Common Hours</title><meta http-equiv="refresh" content="0; url=archive"><p><a href="archive">Browse the archive</a></p></html>');
  }
  pages.set("photos.html", '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Featured Photo</title><meta http-equiv="refresh" content="0; url=./#featured-photo"><p><a href="./#featured-photo">Featured Photo</a></p></html>');
  return pages;
}
