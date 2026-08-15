import type {
  PageReferenceCandidate,
  PageReferenceIntent,
  PageReferenceSelection,
} from "./types";
import type { SearchResult } from "minisearch";
import type { MentionSuggestionMatch } from "../nfm/mention-suggestion-model";
import {
  buildCommandPaletteCharacterHighlightSegments,
  buildCommandPaletteHighlightedSegments,
  buildSearchTermHighlightPreview,
  type CommandPaletteHighlightSegment,
} from "../command-palette-highlight";
import {
  collectPageSearchMatchedTerms,
  createPageSearchMiniSearch,
  searchPageSearchMiniSearch,
  type PageSearchDocument,
} from "../page-search";

export interface PageReferenceCandidatePresentation {
  readonly candidate: PageReferenceCandidate;
  readonly detail: string | null;
  readonly titleSegments: readonly CommandPaletteHighlightSegment[] | null;
  readonly detailSegments: readonly CommandPaletteHighlightSegment[] | null;
  readonly match: MentionSuggestionMatch;
}

function normalizeCandidateText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function classifyPageCandidateMatch(
  candidate: PageReferenceCandidate,
  query: string,
  searchResult: SearchResult | null,
): MentionSuggestionMatch {
  const normalizedQuery = normalizeCandidateText(query);
  if (!normalizedQuery) return "recent";

  const title = normalizeCandidateText(candidate.title);
  if (title === normalizedQuery) return "exact_title";
  if (normalizeCandidateText(candidate.pageKey ?? "").includes(normalizedQuery)) {
    return "page_key";
  }
  if (title.startsWith(normalizedQuery)) return "prefix_title";
  if (title.includes(normalizedQuery)) return "title";
  if (
    searchResult
    && collectPageSearchMatchedTerms(searchResult, "title").length > 0
  ) {
    return "title";
  }
  return "content";
}

function highlightedTitle(
  title: string,
  query: string,
  searchResult: SearchResult | null,
): readonly CommandPaletteHighlightSegment[] | null {
  if (!query.trim()) return null;
  const matchedTerms = searchResult
    ? collectPageSearchMatchedTerms(searchResult, "title")
    : [];
  const indexedSegments = buildCommandPaletteHighlightedSegments(
    title,
    matchedTerms,
  );
  if (indexedSegments) return indexedSegments;

  const segments = buildCommandPaletteCharacterHighlightSegments(title, query, "fuzzy");
  return segments.some(({ highlight }) => highlight) ? segments : null;
}

function candidateSearchDocument(
  candidate: PageReferenceCandidate,
): PageSearchDocument {
  return {
    id: candidate.pageId,
    title: candidate.title,
    description: candidate.matchExcerpt ?? "",
    tags: "",
    assignee: "",
    columnName: "",
    projectName: "",
    pageId: candidate.pageId,
  };
}

function indexCandidateMatches(
  candidates: readonly PageReferenceCandidate[],
  query: string,
): ReadonlyMap<string, SearchResult> {
  if (!query.trim() || candidates.length === 0) return new Map();

  const index = createPageSearchMiniSearch();
  index.addAll(candidates.map(candidateSearchDocument));
  return new Map(
    searchPageSearchMiniSearch(index, query).map((result) => [
      String(result.id),
      result,
    ]),
  );
}

/** Derives only the context needed to explain or disambiguate each Page row. */
export function presentPageReferenceCandidates(
  candidates: readonly PageReferenceCandidate[],
  query: string,
  options: { readonly rank?: boolean } = {},
): PageReferenceCandidatePresentation[] {
  const titleCounts = new Map<string, number>();
  const titleLocationCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const title = normalizeCandidateText(candidate.title || "Untitled");
    const titleLocation = `${title}\u0000${normalizeCandidateText(candidate.locationLabel)}`;
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    titleLocationCounts.set(
      titleLocation,
      (titleLocationCounts.get(titleLocation) ?? 0) + 1,
    );
  }

  const indexedMatches = indexCandidateMatches(candidates, query);
  const orderedCandidates = options.rank
    ? candidates
        .map((candidate, sourceOrder) => ({
          candidate,
          sourceOrder,
          score: indexedMatches.get(candidate.pageId)?.score ?? 0,
        }))
        .sort((left, right) => (
          right.score - left.score || left.sourceOrder - right.sourceOrder
        ))
        .map(({ candidate }) => candidate)
    : candidates;

  return orderedCandidates.map((candidate) => {
    const searchResult = indexedMatches.get(candidate.pageId) ?? null;
    const match = classifyPageCandidateMatch(candidate, query, searchResult);
    const title = candidate.title || "Untitled";
    const titleSegments = highlightedTitle(title, query, searchResult);
    if (match === "content" && candidate.matchExcerpt) {
      const indexedTerms = searchResult
        ? collectPageSearchMatchedTerms(searchResult, "description")
        : [];
      const preview = buildSearchTermHighlightPreview(
        candidate.matchExcerpt,
        indexedTerms.length > 0
          ? indexedTerms
          : query.trim().split(/\s+/).filter(Boolean),
        { maxCharacters: 88, leadingContextCharacters: 18 },
      );
      return {
        candidate,
        match,
        titleSegments,
        detail: preview?.excerpt ?? null,
        detailSegments: preview?.segments ?? null,
      };
    }
    if (match === "page_key") {
      const detail = candidate.pageKey;
      return {
        candidate,
        match,
        titleSegments,
        detail,
        detailSegments: detail
          ? buildCommandPaletteCharacterHighlightSegments(detail, query)
          : null,
      };
    }

    const normalizedTitle = normalizeCandidateText(title);
    if ((titleCounts.get(normalizedTitle) ?? 0) < 2) {
      return {
        candidate,
        match,
        titleSegments,
        detail: null,
        detailSegments: null,
      };
    }

    const titleLocation = `${normalizedTitle}\u0000${normalizeCandidateText(candidate.locationLabel)}`;
    const sameLocation = (titleLocationCounts.get(titleLocation) ?? 0) > 1;
    const detail = [
      candidate.locationLabel,
      sameLocation ? candidate.pageKey : null,
    ].filter(Boolean).join(" · ");
    return {
      candidate,
      match,
      titleSegments,
      detail: detail || null,
      detailSegments: null,
    };
  });
}

export function resolvePageReferenceDisabledReason(input: {
  readonly pageId: string;
  readonly hostPageId: string | null;
  readonly ancestorPageIds: readonly string[];
  readonly intent: PageReferenceIntent;
}): PageReferenceCandidate["disabledReason"] {
  if (input.intent !== "reference_block") return null;
  if (input.pageId === input.hostPageId) return "self";
  return input.ancestorPageIds.includes(input.pageId)
    ? "ancestor_cycle"
    : null;
}

export function selectPageReferenceCandidate(
  candidate: PageReferenceCandidate,
): PageReferenceSelection | null {
  if (candidate.lifecycle !== "active" || candidate.disabledReason) return null;
  return {
    pageId: candidate.pageId,
    titleSnapshot: candidate.title,
  };
}

export function deduplicatePageReferenceCandidates(
  candidates: readonly PageReferenceCandidate[],
  limit: number,
): PageReferenceCandidate[] {
  const boundedLimit = Math.max(1, Math.min(60, Math.floor(limit)));
  const seen = new Set<string>();
  const result: PageReferenceCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.pageId)) continue;
    seen.add(candidate.pageId);
    result.push(candidate);
    if (result.length === boundedLimit) break;
  }
  return result;
}
