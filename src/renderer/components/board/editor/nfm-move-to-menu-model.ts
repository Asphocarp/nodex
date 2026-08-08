import type { BoardSummary, Project } from "@/lib/types";
import type { ProjectAppearance } from "../../../../shared/project-appearance";
import { normalizeSearchText } from "@/lib/search-text";
import {
  createNfmMoveToSearchIndex,
  type NfmMoveToPageSearchHit,
  type NfmMoveToSearchResult,
} from "./nfm-move-to-menu-search";

export type NfmMoveToDestination =
  | {
      kind: "db-column";
      projectId: string;
      columnId: string;
    }
  | {
      kind: "page";
      projectId: string;
      columnId: string;
      pageId: string;
    };

export type NfmMoveToResultScope = "all" | "db-only";

export interface NfmMoveToDbRow {
  kind: "db";
  id: string;
  projectId: string;
  projectName: string;
  projectAppearance: ProjectAppearance;
  expanded: boolean;
}

export interface NfmMoveToDbColumnRow {
  kind: "db-column";
  id: string;
  projectId: string;
  projectName: string;
  projectAppearance: ProjectAppearance;
  columnId: string;
  columnName: string;
  depth: 1;
  destination: NfmMoveToDestination;
}

export interface NfmMoveToPageRow {
  kind: "page";
  id: string;
  projectId: string;
  projectName: string;
  projectAppearance: ProjectAppearance;
  columnId: string;
  columnName: string;
  pageId: string;
  pageKey: string | null;
  matchedPageKey: string | null;
  matchedPageKeyIsCurrent: boolean | null;
  pageTitle: string;
  depth: 0;
  destination: NfmMoveToDestination;
}

export type NfmMoveToRow = NfmMoveToDbRow | NfmMoveToDbColumnRow | NfmMoveToPageRow;

export interface NfmMoveToSection {
  key: "db" | "page";
  label: "DB" | "Page";
  rows: NfmMoveToRow[];
}

export interface NfmMoveToSectionsInput {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  sourceProjectId: string | null;
  sourcePageId: string | null;
  expandedProjectIds: ReadonlySet<string>;
  query: string;
  searchResult?: NfmMoveToSearchResult | null;
  resultScope?: NfmMoveToResultScope;
  pageLimit?: number;
}

const DEFAULT_PAGE_LIMIT = 60;

function createDbRow(project: Project, expanded: boolean): NfmMoveToDbRow {
  return {
    kind: "db",
    id: `db:${project.id}`,
    projectId: project.id,
    projectName: project.name || "Untitled",
    projectAppearance: project.appearance,
    expanded,
  };
}

function createPageRowFromSearchHit(hit: NfmMoveToPageSearchHit): NfmMoveToPageRow {
  return {
    kind: "page",
    id: hit.id,
    projectId: hit.projectId,
    projectName: hit.projectName,
    projectAppearance: hit.projectAppearance,
    columnId: hit.columnId,
    columnName: hit.columnName,
    pageId: hit.pageId,
    pageKey: hit.pageKey,
    matchedPageKey: hit.matchedPageKey,
    matchedPageKeyIsCurrent: hit.matchedPageKeyIsCurrent,
    pageTitle: hit.pageTitle,
    depth: 0,
    destination: {
      kind: "page",
      projectId: hit.projectId,
      columnId: hit.columnId,
      pageId: hit.pageId,
    },
  };
}

function resolveSearchResult({
  projects,
  boardMap,
  sourceProjectId,
  sourcePageId,
  query,
  searchResult,
}: Pick<
  NfmMoveToSectionsInput,
  "projects" | "boardMap" | "sourceProjectId" | "sourcePageId" | "query" | "searchResult"
>): NfmMoveToSearchResult | null {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;
  if (searchResult?.normalizedQuery === normalizedQuery) return searchResult;
  return createNfmMoveToSearchIndex({
    projects,
    boardMap,
    sourceProjectId,
    sourcePageId,
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
  sourcePageId,
  expandedProjectIds,
  query,
  searchResult,
  resultScope = "all",
  pageLimit = DEFAULT_PAGE_LIMIT,
}: NfmMoveToSectionsInput): NfmMoveToSection[] {
  const normalizedQuery = normalizeSearchText(query);
  const resolvedSearchResult = resolveSearchResult({
    projects,
    boardMap,
    sourceProjectId,
    sourcePageId,
    query,
    searchResult,
  });
  const dbRows: NfmMoveToRow[] = [];
  const pageRows: NfmMoveToRow[] = [];

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
          projectAppearance: project.appearance,
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

      for (const page of column.cards) {
        if (project.id === sourceProjectId && page.id === sourcePageId) continue;
        if (pageRows.length >= pageLimit) continue;

        const pageTitle = page.title || "Untitled";
        pageRows.push({
          kind: "page",
          id: `page:${project.id}:${page.id}`,
          projectId: project.id,
          projectName,
          projectAppearance: project.appearance,
          columnId: column.id,
          columnName: column.name,
          pageId: page.id,
          pageKey: page.pageKey ?? null,
          matchedPageKey: null,
          matchedPageKeyIsCurrent: null,
          pageTitle,
          depth: 0,
          destination: {
            kind: "page",
            projectId: project.id,
            columnId: column.id,
            pageId: page.id,
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
    pageRows.push(
      ...resolvedSearchResult.pageHits
        .slice(0, pageLimit)
        .map(createPageRowFromSearchHit),
    );
  }

  const dbSection = { key: "db", label: "DB", rows: dbRows } satisfies NfmMoveToSection;
  if (resultScope === "db-only") return [dbSection];

  return [
    dbSection,
    { key: "page", label: "Page", rows: pageRows },
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
