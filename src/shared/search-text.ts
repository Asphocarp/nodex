export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

export function matchesSearchTokens(searchableText: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  if (!searchableText) return false;
  return tokens.every((token) => searchableText.includes(token));
}

export function resolveFuzzyThreshold(term: string): number {
  if (term.length <= 3) return 0;
  if (term.length <= 5) return 0.1;
  return 0.2;
}
