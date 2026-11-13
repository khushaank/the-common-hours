import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { adminFiles, assetSource, blogFiles, browserConfig, readSiteConfig, sharedFiles, withConnectSource } from "./site-config.mjs";
import { renderFeed } from "./feed.mjs";
import { createHash } from "node:crypto";

const deskPath = "folio-80f54af81f7d";

async function buildApp(app, destination, files, config, childDirectory) {
  const directory = new URL(destination, import.meta.url);
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory()) {
    throw new Error("Use a regular directory for " + destination + ".");
  }
  const output = new URL(destination + "/", import.meta.url);
  const assets = [...files, ...sharedFiles];
  const allowedFiles = new Set([...assets, "config.js"]);
  if (app === "blog") allowedFiles.add("feed.xml");
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
      await writeFile(target, withConnectSource(await readFile(source, "utf8"), config));
    } else if (file === "static-cache.js") {
      const staticFiles = blogFiles.filter(name => /\.(?:jpg|woff2)$/.test(name));
      const hash = createHash("sha256");
      for (const name of staticFiles) hash.update(name).update(await readFile(assetSource(app, name)));
      await writeFile(target, (await readFile(source, "utf8")).replace("__STATIC_REVISION__", hash.digest("hex").slice(0, 16)));
    } else {
      await copyFile(source, target);
    }
  }
  await writeFile(new URL("config.js", output), browserConfig(config));
}

try {
  const config = readSiteConfig({ required: true });
  const feed = await renderFeed(process.argv.includes("--offline-feed") ? {} : config);
  await buildApp("blog", "./dist", blogFiles, config, deskPath);
  await buildApp("admin", "./dist/" + deskPath, adminFiles, config);
  await writeFile(new URL("./dist/feed.xml", import.meta.url), feed);
  console.log("Built the journal and writing desk in dist/.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
