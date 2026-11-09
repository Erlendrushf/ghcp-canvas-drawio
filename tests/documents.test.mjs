import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { normalizeDiagram, loadDocument, LIMITS, checkSize } from "../.github/extensions/drawio-viewer/lib/documents.mjs";
import { model } from "./helpers.mjs";

test("reads bare, uncompressed and compressed mixed-page XML", () => {
  const compressed = deflateRawSync(encodeURIComponent(model("Azure"))).toString("base64");
  assert.equal(normalizeDiagram(Buffer.from(model())).pages.length, 1);
  const input = `<mxfile><diagram id="a" name="Page A">${model()}</diagram><diagram id="b" name="Azure">${compressed}</diagram></mxfile>`;
  const result = normalizeDiagram(Buffer.from(input));
  assert.deepEqual(result.pages.map(page => page.name), ["Page A", "Azure"]);
  assert.equal(result.document.getElementsByTagName("mxGraphModel").length, 2);
});
test("rejects malformed, unsafe, unsupported and duplicate-page XML", () => {
  for (const xml of ["", "<x/>", "<mxfile/>", "<mxfile><wrong/></mxfile>", "<mxfile>", '<!DOCTYPE mxfile><mxfile/>', "<mxfile><diagram>!!!</diagram></mxfile>", `<mxfile><diagram id="a">${model()}</diagram><diagram id="a">${model()}</diagram></mxfile>`]) {
    assert.throws(() => normalizeDiagram(Buffer.from(xml)));
  }
});
test("size limits are inclusive and expansion is bounded", () => {
  for (const [name, limit] of Object.entries(LIMITS)) {
    assert.doesNotThrow(() => checkSize(limit, limit, name));
    assert.throws(() => checkSize(limit + 1, limit, name));
  }
  assert.throws(() => normalizeDiagram(Buffer.alloc(LIMITS.file + 1)));
  const bomb = deflateRawSync("x".repeat(LIMITS.page + 1)).toString("base64");
  assert.throws(() => normalizeDiagram(Buffer.from(`<mxfile><diagram>${bomb}</diagram></mxfile>`)));
});
test("enforces decoded page and total limits on real compressed models", () => {
  const overhead = Buffer.byteLength(model(""));
  const page = size => deflateRawSync(encodeURIComponent(model("x".repeat(size - overhead)))).toString("base64");
  const atLimit = page(LIMITS.page);
  assert.equal(normalizeDiagram(Buffer.from(`<mxfile><diagram>${atLimit}</diagram></mxfile>`)).pages.length, 1);
  const overLimit = page(LIMITS.page + 1);
  assert.throws(() => normalizeDiagram(Buffer.from(`<mxfile><diagram>${overLimit}</diagram></mxfile>`)), /Decoded page exceeds/);
  const extra = page(10 * 1024 ** 2 + 1);
  assert.throws(() => normalizeDiagram(Buffer.from(`<mxfile><diagram id="a">${atLimit}</diagram><diagram id="b">${atLimit}</diagram><diagram id="c">${extra}</diagram></mxfile>`)), /Decoded document exceeds/);
});
test("rejects path and symlink escapes, accepts diagram files without writing them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drawio-docs-"));
  const outside = await mkdtemp(join(tmpdir(), "drawio-outside-"));
  try {
    const bytes = Buffer.from(model("Microsoft"));
    await writeFile(join(dir, "a.drawio"), bytes);
    await writeFile(join(outside, "b.drawio"), bytes);
    await symlink(join(outside, "b.drawio"), join(dir, "escape.drawio"));
    const loaded = await loadDocument(dir, "a.drawio");
    assert.equal(loaded.bytes, bytes.length);
    await assert.rejects(loadDocument(dir, "escape.drawio"), /outside/);
    await assert.rejects(loadDocument(dir, join(dir, "a.drawio")), /relative/);
  } finally { await rm(dir, { recursive: true }); await rm(outside, { recursive: true }); }
});
