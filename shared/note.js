import { pageHref } from "./page-url.js";
import { escape, mediaId } from "./text.js";
import { renderNoteText } from "./rich.js";

const separator = "\n\n<!-- common-hours-note-extras -->\n";
export const notePhotoLimit = 12;
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

export const noteImageSlot = ({ id, alt }) =>
  '<span class="media-slot" aria-busy="true" data-image="' + id + '" data-alt="' + escape(alt) + '"></span>';

export const photoArrows = `<button type="button" class="gallery-arrow" data-photo-step="-1" aria-label="Previous photo" aria-keyshortcuts="ArrowLeft" title="Previous photo (←)"><span aria-hidden="true">←</span></button><button type="button" class="gallery-arrow" data-photo-step="1" aria-label="Next photo" aria-keyshortcuts="ArrowRight" title="Next photo (→)"><span aria-hidden="true">→</span></button>`;

export function noteExtras(body, picture = noteImageSlot, carousel = false) {
  const { photos, references } = readNote(body);
  const slides = carousel && photos.length > 1;
  const gallery = photos.length ? `<div class="note-gallery" data-count="${photos.length}"${slides ? ' data-carousel role="group" aria-label="Note photos. Use the left and right arrow keys to change photo." tabindex="0"' : ""}>${photos.map(picture).join("")}</div>` : "";
  const controls = slides ? `<div class="note-carousel-controls"><span aria-live="polite">1 of ${photos.length}</span><span class="photo-keys" aria-hidden="true"><kbd>←</kbd> <kbd>→</kbd></span></div>` : "";
  const links = references.length ? '<ul class="note-references" aria-label="Referenced articles">' + references.map(({ slug, title }) =>
    '<li><a href="' + escape(pageHref({ post: slug })) + '">' + escape(title) + "</a></li>").join("") + "</ul>" : "";
  return (slides ? `<figure class="note-carousel"><div class="note-stage">${gallery}${photoArrows}</div>${controls}</figure>` : gallery) + links;
}

export function noteText(text) {
  return text ? '<p class="note-text">' + renderNoteText(text) + '</p>' : "";
}

export function noteBody(body, picture, carousel = false) {
  return noteText(readNote(body).text) + noteExtras(body, picture, carousel);
}
