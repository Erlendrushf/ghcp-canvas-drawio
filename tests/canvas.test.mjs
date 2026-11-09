import { test } from "node:test";
import assert from "node:assert/strict";
import { createDrawioCanvas } from "../.github/extensions/drawio-viewer/canvas.mjs";

test("Canvas adapter enforces workspace context and closes opened providers", async () => {
  const declaration = createDrawioCanvas(options => options);
  assert.equal(declaration.id, "drawio-viewer");
  assert.deepEqual(declaration.actions.map(action => action.name), ["refresh", "get_document_info"]);
  await assert.rejects(declaration.open({ instanceId: "test", input: { path: "examples/azure.drawio" } }), /workspace/);
  const context = { instanceId: "test", input: { path: "examples/azure.drawio" }, session: { workingDirectory: process.cwd() } };
  const opened = await declaration.open(context);
  try {
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:/);
    assert.equal((await declaration.open(context)).url, opened.url);
    const info = declaration.actions[1].handler(context);
    assert.equal(info.error, undefined);
    assert.equal(info.xml, undefined);
    assert.equal(info.pages[0].name, "Azure");
    const refreshed = await declaration.actions[0].handler(context);
    assert.equal(refreshed.hash, info.hash);
  } finally { await declaration.onClose(context); }
  assert.throws(() => declaration.actions[1].handler(context), /not open/);
});
