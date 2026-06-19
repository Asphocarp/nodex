import type { BoardSummary, Project } from "@/lib/types";
import { normalizeSearchText } from "@/lib/search-text";
import {
  createNfmMoveToSearchIndex,
  type NfmMoveToCardSearchHit,
  type NfmMoveToSearchResult,
} from "./nfm-move-to-menu-search";

export type NfmMoveToDestination =
  | {
      kind: "db-column";
      projectId: string;
      columnId: string;
    }
  | {
      kind: "card";
      projectId: string;
      columnId: string;
      cardId: string;
    };

export type NfmMoveToResultScope = "all" | "db-only";

export interface NfmMoveToDbRow {
  kind: "db";
  id: string;
  projectId: string;
  projectName: string;
  projectIcon?: string;
  expanded: boolean;
}

export interface NfmMoveToDbColumnRow {
  kind: "db-column";
  id: string;
  projectId: string;
  projectName: string;
  projectIcon?: string;
  columnId: string;
  columnName: string;
  depth: 1;
  destination: NfmMoveToDestination;
}

export interface NfmMoveToCardRow {
  kind: "card";
  id: string;
  projectId: string;
  projectName: string;
  projectIcon?: string;
  columnId: string;
  columnName: string;
  cardId: string;
  cardTitle: string;
  depth: 0;
  destination: NfmMoveToDestination;
}

export type NfmMoveToRow = NfmMoveToDbRow | NfmMoveToDbColumnRow | NfmMoveToCardRow;

export interface NfmMoveToSection {
  key: "db" | "card";
  label: "DB" | "Card";
  rows: NfmMoveToRow[];
}

export interface NfmMoveToSectionsInput {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  sourceProjectId: string | null;
  sourceCardId: string | null;
  expandedProjectIds: ReadonlySet<string>;
  query: string;
  searchResult?: NfmMoveToSearchResult | null;
  resultScope?: NfmMoveToResultScope;
  cardLimit?: number;
}

const DEFAULT_CARD_LIMIT = 60;

function createDbRow(project: Project, expanded: boolean): NfmMoveToDbRow {
  return {
    kind: "db",
    id: `db:${project.id}`,
    projectId: project.id,
    projectName: project.name || "Untitled",
    projectIcon: project.icon,
    expanded,
  };
}

function createCardRowFromSearchHit(hit: NfmMoveToCardSearchHit): NfmMoveToCardRow {
  return {
    kind: "card",
    id: hit.id,
    projectId: hit.projectId,
    projectName: hit.projectName,
    projectIcon: hit.projectIcon,
    columnId: hit.columnId,
    columnName: hit.columnName,
    cardId: hit.cardId,
    cardTitle: hit.cardTitle,
    depth: 0,
    destination: {
      kind: "card",
      projectId: hit.projectId,
      columnId: hit.columnId,
      cardId: hit.cardId,
    },
  };
}

function resolveSearchResult({
  projects,
  boardMap,
  sourceProjectId,
  sourceCardId,
  query,
  searchResult,
}: Pick<
  NfmMoveToSectionsInput,
  "projects" | "boardMap" | "sourceProjectId" | "sourceCardId" | "query" | "searchResult"
>): NfmMoveToSearchResult | null {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;
  if (searchResult?.normalizedQuery === normalizedQuery) return searchResult;
  return createNfmMoveToSearchIndex({
    projects,
    boardMap,
    sourceProjectId,
    sourceCardId,
  }).search(query);
}

export function getDefaultNfmMoveToExpandedProjectIds(
  projects: readonly Project[],
  sourceProjectId: string | null,
) {
  const defaultExpandedProjectId = sourceProjectId && projects.some((project) => project.id === sourceProjectId)
    ? sourceProjectId
    : projects[0]?.id;

  return new Set(defaultExpandedProjectId ? [defaultExpandedProjectId] : []);
}

export function buildNfmMoveToSections({
  projects,
  boardMap,
  sourceProjectId,
  sourceCardId,
  expandedProjectIds,
  query,
  searchResult,
  resultScope = "all",
  cardLimit = DEFAULT_CARD_LIMIT,
}: NfmMoveToSectionsInput): NfmMoveToSection[] {
  const normalizedQuery = normalizeSearchText(query);
  const resolvedSearchResult = resolveSearchResult({
    projects,
    boardMap,
    sourceProjectId,
    sourceCardId,
    query,
    searchResult,
  });
  const dbRows: NfmMoveToRow[] = [];
  const cardRows: NfmMoveToRow[] = [];

  for (const project of projects) {
    const board = boardMap.get(project.id);
    const projectName = project.name || "Untitled";
    const projectMatchesQuery = resolvedSearchResult?.matchedProjectIds.has(project.id) ?? false;
    const matchedColumnIds = resolvedSearchResult?.matchedColumnIdsByProjectId.get(project.id);
    const visibleColumnRows: NfmMoveToDbColumnRow[] = [];
    const queryForcesExpanded = Boolean(normalizedQuery);

    for (const column of board?.columns ?? []) {
      const columnMatchesQuery = matchedColumnIds?.has(column.id) ?? false;
      const shouldShowColumn = !normalizedQuery || projectMatchesQuery || columnMatchesQuery;
      if (shouldShowColumn) {
        visibleColumnRows.push({
          kind: "db-column",
          id: `db-column:${project.id}:${column.id}`,
          projectId: project.id,
          projectName,
          projectIcon: project.icon,
          columnId: column.id,
          columnName: column.name,
          depth: 1,
          destination: {
            kind: "db-column",
            projectId: project.id,
            columnId: column.id,
          },
        });
      }

      if (normalizedQuery || resultScope === "db-only") continue;

      for (const card of column.cards) {
        if (project.id === sourceProjectId && card.id === sourceCardId) continue;
        if (cardRows.length >= cardLimit) continue;

        const cardTitle = card.title || "Untitled";
        cardRows.push({
          kind: "card",
          id: `card:${project.id}:${card.id}`,
          projectId: project.id,
          projectName,
          projectIcon: project.icon,
          columnId: column.id,
          columnName: column.name,
          cardId: card.id,
          cardTitle,
          depth: 0,
          destination: {
            kind: "card",
            projectId: project.id,
            columnId: column.id,
            cardId: card.id,
          },
        });
      }
    }

    const showDbRow = !normalizedQuery || projectMatchesQuery || visibleColumnRows.length > 0;
    if (!showDbRow) continue;

    const expanded = queryForcesExpanded || expandedProjectIds.has(project.id);
    dbRows.push(createDbRow(project, expanded));
    if (expanded) dbRows.push(...visibleColumnRows);
  }

  if (resultScope === "all" && normalizedQuery && resolvedSearchResult) {
    cardRows.push(
      ...resolvedSearchResult.cardHits
        .slice(0, cardLimit)
        .map(createCardRowFromSearchHit),
    );
  }

  const dbSection = { key: "db", label: "DB", rows: dbRows } satisfies NfmMoveToSection;
  if (resultScope === "db-only") return [dbSection];

  return [
    dbSection,
    { key: "card", label: "Card", rows: cardRows },
  ];
}

export function flattenNfmMoveToRows(
  sections: readonly NfmMoveToSection[],
): NfmMoveToRow[] {
  return sections.flatMap((section) => section.rows);
}

export function getInitialNfmMoveToFocusIndex(
  query: string,
  rows: readonly NfmMoveToRow[],
) {
  if (!normalizeSearchText(query)) return -1;
  return rows.length > 0 ? 0 : -1;
}

export function getInitialNfmMoveToFocusedRowId(
  query: string,
  rows: readonly NfmMoveToRow[],
) {
  if (!normalizeSearchText(query)) return null;
  return rows[0]?.id ?? null;
}

export function resolveNfmMoveToFocusedRowId(
  focusedRowId: string | null,
  query: string,
  rows: readonly NfmMoveToRow[],
) {
  if (focusedRowId && rows.some((row) => row.id === focusedRowId)) {
    return focusedRowId;
  }

  return getInitialNfmMoveToFocusedRowId(query, rows);
}

export function moveNfmMoveToFocus(
  currentIndex: number,
  direction: 1 | -1,
  rows: readonly NfmMoveToRow[],
) {
  if (rows.length === 0) return -1;
  if (currentIndex < 0) return direction > 0 ? 0 : rows.length - 1;

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0) return rows.length - 1;
  if (nextIndex >= rows.length) return 0;
  return nextIndex;
}

export function moveNfmMoveToFocusedRowId(
  focusedRowId: string | null,
  direction: 1 | -1,
  rows: readonly NfmMoveToRow[],
) {
  if (rows.length === 0) return null;

  const currentIndex = focusedRowId
    ? rows.findIndex((row) => row.id === focusedRowId)
    : -1;
  const nextIndex = moveNfmMoveToFocus(currentIndex, direction, rows);
  return rows[nextIndex]?.id ?? null;
}
