import { decodeXmlCharacterReferences } from "../xml-character-references";

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

export function getXmlAttr(attrs: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedName}="([^"]*)"`);
  const match = attrs.match(pattern);
  if (!match) return undefined;

  return decodeXmlCharacterReferences(match[1]);
}

export function parseXmlAttrs(attrs: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(attrs)) !== null) {
    const name = match[1];
    const value = match[2];
    if (!name || value === undefined) continue;
    result[name] = decodeXmlCharacterReferences(value);
  }

  return result;
}
