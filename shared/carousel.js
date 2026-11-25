import { escape } from "./text.js";

export const carouselMarkup = id => "![carousel](carousel:" + id + ")";
export const carouselLine = /^!\[carousel\]\(carousel:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\)$/;
export function carouselSlot(id, editable = false, photos = [], picture) {
  const identity = photos.map(photo => photo.id).join(",");
  return '<div class="carousel-embed" data-carousel-id="' + id + '" data-photos="' + identity + '"' +
    (editable ? ' contenteditable="false">Photo carousel' : '>' + photoGallery(photos, picture)) + '</div>';
}

export const photoSlot = ({ id, alt }) =>
  '<span class="media-slot" aria-busy="true" data-image="' + id + '" data-alt="' + escape(alt) + '"></span>';

export const photoArrows = `<button type="button" class="gallery-arrow" data-photo-step="-1" aria-label="Previous photo" aria-keyshortcuts="ArrowLeft" title="Previous photo (←)"><span aria-hidden="true">←</span></button><button type="button" class="gallery-arrow" data-photo-step="1" aria-label="Next photo" aria-keyshortcuts="ArrowRight" title="Next photo (→)"><span aria-hidden="true">→</span></button>`;

export function photoGallery(photos, picture = photoSlot, carousel = true) {
  if (!photos.length) return "";
  const slides = carousel && photos.length > 1;
  const gallery = `<div class="note-gallery" data-count="${photos.length}"${slides ? ' data-carousel role="group" aria-label="Note photos. Use the left and right arrow keys to change photo." tabindex="0"' : ""}>${photos.map(picture).join("")}</div>`;
  if (!slides) return gallery;
  const controls = `<div class="note-carousel-controls"><span aria-live="polite">1 of ${photos.length}</span><span class="photo-keys" aria-hidden="true"><kbd>←</kbd> <kbd>→</kbd></span></div>`;
  return `<figure class="note-carousel"><div class="note-stage">${gallery}${photoArrows}</div>${controls}</figure>`;
}
