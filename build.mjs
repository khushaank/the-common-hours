import { copyFile, lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { adminFiles, assetSource, blogFiles, browserConfig, readSiteConfig, securityHeaders, sharedFiles, withConnectSource } from "./site-config.mjs";
import { renderFeed } from "./feed.mjs";
import { generatedFile, loadPublicSnapshot, renderPublicPages } from "./prerender.mjs";
import { createHash } from "node:crypto";
import sharp from "sharp";

const deskPath = "folio-80f54af81f7d";

async function featuredSnapshot(config) {
  if (!config.origin) return null;
  try {
    const response = await fetch(config.origin + "/rest/v1/rpc/qmargin_b74_home_photos", {
      headers: { apikey: config.key }, signal: AbortSignal.timeout(7000), redirect: "error",
    });
    if (!response.ok) return null;
    const { photos, image } = await response.json();
    if (!photos?.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(image?.encoded || "")) return null;
    const { data: bytes, info } = await sharp(Buffer.from(image.encoded, "base64"))
      .resize({ width: 1280, height: 1000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76 }).toBuffer({ resolveWithObject: true });
    const version = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const [first] = photos;
    if (!/^[0-9a-f-]{36}$/i.test(first.id)) return null;
    const data = JSON.stringify({ first: { id: first.id, media_id: first.media_id }, width: info.width, height: info.height, version });
    return { bytes, version, first, width: info.width, height: info.height, markup: '<template id="featured-snapshot" data-value="' +
      data.replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]) + '"></template>' };
  } catch { return null; }
}

async function buildApp(app, destination, files, config, childDirectory, featured, snapshot) {
  const directory = new URL(destination, import.meta.url);
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory()) {
    throw new Error("Use a regular directory for " + destination + ".");
  }
  const output = new URL(destination + "/", import.meta.url);
  const assets = [...files, ...sharedFiles];
  const allowedFiles = new Set([...assets, "config.js"]);
  const settings = browserConfig(config);
  const browserAssets = assets.filter(name => /\.(?:css|js)$/.test(name) && name !== "static-cache.js");
  const sources = new Map(await Promise.all(browserAssets.map(async name => [name, await readFile(assetSource(app, name), "utf8")])));
  const release = createHash("sha256").update(await readFile(new URL(import.meta.url))).update(settings);
  for (const [name, source] of sources) release.update(name).update(source);
  release.update(await readFile(assetSource(app, "index.html")));
  if (snapshot) {
    release.update(await readFile(new URL("./prerender.mjs", import.meta.url)));
    release.update(JSON.stringify([snapshot.posts, snapshot.photos, snapshot.comments, [...snapshot.images]]));
    for (const [name, bytes] of snapshot.files) release.update(name).update(bytes);
  }
  const versioned = new Set([...browserAssets, "config.js"]);
  if (app === "blog") {
    versioned.add("footer-landscape.jpg");
    release.update(await readFile(assetSource(app, "footer-landscape.jpg")));
  }
  const revision = release.digest("hex").slice(0, 16);
  const version = path => versioned.has(path.replace(/^\.\//, "")) ? path + "?v=" + revision : path;
  if (app === "blog") { allowedFiles.add("feed.xml"); allowedFiles.add("featured.jpg"); allowedFiles.add("featured.webp"); allowedFiles.add("_headers"); }
  const existing = await readdir(output, { withFileTypes: true });
  if (existing.some(entry => entry.isDirectory()
    ? entry.name !== childDirectory
    : !entry.isFile() || !(allowedFiles.has(entry.name) || app === "blog" && (generatedFile.test(entry.name) || entry.name === "photo-shell.js")))) {
    throw new Error("Clear the extra files from " + destination + " before building.");
  }

  let publicPages;
  for (const file of assets) {
    const source = assetSource(app, file);
    const target = new URL(file, output);
    if (file === "index.html") {
      const html = withConnectSource(await readFile(source, "utf8"), config);
      const document = html.replace(/\b(src|href)="([^"\s]+)"/g, (_, attr, path) => `${attr}="${version(path)}"`);
      if (snapshot) {
        publicPages = renderPublicPages(document, snapshot, featured);
        for (const [name, data] of publicPages) await writeFile(new URL(name, output), data);
      } else await writeFile(target, document);
    } else if (file.endsWith(".js") && sources.has(file)) {
      await writeFile(target, sources.get(file).replace(/(\bfrom\s+|\bimport\s*(?:\(\s*)?)(["'])(\.\/[^"']+)\2/g,
        (_, prefix, quote, path) => prefix + quote + version(path) + quote));
    } else if (app === "blog" && file === "cover.jpg") {
      await writeFile(target, await sharp(await readFile(source))
        .resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 76, mozjpeg: true }).toBuffer());
    } else if (file === "static-cache.js") {
      const offline = [...new Set([...versioned, "index.html", ...assets.filter(name => /\.(?:jpg|woff2|svg|png|webmanifest)$/.test(name))])].map(version);
      if (featured) offline.push("featured.webp?v=" + featured.version);
      const hash = createHash("sha256").update(revision).update(JSON.stringify(offline));
      for (const name of offline.filter(name => !name.includes("?") && name !== "index.html")) hash.update(await readFile(assetSource(app, name)));
      await writeFile(target, (await readFile(source, "utf8"))
        .replace("__STATIC_REVISION__", hash.digest("hex").slice(0, 16))
        .replace('"__OFFLINE_ASSETS__"', JSON.stringify(offline)));
    } else {
      await copyFile(source, target);
    }
  }
  if (app === "blog") {
    if (featured) await writeFile(new URL("featured.webp", output), featured.bytes);
    for (const name of featured ? ["featured.jpg"] : ["featured.jpg", "featured.webp"]) {
      if (existing.some(entry => entry.name === name)) await unlink(new URL(name, output));
    }
  }
  if (publicPages) for (const entry of existing) {
    if (entry.isFile() && (generatedFile.test(entry.name) || entry.name === "photo-shell.js") && !publicPages.has(entry.name)) await unlink(new URL(entry.name, output));
  }
  await writeFile(new URL("config.js", output), settings);
}

try {
  const config = process.argv.includes("--offline-feed") ? {} : readSiteConfig({ required: true });
  const [feed, featured, snapshot] = await Promise.all([renderFeed(config), featuredSnapshot(config), loadPublicSnapshot(config)]);
  await buildApp("blog", "./dist", blogFiles, config, deskPath, featured, snapshot);
  await buildApp("admin", "./dist/" + deskPath, adminFiles, config);
  await writeFile(new URL("./dist/feed.xml", import.meta.url), feed);
  await writeFile(new URL("./dist/_headers", import.meta.url), "/*\n" +
    Object.entries(securityHeaders).map(([name, value]) => "  " + name + ": " + value).join("\n") + "\n");
  console.log("Built the journal and writing desk in dist/.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
