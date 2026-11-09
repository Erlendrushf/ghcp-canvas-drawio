import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startViewer } from "../.github/extensions/drawio-viewer/lib/server.mjs";
import { model, svg } from "./helpers.mjs";

test("renders Azure icons offline and imports missing icons without touching diagrams", async () => {
  const root = await mkdtemp(join(tmpdir(), "drawio-browser-"));
  let viewer, browser;
  try {
    const azure = "img/lib/azure2/ai_machine_learning/Azure_OpenAI.svg";
    const missing = "https://example.com/team.svg";
    const file = join(root, "architecture.drawio");
    const source = `<mxfile><diagram id="azure" name="Azure">${model("Azure OpenAI", `shape=image;image=${azure};`)}</diagram><diagram id="missing" name="Custom">${model("Custom", `shape=image;image=${missing};`)}</diagram></mxfile>`;
    await writeFile(file, source);
    viewer = await startViewer({ root, path: "architecture.drawio", iconDirectory: join(root, "packs") });
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
    const page = await browser.newPage();
    const external = [], errors = [], consoleErrors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.route("**/*", route => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1") { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(viewer.url);
    await page.locator("#status").filter({ hasText: "2 page(s)" }).waitFor({ timeout: 15000 }).catch(async error => {
      throw new Error(`${error.message}\nStatus: ${await page.locator("#status").textContent()}\nErrors: ${JSON.stringify(errors)}\nConsole: ${JSON.stringify(consoleErrors)}`);
    });
    assert.ok(await page.locator("#diagram svg").count());
    assert.ok((await page.locator("#diagram").boundingBox()).width > 1000, "Diagram viewport should fill the panel");
    await page.waitForFunction(() => Array.from(document.querySelectorAll("image")).some(image => (image.getAttribute("href") || image.getAttribute("xlink:href") || "").includes("Azure_OpenAI")));
    await page.evaluate(async () => {
      const element = Array.from(document.querySelectorAll("image")).find(image => (image.getAttribute("href") || image.getAttribute("xlink:href") || "").includes("Azure_OpenAI"));
      const image = new Image();
      image.src = element.getAttribute("href") || element.getAttribute("xlink:href");
      await image.decode();
    });
    const legacy = await page.evaluate(() => {
      const result = {};
      for (const file of ["azure.xml", "office/servers.xml", "mscae/cloud.xml"]) {
        const doc = mxStencilRegistry.loadStencil(`${STENCIL_PATH}/${file}`);
        mxStencilRegistry.parseStencilSet(doc.documentElement, null, true);
        result[file] = Object.keys(mxStencilRegistry.stencils).filter(name => name.startsWith(`mxgraph.${file === "azure.xml" ? "azure." : file.startsWith("office") ? "office." : "mscae."}`));
      }
      return result;
    });
    for (const [family, shapes] of Object.entries(legacy)) assert.ok(shapes.length, `Missing legacy stencil family: ${family}`);
    for (const shapes of Object.values(legacy)) {
      await page.evaluate(name => {
        viewer.graph.model.setStyle(viewer.graph.model.getCell("service"), `shape=${name};`);
      }, shapes[0]);
      assert.ok(await page.locator("#diagram svg path").count(), `Stencil ${shapes[0]} did not render vector paths`);
    }
    const beforeZoom = await page.evaluate(() => viewer.graph.view.scale);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.ok((await page.evaluate(() => viewer.graph.view.scale)) > beforeZoom);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.getByText("Import local icon pack", { exact: true }).click();
    await page.locator("#pack-name").fill("team");
    await page.locator("#provenance").fill("Project-owned test artwork");
    await page.locator("#files").setInputFiles({ name: "team.svg", mimeType: "image/svg+xml", buffer: svg });
    await page.locator("#mapping-fields input").fill(missing);
    await page.locator("#import").click();
    await page.locator("#import-status").filter({ hasText: "Imported 1 icon(s)" }).waitFor();
    await page.locator("#status").filter({ hasText: "2 page(s)" }).waitFor({ timeout: 15000 }).catch(async error => {
      throw new Error(`${error.message}\nStatus: ${await page.locator("#status").textContent()}\nErrors: ${JSON.stringify(errors)}\nConsole: ${JSON.stringify(consoleErrors)}\nDiagnostics: ${await page.locator("#diagnostics").textContent()}`);
    });
    assert.equal(await readFile(file, "utf8"), source);
    await page.evaluate(() => viewer.selectPage(1));
    await page.waitForFunction(() => Array.from(document.querySelectorAll("image")).some(image => (image.getAttribute("href") || image.getAttribute("xlink:href") || "").includes("icons/team/team.svg")));
    await page.reload();
    await page.locator("#status").filter({ hasText: "2 page(s)" }).waitFor();
    assert.ok(!(await page.locator("#diagnostics").textContent()).includes(missing));
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await viewer?.close(); await rm(root, { recursive: true }); }
});
