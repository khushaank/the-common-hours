export const escape = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export const mediaId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const markdownMarker = "<!-- common-hours-markdown -->\n";

export function imageSource(image) {
  if (!image || typeof image.encoded !== "string" || image.encoded.length > 1333336 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.encoded)) return "";
  return "data:image/jpeg;base64," + image.encoded;
}

const youtubePattern = /^[a-zA-Z0-9_-]{11}$/;

export function videoFrom(value) {
  if (!/^https:\/\/\S+$/i.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const [, route, tail] = url.pathname.split("/");
  const host = url.hostname;
  let id;
  if (host === "youtu.be") id = route;
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(host)) {
    id = route === "watch" ? url.searchParams.get("v") : ["shorts", "embed", "live"].includes(route) ? tail : "";
  }
  if (youtubePattern.test(id || "")) {
    return { src: "https://www.youtube-nocookie.com/embed/" + id, href: url.href, label: "YouTube",
      poster: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" };
  }
  if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
    const id = host === "player.vimeo.com" && route === "video" ? tail : route;
    const hash = url.searchParams.get("h") || (host === "player.vimeo.com" ? "" : tail);
    if (/^\d+$/.test(id || "") && (!hash || /^[a-zA-Z0-9]+$/.test(hash))) {
      return { src: "https://player.vimeo.com/video/" + id + (hash ? "?h=" + hash : ""), href: url.href, label: "Vimeo" };
    }
  }
  if (/\.(?:mp4|webm|ogv)$/i.test(url.pathname)) return { src: url.href, href: url.href };
  return null;
}
