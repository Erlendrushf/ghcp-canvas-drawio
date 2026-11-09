import { realpath, stat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseXml, serialize } from "./xml.mjs";

export const LIMITS = Object.freeze({ file: 10 * 1024 ** 2, page: 20 * 1024 ** 2, document: 50 * 1024 ** 2, icon: 5 * 1024 ** 2, import: 50 * 1024 ** 2 });
export const hash = data => createHash("sha256").update(data).digest("hex");
export function checkSize(bytes, limit, label) {
  if (bytes > limit) throw new Error(`${label} exceeds ${limit} bytes`);
}
export async function resolveDocument(root, path) {
  if (!path || isAbsolute(path)) throw new Error("A workspace-relative file path is required");
  const base = await realpath(root);
  const file = await realpath(resolve(base, path));
  const child = relative(base, file);
  if (child === ".." || child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(child)) throw new Error("File is outside the workspace");
  if (![".drawio", ".dio", ".xml"].includes(extname(file).toLowerCase())) throw new Error("Unsupported file extension");
  if (!(await stat(file)).isFile()) throw new Error("Expected a regular file");
  return file;
}
export function normalizeDiagram(bytes) {
  checkSize(bytes.length, LIMITS.file, "Diagram file");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const document = parseXml(text);
  const root = document.documentElement;
  if (!["mxfile", "mxGraphModel"].includes(root.tagName)) throw new Error("Expected mxfile or mxGraphModel");
  const pages = root.tagName === "mxfile" ? Array.from(root.childNodes).filter(node => node.nodeType === 1) : [root];
  if (!pages.length || (root.tagName === "mxfile" && pages.some(page => page.tagName !== "diagram"))) throw new Error("Invalid diagram pages");
  let total = 0;
  const info = [];
  const ids = new Set();
  for (const [index, page] of pages.entries()) {
    const children = Array.from(page.childNodes).filter(node => node.nodeType === 1);
    if (root.tagName === "mxfile" && children.length > 1) throw new Error("Expected one model per page");
    let model = root.tagName === "mxGraphModel" ? root : children[0];
    if (!model) {
      const encoded = page.textContent.trim();
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error("Invalid Base64 page");
      const decoded = inflateRawSync(Buffer.from(encoded, "base64"), { maxOutputLength: LIMITS.page * 3 });
      const xml = decodeURIComponent(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
      checkSize(Buffer.byteLength(xml), LIMITS.page, "Decoded page");
      model = document.importNode(parseXml(xml).documentElement, true);
      while (page.firstChild) page.removeChild(page.firstChild);
      page.appendChild(model);
    }
    if (model.tagName !== "mxGraphModel") throw new Error("Invalid page model");
    const size = Buffer.byteLength(serialize(model));
    checkSize(size, LIMITS.page, "Decoded page");
    total += size;
    checkSize(total, LIMITS.document, "Decoded document");
    const id = page.getAttribute("id") || String(index);
    if (ids.has(id)) throw new Error("Duplicate page ID");
    ids.add(id);
    info.push({ id, name: page.getAttribute("name") || `Page ${index + 1}` });
  }
  return { document, pages: info };
}
export async function loadDocument(root, path) {
  const canonical = await resolveDocument(root, path);
  const handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let bytes;
  try {
    checkSize((await handle.stat()).size, LIMITS.file, "Diagram file");
    const chunks = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      checkSize(total, LIMITS.file, "Diagram file");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    bytes = Buffer.concat(chunks);
  } finally { await handle.close(); }
  const normalized = normalizeDiagram(bytes);
  return { ...normalized, canonical, path, bytes: bytes.length, hash: hash(bytes) };
}
