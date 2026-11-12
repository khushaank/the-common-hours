import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { adminFiles, assetSource, blogFiles, browserConfig, readSiteConfig, sharedFiles, withConnectSource } from "./site-config.mjs";
import { renderFeed } from "./feed.mjs";

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
