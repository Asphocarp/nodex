import { useEffect, useMemo, useState } from "react";
import { invoke } from "./api";
import {
  filterCommandPaletteItems,
  getDefaultCommandPalettePageFilters,
  matchesCommandPalettePageFilters,
  prioritizeActiveProjectItems,
  type CommandMenuMode,
  type CommandPalettePage,
  type CommandPalettePageFilters,
} from "./command-palette";
import {
  normalizeCommandPaletteSearchText,
  type CommandPalettePageSearchIndex,
} from "./command-palette-page-search";
import {
  buildCommandPaletteQueryHighlightPreview,
} from "./command-palette-highlight";
import type {
  BoardSummary,
  PageSearchResult,
  Project,
} from "./types";

const DEFAULT_METADATA_PAGE_LIMIT = 12;
const DEFAULT_MERGED_PAGE_LIMIT = 24;
const DEFAULT_DESCRIPTION_SEARCH_LIMIT = 60;
const ROOT_DESCRIPTION_SEARCH_LIMIT = 12;
const PAGE_SEARCH_DEBOUNCE_MS = 150;
const PAGE_SEARCH_CACHE_TTL_MS = 30_000;

type CommandPalettePageDescriptionSearchStatus = "idle" | "pending" | "success" | "error";

interface PageDescriptionSearchCacheEntry {
  readonly expiresAt: number;
  readonly results: readonly PageSearchResult[];
}

const pageDescriptionSearchCache = new Map<string, PageDescriptionSearchCacheEntry>();
const pageDescriptionSearchInFlight = new Map<string, Promise<readonly PageSearchResult[]>>();

export interface CommandPalettePageDescriptionSearchBatch {
  query: string;
  scopeKey: string;
  results: readonly PageSearchResult[];
  status: CommandPalettePageDescriptionSearchStatus;
  error: string | null;
}

export interface CommandPalettePageSearchPlan {
  includeContentResults: boolean;
  searchLimit: number;
}

export function buildCommandPalettePageDescriptionSearchScopeKey(
  projectIds: readonly string[],
): string {
  return Array.from(new Set(projectIds)).sort((left, right) => left.localeCompare(right)).join("\n");
}

export function getCommandPalettePageSearchPlan(
  mode: CommandMenuMode,
  query: string,
): CommandPalettePageSearchPlan | null {
  const queryLength = Array.from(normalizeCommandPaletteSearchText(query)).length;
  if (mode === "pages") {
    return {
      includeContentResults: queryLength > 0,
      searchLimit: DEFAULT_DESCRIPTION_SEARCH_LIMIT,
    };
  }

  if (mode === "root" && queryLength >= 2) {
    return {
      includeContentResults: true,
      searchLimit: ROOT_DESCRIPTION_SEARCH_LIMIT,
    };
  }

  return null;
}

function buildPageDescriptionSearchCacheKey({
  projectIds,
  query,
  limit,
}: {
  projectIds: readonly string[];
  query: string;
  limit: number;
}): string {
  return [
    buildCommandPalettePageDescriptionSearchScopeKey(projectIds),
    normalizeCommandPaletteSearchText(query),
    limit,
  ].join("\u0000");
}

function readCachedPageDescriptionSearch(
  key: string,
  now = Date.now(),
): readonly PageSearchResult[] | null {
  const cached = pageDescriptionSearchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt > now) return cached.results;
  pageDescriptionSearchCache.delete(key);
  return null;
}

export function buildCommandPalettePageItemsFromBoardSummaries({
  projects,
  boardMap,
  activeProjectId,
  recentIndexByKey,
}: {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  activeProjectId: string;
  recentIndexByKey?: ReadonlyMap<string, number>;
}): CommandPalettePage[] {
  return projects.flatMap((project) => {
    const board = boardMap.get(project.id);
    if (!board) return [];

    return board.columns.flatMap((column, columnIndex) => (
      column.cards.map((page, pageIndex) => ({
        kind: "page" as const,
        id: `${project.id}:${page.id}`,
        projectId: project.id,
        projectName: project.name,
        projectAppearance: project.appearance,
        columnName: column.name,
        page,
        tagLabels: [],
        inActiveProject: project.id === activeProjectId,
        recentIndex: recentIndexByKey?.get(`${project.id}:${page.id}`) ?? null,
        boardIndex: columnIndex * 100_000 + pageIndex,
      }))
    ));
  });
}

export async function searchCommandPalettePageDescriptions({
  projectIds,
  query,
  limit = DEFAULT_DESCRIPTION_SEARCH_LIMIT,
}: {
  projectIds: readonly string[];
  query: string;
  limit?: number;
}): Promise<PageSearchResult[]> {
  const queryText = query.trimStart().trim();
  const scopedProjectIds = Array.from(new Set(projectIds));
  if (queryText.length === 0 || scopedProjectIds.length === 0) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.floor(limit));
  const cacheKey = buildPageDescriptionSearchCacheKey({
    projectIds: scopedProjectIds,
    query: queryText,
    limit: normalizedLimit,
  });
  const cached = readCachedPageDescriptionSearch(cacheKey);
  if (cached) return [...cached];
  const existing = pageDescriptionSearchInFlight.get(cacheKey);
  if (existing) return [...await existing];

  const request = (async () => {
    const results = await invoke("pages:search", {
      projectIds: scopedProjectIds,
      query: queryText,
      limit: normalizedLimit,
    });
    const normalizedResults = Array.isArray(results) ? results : [];
    pageDescriptionSearchCache.set(cacheKey, {
      expiresAt: Date.now() + PAGE_SEARCH_CACHE_TTL_MS,
      results: normalizedResults,
    });
    return normalizedResults;
  })().finally(() => {
    pageDescriptionSearchInFlight.delete(cacheKey);
  });
  pageDescriptionSearchInFlight.set(cacheKey, request);
  return [...await request];
}

export function isCommandPalettePageDescriptionSearchPending({
  batch,
  enabled,
  query,
  scopeKey,
}: {
  batch: CommandPalettePageDescriptionSearchBatch | null | undefined;
  enabled: boolean;
  query: string;
  scopeKey: string;
}): boolean {
  const normalizedQuery = normalizeCommandPaletteSearchText(query);
  if (!enabled || normalizedQuery.length === 0 || scopeKey.length === 0) return false;
  if (!batch) return true;
  if (batch.query !== normalizedQuery || batch.scopeKey !== scopeKey) return true;
  return batch.status === "idle" || batch.status === "pending";
}

export function getCommandPalettePageDescriptionSearchError({
  batch,
  query,
  scopeKey,
}: {
  batch: CommandPalettePageDescriptionSearchBatch | null | undefined;
  query: string;
  scopeKey: string;
}): string | null {
  if (!batch || batch.status !== "error") return null;
  if (batch.query !== normalizeCommandPaletteSearchText(query)) return null;
  if (batch.scopeKey !== scopeKey) return null;
  return batch.error ?? "Page content search is unavailable";
}

export function buildCommandPalettePageDescriptionSearchPreview(
  excerpt: string,
  query: string,
): CommandPalettePage["searchPreview"] {
  return buildCommandPaletteQueryHighlightPreview(excerpt, query);
}

export function selectCommandPalettePageResults({
  query,
  pages,
  pageFilters,
  pageSearchIndex,
  pageDescriptionSearchBatch,
  pageDescriptionSearchScopeKey,
  metadataPageLimit = DEFAULT_METADATA_PAGE_LIMIT,
  mergedPageLimit = DEFAULT_MERGED_PAGE_LIMIT,
  preferActiveProject = false,
}: {
  query: string;
  pages: CommandPalettePage[];
  pageFilters?: CommandPalettePageFilters | null;
  pageSearchIndex?: CommandPalettePageSearchIndex | null;
  pageDescriptionSearchBatch?: CommandPalettePageDescriptionSearchBatch | null;
  pageDescriptionSearchScopeKey?: string | null;
  metadataPageLimit?: number;
  mergedPageLimit?: number;
  preferActiveProject?: boolean;
}): CommandPalettePage[] {
  const filters = pageFilters ?? getDefaultCommandPalettePageFilters();
  const results = filterCommandPaletteItems({
    query,
    mode: "pages",
    commands: [],
    pages,
    pageFilters: filters,
    pageSearchIndex,
    pageLimit: metadataPageLimit,
    preferActiveProject,
  });

  const descriptionResults = pageDescriptionSearchBatch
    && pageDescriptionSearchBatch.status === "success"
    && normalizeCommandPaletteSearchText(pageDescriptionSearchBatch.query) === results.query
    && (
      pageDescriptionSearchScopeKey === undefined
      || pageDescriptionSearchScopeKey === null
      || pageDescriptionSearchBatch.scopeKey === pageDescriptionSearchScopeKey
    )
    ? pageDescriptionSearchBatch.results
    : [];

  if (results.query.length === 0 || descriptionResults.length === 0) {
    return results.pages;
  }

  const pageByProjectAndId = new Map(pages.map((item) => [`${item.projectId}:${item.page.id}`, item] as const));
  const descriptionSearchPages = descriptionResults.flatMap((result) => {
    const item = pageByProjectAndId.get(`${result.projectId}:${result.pageId}`);
    if (!item || !matchesCommandPalettePageFilters(item, filters)) {
      return [];
    }

    return [{
      ...item,
      searchPreview: buildCommandPalettePageDescriptionSearchPreview(result.excerpt, results.query) ?? item.searchPreview,
      pageKeyMatch: result.matchedPageKey
        ? {
            matchedPageKey: result.matchedPageKey,
            isCurrent: result.matchedPageKeyIsCurrent === true,
          }
        : item.pageKeyMatch,
    }];
  });

  if (descriptionSearchPages.length === 0) {
    return results.pages;
  }

  const serverMatchesById = new Map(descriptionSearchPages.map((item) => [item.id, item] as const));
  const merged = results.pages.map((item) => {
    const serverMatch = serverMatchesById.get(item.id);
    if (!serverMatch) return item;

    return {
      ...item,
      searchPreview: item.searchPreview ?? serverMatch.searchPreview,
      pageKeyMatch: serverMatch.pageKeyMatch ?? item.pageKeyMatch,
    };
  });
  const seenIds = new Set(merged.map((item) => item.id));
  descriptionSearchPages.forEach((item) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    merged.push(item);
  });

  return (preferActiveProject ? prioritizeActiveProjectItems(merged) : merged)
    .slice(0, mergedPageLimit);
}

export function useCommandPalettePageDescriptionSearch({
  enabled,
  query,
  projectIds,
  limit = DEFAULT_DESCRIPTION_SEARCH_LIMIT,
}: {
  enabled: boolean;
  query: string;
  projectIds: readonly string[];
  limit?: number;
}): CommandPalettePageDescriptionSearchBatch {
  const [batch, setBatch] = useState<CommandPalettePageDescriptionSearchBatch>({
    query: "",
    scopeKey: "",
    results: [],
    status: "idle",
    error: null,
  });
  const projectIdsKey = useMemo(
    () => buildCommandPalettePageDescriptionSearchScopeKey(projectIds),
    [projectIds],
  );

  useEffect(() => {
    const queryText = query.trimStart();
    const normalizedQuery = normalizeCommandPaletteSearchText(queryText);
    const scopedProjectIds = projectIdsKey ? projectIdsKey.split("\n") : [];
    if (!enabled || normalizedQuery.length === 0 || scopedProjectIds.length === 0) {
      setBatch((current) => (
        current.query === ""
          && current.scopeKey === ""
          && current.results.length === 0
          && current.status === "idle"
          ? current
          : { query: "", scopeKey: "", results: [], status: "idle", error: null }
      ));
      return;
    }

    let cancelled = false;
    setBatch((current) => current.status === "pending"
      && current.query === normalizedQuery
      && current.scopeKey === projectIdsKey
      ? current
      : {
          query: normalizedQuery,
          scopeKey: projectIdsKey,
          results: [],
          status: "pending",
          error: null,
        });
    const timer = setTimeout(() => {
      void searchCommandPalettePageDescriptions({
        projectIds: scopedProjectIds,
        query: queryText,
        limit,
      })
        .then((nextResults) => {
          if (cancelled) return;
          setBatch({
            query: normalizedQuery,
            scopeKey: projectIdsKey,
            results: nextResults,
            status: "success",
            error: null,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setBatch({
            query: normalizedQuery,
            scopeKey: projectIdsKey,
            results: [],
            status: "error",
            error: error instanceof Error ? error.message : "Page content search is unavailable",
          });
        });
    }, PAGE_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, limit, projectIdsKey, query]);

  return batch;
}

export function clearCommandPalettePageDescriptionSearchCacheForTests(): void {
  pageDescriptionSearchCache.clear();
  pageDescriptionSearchInFlight.clear();
}

export function useSelectedCommandPalettePageResults({
  query,
  pages,
  pageFilters,
  pageSearchIndex,
  pageDescriptionSearchBatch,
  pageDescriptionSearchScopeKey,
  metadataPageLimit,
  mergedPageLimit,
  preferActiveProject,
}: {
  query: string;
  pages: CommandPalettePage[];
  pageFilters?: CommandPalettePageFilters | null;
  pageSearchIndex?: CommandPalettePageSearchIndex | null;
  pageDescriptionSearchBatch?: CommandPalettePageDescriptionSearchBatch | null;
  pageDescriptionSearchScopeKey?: string | null;
  metadataPageLimit?: number;
  mergedPageLimit?: number;
  preferActiveProject?: boolean;
}): CommandPalettePage[] {
  return useMemo(
    () => selectCommandPalettePageResults({
      query,
      pages,
      pageFilters,
      pageSearchIndex,
      pageDescriptionSearchBatch,
      pageDescriptionSearchScopeKey,
      metadataPageLimit,
      mergedPageLimit,
      preferActiveProject,
    }),
    [
      pageDescriptionSearchBatch,
      pageDescriptionSearchScopeKey,
      pageFilters,
      pageSearchIndex,
      pages,
      mergedPageLimit,
      metadataPageLimit,
      preferActiveProject,
      query,
    ],
  );
}
