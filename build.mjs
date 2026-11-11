import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { blogFiles, browserConfig, readSiteConfig, withConnectSource } from "./site-config.mjs";

try {
  const config = readSiteConfig({ required: true });
  const output = new URL("./dist/", import.meta.url);
  const allowedFiles = new Set([...blogFiles, "config.js"]);
  await mkdir(output, { recursive: true });
  if (!(await lstat(new URL("./dist", import.meta.url))).isDirectory()) {
    throw new Error("Use a regular dist directory for the build output.");
  }
  const existing = await readdir(output, { withFileTypes: true });
  if (existing.some(entry => !entry.isFile() || !allowedFiles.has(entry.name))) {
    throw new Error("Clear the extra files from dist before building the public site.");
  }

  for (const file of blogFiles) {
    const source = new URL("./blog/" + file, import.meta.url);
    const target = new URL(file, output);
    if (file === "index.html") {
      await writeFile(target, withConnectSource(await readFile(source, "utf8"), config));
    } else {
      await copyFile(source, target);
    }
  }
  await writeFile(new URL("config.js", output), browserConfig(config));
  console.log("Built the public journal in dist/.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
