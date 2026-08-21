import { scoreFuzzyQueryMatch } from "@/lib/settings-search-score";

export type ComposerContextSuggestionSection =
  | "Add"
  | "Apps"
  | "Chats"
  | "ChatGPT conversations"
  | "Files and chats"
  | "Plugins"
  | "Sites"
  | "Skills";

export interface ComposerContextSuggestionCandidate<T = unknown> {
  readonly id: string;
  readonly section: ComposerContextSuggestionSection;
  readonly label: string;
  readonly description: string | null;
  readonly searchTerms: readonly string[];
  readonly sourceRanked?: boolean;
  readonly value: T;
}

export interface ComposerContextSuggestionSectionModel<T = unknown> {
  readonly id: ComposerContextSuggestionSection | "search-results";
  readonly label: ComposerContextSuggestionSection | null;
  readonly items: readonly ComposerContextSuggestionCandidate<T>[];
  readonly emptyMessage?: string;
}

const EMPTY_SECTION_LIMITS: Partial<Record<ComposerContextSuggestionSection, number>> = {
  Apps: 3,
  "ChatGPT conversations": 5,
  Sites: 2,
  Skills: 2,
};

export function shouldDismissComposerSuggestionMenu(input: {
  readonly loading: boolean;
  readonly query: string;
  readonly resultCount: number;
}): boolean {
  return (
    input.query.trim().length > 0 &&
    /\s/u.test(input.query) &&
    !input.loading &&
    input.resultCount === 0
  );
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function scoreCandidate(candidate: ComposerContextSuggestionCandidate, query: string): number {
  if (candidate.sourceRanked) return 1;
  return Math.max(
    scoreFuzzyQueryMatch(candidate.label, query),
    ...candidate.searchTerms.map((term) => scoreFuzzyQueryMatch(term, query)),
  );
}

function resolveSearchPriority(
  candidate: ComposerContextSuggestionCandidate,
  query: string,
): number {
  const startsWithQuery = [candidate.label, ...candidate.searchTerms].some((term) =>
    normalizeSearchText(term).startsWith(query),
  );
  if (startsWithQuery) {
    if (candidate.section === "Plugins") return 0;
    if (candidate.section === "Apps") return 1;
  }
  if (
    candidate.section === "Files and chats" ||
    candidate.section === "Chats" ||
    candidate.section === "ChatGPT conversations"
  ) {
    return 3;
  }
  return 2;
}

export function rankComposerContextSuggestionCandidates<T>(input: {
  readonly candidates: readonly ComposerContextSuggestionCandidate<T>[];
  readonly query: string;
  readonly maxResults?: number;
  readonly useProviderPriority?: boolean;
  readonly tieBreakByLabel?: boolean;
}): ComposerContextSuggestionCandidate<T>[] {
  const normalizedQuery = normalizeSearchText(input.query);
  const maxResults = input.maxResults ?? input.candidates.length;
  if (!normalizedQuery) {
    return input.candidates.slice(0, maxResults);
  }

  return input.candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreCandidate(candidate, normalizedQuery),
    }))
    .filter((entry) => entry.candidate.sourceRanked || entry.score > 0)
    .sort((left, right) => {
      if (input.useProviderPriority !== false) {
        const leftPriority = resolveSearchPriority(left.candidate, normalizedQuery);
        const rightPriority = resolveSearchPriority(right.candidate, normalizedQuery);
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
      }
      if (right.score !== left.score) return right.score - left.score;
      if (input.tieBreakByLabel) {
        const labelOrder = left.candidate.label.localeCompare(right.candidate.label);
        if (labelOrder !== 0) return labelOrder;
      }
      return left.index - right.index;
    })
    .slice(0, maxResults)
    .map((entry) => entry.candidate);
}

export function buildComposerContextSuggestionSections<T>(input: {
  readonly candidates: readonly ComposerContextSuggestionCandidate<T>[];
  readonly query: string;
  readonly sectionOrder?: readonly ComposerContextSuggestionSection[];
  readonly maxSearchResults?: number;
  readonly loadingSectionMessages?: Partial<Record<ComposerContextSuggestionSection, string>>;
}): ComposerContextSuggestionSectionModel<T>[] {
  const normalizedQuery = normalizeSearchText(input.query);
  if (normalizedQuery) {
    const ranked = rankComposerContextSuggestionCandidates({
      candidates: input.candidates,
      query: normalizedQuery,
      maxResults: input.maxSearchResults ?? 8,
    });
    return [
      {
        id: "search-results",
        label: null,
        items: ranked,
        ...(ranked.length === 0 ? { emptyMessage: "No results" } : {}),
      },
    ];
  }

  const sectionOrder = input.sectionOrder ?? [
    "Add",
    "Plugins",
    "Apps",
    "Sites",
    "ChatGPT conversations",
    "Chats",
    "Skills",
    "Files and chats",
  ];
  return sectionOrder.flatMap((section) => {
    const items = input.candidates.filter((candidate) => candidate.section === section);
    const limit = EMPTY_SECTION_LIMITS[section];
    const visibleItems = limit === undefined ? items : items.slice(0, limit);
    if (visibleItems.length > 0) {
      return [
        {
          id: section,
          label: section,
          items: visibleItems,
        },
      ];
    }
    const loadingMessage = input.loadingSectionMessages?.[section];
    if (loadingMessage) {
      return [
        {
          id: section,
          label: section,
          items: [],
          emptyMessage: loadingMessage,
        },
      ];
    }
    if (section !== "Files and chats") return [];
    return [
      {
        id: section,
        label: section,
        items: [],
        emptyMessage: "Type to search files or chats",
      },
    ];
  });
}
