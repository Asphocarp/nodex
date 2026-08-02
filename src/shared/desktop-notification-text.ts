const DEFAULT_NOTIFICATION_TEXT_LIMIT = 512;
const HTML_ENTITY_REPLACEMENTS: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    const normalizedToken = token.toLowerCase();
    if (normalizedToken.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedToken.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (normalizedToken.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedToken.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return HTML_ENTITY_REPLACEMENTS[normalizedToken] ?? entity;
  });
}

function stripHtmlTags(value: string): string {
  let output = "";
  let insideTag = false;
  for (const character of value) {
    if (character === "<") {
      insideTag = true;
      output += " ";
      continue;
    }
    if (character === ">" && insideTag) {
      insideTag = false;
      output += " ";
      continue;
    }
    if (!insideTag) output += character;
  }
  return output;
}

function stripMarkdownDecoration(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/(^|\s)(?:#{1,6}|>|[-*+]\s|\d+\.\s)/gm, "$1")
    .replace(/([*_~`])+/g, "");
}

export function toDesktopNotificationPlainText(
  value: string | null | undefined,
  maxLength = DEFAULT_NOTIFICATION_TEXT_LIMIT,
): string {
  if (typeof value !== "string" || maxLength <= 0) return "";
  const withoutExecutableBlocks = value.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
  const plainText = decodeHtmlEntities(stripMarkdownDecoration(stripHtmlTags(
    withoutExecutableBlocks.replace(/<br\s*\/?\s*>/gi, " "),
  )))
    .replace(/\s+/g, " ")
    .trim();
  const codePoints = Array.from(plainText);
  if (codePoints.length <= maxLength) return plainText;
  return `${codePoints.slice(0, Math.max(0, maxLength - 1)).join("").trimEnd()}…`;
}
