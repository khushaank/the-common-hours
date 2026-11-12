import { publishableKey, getProjectOrigin } from "./config.js";

export class RequestError extends Error {
  constructor(status, code) {
    super("The request could not be completed.");
    this.status = status;
    this.code = code;
  }
}

export async function request(path, { method = "GET", body, token, prefer, timeout = 12000 } = {}) {
  const headers = { apikey: publishableKey };
  if (token) headers.Authorization = "Bearer " + token;
  if (prefer) headers.Prefer = prefer;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(getProjectOrigin() + path, {
      method, headers, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(timeout),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error("The request timed out. Try again.");
    throw new Error("Could not connect. Check your connection and try again.");
  }
  const data = response.headers.get("content-type")?.includes("json") ? await response.json().catch(() => null) : null;
  if (!response.ok) throw new RequestError(response.status, data?.code || data?.error_code);
  if (response.status === 204 || method === "DELETE" && !prefer) return null;
  if (method === "GET" && data === null) throw new Error("The service returned an unexpected response. Try again.");
  return data;
}

export const table = path => "/rest/v1/qmargin_b74_" + path;
export const missingFeature = error => ["PGRST205", "42P01"].includes(error?.code);

export async function allRows(get, path) {
  const rows = [];
  while (true) {
    const batch = await get(path + "&limit=100&offset=" + rows.length);
    if (!Array.isArray(batch)) throw new Error("The service returned an unexpected response.");
    if (!batch.length) return rows;
    rows.push(...batch);
  }
}

export const escape = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export const monthNow = () => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
  }).formatToParts();
  return parts.find(part => part.type === "year").value + "-" +
    parts.find(part => part.type === "month").value;
};

export const mediaId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const markdownMarker = "<!-- common-hours-markdown -->\n";

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
