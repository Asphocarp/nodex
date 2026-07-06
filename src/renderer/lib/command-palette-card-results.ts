import { useEffect, useMemo, useState } from "react";
import { invoke } from "./api";
import {
  filterCommandPaletteItems,
  getDefaultCommandPaletteCardFilters,
  matchesCommandPaletteCardFilters,
  prioritizeActiveProjectItems,
  type CommandPaletteCard,
  type CommandPaletteCardFilters,
} from "./command-palette";
import {
  normalizeCommandPaletteSearchText,
  type CommandPaletteCardSearchIndex,
} from "./command-palette-card-search";
import {
  buildCommandPaletteQueryHighlightPreview,
} from "./command-palette-highlight";
import { normalizeProjectIcon } from "./project-icon";
import type {
  BoardSummary,
  CardSearchResult,
  Project,
} from "./types";

const DEFAULT_METADATA_CARD_LIMIT = 12;
const DEFAULT_MERGED_CARD_LIMIT = 24;
const DEFAULT_DESCRIPTION_SEARCH_LIMIT = 60;

export interface CommandPaletteCardDescriptionSearchBatch {
  query: string;
  scopeKey: string;
  results: readonly CardSearchResult[];
  loading: boolean;
}

export function buildCommandPaletteCardDescriptionSearchScopeKey(
  projectIds: readonly string[],
): string {
  return Array.from(new Set(projectIds)).sort((left, right) => left.localeCompare(right)).join("\n");
}

export function buildCommandPaletteCardItemsFromBoardSummaries({
  projects,
  boardMap,
  activeProjectId,
  recentIndexByKey,
}: {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  activeProjectId: string;
  recentIndexByKey?: ReadonlyMap<string, number>;
}): CommandPaletteCard[] {
  return projects.flatMap((project) => {
    const board = boardMap.get(project.id);
    if (!board) return [];

    const projectIcon = normalizeProjectIcon(project.icon);
    return board.columns.flatMap((column, columnIndex) => (
      column.cards.map((card, cardIndex) => ({
        kind: "card" as const,
        id: `${project.id}:${card.id}`,
        projectId: project.id,
        projectName: project.name,
        projectIcon,
        columnName: column.name,
        card,
        inActiveProject: project.id === activeProjectId,
        recentIndex: recentIndexByKey?.get(`${project.id}:${card.id}`) ?? null,
        boardIndex: columnIndex * 100_000 + cardIndex,
      }))
    ));
  });
}

export async function searchCommandPaletteCardDescriptions({
  projectIds,
  query,
  limit = DEFAULT_DESCRIPTION_SEARCH_LIMIT,
}: {
  projectIds: readonly string[];
  query: string;
  limit?: number;
}): Promise<CardSearchResult[]> {
  const queryText = query.trimStart().trim();
  const scopedProjectIds = Array.from(new Set(projectIds));
  if (queryText.length === 0 || scopedProjectIds.length === 0) {
    return [];
  }

  try {
    const results = await invoke("cards:search", {
      projectIds: scopedProjectIds,
      query: queryText,
      limit,
    });
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

export function buildCommandPaletteCardDescriptionSearchPreview(
  excerpt: string,
  query: string,
): CommandPaletteCard["searchPreview"] {
  return buildCommandPaletteQueryHighlightPreview(excerpt, query);
}

export function selectCommandPaletteCardResults({
  query,
  cards,
  cardFilters,
  cardSearchIndex,
  cardDescriptionSearchBatch,
  cardDescriptionSearchScopeKey,
  metadataCardLimit = DEFAULT_METADATA_CARD_LIMIT,
  mergedCardLimit = DEFAULT_MERGED_CARD_LIMIT,
  preferActiveProject = false,
}: {
  query: string;
  cards: CommandPaletteCard[];
  cardFilters?: CommandPaletteCardFilters | null;
  cardSearchIndex?: CommandPaletteCardSearchIndex | null;
  cardDescriptionSearchBatch?: CommandPaletteCardDescriptionSearchBatch | null;
  cardDescriptionSearchScopeKey?: string | null;
  metadataCardLimit?: number;
  mergedCardLimit?: number;
  preferActiveProject?: boolean;
}): CommandPaletteCard[] {
  const filters = cardFilters ?? getDefaultCommandPaletteCardFilters();
  const results = filterCommandPaletteItems({
    query,
    mode: "cards",
    commands: [],
    cards,
    cardFilters: filters,
    cardSearchIndex,
    cardLimit: metadataCardLimit,
    preferActiveProject,
  });

  const descriptionResults = cardDescriptionSearchBatch
    && normalizeCommandPaletteSearchText(cardDescriptionSearchBatch.query) === results.query
    && (
      cardDescriptionSearchScopeKey === undefined
      || cardDescriptionSearchScopeKey === null
      || cardDescriptionSearchBatch.scopeKey === cardDescriptionSearchScopeKey
    )
    ? cardDescriptionSearchBatch.results
    : [];

  if (results.query.length === 0 || descriptionResults.length === 0) {
    return results.cards;
  }

  const cardByProjectAndId = new Map(cards.map((item) => [`${item.projectId}:${item.card.id}`, item] as const));
  const descriptionSearchCards = descriptionResults.flatMap((result) => {
    const item = cardByProjectAndId.get(`${result.projectId}:${result.cardId}`);
    if (!item || !matchesCommandPaletteCardFilters(item, filters)) {
      return [];
    }

    return [{
      ...item,
      searchPreview: buildCommandPaletteCardDescriptionSearchPreview(result.excerpt, results.query) ?? item.searchPreview,
    }];
  });

  if (descriptionSearchCards.length === 0) {
    return results.cards;
  }

  const serverMatchesById = new Map(descriptionSearchCards.map((item) => [item.id, item] as const));
  const merged = results.cards.map((item) => {
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
  descriptionSearchCards.forEach((item) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    merged.push(item);
  });

  return (preferActiveProject ? prioritizeActiveProjectItems(merged) : merged)
    .slice(0, mergedCardLimit);
}

export function useCommandPaletteCardDescriptionSearch({
  enabled,
  query,
  projectIds,
}: {
  enabled: boolean;
  query: string;
  projectIds: readonly string[];
}): CommandPaletteCardDescriptionSearchBatch {
  const [batch, setBatch] = useState<CommandPaletteCardDescriptionSearchBatch>({
    query: "",
    scopeKey: "",
    results: [],
    loading: false,
  });
  const projectIdsKey = useMemo(
    () => buildCommandPaletteCardDescriptionSearchScopeKey(projectIds),
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
    void searchCommandPaletteCardDescriptions({
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

export function useSelectedCommandPaletteCardResults({
  query,
  cards,
  cardFilters,
  cardSearchIndex,
  cardDescriptionSearchBatch,
  cardDescriptionSearchScopeKey,
  metadataCardLimit,
  mergedCardLimit,
  preferActiveProject,
}: {
  query: string;
  cards: CommandPaletteCard[];
  cardFilters?: CommandPaletteCardFilters | null;
  cardSearchIndex?: CommandPaletteCardSearchIndex | null;
  cardDescriptionSearchBatch?: CommandPaletteCardDescriptionSearchBatch | null;
  cardDescriptionSearchScopeKey?: string | null;
  metadataCardLimit?: number;
  mergedCardLimit?: number;
  preferActiveProject?: boolean;
}): CommandPaletteCard[] {
  return useMemo(
    () => selectCommandPaletteCardResults({
      query,
      cards,
      cardFilters,
      cardSearchIndex,
      cardDescriptionSearchBatch,
      cardDescriptionSearchScopeKey,
      metadataCardLimit,
      mergedCardLimit,
      preferActiveProject,
    }),
    [
      cardDescriptionSearchBatch,
      cardDescriptionSearchScopeKey,
      cardFilters,
      cardSearchIndex,
      cards,
      mergedCardLimit,
      metadataCardLimit,
      preferActiveProject,
      query,
    ],
  );
}
