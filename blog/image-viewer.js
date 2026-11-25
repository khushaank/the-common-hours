import { photoArrows } from "./note.js";

const wrapIndex = (index, count) => (index + count) % count;
const carousel = ".note-gallery[data-carousel]";
const direction = event => event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;

function listenForSwipes(root, onSwipe) {
  let start;
  root.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) { start = null; return; }
    const target = event.target.closest(".note-stage, .image-viewer");
    if (target) start = { target, x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  root.addEventListener("touchcancel", () => { start = null; }, { passive: true });
  root.addEventListener("touchend", event => {
    if (!start) return;
    const { target, x, y } = start;
    start = null;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - x;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(touch.clientY - y) * 1.5) return;
    if (onSwipe(target, dx < 0 ? 1 : -1)) event.preventDefault();
  }, { passive: false });
}

function galleryIndex(gallery) {
  return Number(gallery.dataset.active || 0);
}

function showGalleryPhoto(gallery, index) {
  const slides = [...gallery.children];
  gallery.dataset.active = index;
  const previous = wrapIndex(index - 1, slides.length);
  const next = wrapIndex(index + 1, slides.length);
  for (const [i, slide] of slides.entries()) {
    const position = i === index ? "current" : i === next ? "next" : i === previous ? "previous" : "";
    slide.dataset.position = position;
    slide.setAttribute("aria-hidden", String(i !== index));
    const trigger = slide.querySelector(".zoom-image");
    if (trigger) trigger.tabIndex = i === index ? 0 : -1;
  }
  const status = gallery.closest(".note-carousel").querySelector("[aria-live]");
  status.textContent = (index + 1) + " of " + slides.length;
  for (const slide of slides) {
    if (slide.dataset.position) slide.dispatchEvent(new Event("show-note-photo"));
  }
}

function stepGallery(gallery, amount) {
  showGalleryPhoto(gallery, wrapIndex(galleryIndex(gallery) + amount, gallery.children.length));
}

export function setupImageViewer() {
  let dialog;
  let gallery;
  let index;
  let origin;
  const update = () => {
    const center = gallery ? gallery.children[index]?.querySelector("img") : origin?.querySelector("img");
    if (!center?.src) return;
    const slides = gallery?.children;
    for (const [position, photo] of [
      ["previous", slides?.length > 2 ? slides[wrapIndex(index - 1, slides.length)]?.querySelector("img") : null],
      ["current", center],
      ["next", slides ? slides[wrapIndex(index + 1, slides.length)]?.querySelector("img") : null],
    ]) {
      const image = dialog.querySelector('[data-view-photo="' + position + '"]');
      image.hidden = !photo?.src;
      image.alt = position === "current" ? center.alt : "";
      if (photo?.src) {
        const src = photo.currentSrc || photo.src;
        if (image.getAttribute("src") === src) continue;
        image.src = src;
        if (dialog.open && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          image.animate([{ opacity: 0 }, { opacity: getComputedStyle(image).opacity }], { duration: 220 });
        }
      }
      else image.removeAttribute("src");
    }
    dialog.querySelector("[aria-live]").textContent = gallery ? (index + 1) + " of " + slides.length : "";
    for (const button of dialog.querySelectorAll("[data-photo-step]")) button.hidden = !gallery;
  };
  const step = amount => {
    if (!gallery) return false;
    index = wrapIndex(index + amount, gallery.children.length);
    showGalleryPhoto(gallery, index);
    update();
    return true;
  };
  document.addEventListener("click", event => {
    const trigger = event.target.closest(".zoom-image");
    if (!trigger || event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
        event.metaKey || event.altKey || event.shiftKey || document.querySelector("dialog[open]")) return;
    const photo = trigger.querySelector("img");
    if (!photo?.src) return;
    event.preventDefault();
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "image-viewer";
      dialog.setAttribute("aria-label", "Enlarged photo");
      dialog.innerHTML = '<button class="viewer-close" type="button" aria-label="Close photo viewer" title="Close (Esc)" autofocus>×</button><div class="viewer-stage"><img data-view-photo="previous" alt="" hidden><img data-view-photo="next" alt="" hidden><img data-view-photo="current" alt="">' + photoArrows + '</div><p class="viewer-count" aria-live="polite"></p>';
      dialog.querySelector(".viewer-close").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", click => {
        if (click.target === dialog) dialog.close();
        const button = click.target.closest("[data-photo-step]");
        if (button) step(Number(button.dataset.photoStep));
      });
      dialog.addEventListener("keydown", event => {
        const amount = direction(event);
        if (amount && step(amount)) event.preventDefault();
      });
      listenForSwipes(dialog, (_, amount) => step(amount));
      dialog.addEventListener("close", () => {
        for (const image of dialog.querySelectorAll("img")) image.removeAttribute("src");
        gallery?.removeEventListener("note-photo-loaded", update);
        const focus = gallery?.children[index]?.querySelector(".zoom-image") || origin;
        if (focus?.isConnected) focus.focus({ preventScroll: true });
        gallery = null;
      });
      document.body.append(dialog);
    }
    origin = trigger;
    gallery = trigger.closest(carousel);
    index = gallery ? [...gallery.children].indexOf(trigger.closest(".media-slot")) : 0;
    if (gallery) {
      gallery.addEventListener("note-photo-loaded", update);
      showGalleryPhoto(gallery, index);
    }
    update();
    dialog.showModal();
  });
}

export function setupNoteCarousels() {
  for (const gallery of document.querySelectorAll(carousel)) showGalleryPhoto(gallery, 0);
  document.addEventListener("click", event => {
    const button = event.target.closest(".note-stage > [data-photo-step]");
    if (button) stepGallery(button.parentElement.querySelector(carousel), Number(button.dataset.photoStep));
  });
  document.addEventListener("keydown", event => {
    const gallery = event.target.closest(".note-stage")?.querySelector(carousel);
    const amount = direction(event);
    if (!gallery || !amount || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest(".zoom-image")) gallery.focus({ preventScroll: true });
    event.preventDefault();
    stepGallery(gallery, amount);
  });
  listenForSwipes(document, (stage, amount) => {
    const gallery = stage.querySelector(carousel);
    if (!gallery) return false;
    stepGallery(gallery, amount);
    return true;
  });
}

const queuedNoteImages = new WeakSet();

export async function loadNoteImages(target, loadImage) {
  for (const gallery of target.querySelectorAll(carousel)) {
    if (!gallery.hasAttribute("data-active")) showGalleryPhoto(gallery, 0);
  }
  const slots = [...target.querySelectorAll(":is(.note-gallery, .note-thumb) [data-image][aria-busy]")].filter(slot => !queuedNoteImages.has(slot));
  if (!slots.length) return;
  const { loadImageSlot } = await import("./rich.js");
  const reveal = slot => {
    if (!slot.isConnected) return;
    const gallery = slot.closest(carousel);
    const render = () => void loadImageSlot(slot, loadImage, Boolean(slot.closest(".note-gallery"))).then(() => {
      if (!gallery) return;
      const trigger = slot.querySelector(".zoom-image");
      if (trigger) trigger.tabIndex = slot.dataset.position === "current" ? 0 : -1;
      gallery.dispatchEvent(new Event("note-photo-loaded"));
    });
    if (gallery && !slot.dataset.position) slot.addEventListener("show-note-photo", render, { once: true });
    else render();
  };
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting && entry.target.isConnected) continue;
      observer.unobserve(entry.target);
      reveal(entry.target);
    }
  }, { rootMargin: "250px" }) : null;
  for (const slot of slots) {
    queuedNoteImages.add(slot);
    if (observer) observer.observe(slot);
    else reveal(slot);
  }
}
