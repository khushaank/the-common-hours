import "./markdown-it.min.js";
import { escape, imageSource, markdownMarker, mediaId, videoFrom } from "./common.js";

const md = globalThis.markdownit({ html: false, linkify: false, breaks: true });
const assetId = (url, prefix) => url.startsWith(prefix) && mediaId.test(url.slice(prefix.length)) ? url.slice(prefix.length) : "";
md.validateLink = url => /^https:\/\//i.test(url) || /^#[a-z0-9_-]+$/i.test(url) ||
  Boolean(assetId(url, "media:") || assetId(url, "attachment:"));

md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const alt = self.renderInlineAsText(token.children, options, env);
  const id = assetId(token.attrGet("src") || "", "media:");
  return id ? '<span class="media-slot" data-image="' + id + '" data-alt="' + escape(alt) + '">Loading image…</span>' :
    escape(alt || "Image unavailable");
};

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet("href") || "";
  const id = assetId(href, "attachment:");
  if (id) {
    token.attrSet("href", "#");
    token.attrSet("data-attachment", id);
    token.attrSet("class", "attachment");
  } else if (href.startsWith("media:")) token.attrSet("href", "#");
  token.attrSet("rel", "noreferrer");
  return self.renderToken(tokens, index, options);
};

md.block.ruler.before("paragraph", "video", (state, line, endLine, silent) => {
  if (state.sCount[line] - state.blkIndent >= 4) return false;
  const start = state.bMarks[line] + state.tShift[line];
  const text = state.src.slice(start, state.eMarks[line]).trim();
  const legacy = /^::youtube ([a-zA-Z0-9_-]{11})$/.exec(text);
  const video = videoFrom(legacy ? "https://youtu.be/" + legacy[1] : text.replace(/^::video /, ""));
  if (!video) return false;
  if (silent) return true;
  state.push("video", "", 0).meta = video;
  state.line = line + 1;
  return true;
}, { alt: ["paragraph", "blockquote", "list"] });

md.renderer.rules.video = (tokens, index) => {
  const { src, href, label } = tokens[index].meta;
  const player = label
    ? '<iframe title="' + label + ' video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen src="' + escape(src) + '"></iframe>'
    : '<video controls playsinline preload="none" src="' + escape(src) + '"></video>';
  return '<div class="video">' + player + '<a class="video-link" rel="noreferrer" href="' + escape(href) +
    '">Watch ' + (label ? "on " + label : "video") + ' ↗</a></div>';
};

export function renderText(target, body, loadImage, { markdown = body.startsWith(markdownMarker), loadAttachment } = {}) {
  if (!markdown) {
    target.replaceChildren(...body.split(/\n\s*\n/).filter(Boolean).map(text => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    }));
    return;
  }

  target.innerHTML = md.render(body.startsWith(markdownMarker) ? body.slice(markdownMarker.length) : body);
  const images = new Map();
  function reveal(slot) {
    const id = slot.dataset.image;
    if (!images.has(id)) images.set(id, Promise.resolve().then(() => loadImage(id)));
    images.get(id).then(image => {
      const src = imageSource(image);
      if (!src) throw new Error();
      const picture = new Image(image.width, image.height);
      picture.alt = slot.dataset.alt;
      picture.decoding = "async";
      picture.addEventListener("error", () => { slot.textContent = picture.alt || "Image unavailable"; });
      picture.src = src;
      slot.replaceChildren(picture);
    }).catch(() => { slot.textContent = slot.dataset.alt || "Image unavailable"; });
  }
  const slots = target.querySelectorAll("[data-image]");
  if (slots.length && typeof IntersectionObserver === "function") {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.target.isConnected) continue;
        observer.unobserve(entry.target);
        if (entry.target.isConnected) reveal(entry.target);
      }
    }, { rootMargin: "350px" });
    for (const slot of slots) observer.observe(slot);
  } else for (const slot of slots) reveal(slot);

  for (const link of target.querySelectorAll("[data-attachment]")) {
    const button = document.createElement("button");
    const label = link.textContent || "Attachment";
    const id = link.dataset.attachment;
    button.type = "button";
    button.className = "attachment";
    button.textContent = "↓ " + label;
    link.replaceWith(button);
    const status = document.createElement("small");
    status.className = "attachment-status";
    status.setAttribute("role", "status");
    button.after(status);
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Preparing download…";
      try {
        const data = await loadAttachment(id);
        const url = URL.createObjectURL(data);
        const download = document.createElement("a");
        download.href = url;
        download.download = label;
        download.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        status.textContent = "";
      } catch {
        status.textContent = "Download unavailable. Try again.";
      } finally {
        button.disabled = false;
      }
    });
    if (!loadAttachment) button.disabled = true;
  }
}
