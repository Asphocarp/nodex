export interface CommandPaletteHighlightSegment {
  text: string;
  highlight: boolean;
}

export type CommandPaletteCharacterHighlightMode = "substring" | "fuzzy";

export function normalizeCommandPalettePreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findCodePointSubstring(
  text: readonly string[],
  query: readonly string[],
): number {
  if (query.length === 0 || query.length > text.length) return -1;

  for (let start = 0; start <= text.length - query.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < query.length; offset += 1) {
      if (text[start + offset]?.toLocaleLowerCase() === query[offset]?.toLocaleLowerCase()) continue;
      matches = false;
      break;
    }
    if (matches) return start;
  }

  return -1;
}

function buildSegmentsFromMatchedIndexes(
  characters: readonly string[],
  matchedIndexes: ReadonlySet<number>,
): CommandPaletteHighlightSegment[] {
  const segments: CommandPaletteHighlightSegment[] = [];
  characters.forEach((character, index) => {
    const highlight = matchedIndexes.has(index);
    const previous = segments.at(-1);
    if (previous?.highlight === highlight) {
      previous.text += character;
      return;
    }
    segments.push({ text: character, highlight });
  });
  return segments;
}

export function buildCommandPaletteCharacterHighlightSegments(
  text: string,
  query: string,
  mode: CommandPaletteCharacterHighlightMode = "substring",
): CommandPaletteHighlightSegment[] {
  const characters = Array.from(text);
  const queryCharacters = Array.from(query.trim());
  if (queryCharacters.length === 0) {
    return [{ text, highlight: false }];
  }

  const substringStart = findCodePointSubstring(characters, queryCharacters);
  if (substringStart >= 0) {
    const matchedIndexes = new Set(
      queryCharacters.flatMap((character, offset) => (
        /\s/u.test(character) ? [] : [substringStart + offset]
      )),
    );
    return buildSegmentsFromMatchedIndexes(characters, matchedIndexes);
  }
  if (mode === "substring") {
    return [{ text, highlight: false }];
  }

  const matchedIndexes = new Set<number>();
  let queryIndex = 0;
  characters.forEach((character, index) => {
    if (
      queryIndex < queryCharacters.length
      && character.toLocaleLowerCase() === queryCharacters[queryIndex]?.toLocaleLowerCase()
    ) {
      matchedIndexes.add(index);
      queryIndex += 1;
    }
  });

  if (queryIndex !== queryCharacters.length) {
    return [{ text, highlight: false }];
  }
  return buildSegmentsFromMatchedIndexes(characters, matchedIndexes);
}

export function buildCommandPaletteTokenHighlightSegments(
  text: string,
  query: string,
): CommandPaletteHighlightSegment[] {
  const characters = Array.from(text);
  const phrase = buildCommandPaletteCharacterHighlightSegments(text, query, "substring");
  if (phrase.some((segment) => segment.highlight)) return phrase;

  const matchedIndexes = new Set<number>();
  const tokens = Array.from(new Set(query.trim().split(/\s+/).filter(Boolean)));
  tokens.forEach((token) => {
    const tokenCharacters = Array.from(token);
    let searchFrom = 0;
    while (searchFrom <= characters.length - tokenCharacters.length) {
      const start = findCodePointSubstring(characters.slice(searchFrom), tokenCharacters);
      if (start < 0) break;
      const absoluteStart = searchFrom + start;
      tokenCharacters.forEach((_, offset) => matchedIndexes.add(absoluteStart + offset));
      searchFrom = absoluteStart + tokenCharacters.length;
    }
  });

  if (matchedIndexes.size === 0) return [{ text, highlight: false }];
  return buildSegmentsFromMatchedIndexes(characters, matchedIndexes);
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

  if (!query.trim()) {
    return {
      excerpt: normalizedExcerpt,
      segments: [{ text: normalizedExcerpt, highlight: false }],
    };
  }

  return {
    excerpt: normalizedExcerpt,
    segments: buildCommandPaletteTokenHighlightSegments(normalizedExcerpt, query),
  };
}
