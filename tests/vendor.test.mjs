import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { brotliCompressSync } from "node:zlib";
import { loadVendor } from "../.github/extensions/drawio-viewer/lib/vendor.mjs";

async function fixture(t, entries = [{ path: "images/icon.svg", bytes: 3 }], payload = Buffer.from("svg"), corrupt = false) {
  const root = await mkdtemp(join(tmpdir(), "drawio-vendor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const header = Buffer.from(JSON.stringify(entries)), length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const archive = Buffer.concat([length, header, payload]);
  const compressed = brotliCompressSync(archive);
  await writeFile(join(root, "bundle-0.br"), compressed);
  await writeFile(join(root, "bundle.json"), JSON.stringify({
    version: 1, decodedBytes: archive.length,
    chunks: [{ path: "bundle-0.br", bytes: compressed.length, sha256: corrupt ? "0".repeat(64) : createHash("sha256").update(compressed).digest("hex") }]
  }));
  return root;
}

test("compressed vendor assets load offline without extracting files", async t => {
  const vendor = await loadVendor(await fixture(t));
  assert.equal(await vendor.has("images/icon.svg"), true);
  assert.equal(await vendor.has("images/missing.svg"), false);
  assert.equal((await vendor.read("images/icon.svg")).toString(), "svg");
  await assert.rejects(vendor.read("../bundle.json"), /not found/);
});

test("vendor bundles reject corruption, traversal, duplicates and incorrect lengths", async t => {
  await assert.rejects(loadVendor(await fixture(t, undefined, undefined, true)), /checksum mismatch/);
  for (const entries of [
    [{ path: "../outside", bytes: 3 }],
    [{ path: "/absolute", bytes: 3 }],
    [{ path: "one", bytes: 0 }, { path: "one", bytes: 3 }],
    [{ path: "one", bytes: 4 }]
  ]) await assert.rejects(loadVendor(await fixture(t, entries)), /Invalid vendor bundle entry/);
});

test("unpacked vendor assets retain path and symlink boundaries", async t => {
  const root = await mkdtemp(join(tmpdir(), "drawio-vendor-"));
  const outside = await mkdtemp(join(tmpdir(), "drawio-outside-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  await writeFile(join(outside, "icon.svg"), "outside");
  await symlink(join(outside, "icon.svg"), join(root, "escape.svg"));
  const vendor = await loadVendor(root);
  await assert.rejects(vendor.read("../icon.svg"), /Invalid vendor asset path/);
  await assert.rejects(vendor.read("escape.svg"), /outside allowed directory/);
});
