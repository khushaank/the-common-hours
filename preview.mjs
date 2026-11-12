import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { adminFiles, assetSource, blogFiles, browserConfig, readSiteConfig, sharedFiles, withConnectSource } from "./site-config.mjs";
import { renderFeed } from "./feed.mjs";

const app = process.argv[2];
if (app !== "blog" && app !== "admin") {
  console.error("Use node preview.mjs blog or node preview.mjs admin.");
  process.exit(1);
}
const port = process.argv[3] === undefined ? (app === "blog" ? 8000 : 8001) : Number(process.argv[3]);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("Use a port from 0 to 65535. Port 0 picks an available port.");
  process.exit(1);
}
const files = new Set(app === "blog" ? [...blogFiles, "demo.js", "feed.xml"] : adminFiles);
for (const file of sharedFiles) files.add(file);
files.add("config.js");
const types = { html: "text/html", css: "text/css", js: "text/javascript", jpg: "image/jpeg", woff2: "font/woff2", txt: "text/plain", xml: "application/rss+xml" };
let config;
try {
  config = readSiteConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    const file = path === "/" ? "index.html" : path.slice(1);
    if (!files.has(file)) throw new Error("Unknown path");
    let data = file === "feed.xml" ? await renderFeed(config) :
      file === "config.js" ? browserConfig(config) : await readFile(assetSource(app, file));
    if (file === "index.html") data = withConnectSource(data.toString("utf8"), config);
    response.writeHead(200, { "Content-Type": types[file.split(".").pop()] + "; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Page not found");
  }
});
server.on("error", error => {
  console.error(error.code === "EADDRINUSE" ? "That port is in use. Try node preview.mjs " + app + " 0." : error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`));
