import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { adminFiles, blogFiles, browserConfig, readSiteConfig, withConnectSource } from "./site-config.mjs";

const deskPath = "folio-80f54af81f7d";

async function buildApp(app, destination, files, config, childDirectory) {
  const directory = new URL(destination, import.meta.url);
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory()) {
    throw new Error("Use a regular directory for " + destination + ".");
  }
  const output = new URL(destination + "/", import.meta.url);
  const allowedFiles = new Set([...files, "config.js"]);
  const existing = await readdir(output, { withFileTypes: true });
  if (existing.some(entry => entry.isDirectory()
    ? entry.name !== childDirectory
    : !entry.isFile() || !allowedFiles.has(entry.name))) {
    throw new Error("Clear the extra files from " + destination + " before building.");
  }

  for (const file of files) {
    const source = new URL("./" + app + "/" + file, import.meta.url);
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
  await buildApp("blog", "./dist", blogFiles, config, deskPath);
  await buildApp("admin", "./dist/" + deskPath, adminFiles, config);
  console.log("Built the journal and writing desk in dist/.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
