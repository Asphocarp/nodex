import { useEffect, useMemo, useState } from "react";
import { invoke } from "./api";
import {
  filterCommandPaletteItems,
  getDefaultCommandPaletteCardFilters,
  matchesCommandPaletteCardFilters,
  type CommandPaletteCard,
  type CommandPaletteCardFilters,
} from "./command-palette";
import type { CommandPaletteCardSearchIndex } from "./command-palette-card-search";
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
  cardDescriptionSearchResults,
  metadataCardLimit = DEFAULT_METADATA_CARD_LIMIT,
  mergedCardLimit = DEFAULT_MERGED_CARD_LIMIT,
}: {
  query: string;
  cards: CommandPaletteCard[];
  cardFilters?: CommandPaletteCardFilters | null;
  cardSearchIndex?: CommandPaletteCardSearchIndex | null;
  cardDescriptionSearchResults?: readonly CardSearchResult[];
  metadataCardLimit?: number;
  mergedCardLimit?: number;
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
  });

  if (results.query.length === 0 || !cardDescriptionSearchResults || cardDescriptionSearchResults.length === 0) {
    return results.cards;
  }

  const cardByProjectAndId = new Map(cards.map((item) => [`${item.projectId}:${item.card.id}`, item] as const));
  const descriptionSearchCards = cardDescriptionSearchResults.flatMap((result) => {
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

  return merged.slice(0, mergedCardLimit);
}

export function useCommandPaletteCardDescriptionSearch({
  enabled,
  query,
  projectIds,
}: {
  enabled: boolean;
  query: string;
  projectIds: readonly string[];
}): CardSearchResult[] {
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const projectIdsKey = useMemo(() => projectIds.join("\n"), [projectIds]);

  useEffect(() => {
    const queryText = query.trimStart();
    const scopedProjectIds = projectIdsKey ? projectIdsKey.split("\n") : [];
    if (!enabled || queryText.trim().length === 0 || scopedProjectIds.length === 0) {
      setResults((current) => current.length === 0 ? current : []);
      return;
    }

    let cancelled = false;
    void searchCommandPaletteCardDescriptions({
      projectIds: scopedProjectIds,
      query: queryText,
      limit: DEFAULT_DESCRIPTION_SEARCH_LIMIT,
    })
      .then((nextResults) => {
        if (cancelled) return;
        setResults((current) => (
          current.length === 0 && nextResults.length === 0 ? current : nextResults
        ));
      })
      .catch(() => {
        if (cancelled) return;
        setResults((current) => current.length === 0 ? current : []);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, projectIdsKey, query]);

  return results;
}

export function useSelectedCommandPaletteCardResults({
  query,
  cards,
  cardFilters,
  cardSearchIndex,
  cardDescriptionSearchResults,
  metadataCardLimit,
  mergedCardLimit,
}: {
  query: string;
  cards: CommandPaletteCard[];
  cardFilters?: CommandPaletteCardFilters | null;
  cardSearchIndex?: CommandPaletteCardSearchIndex | null;
  cardDescriptionSearchResults?: readonly CardSearchResult[];
  metadataCardLimit?: number;
  mergedCardLimit?: number;
}): CommandPaletteCard[] {
  return useMemo(
    () => selectCommandPaletteCardResults({
      query,
      cards,
      cardFilters,
      cardSearchIndex,
      cardDescriptionSearchResults,
      metadataCardLimit,
      mergedCardLimit,
    }),
    [
      cardDescriptionSearchResults,
      cardFilters,
      cardSearchIndex,
      cards,
      mergedCardLimit,
      metadataCardLimit,
      query,
    ],
  );
}
