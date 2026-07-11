import type { BoardSummary, Project } from "@/lib/types";
import type { GeneralDatabaseDescriptor } from "../../../shared/database-query";
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
      databaseViewId: string;
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
  databaseName: string;
  viewName: string;
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
  key: "db" | "card" | "current-card" | "other-card";
  label: "DB" | "Card" | "Current project" | "Other projects";
  rows: PanelDestinationRow[];
}

export interface BuildPanelDestinationSectionsInput {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  databaseDescriptorMap: ReadonlyMap<string, GeneralDatabaseDescriptor>;
  query: string;
  searchResult?: NfmMoveToSearchResult | null;
  scope?: PanelDestinationPickerScope;
  cardLimit?: number;
  currentProjectId?: string | null;
}

const DEFAULT_CARD_LIMIT = 60;

function createDbRow(
  project: Project,
  descriptor: GeneralDatabaseDescriptor,
  view: GeneralDatabaseDescriptor["views"][number],
): PanelDestinationDbRow {
  return {
    kind: "db",
    id: `panel-db:${project.id}:${view.id}`,
    projectId: project.id,
    projectName: project.name || "Untitled",
    projectIcon: project.icon,
    databaseName: descriptor.database.name,
    viewName: view.name,
    destination: {
      kind: "db",
      projectId: project.id,
      databaseViewId: view.id,
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

function createCardRowFromSummary(
  project: Project,
  column: BoardSummary["columns"][number],
  card: BoardSummary["columns"][number]["cards"][number],
): PanelDestinationCardRow {
  const cardTitle = card.title || "Untitled";
  return {
    kind: "card",
    id: `panel-card:${project.id}:${card.id}`,
    projectId: project.id,
    projectName: project.name || "Untitled",
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
  };
}

function orderProjectsForCardPicker(
  projects: readonly Project[],
  currentProjectId: string | null | undefined,
): readonly Project[] {
  if (!currentProjectId) return projects;

  const currentProject = projects.find((project) => project.id === currentProjectId);
  if (!currentProject) return projects;

  return [
    currentProject,
    ...projects.filter((project) => project.id !== currentProjectId),
  ];
}

function limitCardRowsWithCurrentProjectFirst(
  rows: readonly PanelDestinationCardRow[],
  currentProjectId: string,
  cardLimit: number,
): PanelDestinationCardRow[] {
  const currentProjectRows = rows.filter((row) => row.projectId === currentProjectId);
  const otherProjectRows = rows.filter((row) => row.projectId !== currentProjectId);
  return [
    ...currentProjectRows,
    ...otherProjectRows,
  ].slice(0, cardLimit);
}

function createCardSections(
  rows: readonly PanelDestinationCardRow[],
  currentProjectId: string | null | undefined,
  groupCurrentProject: boolean,
): PanelDestinationSection[] {
  if (!groupCurrentProject || !currentProjectId) {
    return [{ key: "card", label: "Card", rows: [...rows] }];
  }

  const currentProjectRows = rows.filter((row) => row.projectId === currentProjectId);
  const otherProjectRows = rows.filter((row) => row.projectId !== currentProjectId);
  return [
    ...(currentProjectRows.length > 0
      ? [{ key: "current-card", label: "Current project", rows: currentProjectRows } as const]
      : []),
    ...(otherProjectRows.length > 0
      ? [{ key: "other-card", label: "Other projects", rows: otherProjectRows } as const]
      : []),
  ];
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
  databaseDescriptorMap,
  query,
  searchResult,
  scope = "all",
  cardLimit = DEFAULT_CARD_LIMIT,
  currentProjectId = null,
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
  const groupCurrentProjectCards = scope === "card-only" && currentProjectId !== null;
  const dbRows: PanelDestinationDbRow[] = [];
  const cardRows: PanelDestinationCardRow[] = [];

  if (includeDb) {
    for (const project of projects) {
      const descriptor = databaseDescriptorMap.get(project.id);
      if (!descriptor) continue;
      for (const view of descriptor.views) {
        if (view.lifecycle !== "active") continue;
        const searchable = normalizeSearchText(
          `${project.name} ${descriptor.database.name} ${view.name}`,
        );
        if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;
        dbRows.push(createDbRow(project, descriptor, view));
      }
    }
  }

  if (includeCards) {
    if (normalizedQuery && resolvedSearchResult) {
      cardRows.push(
        ...(groupCurrentProjectCards && currentProjectId
          ? limitCardRowsWithCurrentProjectFirst(
              resolvedSearchResult.cardHits.map(createCardRowFromSearchHit),
              currentProjectId,
              cardLimit,
            )
          : resolvedSearchResult.cardHits
              .slice(0, cardLimit)
              .map(createCardRowFromSearchHit)),
      );
    } else {
      for (const project of orderProjectsForCardPicker(projects, groupCurrentProjectCards ? currentProjectId : null)) {
        const board = boardMap.get(project.id);
        for (const column of board?.columns ?? []) {
          for (const card of column.cards) {
            if (cardRows.length >= cardLimit) break;
            cardRows.push(createCardRowFromSummary(project, column, card));
          }
          if (cardRows.length >= cardLimit) break;
        }
        if (cardRows.length >= cardLimit) break;
      }
    }
  }

  const sections: PanelDestinationSection[] = [];
  if (includeDb) sections.push({ key: "db", label: "DB", rows: dbRows });
  if (includeCards) {
    sections.push(
      ...createCardSections(cardRows, currentProjectId, groupCurrentProjectCards),
    );
  }
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
