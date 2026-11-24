import { pageHref } from "./page-url.js";
import { escape, mediaId } from "./text.js";

const separator = "\n\n<!-- common-hours-note-extras -->\n";
export const notePhotoLimit = 4;
export const noteReferenceLimit = 8;

export function readNote(body) {
  if (typeof body !== "string") body = "";
  const boundary = body.lastIndexOf(separator);
  const photos = [];
  const references = [];
  if (boundary < 0) return { text: body, photos, references };
  for (const line of body.slice(boundary + separator.length).split("\n")) {
    const photo = /^!\[("(?:[^"\\]|\\.)*")\]\(media:([a-f0-9-]+)\)$/.exec(line);
    const reference = /^\[("(?:[^"\\]|\\.)*")\]\(\?post=([a-z0-9-]{1,120})\)$/.exec(line);
    try {
      if (photo && mediaId.test(photo[2]) && photos.length < notePhotoLimit) {
        photos.push({ id: photo[2], alt: JSON.parse(photo[1]) });
      } else if (reference && references.length < noteReferenceLimit) {
        references.push({ slug: reference[2], title: JSON.parse(reference[1]) });
      }
    } catch { /* Ignore malformed attachment metadata. */ }
  }
  return { text: photos.length || references.length ? body.slice(0, boundary) : body, photos, references };
}

export function writeNote(text, { photos, references }) {
  const extras = [
    ...photos.map(({ id, alt }) => "![" + JSON.stringify(alt) + "](media:" + id + ")"),
    ...references.map(({ slug, title }) => "[" + JSON.stringify(title) + "](?post=" + slug + ")"),
  ];
  return extras.length ? text + separator + extras.join("\n") : text;
}

export function noteExtras(body, picture = ({ id, alt }) =>
  '<span class="media-slot" aria-busy="true" data-image="' + id + '" data-alt="' + escape(alt) + '"></span>') {
  const { photos, references } = readNote(body);
  const gallery = photos.length ? '<div class="note-gallery" data-count="' + photos.length + '">' + photos.map(picture).join("") + "</div>" : "";
  const links = references.length ? '<ul class="note-references" aria-label="Referenced articles">' + references.map(({ slug, title }) =>
    '<li><a href="' + escape(pageHref({ post: slug })) + '">' + escape(title) + "</a></li>").join("") + "</ul>" : "";
  return gallery + links;
}
