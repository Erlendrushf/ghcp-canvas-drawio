import { access } from "node:fs/promises";
import { join } from "node:path";
import { elements, serialize } from "./xml.mjs";
import { validateIcon } from "./icon-packs.mjs";

export async function prepareView(loaded, vendorDirectory, mappings, prefix) {
  const diagnostics = new Set(), missing = new Set();
  const document = loaded.document.cloneNode(true);
  async function resource(original) {
    if (Object.hasOwn(mappings, original)) return `${prefix}icons/${mappings[original]}`;
    if (/^data:image\/(png|svg\+xml)(;base64)?,/i.test(original)) {
      try {
        const [header, data] = original.split(",");
        const svg = header.includes("svg");
        const bytes = Buffer.from(svg && !header.includes("base64") ? decodeURIComponent(original.slice(original.indexOf(",") + 1)) : data, svg && !header.includes("base64") ? "utf8" : "base64");
        validateIcon(bytes, svg ? "embedded.svg" : "embedded.png");
        return original;
      } catch (error) { diagnostics.add(`Blocked embedded image: ${error.message}`); return ""; }
    }
    let path = original;
    if (/^https?:/i.test(path)) {
      const url = new URL(path);
      if (!["app.diagrams.net", "viewer.diagrams.net", "embed.diagrams.net"].includes(url.hostname)) path = "";
      else path = url.pathname.replace(/^\//, "");
    }
    path = path.replace(/^\.\//, "");
    if (/^(img\/lib\/|images\/|mxgraph\/images\/)/.test(path) && !/[\\?#]/.test(path) && !path.split("/").includes("..")) {
      try {
        if (typeof vendorDirectory === "string") await access(join(vendorDirectory, path));
        else if (!await vendorDirectory.has(path)) throw Object.assign(new Error("Missing vendor asset"), { code: "ENOENT" });
        return `${prefix}vendor/${path}`;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    missing.add(original);
    diagnostics.add(`Unresolved or blocked image: ${original.slice(0, 180)}`);
    return "";
  }
  for (const node of [document.documentElement, ...elements(document.documentElement)]) {
    if (node.getAttribute("math") === "1") {
      node.setAttribute("math", "0");
      diagnostics.add("Mathematical typesetting is not bundled");
    }
    if (node.hasAttribute("extFonts")) {
      node.removeAttribute("extFonts");
      diagnostics.add("External fonts are blocked; system fonts are used");
    }
    if (node.hasAttribute("backgroundImage")) {
      const background = JSON.parse(node.getAttribute("backgroundImage"));
      background.src = await resource(background.src || "");
      node.setAttribute("backgroundImage", JSON.stringify(background));
    }
    for (const attribute of Array.from(node.attributes)) {
      if (["link", "href"].includes(attribute.name) && !/^data:page\/id,/.test(attribute.value)) {
        node.removeAttribute(attribute.name);
        diagnostics.add("External diagram links are disabled");
      }
      if (attribute.name === "style") {
        let value = attribute.value;
        for (const match of value.matchAll(/(?:^|;)(image|resIcon)=([^;]*)(?=;|$)/g)) {
          value = value.replace(`${match[1]}=${match[2]}`, `${match[1]}=${await resource(match[2])}`);
        }
        node.setAttribute(attribute.name, value);
      }
      if (["value", "label"].includes(attribute.name) && /<(img|image)\b/i.test(attribute.value)) {
        let value = attribute.value;
        for (const match of value.matchAll(/\b(src|href)\s*=\s*["']([^"']*)["']/gi)) {
          value = value.replace(match[0], `${match[1]}="${await resource(match[2])}"`);
        }
        node.setAttribute(attribute.name, value);
      }
    }
  }
  return { xml: serialize(document), diagnostics: [...diagnostics], missing: [...missing] };
}
