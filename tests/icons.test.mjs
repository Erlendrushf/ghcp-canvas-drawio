import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPack, readPacks, validateIcon } from "../.github/extensions/drawio-viewer/lib/icon-packs.mjs";
import { svg } from "./helpers.mjs";
import { LIMITS } from "../.github/extensions/drawio-viewer/lib/documents.mjs";

test("validates SVG and rejects active, remote and unsupported content", () => {
  validateIcon(svg, "azure.svg");
  for (const content of [
    '<svg><script>alert(1)</script></svg>', '<svg onload="bad()"/>',
    '<svg><use href="https://example.com/a"/></svg>', '<svg><foreignObject/></svg>',
    '<svg><path fill="url(https://example.com/a)"/></svg>', '<!DOCTYPE svg><svg/>'
  ]) assert.throws(() => validateIcon(Buffer.from(content), "bad.svg"));
  assert.throws(() => validateIcon(svg, "icon.html"));
  assert.throws(() => validateIcon(Buffer.from("not PNG"), "bad.png"));
  const wrapper = '<svg xmlns="http://www.w3.org/2000/svg"><title></title></svg>';
  const exact = Buffer.from(wrapper.replace("<title>", `<title>${"x".repeat(LIMITS.icon - Buffer.byteLength(wrapper))}`));
  assert.equal(exact.length, LIMITS.icon);
  validateIcon(exact, "exact.svg");
  assert.throws(() => validateIcon(Buffer.concat([exact, Buffer.from(" ")]), "over.svg"), /exceeds/);
});
test("persists immutable tracked packs and exact mappings across reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drawio-icons-"));
  try {
    const input = { name: "azure", provenance: "Test fixture, project-owned artwork", files: [{ name: "test.svg", data: svg.toString("base64"), aliases: ["https://example.com/missing.svg"] }] };
    assert.equal((await importPack(directory, input)).count, 1);
    assert.equal((await readPacks(directory))["https://example.com/missing.svg"], "azure/test.svg");
    const original = await readFile(join(directory, "azure/test.svg"));
    await assert.rejects(importPack(directory, input), /duplicate resource mapping/);
    await assert.rejects(importPack(directory, { ...input, name: "other" }), /duplicate resource mapping/);
    assert.deepEqual(await readFile(join(directory, "azure/test.svg")), original);
    await assert.rejects(importPack(directory, { ...input, name: "../escape" }));
  } finally { await rm(directory, { recursive: true }); }
});
