import { normalizeSearchText } from "./search-text";
import {
  buildCurrentPageKeySearchAliases,
  isExplicitPageKeySearch,
} from "../../shared/page-key";

export const PAGE_KEY_EXACT_SEARCH_SCORE = 1_000_000;
export const PAGE_KEY_PREFIX_SEARCH_SCORE = 900_000;

export interface PageKeySearchQuery {
  readonly normalizedQuery: string;
  readonly explicit: boolean;
  readonly candidate: string | null;
}

export interface PageKeySearchMatch {
  readonly kind: "exact" | "prefix";
  readonly score: number;
  readonly terms: string[];
}

interface CurrentPageKeyIndexEntry<T> {
  readonly id: string;
  readonly normalizedKey: string;
  readonly value: T;
}

export interface CurrentPageKeyIndex<T> {
  readonly exact: ReadonlyMap<string, readonly CurrentPageKeyIndexEntry<T>[]>;
  readonly sorted: readonly CurrentPageKeyIndexEntry<T>[];
}

export interface CurrentPageKeyIndexedHit<T> {
  readonly value: T;
  readonly match: PageKeySearchMatch;
}

export function buildCurrentPageKeyIndex<T>(
  values: readonly T[],
  readId: (value: T) => string,
  readPageKey: (value: T) => string | null | undefined,
): CurrentPageKeyIndex<T> {
  const exact = new Map<string, CurrentPageKeyIndexEntry<T>[]>();
  const sorted: CurrentPageKeyIndexEntry<T>[] = [];
  for (const value of values) {
    const pageKey = readPageKey(value);
    if (!pageKey) continue;
    const id = readId(value);
    for (const alias of buildCurrentPageKeySearchAliases(pageKey)) {
      const normalizedKey = normalizeSearchText(alias);
      const entry = { id, normalizedKey, value };
      const entries = exact.get(normalizedKey);
      if (entries) entries.push(entry);
      else exact.set(normalizedKey, [entry]);
      sorted.push(entry);
    }
  }
  sorted.sort((left, right) => {
    if (left.normalizedKey < right.normalizedKey) return -1;
    if (left.normalizedKey > right.normalizedKey) return 1;
    return left.id.localeCompare(right.id);
  });
  return { exact, sorted };
}

const lowerBoundCurrentPageKey = <T>(
  entries: readonly CurrentPageKeyIndexEntry<T>[],
  candidate: string,
): number => {
  let start = 0;
  let end = entries.length;
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    if ((entries[middle]?.normalizedKey ?? "") < candidate) start = middle + 1;
    else end = middle;
  }
  return start;
};

/** Looks up exact and prefix evidence without scanning unrelated Page documents. */
export function searchCurrentPageKeyIndex<T>(
  index: CurrentPageKeyIndex<T>,
  query: PageKeySearchQuery,
  limit = Number.POSITIVE_INFINITY,
): readonly CurrentPageKeyIndexedHit<T>[] {
  const candidate = query.candidate;
  if (!candidate || limit <= 0) return [];
  const exact = index.exact.get(candidate);
  const hits: CurrentPageKeyIndexedHit<T>[] = (exact ?? [])
    .slice(0, limit)
    .map((entry) => ({
      value: entry.value,
      match: {
        kind: "exact",
        score: PAGE_KEY_EXACT_SEARCH_SCORE,
        terms: [candidate],
      },
    }));
  if (hits.length >= limit) return hits;

  const seen = new Set((exact ?? []).map((entry) => entry.id));
  for (
    let indexOffset = lowerBoundCurrentPageKey(index.sorted, candidate);
    indexOffset < index.sorted.length && hits.length < limit;
    indexOffset += 1
  ) {
    const entry = index.sorted[indexOffset];
    if (!entry || !entry.normalizedKey.startsWith(candidate)) break;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    hits.push({
      value: entry.value,
      match: {
        kind: "prefix",
        score: PAGE_KEY_PREFIX_SEARCH_SCORE,
        terms: [candidate],
      },
    });
  }
  return hits;
}

/**
 * Page keys are a whole-query lookup. A leading `#` makes that intent
 * explicit; mixed-token queries remain ordinary text search.
 */
export const parsePageKeySearchQuery = (query: string): PageKeySearchQuery => {
  const normalizedQuery = normalizeSearchText(query);
  const explicit = isExplicitPageKeySearch(query);
  const candidate = explicit ? normalizedQuery.slice(1) : normalizedQuery;
  const isSingleCandidate = candidate.length > 0
    && !candidate.startsWith("#")
    && !candidate.includes(" ");
  return {
    normalizedQuery,
    explicit,
    candidate: isSingleCandidate ? candidate : null,
  };
};

export const matchPageKeySearchQuery = (
  pageKey: string | null | undefined,
  query: PageKeySearchQuery,
): PageKeySearchMatch | null => {
  if (!pageKey || !query.candidate) return null;
  const candidate = query.candidate;
  const normalizedAliases = buildCurrentPageKeySearchAliases(pageKey)
    .map(normalizeSearchText);
  if (normalizedAliases.includes(candidate)) {
    return {
      kind: "exact",
      score: PAGE_KEY_EXACT_SEARCH_SCORE,
      terms: [candidate],
    };
  }
  if (normalizedAliases.some((alias) => alias.startsWith(candidate))) {
    return {
      kind: "prefix",
      score: PAGE_KEY_PREFIX_SEARCH_SCORE,
      terms: [candidate],
    };
  }
  return null;
};
