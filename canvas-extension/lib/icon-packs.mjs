import { mkdir, readFile, readdir, writeFile, rename, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";
import { parseXml, elements } from "./xml.mjs";
import { LIMITS, checkSize, hash } from "./documents.mjs";

const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;
const svgTags = new Set("svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask use symbol pattern".split(" "));
export function validateIcon(data, filename) {
  checkSize(data.length, LIMITS.icon, "Icon");
  if (/\.png$/i.test(filename)) {
    if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || data.toString("ascii", 12, 16) !== "IHDR") throw new Error("Invalid PNG");
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    if (!width || !height || width * height > 16_777_216) throw new Error("PNG dimensions exceed supported area");
    let offset = 8, imageData = false, ended = false;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset), end = offset + length + 12;
      if (end > data.length) throw new Error("Truncated PNG chunk");
      const type = data.toString("ascii", offset + 4, offset + 8);
      if (crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw new Error("Invalid PNG checksum");
      if (type === "IDAT") imageData = true;
      if (type === "IEND") { ended = length === 0 && end === data.length; break; }
      offset = end;
    }
    if (!ended || !imageData) throw new Error("Incomplete PNG image");
  } else if (/\.svg$/i.test(filename)) {
    const xml = parseXml(new TextDecoder("utf-8", { fatal: true }).decode(data));
    if (xml.documentElement.tagName !== "svg") throw new Error("Invalid SVG");
    for (const node of [xml.documentElement, ...elements(xml.documentElement)]) {
      if (!svgTags.has(node.tagName)) throw new Error(`Unsupported SVG element: ${node.tagName}`);
      for (const attribute of Array.from(node.attributes)) {
        const key = attribute.name.toLowerCase(), value = attribute.value;
        if (key.startsWith("on") || key === "style" || key === "xml:base") throw new Error(`Unsafe SVG attribute: ${key}`);
        if ((key === "href" || key.endsWith(":href")) && !/^#[A-Za-z0-9_.:-]+$/.test(value)) throw new Error("External SVG reference");
        if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z0-9_.:-]+\)$/.test(value)) throw new Error("External SVG URL");
        if (/javascript:|data:|https?:|@import/i.test(value) && !key.startsWith("xmlns")) throw new Error("External SVG content");
      }
    }
  } else throw new Error("Only SVG and PNG icons are supported");
}
export async function readPacks(directory) {
  const mappings = Object.create(null);
  const directoryInfo = await lstat(directory).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (directoryInfo?.isSymbolicLink()) throw new Error("Symlinked icon directory");
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("Symlinked icon packs are not supported");
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name, "manifest.json");
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Symlinked icon manifest");
    const pack = JSON.parse(await readFile(path, "utf8"));
    for (const file of pack.files) {
      if (!namePattern.test(file.name)) throw new Error("Invalid icon manifest filename");
      const location = join(directory, entry.name, file.name);
      const info = await lstat(location);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid icon file");
      checkSize(info.size, LIMITS.icon, "Icon");
      const bytes = await readFile(location);
      if (hash(bytes) !== file.sha256) throw new Error("Icon checksum mismatch");
      validateIcon(bytes, file.name);
      for (const alias of file.aliases) {
        if (Object.hasOwn(mappings, alias)) throw new Error(`Duplicate resource mapping: ${alias}`);
        mappings[alias] = `${entry.name}/${file.name}`;
      }
    }
  }
  return mappings;
}
export async function importPack(directory, input) {
  if (!input || typeof input.name !== "string" || !namePattern.test(input.name) || !Array.isArray(input.files) || !input.files.length || input.files.length > 500) throw new Error("Invalid icon pack");
  if (typeof input.provenance !== "string" || !input.provenance.trim() || input.provenance.length > 4096) throw new Error("Icon source/rights information is required");
  const existing = await readPacks(directory);
  const names = new Set(), aliases = new Set();
  let total = 0;
  const files = input.files.map(file => {
    if (!file || typeof file.name !== "string" || !namePattern.test(file.name) || file.name === "manifest.json" || names.has(file.name) || !Array.isArray(file.aliases) || !file.aliases.length || file.aliases.length > 100) throw new Error("Invalid or duplicate icon filename/mapping");
    names.add(file.name);
    if (typeof file.data !== "string" || file.data.length > Math.ceil(LIMITS.icon / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error("Invalid icon encoding");
    const bytes = Buffer.from(file.data, "base64");
    total += bytes.length;
    checkSize(total, LIMITS.import, "Icon import");
    validateIcon(bytes, file.name);
    for (const alias of file.aliases) {
      if (typeof alias !== "string" || !alias || alias.length > 2048 || aliases.has(alias) || Object.hasOwn(existing, alias)) throw new Error("Invalid or duplicate resource mapping");
      aliases.add(alias);
    }
    return { ...file, bytes };
  });
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Symlinked icon directory");
  const stage = join(directory, `.import-${randomUUID()}`);
  const target = join(directory, input.name);
  await mkdir(stage);
  let reserved = false;
  try {
    for (const file of files) await writeFile(join(stage, file.name), file.bytes, { flag: "wx" });
    await writeFile(join(stage, "manifest.json"), JSON.stringify({
      version: 1, provenance: input.provenance,
      files: files.map(file => ({ name: file.name, aliases: file.aliases, sha256: hash(file.bytes) }))
    }, null, 2) + "\n", { flag: "wx" });
    await mkdir(target);
    reserved = true;
    await rename(stage, target);
    reserved = false;
  } finally {
    await rm(stage, { recursive: true, force: true });
    if (reserved) await rm(target, { recursive: true, force: true });
  }
  return { name: input.name, count: files.length };
}
