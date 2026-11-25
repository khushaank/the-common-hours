import { pageHref } from "./page-url.js";
import { escape, mediaId } from "./text.js";
import { renderNoteText } from "./rich.js";
import { carouselLine, carouselMarkup, carouselSlot, photoGallery, photoSlot } from "./carousel.js";

const separator = "\n\n<!-- common-hours-note-extras -->\n";
export const noteReferenceLimit = 8;
export { photoSlot as noteImageSlot };

export function readNote(body) {
  if (typeof body !== "string") body = "";
  const boundary = body.lastIndexOf(separator);
  const photos = [];
  const references = [];
  const carousels = [];
  if (boundary < 0) return { text: body, photos, references, carousels };
  for (const line of body.slice(boundary + separator.length).split("\n")) {
    const photo = /^!\[("(?:[^"\\]|\\.)*")\]\(media:([a-f0-9-]+)\)$/.exec(line);
    const reference = /^\[("(?:[^"\\]|\\.)*")\]\(\?post=([a-z0-9-]{1,120})\)$/.exec(line);
    const carousel = carouselLine.exec(line);
    try {
      if (photo && mediaId.test(photo[2])) {
        photos.push({ id: photo[2], alt: JSON.parse(photo[1]) });
      } else if (carousel) {
        carousels.push(carousel[1]);
      } else if (reference && references.length < noteReferenceLimit) {
        references.push({ slug: reference[2], title: JSON.parse(reference[1]) });
      }
    } catch { /* Ignore malformed attachment metadata. */ }
  }
  return { text: photos.length || references.length || carousels.length ? body.slice(0, boundary) : body, photos, references, carousels };
}

export function writeNote(text, { photos, references, carousels = [] }) {
  const extras = [
    ...photos.map(({ id, alt }) => "![" + JSON.stringify(alt) + "](media:" + id + ")"),
    ...carousels.map(carouselMarkup),
    ...references.map(({ slug, title }) => "[" + JSON.stringify(title) + "](?post=" + slug + ")"),
  ];
  return extras.length ? text + separator + extras.join("\n") : text;
}

export function noteExtras(body, picture = photoSlot, carousel = false) {
  const { photos, references, carousels } = readNote(body);
  const links = references.length ? '<ul class="note-references" aria-label="Referenced articles">' + references.map(({ slug, title }) =>
    '<li><a href="' + escape(pageHref({ post: slug })) + '">' + escape(title) + "</a></li>").join("") + "</ul>" : "";
  return photoGallery(photos, picture, carousel) + carousels.map(id => carouselSlot(id)).join("") + links;
}

export function noteText(text) {
  return text ? '<p class="note-text">' + renderNoteText(text) + '</p>' : "";
}

export function noteBody(body, picture, carousel = false) {
  return noteText(readNote(body).text) + noteExtras(body, picture, carousel);
}
