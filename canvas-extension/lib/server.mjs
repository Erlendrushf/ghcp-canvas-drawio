import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, join, relative, isAbsolute, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDocument, LIMITS } from "./documents.mjs";
import { prepareView } from "./resources.mjs";
import { importPack, readPacks } from "./icon-packs.mjs";
import { loadVendor } from "./vendor.mjs";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const vendorRoot = join(extensionRoot, "assets/vendor/drawio");
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".xml": "application/xml", ".json": "application/json" };
async function safeAsset(root, path) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error("Asset outside allowed directory");
  const canonicalRoot = await realpath(root), canonical = await realpath(join(root, path));
  const child = relative(canonicalRoot, canonical);
  if (child.startsWith("..") || isAbsolute(child) || !(await stat(canonical)).isFile()) throw new Error("Asset outside allowed directory");
  return readFile(canonical);
}
async function readJson(request) {
  const max = Math.ceil(LIMITS.import * 4 / 3) + 1024 ** 2;
  let length = 0;
  const parts = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > max) throw new Error("Import request is too large");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export async function startViewer({ root, path, iconDirectory = join(extensionRoot, "assets/icon-packs") }) {
  const vendor = await loadVendor(vendorRoot);
  const token = randomBytes(32).toString("hex");
  const prefix = `/${token}/`;
  const clients = new Set();
  const watchers = [];
  let state, origin, timer, closed = false, importPending = false;
  let update = Promise.resolve();
  const broadcast = () => { for (const client of clients) client.write("data: changed\n\n"); };
  function refresh() {
    update = update.then(async () => {
      try {
        const loaded = await loadDocument(root, path);
        const mappings = await readPacks(iconDirectory);
        const view = await prepareView(loaded, vendor, mappings, `${origin}${prefix}`);
        state = { path, hash: loaded.hash, bytes: loaded.bytes, pages: loaded.pages, ...view };
      } catch (error) {
        state = { path, error: error.message, diagnostics: [], missing: [] };
      }
      broadcast();
      return state;
    });
    return update;
  }
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'");
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) {
        response.writeHead(403).end("Request origin denied"); return;
      }
      const url = new URL(request.url, origin);
      if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end("Not found"); return; }
      const route = decodeURIComponent(url.pathname.slice(prefix.length));
      if (request.method === "GET" && route === "state") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(state)); return;
      }
      if (request.method === "GET" && route === "events") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Connection": "keep-alive" });
        response.write("data: connected\n\n");
        clients.add(response);
        response.on("close", () => clients.delete(response));
        return;
      }
      if (request.method === "POST") {
        if (request.headers.origin !== origin || request.headers["content-type"] !== "application/json") {
          response.writeHead(403).end("Same-origin JSON required"); return;
        }
        let result;
        if (route === "refresh") result = await refresh();
        else if (route === "import") {
          if (importPending) throw new Error("Another icon import is in progress");
          importPending = true;
          try { result = await importPack(iconDirectory, await readJson(request)); await refresh(); }
          finally { importPending = false; }
        } else { response.writeHead(404).end("Not found"); return; }
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result)); return;
      }
      if (request.method !== "GET") { response.writeHead(405).end("Method not allowed"); return; }
      let data;
      if (route.startsWith("vendor/")) data = await vendor.read(route.slice(7));
      else if (route.startsWith("icons/")) {
        if (!/^[\w.-]+\/[\w.-]+\.(svg|png)$/i.test(route.slice(6))) throw new Error("Invalid icon path");
        data = await safeAsset(iconDirectory, route.slice(6));
      } else {
        const ui = { "": "index.html", "setup.js": "setup.js", "viewer.js": "viewer.js", "viewer.css": "viewer.css" }[route];
        if (!ui) { response.writeHead(404).end("Not found"); return; }
        data = await safeAsset(join(extensionRoot, "ui"), ui);
      }
      response.setHeader("Content-Type", mime[extname(route || "index.html")] || "application/octet-stream");
      response.end(data);
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.code === "ENOENT" ? 404 : 400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  server.requestTimeout = 30_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  await refresh();
  try {
    const file = await import("./documents.mjs").then(module => module.resolveDocument(root, path));
    for (const directory of new Set([dirname(file), dirname(resolve(root, path))])) {
      const watcher = watch(directory, () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (!closed) void refresh(); }, 120);
      });
      watcher.on("error", error => {
        state = { path, error: `File watcher failed: ${error.message}. Use Refresh.`, diagnostics: [], missing: [] };
        broadcast();
      });
      watchers.push(watcher);
    }
  } catch (error) {
    state = { ...state, error: state.error || `Unable to watch file: ${error.message}` };
  }
  return {
    url: `${origin}${prefix}`, refresh,
    info: () => { const { xml, ...info } = state; return info; },
    async close() {
      closed = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
