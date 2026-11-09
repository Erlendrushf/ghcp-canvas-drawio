import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));

for (const layout of ["project", "repository-root", "compact"]) {
  test(`installed SDK discovers, routes, reloads and closes the ${layout} extension`, { timeout: 120_000 }, async () => {
    assert.ok(process.env.COPILOT_SDK_PATH, "Set COPILOT_SDK_PATH to the installed copilot-sdk directory");
    assert.ok(process.env.COPILOT_CLI_PATH, "Set COPILOT_CLI_PATH to the absolute path of the Copilot CLI executable");
    const sdk = resolve(process.env.COPILOT_SDK_PATH);
    const { CopilotClient, RuntimeConnection } = await import(pathToFileURL(join(sdk, "index.js")).href);
    const home = await mkdtemp(join(tmpdir(), "drawio-runtime-"));
    if (layout !== "project") {
      const installed = join(home, "extensions/ghcp-canvas-drawio");
      await mkdir(installed, { recursive: true });
      if (layout === "compact") await cp(join(root, "canvas-extension"), installed, { recursive: true });
      else {
        await cp(join(root, "extension.mjs"), join(installed, "extension.mjs"));
        await cp(join(root, ".github/extensions/drawio-viewer"), join(installed, ".github/extensions/drawio-viewer"), { recursive: true });
      }
    }
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: process.env.COPILOT_CLI_PATH }),
      workingDirectory: root,
      baseDirectory: home,
      logLevel: "error"
    });
    let browser;
    try {
      const session = await client.createSession({
        workingDirectory: root,
        requestExtensions: true,
        requestCanvasRenderer: true,
        extensionSdkPath: sdk,
        onPermissionRequest: async () => ({ kind: "reject" })
      });
      const extensionId = layout === "project" ? "project:drawio-viewer" : "user:ghcp-canvas-drawio";
      async function waitForCanvas() {
        for (let attempt = 0; attempt < 100; attempt++) {
          const { extensions } = await session.rpc.extensions.list();
          const extension = extensions.find(item => item.id === extensionId);
          if (extension?.status === "failed") {
            const details = await session.rpc.tools.execute({
              name: "extensions_manage", arguments: { operation: "inspect", name: layout === "project" ? "drawio-viewer" : "ghcp-canvas-drawio" }
            });
            assert.fail(details.textResultForLlm);
          }
          const { canvases } = await session.rpc.canvas.list();
          const canvas = canvases.find(item => item.extensionId === extensionId && item.canvasId === "drawio-viewer");
          if (extension?.status === "running" && canvas) return canvas;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.fail("draw.io Canvas did not register within 10 seconds");
      }
      const canvas = await waitForCanvas();
      assert.deepEqual(canvas.actions.map(action => action.name), ["refresh", "get_document_info"]);
      await session.rpc.tools.initializeAndValidate();
      const capabilities = await session.rpc.tools.execute({
        name: "list_canvas_capabilities",
        arguments: { canvasId: "drawio-viewer", extensionId }
      });
      assert.equal(capabilities.resultType, "success");
      assert.match(capabilities.textResultForLlm, /get_document_info/);
      await assert.rejects(session.rpc.canvas.open({
        canvasId: "drawio-viewer", extensionId, instanceId: "invalid", input: {}
      }), /Invalid input for canvas.*"path" is a required property/);
      const input = { path: "examples/azure.drawio" };
      const source = await readFile(join(root, input.path));
      const opened = await session.rpc.canvas.open({
        canvasId: "drawio-viewer", extensionId, instanceId: "runtime-test", input
      });
      assert.match(opened.url, /^http:\/\/127\.0\.0\.1:/);
      assert.equal((await session.rpc.canvas.open({
        canvasId: "drawio-viewer", extensionId, instanceId: "runtime-test", input
      })).url, opened.url);
      const action = async actionName => {
        const { result } = await session.rpc.canvas.action.invoke({ instanceId: "runtime-test", actionName });
        return result;
      };
      const info = await action("get_document_info");
      assert.ok(info.pages, JSON.stringify(info));
      assert.equal(info.error, undefined);
      assert.equal(info.pages[0].name, "Azure");
      assert.equal((await action("refresh")).hash, info.hash);
      await assert.rejects(action("canvas.open"), /Canvas action names beginning with "canvas\." are reserved/);
      browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
      const page = await browser.newPage();
      const external = [], errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        if (new URL(route.request().url()).hostname !== "127.0.0.1") {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(opened.url);
      await page.locator("#status").filter({ hasText: "1 page(s)" }).waitFor();
      await page.evaluate(() => {
        for (const file of ["azure.xml", "office/servers.xml", "mscae/cloud.xml"]) {
          const doc = mxStencilRegistry.loadStencil(`${STENCIL_PATH}/${file}`);
          if (!doc?.documentElement) throw new Error(`Missing Microsoft stencil family: ${file}`);
          mxStencilRegistry.parseStencilSet(doc.documentElement, null, true);
        }
      });
      await page.evaluate(async () => {
        const element = Array.from(document.querySelectorAll("image")).find(image =>
          (image.getAttribute("href") || image.getAttribute("xlink:href") || "").includes("Azure_OpenAI"));
        if (!element) throw new Error("Azure OpenAI icon was not rendered");
        const image = new Image();
        image.src = element.getAttribute("href") || element.getAttribute("xlink:href");
        await image.decode();
      });
      await session.rpc.extensions.reload();
      await waitForCanvas();
      let restored;
      for (let attempt = 0; attempt < 100; attempt++) {
        const { openCanvases } = await session.rpc.canvas.listOpen();
        restored = openCanvases.find(item => item.instanceId === "runtime-test");
        if (restored?.url && restored.url !== opened.url) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(restored?.url);
      assert.notEqual(restored.url, opened.url, "Reload must rehydrate with the new provider URL");
      await page.goto(restored.url);
      await page.locator("#status").filter({ hasText: "1 page(s)" }).waitFor();
      assert.equal((await action("get_document_info")).hash, info.hash);
      assert.deepEqual(await readFile(join(root, input.path)), source);
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
      await session.rpc.canvas.close({ instanceId: "runtime-test" });
      assert.deepEqual((await session.rpc.canvas.listOpen()).openCanvases, []);
      await assert.rejects(action("get_document_info"));
      await assert.rejects(fetch(restored.url, { signal: AbortSignal.timeout(2000) }));
    } finally {
      await browser?.close();
      const errors = await client.stop();
      await rm(home, { recursive: true, force: true });
      assert.deepEqual(errors, [], "Runtime must shut down cleanly");
    }
  });
}
