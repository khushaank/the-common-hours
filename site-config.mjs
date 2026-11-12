import { loadEnvFile } from "node:process";

export const blogFiles = [
  "index.html", "404.html", "style.css", "start.js", "journal.js", "legal.js", "photos.js", "cover.jpg",
  "serif.woff2", "serif-italic.woff2", "sans.woff2", "sans-semibold.woff2",
  "LICENSE-DM-Sans.txt", "LICENSE-Instrument-Serif.txt",
];
export const adminFiles = [
  "index.html", "style.css", "desk.js", "editor-tools.js", "photo-tools.js",
  "serif.woff2", "sans.woff2", "sans-semibold.woff2", "LICENSE-DM-Sans.txt", "LICENSE-Instrument-Serif.txt",
];
export const sharedFiles = ["common.js", "rich.js", "markdown-it.min.js", "LICENSE-markdown-it.txt"];
export const assetSource = (app, file) => {
  const folder = sharedFiles.includes(file) ? "shared" : /\.(?:woff2|txt)$/.test(file) ? "blog" : app;
  return new URL("./" + folder + "/" + file, import.meta.url);
};

export function readSiteConfig({ required = false } = {}) {
  try {
    loadEnvFile(new URL(".env", import.meta.url));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const url = process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  if (!required && !url && !key) return { origin: "", key: "" };
  if (!url || !key) throw new Error("Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");

  let project;
  try {
    project = new URL(url);
  } catch {
    throw new Error("Use a valid HTTPS Supabase project URL.");
  }
  if (project.protocol !== "https:" || !/^[a-z0-9.-]+$/i.test(project.hostname) ||
      project.username || project.password || project.pathname !== "/" || project.search || project.hash) {
    throw new Error("Use an HTTPS Supabase project URL without a path or credentials.");
  }

  if (!/^sb_publishable_[a-z0-9_-]+$/i.test(key)) {
    const jwt = /^[a-z0-9_-]+\.([a-z0-9_-]+)\.[a-z0-9_-]+$/i.exec(key);
    let role;
    if (jwt) {
      try {
        role = JSON.parse(Buffer.from(jwt[1], "base64url").toString("utf8"))?.role;
      } catch {
        // An invalid JWT falls through to the same error as a privileged key.
      }
    }
    if (role !== "anon") throw new Error("Use a Supabase publishable key or legacy anon key.");
  }

  return { origin: project.origin, key };
}

export function browserConfig({ origin, key }) {
  return [
    "export const url = " + JSON.stringify(origin) + ";",
    "export const publishableKey = " + JSON.stringify(key) + ";",
    "export function getProjectOrigin() {",
    '  if (!url) throw new Error("Supabase is not configured.");',
    "  return url;",
    "}",
    "",
  ].join("\n");
}

export function withConnectSource(html, { origin }) {
  return html.replace("connect-src 'self' https://*.supabase.co", "connect-src " + (origin || "'none'"));
}
