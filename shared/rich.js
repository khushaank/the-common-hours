import "./markdown-it.min.js";
import footnotes from "./markdown-it-footnote.js";
import { escape, imageSource, markdownMarker, mediaId, videoFrom } from "./common.js";

const md = globalThis.markdownit({ html: false, linkify: false, breaks: true }).use(footnotes);
const assetId = (url, prefix) => url.startsWith(prefix) && mediaId.test(url.slice(prefix.length)) ? url.slice(prefix.length) : "";
md.validateLink = url => /^https:\/\//i.test(url) || /^#[a-z0-9_-]+$/i.test(url) || /^\?post=[a-z0-9-]{1,120}$/.test(url) ||
  Boolean(assetId(url, "media:") || assetId(url, "attachment:"));

md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const alt = self.renderInlineAsText(token.children, options, env);
  const id = assetId(token.attrGet("src") || "", "media:");
  return id ? '<span class="media-slot" aria-busy="true" data-image="' + id + '" data-alt="' + escape(alt) + '">Loading image…</span>' :
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

md.renderer.rules.bullet_list_open = (tokens, index, options, env, self) => {
  if (tokens[index].markup === "+") tokens[index].attrSet("class", "square-list");
  return self.renderToken(tokens, index, options);
};

md.renderer.rules.ordered_list_open = (tokens, index, options, env, self) => {
  if (tokens[index].markup === ")") tokens[index].attrSet("type", "a");
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

md.core.ruler.after("inline", "linked_video", state => {
  const tokens = state.tokens;
  for (let index = tokens.length - 3; index >= 0; index--) {
    if (tokens[index].type !== "paragraph_open" || tokens[index + 2].type !== "paragraph_close") continue;
    const links = tokens[index + 1].children;
    if (links?.[0]?.type !== "link_open" || links.at(-1)?.type !== "link_close") continue;
    const linkText = links.slice(1, -1);
    if (linkText.some(token => token.type === "link_open" || token.type === "link_close")) continue;
    const video = videoFrom(links[0].attrGet("href") || "");
    if (!video) continue;
    const token = new state.Token("video", "", 0);
    token.meta = { ...video, title: md.renderer.renderInlineAsText(linkText, md.options, state.env) };
    tokens.splice(index, 3, token);
  }
});

md.renderer.rules.video = (tokens, index) => {
  const { src, href, label, title } = tokens[index].meta;
  const player = label
    ? '<iframe title="' + escape(title || label + " video") + '" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen src="' + escape(src) + '"></iframe>'
    : '<video controls playsinline preload="none" src="' + escape(src) + '"></video>';
  return '<div class="video">' + player + (title ? '<p class="video-caption">' + escape(title) + '</p>' : "") +
    '<a class="video-link" rel="noreferrer" href="' + escape(href) +
    '">Watch ' + (label ? "on " + label : "video") + ' ↗</a></div>';
};

export function mediaReferences(body) {
  if (!body.startsWith(markdownMarker)) return [];
  const references = [];
  for (const block of md.parse(body.slice(markdownMarker.length), {})) {
    const tokens = block.children || [];
    for (const [index, token] of tokens.entries()) {
      if (token.type === "image") {
        const id = assetId(token.attrGet("src") || "", "media:");
        if (id) references.push({ id, kind: "image", alt: md.renderer.renderInlineAsText(token.children, md.options, {}) });
      } else if (token.type === "link_open") {
        const id = assetId(token.attrGet("href") || "", "attachment:");
        const end = tokens.findIndex((child, childIndex) => childIndex > index && child.type === "link_close");
        if (id && end !== -1) references.push({
          id, kind: "file", title: md.renderer.renderInlineAsText(tokens.slice(index + 1, end), md.options, {}),
        });
      }
    }
  }
  return references;
}

export function entryLinks(body) {
  const links = new Set();
  for (const block of md.parse(body, {})) {
    for (const token of block.children || []) {
      const href = token.type === "link_open" ? token.attrGet("href") : "";
      if (href?.startsWith("https:")) links.add(href);
    }
    if (block.type === "video") links.add(block.meta.href);
  }
  return [...links];
}

export function renderText(target, body, loadImage, { markdown = body.startsWith(markdownMarker), loadAttachment, preparePrint = false, preview = false } = {}) {
  if (!markdown) {
    target.replaceChildren(...body.split(/\n\s*\n/).filter(Boolean).map(text => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    }));
    return;
  }

  target.innerHTML = md.render(body.startsWith(markdownMarker) ? body.slice(markdownMarker.length) : body);
  if (preview) {
    for (const link of target.querySelectorAll("a[href^='?post='], a[href^='https://']")) {
      if (link.getAttribute("href").startsWith("?post=")) link.setAttribute("href", "../" + link.getAttribute("href"));
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }
  const images = new Map();
  const requested = new WeakSet();
  function reveal(slot) {
    if (requested.has(slot)) return;
    requested.add(slot);
    const id = slot.dataset.image;
    if (!images.has(id)) images.set(id, Promise.resolve().then(() => loadImage(id)));
    images.get(id).then(image => {
      const src = imageSource(image);
      if (!src) throw new Error();
      const picture = new Image(image.width, image.height);
      picture.alt = image.alt || slot.dataset.alt;
      if (picture.alt) picture.title = picture.alt;
      picture.decoding = "async";
      picture.addEventListener("error", () => { slot.textContent = picture.alt || "Image unavailable"; });
      picture.src = src;
      slot.replaceChildren(picture);
    }).catch(() => { slot.textContent = slot.dataset.alt || "Image unavailable"; })
      .finally(() => slot.removeAttribute("aria-busy"));
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
    if (preparePrint) {
      setTimeout(() => {
        for (const slot of slots) {
          if (slot.isConnected && !requested.has(slot)) {
            observer.unobserve(slot);
            reveal(slot);
          }
        }
      }, 1500);
    }
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
