import MiniSearch, { type Options } from "minisearch";
import {
  normalizeSearchText,
  resolveFuzzyThreshold,
} from "@/lib/search-text";
import type { BoardSummary, Project } from "@/lib/types";

interface NfmMoveToSearchDocument {
  id: string;
  kind: "project" | "column" | "page";
  projectId: string;
  projectName: string;
  projectIcon: string;
  columnId: string;
  columnName: string;
  pageId: string;
  pageTitle: string;
  boardOrder: number;
}

export interface NfmMoveToPageSearchHit {
  id: string;
  projectId: string;
  projectName: string;
  projectIcon?: string;
  columnId: string;
  columnName: string;
  pageId: string;
  pageTitle: string;
  boardOrder: number;
  score: number;
}

export interface NfmMoveToSearchResult {
  normalizedQuery: string;
  matchedProjectIds: ReadonlySet<string>;
  matchedColumnIdsByProjectId: ReadonlyMap<string, ReadonlySet<string>>;
  pageHits: NfmMoveToPageSearchHit[];
}

export interface NfmMoveToSearchIndex {
  search: (query: string) => NfmMoveToSearchResult;
}

export interface CreateNfmMoveToSearchIndexInput {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  sourceProjectId: string | null;
  sourcePageId: string | null;
}

const SEARCH_FIELDS: Array<keyof Pick<
  NfmMoveToSearchDocument,
  "projectName" | "columnName" | "pageTitle"
>> = [
  "projectName",
  "columnName",
  "pageTitle",
];

const FIELD_BOOSTS: Partial<Record<keyof NfmMoveToSearchDocument, number>> = {
  pageTitle: 8,
  columnName: 3,
  projectName: 2,
};

function createMiniSearchOptions(): Options<NfmMoveToSearchDocument> {
  return {
    fields: SEARCH_FIELDS,
    idField: "id",
    storeFields: ["id"],
    processTerm: (term) => {
      const normalized = normalizeSearchText(term);
      return normalized.length > 0 ? normalized : null;
    },
  };
}

function createEmptySearchResult(query: string): NfmMoveToSearchResult {
  return {
    normalizedQuery: normalizeSearchText(query),
    matchedProjectIds: new Set<string>(),
    matchedColumnIdsByProjectId: new Map<string, ReadonlySet<string>>(),
    pageHits: [],
  };
}

function addColumnMatch(
  columnIdsByProjectId: Map<string, Set<string>>,
  projectId: string,
  columnId: string,
) {
  const existing = columnIdsByProjectId.get(projectId);
  if (existing) {
    existing.add(columnId);
    return;
  }

  columnIdsByProjectId.set(projectId, new Set([columnId]));
}

function createPageHit(
  document: NfmMoveToSearchDocument,
  score: number,
): NfmMoveToPageSearchHit {
  return {
    id: document.id,
    projectId: document.projectId,
    projectName: document.projectName,
    projectIcon: document.projectIcon || undefined,
    columnId: document.columnId,
    columnName: document.columnName,
    pageId: document.pageId,
    pageTitle: document.pageTitle,
    boardOrder: document.boardOrder,
    score,
  };
}

export function createNfmMoveToSearchIndex({
  projects,
  boardMap,
  sourceProjectId,
  sourcePageId,
}: CreateNfmMoveToSearchIndexInput): NfmMoveToSearchIndex {
  const documents: NfmMoveToSearchDocument[] = [];

  projects.forEach((project, projectIndex) => {
    const projectName = project.name || "Untitled";
    const projectIcon = project.icon ?? "";
    documents.push({
      id: `db:${project.id}`,
      kind: "project",
      projectId: project.id,
      projectName,
      projectIcon,
      columnId: "",
      columnName: "",
      pageId: "",
      pageTitle: "",
      boardOrder: projectIndex * 1_000_000,
    });

    const board = boardMap.get(project.id);
    board?.columns.forEach((column, columnIndex) => {
      const columnOrder = projectIndex * 1_000_000 + columnIndex * 10_000;
      documents.push({
        id: `db-column:${project.id}:${column.id}`,
        kind: "column",
        projectId: project.id,
        projectName,
        projectIcon,
        columnId: column.id,
        columnName: column.name,
        pageId: "",
        pageTitle: "",
        boardOrder: columnOrder,
      });

      column.cards.forEach((page, pageIndex) => {
        if (project.id === sourceProjectId && page.id === sourcePageId) return;

        documents.push({
          id: `page:${project.id}:${page.id}`,
          kind: "page",
          projectId: project.id,
          projectName,
          projectIcon,
          columnId: column.id,
          columnName: column.name,
          pageId: page.id,
          pageTitle: page.title || "Untitled",
          boardOrder: columnOrder + pageIndex,
        });
      });
    });
  });

  const documentsById = new Map(documents.map((document) => [document.id, document] as const));
  const miniSearch = new MiniSearch<NfmMoveToSearchDocument>(createMiniSearchOptions());
  if (documents.length > 0) {
    miniSearch.addAll(documents);
  }

  return {
    search(query) {
      const normalizedQuery = normalizeSearchText(query);
      if (!normalizedQuery) return createEmptySearchResult(query);

      const matchedProjectIds = new Set<string>();
      const matchedColumnIdsByProjectId = new Map<string, Set<string>>();
      const pageHitsById = new Map<string, NfmMoveToPageSearchHit>();
      const results = miniSearch.search(normalizedQuery, {
        combineWith: "AND",
        prefix: (term) => term.length >= 2,
        fuzzy: resolveFuzzyThreshold,
        boost: FIELD_BOOSTS,
      });

      for (const result of results) {
        const document = documentsById.get(String(result.id));
        if (!document) continue;

        if (document.kind === "project") {
          matchedProjectIds.add(document.projectId);
          continue;
        }

        if (document.kind === "column") {
          addColumnMatch(matchedColumnIdsByProjectId, document.projectId, document.columnId);
          continue;
        }

        const existing = pageHitsById.get(document.id);
        if (existing && existing.score >= result.score) continue;
        pageHitsById.set(document.id, createPageHit(document, result.score));
      }

      const pageHits = Array.from(pageHitsById.values()).sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.boardOrder - right.boardOrder;
      });

      return {
        normalizedQuery,
        matchedProjectIds,
        matchedColumnIdsByProjectId,
        pageHits,
      };
    },
  };
}
