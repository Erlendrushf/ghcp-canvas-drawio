import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = new URL("../node_modules/@xmldom/xmldom/", import.meta.url);
const target = new URL("../.github/extensions/drawio-viewer/assets/vendor/xmldom/", import.meta.url);
const digest = data => createHash("sha256").update(data).digest("hex");
if (!process.argv.includes("--verify")) {
  await mkdir(target, { recursive: true });
  for (const path of ["lib", "package.json", "LICENSE"]) await cp(new URL(path, source), new URL(path, target), { recursive: true });
  const files = {};
  for (const path of ["package.json", "LICENSE", ...(await readdir(new URL("lib/", target))).map(name => `lib/${name}`)]) files[path] = digest(await readFile(new URL(path, target)));
  await writeFile(new URL("checksums.json", target), JSON.stringify({ version: "0.9.12", files }, null, 2) + "\n");
}
const manifest = JSON.parse(await readFile(new URL("checksums.json", target)));
for (const [path, sha] of Object.entries(manifest.files)) {
  if (digest(await readFile(new URL(path, target))) !== sha) throw new Error(`Parser checksum mismatch: ${path}`);
}
console.log(`Verified vendored xmldom ${manifest.version}`);
