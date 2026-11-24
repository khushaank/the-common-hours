import { loadEnvFile } from "node:process";

export const blogFiles = [
  "manifest.webmanifest", "logo.png", "app-192.png", "app-512.png", "app-maskable.png",
  "index.html", "404.html", "style.css", "route.js", "start.js", "journal.js", "legal.js", "legal-content.js", "photos.js", "reading.js", "reading-copy.js", "bookmarks.js", "cover.jpg", "footer-landscape.jpg", "static-cache.js", "public-cache.js",
  "serif.woff2", "serif-italic.woff2", "sans.woff2", "sans-semibold.woff2",
  "LICENSE-DM-Sans.txt", "LICENSE-Instrument-Serif.txt",
];
export const adminFiles = [
  "index.html", "logo.png", "style.css", "desk-start.js", "desk.js", "editor-tools.js", "photo-tools.js", "image-library.js", "media-catalog.js", "media-editor.js", "stats.js",
  "visual-editor.js", "pdf-thumbnail.js", "turndown.js", "pdf-engine.js", "pdf-worker.js", "LICENSE-turndown.txt", "LICENSE-pdfjs.txt",
  "serif.woff2", "sans.woff2", "sans-semibold.woff2", "LICENSE-DM-Sans.txt", "LICENSE-Instrument-Serif.txt",
];
export const sharedFiles = ["scrollbars.css", "interface.css", "keyboard.js", "feedback.js", "common.js", "text.js", "photo-text.js", "page-url.js", "archive.js", "series.js", "rich.js", "markdown-it.min.js", "LICENSE-markdown-it.txt",
  "markdown-it-footnote.js", "LICENSE-markdown-it-footnote.txt"];
export const securityHeaders = {
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000",
};
export const assetSource = (app, file) => {
  const packages = {
    "turndown.js": "turndown/lib/turndown.browser.es.js",
    "pdf-engine.js": "pdfjs-dist/build/pdf.min.mjs",
    "pdf-worker.js": "pdfjs-dist/build/pdf.worker.min.mjs",
    "LICENSE-turndown.txt": "turndown/LICENSE",
    "LICENSE-pdfjs.txt": "pdfjs-dist/LICENSE",
  };
  if (app === "admin" && packages[file]) return new URL("./node_modules/" + packages[file], import.meta.url);
  const folder = sharedFiles.includes(file) ? "shared" : /\.(?:woff2|txt)$/.test(file) || file === "logo.png" ? "blog" : app;
  return new URL("./" + folder + "/" + file, import.meta.url);
};

export function readSiteConfig({ required = false, preview = false } = {}) {
  try {
    loadEnvFile(new URL(".env", import.meta.url));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const urlName = preview ? "PREVIEW_SUPABASE_URL" : "SUPABASE_URL";
  const keyName = preview ? "PREVIEW_SUPABASE_PUBLISHABLE_KEY" : "SUPABASE_PUBLISHABLE_KEY";
  const url = process.env[urlName]?.trim() || "";
  const key = process.env[keyName]?.trim() || "";
  if (!required && !url && !key) return { origin: "", key: "" };
  if (!url || !key) throw new Error("Set both " + urlName + " and " + keyName + ".");

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
  return html.replace(/connect-src 'self'[^;"]*/, "connect-src 'self'" + (origin ? " " + origin : ""))
    .replace(/<!-- public-api-connection -->|<link rel="preconnect" href="[^"]+" crossorigin>/,
      origin ? '<link rel="preconnect" href="' + origin + '" crossorigin>' : "");
}
