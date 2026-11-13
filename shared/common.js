import { publishableKey, getProjectOrigin } from "./config.js";

export class RequestError extends Error {
  constructor(status, code) {
    super("The request could not be completed.");
    this.status = status;
    this.code = code;
  }
}

export async function request(path, { method = "GET", body, token, prefer, timeout = 12000, download = false, keepalive = false } = {}) {
  const headers = { apikey: publishableKey };
  if (token) headers.Authorization = "Bearer " + token;
  if (prefer) headers.Prefer = prefer;
  const binary = body instanceof Blob;
  if (body !== undefined) headers["Content-Type"] = binary ? "application/octet-stream" : "application/json";
  let response;
  try {
    response = await fetch(getProjectOrigin() + path, {
      method, headers, cache: "no-store", redirect: "error", keepalive,
      signal: AbortSignal.timeout(timeout),
      body: binary || body === undefined ? body : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error("The request timed out. Try again.");
    throw new Error("Could not connect. Check your connection and try again.");
  }
  if (download && response.ok) return response.blob();
  const data = response.headers.get("content-type")?.includes("json") ? await response.json().catch(() => null) : null;
  if (!response.ok) throw new RequestError(response.status, data?.code || data?.error_code || data?.error);
  if (response.status === 204 || method === "DELETE" && !prefer) return null;
  if (method === "GET" && data === null) throw new Error("The service returned an unexpected response. Try again.");
  return data;
}

export const table = path => "/rest/v1/qmargin_b74_" + path;
export const missingFeature = error => ["PGRST205", "42P01"].includes(error?.code);
export const missingColumn = error => ["PGRST204", "42703"].includes(error?.code);

export async function readMediaImage(api, id, options) {
  let image;
  try { [image] = await api("media?select=encoded,width,height,alt&id=eq." + id, options); }
  catch (error) {
    if (!missingColumn(error)) throw error;
    [image] = await api("media?select=encoded,width,height&id=eq." + id, options);
  }
  return image;
}

export async function allRows(get, path) {
  const rows = [];
  while (true) {
    const batch = await get(path + "&limit=100&offset=" + rows.length);
    if (!Array.isArray(batch)) throw new Error("The service returned an unexpected response.");
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
}

export const escape = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export const journalToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
export const monthNow = () => journalToday().slice(0, 7);
export const attachmentLimit = 25 * 1024 * 1024;
const attachmentPath = id => "/storage/v1/object/qmargin-b74-attachments/" + id;
export async function uploadAttachment(id, file, token) {
  const path = attachmentPath(id);
  try {
    await request(path, { method: "POST", body: file, token, timeout: 120000 });
  } catch (error) {
    if (error.status !== 409 && !["Duplicate", "ResourceAlreadyExists"].includes(error.code)) throw error;
    await request(path, { method: "HEAD", token });
  }
}
export const fetchAttachment = (id, token = publishableKey) =>
  request(attachmentPath(id), { token, timeout: 120000, download: true });

export async function listAttachments(token) {
  const files = [];
  for (let offset = 0; ; offset += 100) {
    const rows = await request("/storage/v1/object/list/qmargin-b74-attachments", {
      method: "POST", token, body: { prefix: "", limit: 100, offset, sortBy: { column: "name", order: "asc" } },
    });
    if (!Array.isArray(rows)) throw new Error("The attachment list could not load.");
    files.push(...rows);
    if (rows.length < 100) return files;
  }
}

export const mediaId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const markdownMarker = "<!-- common-hours-markdown -->\n";

export function weekOf(date = journalToday()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const day = new Date(date + "T00:00:00Z");
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return "";
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function imageSource(image) {
  if (!image || typeof image.encoded !== "string" || image.encoded.length > 1333336 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.encoded)) return "";
  return "data:image/jpeg;base64," + image.encoded;
}

export function showFailure(element, message, retry) {
  const text = document.createElement("p");
  text.setAttribute("role", "alert");
  text.textContent = message;
  element.replaceChildren(text);
  if (!retry) return;
  const button = document.createElement("button");
  button.className = "quiet-button";
  button.type = "button";
  button.textContent = "Try again";
  button.addEventListener("click", () => {
    button.disabled = true;
    retry();
  });
  element.append(button);
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
