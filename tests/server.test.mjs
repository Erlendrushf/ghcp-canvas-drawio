import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startViewer } from "../.github/extensions/drawio-viewer/lib/server.mjs";
import { model } from "./helpers.mjs";

test("serves only authorized assets, refreshes atomic saves and never writes diagrams", async () => {
  const root = await mkdtemp(join(tmpdir(), "drawio-server-"));
  let viewer;
  try {
    const file = join(root, "a.drawio");
    await writeFile(file, model("Original"));
    viewer = await startViewer({ root, path: "a.drawio", iconDirectory: join(root, "packs") });
    const original = await readFile(file);
    assert.equal((await fetch(viewer.url)).status, 200);
    assert.equal((await fetch(new URL("/", viewer.url))).status, 404);
    assert.equal((await fetch(`${viewer.url}state`, { headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await fetch(`${viewer.url}refresh`, { method: "POST" })).status, 403);
    assert.equal((await fetch(`${viewer.url}vendor/%2e%2e%2f%2e%2e%2fpackage.json`)).status, 400);
    assert.deepEqual(await readFile(file), original);
    await writeFile(join(root, "replacement"), model("Updated"));
    await rename(join(root, "replacement"), file);
    await assertEventually(async () => (await (await fetch(`${viewer.url}state`)).json()).xml.includes("Updated"));
    await unlink(file);
    await assertEventually(async () => Boolean((await (await fetch(`${viewer.url}state`)).json()).error));
    await writeFile(file, model("Restored"));
    await viewer.refresh();
    assert.match((await (await fetch(`${viewer.url}state`)).json()).xml, /Restored/);
    const url = viewer.url; await viewer.close(); viewer = undefined;
    await assert.rejects(fetch(url));
  } finally { await viewer?.close(); await rm(root, { recursive: true }); }
});
async function assertEventually(check) {
  for (let n = 0; n < 50; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail("Expected state transition did not occur");
}
