import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const revision = "c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3";
const destination = new URL("../.github/extensions/drawio-viewer/assets/vendor/drawio/", import.meta.url);
const digest = data => createHash("sha256").update(data).digest("hex");
async function walk(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(new URL(prefix, root), { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(root, `${path}/`));
    else if (entry.isFile() && path !== "manifest.json") files.push(path);
  }
  return files.sort();
}
if (process.argv.includes("--verify")) {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", destination)));
  if (manifest.revision !== revision) throw new Error("Unexpected draw.io revision");
  const actual = await walk(destination);
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error("Vendor inventory mismatch");
  for (const path of actual) {
    if (digest(await readFile(new URL(path, destination))) !== manifest.files[path]) throw new Error(`Checksum mismatch: ${path}`);
  }
  console.log(`Verified ${actual.length} pinned vendor files`);
} else {
  const temp = await mkdtemp(join(tmpdir(), "drawio-assets-"));
  try {
    const response = await fetch(`https://codeload.github.com/jgraph/drawio/tar.gz/${revision}`);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const archive = join(temp, "source.tar.gz");
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    execFileSync("tar", ["-xzf", archive, "-C", temp]);
    const root = join(temp, `drawio-${revision}`);
    const webapp = join(root, "src/main/webapp");
    const paths = [
      "js/viewer-static.min.js", "js/stencils.min.js", "styles", "mxgraph/css",
      "mxgraph/images", "images", "img/lib/azure2", "img/lib/mscae",
      "img/lib/active_directory", "img/lib/dynamics365", "img/LICENSE",
      "shapes/LICENSE", "stencils/LICENSE"
    ];
    await mkdir(destination, { recursive: true });
    const { cp } = await import("node:fs/promises");
    for (const path of paths) {
      const target = new URL(path, destination);
      await mkdir(dirname(target.pathname), { recursive: true });
      await cp(join(webapp, path), target, { recursive: true });
    }
    await copyFile(join(root, "LICENSE"), new URL("LICENSE", destination));
    const files = {};
    for (const path of await walk(destination)) files[path] = digest(await readFile(new URL(path, destination)));
    await writeFile(new URL("manifest.json", destination), JSON.stringify({ revision, files }, null, 2) + "\n");
    console.log(`Packaged ${Object.keys(files).length} pinned vendor files`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
