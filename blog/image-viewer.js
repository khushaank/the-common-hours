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

const queuedNoteImages = new WeakSet();

export async function loadNoteImages(target, loadImage) {
  const slots = [...target.querySelectorAll(".note-gallery [data-image][aria-busy]")].filter(slot => !queuedNoteImages.has(slot));
  if (!slots.length) return;
  const { loadImageSlot } = await import("./rich.js");
  const reveal = slot => { if (slot.isConnected) void loadImageSlot(slot, loadImage, true); };
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
