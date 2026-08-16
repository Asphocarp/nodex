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
const MAX_TAG_NAME_BYTES = 256;

/** Presentation-only preview. Core independently parses the durable rich title. */
export const previewTaskShorthand = (
  title: string,
): TaskShorthandPreview | null => {
  if (!/^[0-3]/u.test(title)) return null;
  const priority = Number(title[0]) as 0 | 1 | 2 | 3;
  let cursor = 1;
  let estimate: TaskShorthandPreview["estimate"] = null;
  const upper = title.slice(cursor).toUpperCase();
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
      const name = part.trim().normalize("NFC");
      if (
        !name
        || new TextEncoder().encode(name).length > MAX_TAG_NAME_BYTES
        || /[\u0000-\u001f\u007f]/u.test(name)
      ) return null;
      if (!seen.has(name)) tags.push(name);
      seen.add(name);
    }
    if (tags.length > MAX_TAGS) return null;
    cursor = close + 1;
  }
  if (title[cursor] === ":") return null;
  const separator = title.slice(cursor).match(/^\s+/u)?.[0];
  if (!separator) return null;
  cursor += separator.length;
  if (
    new TextEncoder().encode(title.slice(0, cursor)).length > MAX_PREFIX_BYTES
    || !title.slice(cursor).trim()
  ) return null;

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
