import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { normalizeDiagram } from "../.github/extensions/drawio-viewer/lib/documents.mjs";
import { prepareView } from "../.github/extensions/drawio-viewer/lib/resources.mjs";
import { model, svg } from "./helpers.mjs";
const vendor = fileURLToPath(new URL("../.github/extensions/drawio-viewer/assets/vendor/drawio", import.meta.url));

test("rewrites approved vendor references locally, resolves exact imports and preserves original XML DOM", async () => {
  const image = "https://app.diagrams.net/img/lib/azure2/ai_machine_learning/Azure_OpenAI.svg";
  const loaded = normalizeDiagram(Buffer.from(model("Azure", `shape=image;image=${image};`)));
  const view = await prepareView(loaded, vendor, {}, "http://127.0.0.1:1234/token/");
  assert.match(view.xml, /http:\/\/127\.0\.0\.1:1234\/token\/vendor\/img\/lib/);
  assert.deepEqual(view.diagnostics, []);
  assert.equal(loaded.document.getElementsByTagName("mxCell")[2].getAttribute("style"), `shape=image;image=${image};`);
  const missing = normalizeDiagram(Buffer.from(model("Custom", "shape=image;image=https://example.com/icon.svg;")));
  const mapped = await prepareView(missing, vendor, { "https://example.com/icon.svg": "team/icon.svg" }, "/local/");
  assert.match(mapped.xml, /\/local\/icons\/team\/icon.svg/);
  assert.deepEqual(mapped.missing, []);
});
test("reports blocked resources and unsupported math/fonts, rejects unsafe embedded SVG", async () => {
  const loaded = normalizeDiagram(Buffer.from(model("Test", "image=https://example.com/remote.svg;")));
  loaded.document.documentElement.setAttribute("math", "1");
  loaded.document.documentElement.setAttribute("extFonts", "external^https://example.com/font");
  const view = await prepareView(loaded, vendor, {}, "/local/");
  assert.deepEqual(view.missing, ["https://example.com/remote.svg"]);
  assert.equal(view.diagnostics.length, 3);
  const encoded = encodeURIComponent(svg.toString());
  const embedded = await prepareView(normalizeDiagram(Buffer.from(model("Embedded", `image=data:image/svg+xml,${encoded};`))), vendor, {}, "/local/");
  assert.deepEqual(embedded.diagnostics, []);
});
