import xmldom from "../assets/vendor/xmldom/lib/index.js";
const { DOMParser, XMLSerializer } = xmldom;

export function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("DTD and entity declarations are not supported");
  const errors = [];
  const document = new DOMParser({ onError: (level, message) => {
    errors.push(message);
    throw new Error("Malformed XML");
  } }).parseFromString(text, "application/xml");
  if (errors.length || !document.documentElement || document.childNodes.length === 0) throw new Error("Malformed XML");
  const roots = Array.from(document.childNodes).filter(node => node.nodeType === 1);
  if (roots.length !== 1) throw new Error("Expected one XML root");
  return document;
}
export const serialize = node => new XMLSerializer().serializeToString(node);
export const elements = node => Array.from(node.getElementsByTagName("*"));
