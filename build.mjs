import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { adminFiles, assetSource, blogFiles, browserConfig, readSiteConfig, sharedFiles, withConnectSource } from "./site-config.mjs";
import { renderFeed } from "./feed.mjs";
import { createHash } from "node:crypto";

const deskPath = "folio-80f54af81f7d";

async function featuredSnapshot(config) {
  if (!config.origin) return null;
  try {
    const response = await fetch(config.origin + "/rest/v1/rpc/qmargin_b74_home_photos", {
      headers: { apikey: config.key }, signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const { photos, image } = await response.json();
    if (!photos?.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(image?.encoded || "")) return null;
    const bytes = Buffer.from(image.encoded, "base64");
    const version = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const [first] = photos;
    if (!/^(?:[0-9a-f-]{36}|month-\d{4}-\d{2})$/i.test(first.id)) return null;
    const data = JSON.stringify({ first: { id: first.id, media_id: first.media_id }, width: image.width, height: image.height, version });
    return { bytes, markup: '<template id="featured-snapshot" data-value="' +
      data.replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]) + '"></template>' };
  } catch { return null; }
}

async function buildApp(app, destination, files, config, childDirectory, featured) {
  const directory = new URL(destination, import.meta.url);
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory()) {
    throw new Error("Use a regular directory for " + destination + ".");
  }
  const output = new URL(destination + "/", import.meta.url);
  const assets = [...files, ...sharedFiles];
  const allowedFiles = new Set([...assets, "config.js"]);
  if (app === "blog") { allowedFiles.add("feed.xml"); allowedFiles.add("featured.jpg"); }
  const existing = await readdir(output, { withFileTypes: true });
  if (existing.some(entry => entry.isDirectory()
    ? entry.name !== childDirectory
    : !entry.isFile() || !allowedFiles.has(entry.name))) {
    throw new Error("Clear the extra files from " + destination + " before building.");
  }

  for (const file of assets) {
    const source = assetSource(app, file);
    const target = new URL(file, output);
    if (file === "index.html") {
      const html = withConnectSource(await readFile(source, "utf8"), config);
      await writeFile(target, html.replace("<!-- featured-snapshot -->", featured?.markup || ""));
    } else if (file === "static-cache.js") {
      const staticFiles = blogFiles.filter(name => /\.(?:jpg|woff2)$/.test(name));
      const hash = createHash("sha256");
      for (const name of staticFiles) hash.update(name).update(await readFile(assetSource(app, name)));
      await writeFile(target, (await readFile(source, "utf8")).replace("__STATIC_REVISION__", hash.digest("hex").slice(0, 16)));
    } else {
      await copyFile(source, target);
    }
  }
  if (featured) await writeFile(new URL("featured.jpg", output), featured.bytes);
  await writeFile(new URL("config.js", output), browserConfig(config));
}

try {
  const config = readSiteConfig({ required: true });
  const publicConfig = process.argv.includes("--offline-feed") ? {} : config;
  const [feed, featured] = await Promise.all([renderFeed(publicConfig), featuredSnapshot(publicConfig)]);
  await buildApp("blog", "./dist", blogFiles, config, deskPath, featured);
  await buildApp("admin", "./dist/" + deskPath, adminFiles, config);
  await writeFile(new URL("./dist/feed.xml", import.meta.url), feed);
  console.log("Built the journal and writing desk in dist/.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
