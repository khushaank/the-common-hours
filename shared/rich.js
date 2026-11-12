import "./markdown-it.min.js";
import { escape, imageSource, markdownMarker, mediaId } from "./common.js";

const md = globalThis.markdownit({ html: false, linkify: false, typographer: false, breaks: true });
md.validateLink = url => /^https:\/\//i.test(url) || /^#[a-z0-9_-]+$/i.test(url) ||
  (url.startsWith("media:") && mediaId.test(url.slice(6)));

md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const source = token.attrGet("src") || "";
  const alt = self.renderInlineAsText(token.children, options, env);
  const id = source.slice(6);
  if (!source.startsWith("media:") || !mediaId.test(id)) return escape(alt || "Image unavailable");
  return `<span class="media-slot" data-image="${id}" data-alt="${escape(alt)}">Loading image…</span>`;
};

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token.attrGet("href")?.startsWith("media:")) token.attrSet("href", "#");
  token.attrSet("rel", "noreferrer");
  return self.renderToken(tokens, index, options);
};

const videoId = /^[a-zA-Z0-9_-]{11}$/;
export function youtubeId(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
  const [, route, tail] = url.pathname.split("/");
  let id;
  if (url.hostname === "youtu.be") id = route;
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname)) {
    id = route === "watch" ? url.searchParams.get("v") : ["shorts", "embed", "live"].includes(route) ? tail : "";
  }
  return videoId.test(id || "") ? id : "";
}

md.block.ruler.before("paragraph", "youtube", (state, line, endLine, silent) => {
  if (state.sCount[line] - state.blkIndent >= 4) return false;
  const start = state.bMarks[line] + state.tShift[line];
  const match = /^::youtube ([a-zA-Z0-9_-]{11})$/.exec(state.src.slice(start, state.eMarks[line]).trim());
  if (!match) return false;
  if (silent) return true;
  const token = state.push("youtube", "", 0);
  token.content = match[1];
  state.line = line + 1;
  return true;
}, { alt: ["paragraph", "blockquote", "list"] });

md.renderer.rules.youtube = (tokens, index) => {
  const id = tokens[index].content;
  return `<div class="video"><div class="video-placeholder">
    <button type="button" class="quiet-button" data-video="${id}">Load YouTube video</button>
    <small>Loads content from YouTube</small></div>
    <a class="video-link" href="https://www.youtube.com/watch?v=${id}">Watch on YouTube ↗</a></div>`;
};

export function renderText(target, body, loadImage, { markdown = body.startsWith(markdownMarker), loadVideos = true } = {}) {
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
  for (const slot of target.querySelectorAll("[data-image]")) {
    const id = slot.dataset.image;
    if (!images.has(id)) images.set(id, Promise.resolve().then(() => loadImage(id)));
    images.get(id).then(image => {
      const src = imageSource(image);
      if (!src) throw new Error();
      const picture = new Image(image.width, image.height);
      picture.alt = slot.dataset.alt;
      picture.draggable = false;
      picture.decoding = "async";
      picture.addEventListener("error", () => { slot.textContent = picture.alt || "Image unavailable"; });
      picture.src = src;
      slot.replaceChildren(picture);
    }).catch(() => { slot.textContent = slot.dataset.alt || "Image unavailable"; });
  }

  for (const button of target.querySelectorAll("[data-video]")) {
    if (!loadVideos) {
      button.replaceWith(document.createTextNode("YouTube video"));
      continue;
    }
    button.addEventListener("click", () => {
      const frame = document.createElement("iframe");
      frame.title = "YouTube video";
      frame.referrerPolicy = "strict-origin";
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.src = "https://www.youtube-nocookie.com/embed/" + button.dataset.video + "?autoplay=1";
      button.parentElement.replaceWith(frame);
    }, { once: true });
  }
}