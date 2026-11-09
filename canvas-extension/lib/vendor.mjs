import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import { join, relative, isAbsolute } from "node:path";

const digest = data => createHash("sha256").update(data).digest("hex");
const validPath = path => typeof path === "string" && path.length > 0 &&
  !path.startsWith("/") && !/[\\:\0]/.test(path) && !path.split("/").some(part => !part || part === "." || part === "..");
const cache = new Map();

export async function loadVendor(directory) {
  if (!cache.has(directory)) cache.set(directory, readVendor(directory));
  return cache.get(directory);
}

async function readVendor(directory) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(directory, "bundle.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    async function filePath(path) {
      if (!validPath(path)) throw new Error("Invalid vendor asset path");
      const root = await realpath(directory), file = await realpath(join(directory, path));
      const child = relative(root, file);
      if (child.startsWith("..") || isAbsolute(child) || !(await stat(file)).isFile()) {
        throw new Error("Vendor asset outside allowed directory");
      }
      return file;
    }
    return {
      has: async path => {
        if (!validPath(path)) return false;
        try { await filePath(path); return true; }
        catch (error) { if (error.code === "ENOENT") return false; throw error; }
      },
      read: async path => readFile(await filePath(path))
    };
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.chunks) || manifest.chunks.length > 10 ||
      !Number.isSafeInteger(manifest.decodedBytes) || manifest.decodedBytes <= 0 ||
      manifest.decodedBytes > 24 * 1024 ** 2) throw new Error("Invalid vendor bundle manifest");
  const chunks = [];
  for (const chunk of manifest.chunks) {
    if (!/^bundle-\d+\.br$/.test(chunk.path) || !/^[a-f0-9]{64}$/.test(chunk.sha256)) {
      throw new Error("Invalid vendor bundle chunk");
    }
    const data = await readFile(join(directory, chunk.path));
    if (data.length !== chunk.bytes || data.length > 900_000 || digest(data) !== chunk.sha256) {
      throw new Error(`Vendor bundle checksum mismatch: ${chunk.path}`);
    }
    chunks.push(data);
  }
  const data = brotliDecompressSync(Buffer.concat(chunks), { maxOutputLength: manifest.decodedBytes });
  if (data.length !== manifest.decodedBytes || data.length < 4) throw new Error("Invalid vendor bundle length");
  const headerBytes = data.readUInt32BE();
  if (headerBytes > 1024 ** 2 || headerBytes + 4 > data.length) throw new Error("Invalid vendor bundle header");
  const entries = JSON.parse(data.subarray(4, 4 + headerBytes).toString("utf8"));
  if (!Array.isArray(entries) || entries.length > 3000) throw new Error("Invalid vendor bundle inventory");
  const files = new Map();
  let offset = 4 + headerBytes;
  for (const entry of entries) {
    if (!validPath(entry.path) || files.has(entry.path) || !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0 || offset + entry.bytes > data.length) throw new Error("Invalid vendor bundle entry");
    files.set(entry.path, data.subarray(offset, offset + entry.bytes));
    offset += entry.bytes;
  }
  if (offset !== data.length) throw new Error("Unexpected vendor bundle trailing bytes");
  return {
    has: async path => files.has(path),
    read: async path => {
      if (!files.has(path)) throw Object.assign(new Error(`Vendor asset not found: ${path}`), { code: "ENOENT" });
      return files.get(path);
    }
  };
}
