import type { BoardSummary, Project } from "@/lib/types";
import { normalizeSearchText } from "@/lib/search-text";
import {
  createNfmMoveToSearchIndex,
  type NfmMoveToCardSearchHit,
  type NfmMoveToSearchResult,
} from "@/components/kanban/editor/nfm-move-to-menu-search";

export type PanelDestinationPickerScope = "all" | "db-only" | "card-only";

export type PanelDestination =
  | {
      kind: "db";
      projectId: string;
    }
  | {
      kind: "card";
      projectId: string;
      columnId: string;
      cardId: string;
      titleSnapshot: string;
    };

export interface PanelDestinationDbRow {
  kind: "db";
  id: string;
  projectId: string;
  projectName: string;
  projectIcon?: string;
  destination: PanelDestination;
}

export interface PanelDestinationCardRow {
  kind: "card";
  id: string;
  projectId: string;
  projectName: string;
  projectIcon?: string;
  columnId: string;
  columnName: string;
  cardId: string;
  cardTitle: string;
  destination: PanelDestination;
}

export type PanelDestinationRow = PanelDestinationDbRow | PanelDestinationCardRow;

export interface PanelDestinationSection {
  key: "db" | "card";
  label: "DB" | "Card";
  rows: PanelDestinationRow[];
}

export interface BuildPanelDestinationSectionsInput {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  query: string;
  searchResult?: NfmMoveToSearchResult | null;
  scope?: PanelDestinationPickerScope;
  cardLimit?: number;
}

const DEFAULT_CARD_LIMIT = 60;

function createDbRow(project: Project): PanelDestinationDbRow {
  return {
    kind: "db",
    id: `panel-db:${project.id}`,
    projectId: project.id,
    projectName: project.name || "Untitled",
    projectIcon: project.icon,
    destination: {
      kind: "db",
      projectId: project.id,
    },
  };
}

function createCardRowFromSearchHit(hit: NfmMoveToCardSearchHit): PanelDestinationCardRow {
  return {
    kind: "card",
    id: `panel-${hit.id}`,
    projectId: hit.projectId,
    projectName: hit.projectName,
    projectIcon: hit.projectIcon,
    columnId: hit.columnId,
    columnName: hit.columnName,
    cardId: hit.cardId,
    cardTitle: hit.cardTitle,
    destination: {
      kind: "card",
      projectId: hit.projectId,
      columnId: hit.columnId,
      cardId: hit.cardId,
      titleSnapshot: hit.cardTitle,
    },
  };
}

function resolveSearchResult({
  projects,
  boardMap,
  query,
  searchResult,
}: Pick<BuildPanelDestinationSectionsInput, "projects" | "boardMap" | "query" | "searchResult">) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;
  if (searchResult?.normalizedQuery === normalizedQuery) return searchResult;

  return createNfmMoveToSearchIndex({
    projects,
    boardMap,
    sourceProjectId: null,
    sourceCardId: null,
  }).search(query);
}

export function buildPanelDestinationSections({
  projects,
  boardMap,
  query,
  searchResult,
  scope = "all",
  cardLimit = DEFAULT_CARD_LIMIT,
}: BuildPanelDestinationSectionsInput): PanelDestinationSection[] {
  const normalizedQuery = normalizeSearchText(query);
  const resolvedSearchResult = resolveSearchResult({
    projects,
    boardMap,
    query,
    searchResult,
  });
  const includeDb = scope === "all" || scope === "db-only";
  const includeCards = scope === "all" || scope === "card-only";
  const dbRows: PanelDestinationDbRow[] = [];
  const cardRows: PanelDestinationCardRow[] = [];

  if (includeDb) {
    for (const project of projects) {
      if (normalizedQuery && !resolvedSearchResult?.matchedProjectIds.has(project.id)) {
        continue;
      }
      dbRows.push(createDbRow(project));
    }
  }

  if (includeCards) {
    if (normalizedQuery && resolvedSearchResult) {
      cardRows.push(
        ...resolvedSearchResult.cardHits
          .slice(0, cardLimit)
          .map(createCardRowFromSearchHit),
      );
    } else {
      for (const project of projects) {
        const board = boardMap.get(project.id);
        const projectName = project.name || "Untitled";
        for (const column of board?.columns ?? []) {
          for (const card of column.cards) {
            if (cardRows.length >= cardLimit) break;
            const cardTitle = card.title || "Untitled";
            cardRows.push({
              kind: "card",
              id: `panel-card:${project.id}:${card.id}`,
              projectId: project.id,
              projectName,
              projectIcon: project.icon,
              columnId: column.id,
              columnName: column.name,
              cardId: card.id,
              cardTitle,
              destination: {
                kind: "card",
                projectId: project.id,
                columnId: column.id,
                cardId: card.id,
                titleSnapshot: cardTitle,
              },
            });
          }
        }
      }
    }
  }

  const sections: PanelDestinationSection[] = [];
  if (includeDb) sections.push({ key: "db", label: "DB", rows: dbRows });
  if (includeCards) sections.push({ key: "card", label: "Card", rows: cardRows });
  return sections;
}

export function flattenPanelDestinationRows(
  sections: readonly PanelDestinationSection[],
): PanelDestinationRow[] {
  return sections.flatMap((section) => section.rows);
}

export function resolvePanelDestinationFocusedRowId(
  focusedRowId: string | null,
  query: string,
  rows: readonly PanelDestinationRow[],
) {
  if (focusedRowId && rows.some((row) => row.id === focusedRowId)) {
    return focusedRowId;
  }

  if (!normalizeSearchText(query)) return null;
  return rows[0]?.id ?? null;
}

export function movePanelDestinationFocusedRowId(
  focusedRowId: string | null,
  direction: 1 | -1,
  rows: readonly PanelDestinationRow[],
) {
  if (rows.length === 0) return null;

  const currentIndex = focusedRowId
    ? rows.findIndex((row) => row.id === focusedRowId)
    : -1;
  if (currentIndex < 0) {
    return direction > 0 ? rows[0]?.id ?? null : rows[rows.length - 1]?.id ?? null;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0) return rows[rows.length - 1]?.id ?? null;
  if (nextIndex >= rows.length) return rows[0]?.id ?? null;
  return rows[nextIndex]?.id ?? null;
}
