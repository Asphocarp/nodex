import { useEffect, useMemo, useState } from "react";
import { invoke } from "./api";
import {
  filterCommandPaletteItems,
  getDefaultCommandPalettePageFilters,
  matchesCommandPalettePageFilters,
  prioritizeActiveProjectItems,
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
import { normalizeProjectIcon } from "./project-icon";
import type {
  BoardSummary,
  PageSearchResult,
  Project,
} from "./types";

const DEFAULT_METADATA_PAGE_LIMIT = 12;
const DEFAULT_MERGED_PAGE_LIMIT = 24;
const DEFAULT_DESCRIPTION_SEARCH_LIMIT = 60;

export interface CommandPalettePageDescriptionSearchBatch {
  query: string;
  scopeKey: string;
  results: readonly PageSearchResult[];
  loading: boolean;
}

export function buildCommandPalettePageDescriptionSearchScopeKey(
  projectIds: readonly string[],
): string {
  return Array.from(new Set(projectIds)).sort((left, right) => left.localeCompare(right)).join("\n");
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

    const projectIcon = normalizeProjectIcon(project.icon);
    return board.columns.flatMap((column, columnIndex) => (
      column.cards.map((page, pageIndex) => ({
        kind: "page" as const,
        id: `${project.id}:${page.id}`,
        projectId: project.id,
        projectName: project.name,
        projectIcon,
        columnName: column.name,
        page,
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

  try {
    const results = await invoke("pages:search", {
      projectIds: scopedProjectIds,
      query: queryText,
      limit,
    });
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
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
    }];
  });

  if (descriptionSearchPages.length === 0) {
    return results.pages;
  }

  const serverMatchesById = new Map(descriptionSearchPages.map((item) => [item.id, item] as const));
  const merged = results.pages.map((item) => {
    const serverMatch = serverMatchesById.get(item.id);
    if (!serverMatch?.searchPreview || item.searchPreview) {
      return item;
    }

    return {
      ...item,
      searchPreview: serverMatch.searchPreview,
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
}: {
  enabled: boolean;
  query: string;
  projectIds: readonly string[];
}): CommandPalettePageDescriptionSearchBatch {
  const [batch, setBatch] = useState<CommandPalettePageDescriptionSearchBatch>({
    query: "",
    scopeKey: "",
    results: [],
    loading: false,
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
        current.query === "" && current.scopeKey === "" && current.results.length === 0 && !current.loading
          ? current
          : { query: "", scopeKey: "", results: [], loading: false }
      ));
      return;
    }

    let cancelled = false;
    setBatch((current) => current.loading && current.query === normalizedQuery && current.scopeKey === projectIdsKey
      ? current
      : { ...current, loading: true });
    void searchCommandPalettePageDescriptions({
      projectIds: scopedProjectIds,
      query: queryText,
      limit: DEFAULT_DESCRIPTION_SEARCH_LIMIT,
    })
      .then((nextResults) => {
        if (cancelled) return;
        setBatch({
          query: normalizedQuery,
          scopeKey: projectIdsKey,
          results: nextResults,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setBatch({
          query: normalizedQuery,
          scopeKey: projectIdsKey,
          results: [],
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, projectIdsKey, query]);

  return batch;
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
