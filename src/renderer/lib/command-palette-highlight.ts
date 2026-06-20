export interface CommandPaletteHighlightSegment {
  text: string;
  highlight: boolean;
}

export function normalizeCommandPalettePreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildCommandPaletteHighlightRegex(terms: string[]): RegExp | null {
  const normalizedTerms = Array.from(new Set(
    terms
      .map((term) => term.trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length),
  ));

  if (normalizedTerms.length === 0) {
    return null;
  }

  return new RegExp(`(${normalizedTerms.map(escapeRegExp).join("|")})`, "gi");
}

export function buildCommandPaletteHighlightSegments(
  excerpt: string,
  regex: RegExp | null,
): CommandPaletteHighlightSegment[] {
  if (!regex) {
    return [{ text: excerpt, highlight: false }];
  }

  const segments: CommandPaletteHighlightSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  regex.lastIndex = 0;

  while ((match = regex.exec(excerpt)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: excerpt.slice(lastIndex, match.index),
        highlight: false,
      });
    }

    segments.push({
      text: match[0],
      highlight: true,
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < excerpt.length) {
    segments.push({
      text: excerpt.slice(lastIndex),
      highlight: false,
    });
  }

  return segments.length > 0 ? segments : [{ text: excerpt, highlight: false }];
}

export function buildCommandPaletteHighlightedSegments(
  text: string,
  terms: string[],
): CommandPaletteHighlightSegment[] | null {
  const normalizedText = normalizeCommandPalettePreviewText(text);
  if (!normalizedText) {
    return null;
  }

  const regex = buildCommandPaletteHighlightRegex(terms);
  if (!regex) {
    return null;
  }

  regex.lastIndex = 0;
  if (!regex.test(normalizedText)) {
    return null;
  }

  return buildCommandPaletteHighlightSegments(normalizedText, buildCommandPaletteHighlightRegex(terms));
}

export function buildCommandPaletteQueryHighlightPreview(
  excerpt: string,
  query: string,
): { excerpt: string; segments: CommandPaletteHighlightSegment[] } | null {
  const normalizedExcerpt = normalizeCommandPalettePreviewText(excerpt);
  if (!normalizedExcerpt) {
    return null;
  }

  const terms = Array.from(new Set(
    query
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .sort((left, right) => right.length - left.length),
  ));
  if (terms.length === 0) {
    return {
      excerpt: normalizedExcerpt,
      segments: [{ text: normalizedExcerpt, highlight: false }],
    };
  }

  return {
    excerpt: normalizedExcerpt,
    segments: buildCommandPaletteHighlightSegments(
      normalizedExcerpt,
      buildCommandPaletteHighlightRegex(terms),
    ),
  };
}
