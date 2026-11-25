export function setupImageViewer() {
  let dialog;
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
      dialog.innerHTML = '<button type="button" autofocus>Close</button><img alt="">';
      dialog.querySelector("button").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", click => { if (click.target === dialog) dialog.close(); });
      dialog.addEventListener("close", () => {
        dialog.querySelector("img").removeAttribute("src");
      });
      document.body.append(dialog);
    }
    const enlarged = dialog.querySelector("img");
    enlarged.alt = photo.alt;
    enlarged.src = photo.currentSrc || photo.src;
    dialog.showModal();
    dialog.addEventListener("close", () => { if (trigger.isConnected) trigger.focus(); }, { once: true });
  });
}

export function setupNoteCarousels() {
  const currentPhoto = gallery => Math.round(gallery.scrollLeft / gallery.clientWidth);
  function step(gallery, direction) {
    const count = gallery.children.length;
    const index = (currentPhoto(gallery) + direction + count) % count;
    gallery.scrollTo({ left: index * gallery.clientWidth });
  }
  document.addEventListener("click", event => {
    const button = event.target.closest(".note-carousel-controls button");
    if (button) step(button.parentElement.previousElementSibling, Number(button.dataset.photoStep));
  });
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !event.target.matches(".note-gallery[data-carousel]") || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    step(event.target, event.key === "ArrowRight" ? 1 : -1);
  });
  document.addEventListener("scroll", event => {
    const gallery = event.target;
    if (!gallery.matches?.(".note-gallery[data-carousel]")) return;
    const status = gallery.nextElementSibling.querySelector("[aria-live]");
    const position = (currentPhoto(gallery) + 1) + " of " + gallery.children.length;
    if (status.textContent !== position) status.textContent = position;
  }, true);
}

const queuedNoteImages = new WeakSet();

export async function loadNoteImages(target, loadImage) {
  const slots = [...target.querySelectorAll(":is(.note-gallery, .note-thumb) [data-image][aria-busy]")].filter(slot => !queuedNoteImages.has(slot));
  if (!slots.length) return;
  const { loadImageSlot } = await import("./rich.js");
  const reveal = slot => { if (slot.isConnected) void loadImageSlot(slot, loadImage, Boolean(slot.closest(".note-gallery"))); };
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
