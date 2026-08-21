import { canonicalizeTagName } from "../../shared/database-identities";
import { MAX_DATA_SOURCE_OPTION_NAME_LENGTH } from "../../shared/data-source-option-registry";

export interface TaskShorthandPreview {
  readonly priority: 0 | 1 | 2 | 3;
  readonly estimate: "XS" | "S" | "M" | "L" | "XL" | null;
  readonly tags: readonly string[];
  readonly consumedCharacters: number;
  readonly title: string;
  readonly compactLabel: string;
}

const MAX_PREFIX_BYTES = 1_024;
const MAX_TAGS = 32;
const LEADING_UNICODE_WHITESPACE = /^\p{White_Space}+/u;
const UNICODE_CONTROL = /\p{Cc}/u;
const NON_UNICODE_WHITESPACE = /[^\p{White_Space}]/u;

const toAsciiUpperCase = (value: string): string =>
  value.replace(/[a-z]/g, (character) => character.toUpperCase());

/** Presentation-only preview of the leading ordinary-text authority run. */
export const previewTaskShorthandTextRun = (
  title: string,
  hasFollowingRichTitle = false,
): TaskShorthandPreview | null => {
  if (!/^[0-3]/u.test(title)) return null;
  const priority = Number(title[0]) as 0 | 1 | 2 | 3;
  let cursor = 1;
  let estimate: TaskShorthandPreview["estimate"] = null;
  const upper = toAsciiUpperCase(title.slice(cursor, cursor + 2));
  for (const candidate of ["XL", "XS", "S", "M", "L"] as const) {
    if (!upper.startsWith(candidate)) continue;
    estimate = candidate;
    cursor += candidate.length;
    break;
  }

  const tags: string[] = [];
  if (title[cursor] === "(") {
    const close = title.indexOf(")", cursor + 1);
    if (close < 0) return null;
    const raw = title.slice(cursor + 1, close);
    if (raw.includes("(") || raw.includes(")")) return null;
    const seen = new Set<string>();
    for (const part of raw.split(",")) {
      let name: string;
      try {
        name = canonicalizeTagName(part);
      } catch {
        return null;
      }
      if (
        new TextEncoder().encode(name).length > MAX_DATA_SOURCE_OPTION_NAME_LENGTH ||
        UNICODE_CONTROL.test(name)
      )
        return null;
      if (!seen.has(name)) tags.push(name);
      seen.add(name);
    }
    if (tags.length > MAX_TAGS) return null;
    cursor = close + 1;
  }
  if (title[cursor] === ":") return null;
  const separator = title.slice(cursor).match(LEADING_UNICODE_WHITESPACE)?.[0];
  if (!separator) return null;
  cursor += separator.length;
  if (
    new TextEncoder().encode(title.slice(0, cursor)).length > MAX_PREFIX_BYTES ||
    (!NON_UNICODE_WHITESPACE.test(title.slice(cursor)) && !hasFollowingRichTitle)
  )
    return null;

  const details = [
    `P${priority}`,
    estimate,
    ...tags.slice(0, 2),
    ...(tags.length > 2 ? [`+${tags.length - 2}`] : []),
  ].filter((value): value is string => Boolean(value));
  return {
    priority,
    estimate,
    tags,
    consumedCharacters: cursor,
    title: title.slice(cursor),
    compactLabel: details.join(" · "),
  };
};

/** Presentation-only preview. Core independently parses the durable rich title. */
export const previewTaskShorthand = (title: string): TaskShorthandPreview | null =>
  previewTaskShorthandTextRun(title);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const blockNoteLinkHasTitle = (value: Record<string, unknown>): boolean =>
  Array.isArray(value.content) &&
  value.content.some(
    (item) =>
      isRecord(item) &&
      item.type === "text" &&
      typeof item.text === "string" &&
      NON_UNICODE_WHITESPACE.test(item.text),
  );

const SUPPORTED_RICH_TITLE_ATOMS = new Set(["threadMention", "pageMention", "dateMention"]);

/** Adapts BlockNote inline content without flattening across rich authority boundaries. */
export const previewTaskShorthandInlineContent = (
  content: unknown,
): TaskShorthandPreview | null => {
  if (!Array.isArray(content)) return null;
  let leadingText = "";
  let boundary = content.length;
  for (const [index, item] of content.entries()) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      leadingText += item.text;
      continue;
    }
    boundary = index;
    break;
  }
  if (boundary === content.length) return previewTaskShorthand(leadingText);

  let hasFollowingRichTitle = false;
  for (const item of content.slice(boundary)) {
    if (!isRecord(item) || typeof item.type !== "string") return null;
    if (item.type === "text" && typeof item.text === "string") {
      hasFollowingRichTitle ||= NON_UNICODE_WHITESPACE.test(item.text);
      continue;
    }
    if (item.type === "link") {
      if (!Array.isArray(item.content)) return null;
      hasFollowingRichTitle ||= blockNoteLinkHasTitle(item);
      continue;
    }
    if (item.type === "linebreak") continue;
    if (!SUPPORTED_RICH_TITLE_ATOMS.has(item.type)) return null;
    hasFollowingRichTitle = true;
  }
  return previewTaskShorthandTextRun(leadingText, hasFollowingRichTitle);
};
