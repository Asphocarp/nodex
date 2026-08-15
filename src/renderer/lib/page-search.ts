import MiniSearch, { type Options, type SearchResult } from "minisearch";
import type { DatabasePageSummary } from "./types";
import {
  matchPageKeySearchQuery,
  parsePageKeySearchQuery,
  type PageKeySearchQuery,
} from "./page-key";
import {
  matchesSearchTokens,
  normalizeSearchText,
  resolveFuzzyThreshold,
  tokenizeSearchQuery,
} from "./search-text";

export interface PageSearchDocument {
  id: string;
  title: string;
  description: string;
  tags: string;
  assignee: string;
  columnName: string;
  projectName: string;
  pageId: string;
}

export type PageSearchField = Exclude<keyof PageSearchDocument, "id">;

export type PageSearchFieldBoosts = Partial<
  Readonly<Record<PageSearchField, number>>
>;

export const DEFAULT_PAGE_SEARCH_FIELD_BOOSTS: PageSearchFieldBoosts = {
  title: 8,
  tags: 5,
  assignee: 4,
  columnName: 2,
  projectName: 2,
  description: 1,
  pageId: 1,
};

const PAGE_SEARCH_FIELDS: PageSearchField[] = [
  "title",
  "description",
  "tags",
  "assignee",
  "columnName",
  "projectName",
  "pageId",
];

/**
 * Builds the surface-independent fuzzy Page index used by every local Page
 * search adapter. Candidate authority remains with the adapter that supplies
 * the documents; this module owns only matching, ranking, and match evidence.
 */
export function createPageSearchMiniSearchOptions<
  Document extends PageSearchDocument = PageSearchDocument,
>(): Options<Document> {
  return {
    fields: PAGE_SEARCH_FIELDS,
    idField: "id",
    storeFields: ["id"],
    processTerm: (term) => {
      const normalized = normalizeSearchText(term);
      return normalized.length > 0 ? normalized : null;
    },
  };
}

export function createPageSearchMiniSearch<
  Document extends PageSearchDocument = PageSearchDocument,
>(): MiniSearch<Document> {
  return new MiniSearch<Document>(createPageSearchMiniSearchOptions<Document>());
}

export function searchPageSearchMiniSearch<Document extends PageSearchDocument>(
  index: MiniSearch<Document>,
  query: string,
  boosts: PageSearchFieldBoosts = DEFAULT_PAGE_SEARCH_FIELD_BOOSTS,
): SearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  return index.search(normalizedQuery, {
    combineWith: "AND",
    prefix: (term) => term.length >= 2,
    fuzzy: resolveFuzzyThreshold,
    boost: boosts,
  });
}

export function collectPageSearchMatchedTerms(
  result: SearchResult,
  field: PageSearchField,
): string[] {
  return result.terms.filter((term) => result.match[term]?.includes(field));
}

export {
  matchesSearchTokens,
  tokenizeSearchQuery,
} from "./search-text";

export interface PageCollectionSearchQuery {
  readonly normalizedQuery: string;
  readonly pageKey: PageKeySearchQuery;
  readonly textTokens: readonly string[];
}

/**
 * Compiles one local Page-collection query for reuse across every loaded row.
 * Historical aliases deliberately remain a Core-authorized global-search concern.
 */
export function compilePageCollectionSearchQuery(
  query: string,
): PageCollectionSearchQuery {
  const pageKey = parsePageKeySearchQuery(query);
  return {
    normalizedQuery: pageKey.normalizedQuery,
    pageKey,
    textTokens: pageKey.explicit ? [] : tokenizeSearchQuery(query),
  };
}

export function matchesPageCollectionSearchQuery(
  pageKey: string | null | undefined,
  text: string,
  query: PageCollectionSearchQuery,
): boolean {
  if (!query.normalizedQuery) return true;
  if (matchPageKeySearchQuery(pageKey, query.pageKey)) return true;
  if (query.pageKey.explicit) return false;
  return matchesSearchTokens(text, query.textTokens);
}

export function buildPageSearchText(card: Pick<
  DatabasePageSummary,
  "id" | "pageKey" | "title" | "descriptionPreview" | "assignee"
>, tagLabels: readonly string[] = []): string {
  return normalizeSearchText([
    card.id,
    card.title,
    card.descriptionPreview,
    tagLabels.join(" "),
    card.assignee ?? "",
  ].join(" "));
}
