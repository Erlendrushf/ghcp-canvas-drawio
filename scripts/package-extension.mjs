import { brotliCompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, ".github/extensions/drawio-viewer");
const output = join(root, "canvas-extension");
const digest = data => createHash("sha256").update(data).digest("hex");
const maxTotal = 5_000_000;
const maxFile = 1_000_000;

async function inventory(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await inventory(directory, path + "/"));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported package entry: ${path}`);
  }
  return files.sort();
}

async function verify() {
  const files = await inventory(output);
  let total = 0;
  for (const path of files) {
    const data = await readFile(join(output, path));
    total += data.length;
    if (data.length > maxFile) throw new Error(`Installer file limit exceeded: ${path}`);
  }
  if (total > maxTotal) throw new Error(`Installer total limit exceeded: ${total} > ${maxTotal}`);
  const { loadVendor } = await import("../.github/extensions/drawio-viewer/lib/vendor.mjs");
  const vendor = await loadVendor(join(output, "assets/vendor/drawio"));
  const manifest = JSON.parse(await readFile(join(source, "assets/vendor/drawio/manifest.json")));
  for (const [path, checksum] of Object.entries(manifest.files)) {
    if (excluded(path)) continue;
    if (digest(await vendor.read(path)) !== checksum) throw new Error(`Packaged vendor mismatch: ${path}`);
  }
  for (const path of await inventory(source)) {
    if (path.startsWith("assets/vendor/drawio/")) continue;
    if (digest(await readFile(join(output, path))) !== digest(await readFile(join(source, path)))) {
      throw new Error(`Packaged source mismatch: ${path}`);
    }
  }
  console.log(`Verified install package: ${total} / ${maxTotal} bytes, ${files.length} files`);
}

function excluded(path) {
  return path === "manifest.json" || /^images\/sidebar-/.test(path) ||
    /^styles\/fonts\//.test(path) || /^styles\/(grapheditor|high-contrast)\.css$/.test(path);
}

if (!process.argv.includes("--verify")) {
  const vendorSource = join(source, "assets/vendor/drawio");
  const manifest = JSON.parse(await readFile(join(vendorSource, "manifest.json")));
  const entries = [], bodies = [];
  for (const path of await inventory(vendorSource)) {
    if (excluded(path)) continue;
    const data = await readFile(join(vendorSource, path));
    if (digest(data) !== manifest.files[path]) throw new Error(`Source checksum mismatch: ${path}`);
    entries.push({ path, bytes: data.length });
    bodies.push(data);
  }
  const header = Buffer.from(JSON.stringify(entries));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const decoded = Buffer.concat([length, header, ...bodies]);
  const compressed = brotliCompressSync(decoded, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  // Only remove this script's fixed generated output, never the source extension.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const path of await inventory(source)) {
    if (path.startsWith("assets/vendor/drawio/")) continue;
    await mkdir(join(output, path, ".."), { recursive: true });
    await cp(join(source, path), join(output, path));
  }
  const vendorOutput = join(output, "assets/vendor/drawio");
  await mkdir(vendorOutput, { recursive: true });
  const chunks = [];
  for (let offset = 0; offset < compressed.length; offset += 900_000) {
    const data = compressed.subarray(offset, offset + 900_000);
    const path = `bundle-${chunks.length}.br`;
    await writeFile(join(vendorOutput, path), data);
    chunks.push({ path, bytes: data.length, sha256: digest(data) });
  }
  await writeFile(join(vendorOutput, "bundle.json"), JSON.stringify({
    version: 1, revision: manifest.revision, decodedBytes: decoded.length, chunks
  }, null, 2) + "\n");
  for (const path of ["LICENSE", "img/LICENSE", "shapes/LICENSE", "stencils/LICENSE"]) {
    await mkdir(join(vendorOutput, path, ".."), { recursive: true });
    await cp(join(vendorSource, path), join(vendorOutput, path));
  }
  await cp(join(root, "THIRD_PARTY_NOTICES.md"), join(output, "THIRD_PARTY_NOTICES.md"));
}
await verify();
