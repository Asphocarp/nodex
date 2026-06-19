import MiniSearch, { type Options } from "minisearch";
import {
  normalizeSearchText,
  resolveFuzzyThreshold,
} from "@/lib/search-text";
import type { BoardSummary, Project } from "@/lib/types";

interface NfmMoveToSearchDocument {
  id: string;
  kind: "project" | "column" | "card";
  projectId: string;
  projectName: string;
  projectIcon: string;
  columnId: string;
  columnName: string;
  cardId: string;
  cardTitle: string;
  boardOrder: number;
}

export interface NfmMoveToCardSearchHit {
  id: string;
  projectId: string;
  projectName: string;
  projectIcon?: string;
  columnId: string;
  columnName: string;
  cardId: string;
  cardTitle: string;
  boardOrder: number;
  score: number;
}

export interface NfmMoveToSearchResult {
  normalizedQuery: string;
  matchedProjectIds: ReadonlySet<string>;
  matchedColumnIdsByProjectId: ReadonlyMap<string, ReadonlySet<string>>;
  cardHits: NfmMoveToCardSearchHit[];
}

export interface NfmMoveToSearchIndex {
  search: (query: string) => NfmMoveToSearchResult;
}

export interface CreateNfmMoveToSearchIndexInput {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  sourceProjectId: string | null;
  sourceCardId: string | null;
}

const SEARCH_FIELDS: Array<keyof Pick<
  NfmMoveToSearchDocument,
  "projectName" | "columnName" | "cardTitle"
>> = [
  "projectName",
  "columnName",
  "cardTitle",
];

const FIELD_BOOSTS: Partial<Record<keyof NfmMoveToSearchDocument, number>> = {
  cardTitle: 8,
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
    cardHits: [],
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

function createCardHit(
  document: NfmMoveToSearchDocument,
  score: number,
): NfmMoveToCardSearchHit {
  return {
    id: document.id,
    projectId: document.projectId,
    projectName: document.projectName,
    projectIcon: document.projectIcon || undefined,
    columnId: document.columnId,
    columnName: document.columnName,
    cardId: document.cardId,
    cardTitle: document.cardTitle,
    boardOrder: document.boardOrder,
    score,
  };
}

export function createNfmMoveToSearchIndex({
  projects,
  boardMap,
  sourceProjectId,
  sourceCardId,
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
      cardId: "",
      cardTitle: "",
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
        cardId: "",
        cardTitle: "",
        boardOrder: columnOrder,
      });

      column.cards.forEach((card, cardIndex) => {
        if (project.id === sourceProjectId && card.id === sourceCardId) return;

        documents.push({
          id: `card:${project.id}:${card.id}`,
          kind: "card",
          projectId: project.id,
          projectName,
          projectIcon,
          columnId: column.id,
          columnName: column.name,
          cardId: card.id,
          cardTitle: card.title || "Untitled",
          boardOrder: columnOrder + cardIndex,
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
      const cardHitsById = new Map<string, NfmMoveToCardSearchHit>();
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

        const existing = cardHitsById.get(document.id);
        if (existing && existing.score >= result.score) continue;
        cardHitsById.set(document.id, createCardHit(document, result.score));
      }

      const cardHits = Array.from(cardHitsById.values()).sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.boardOrder - right.boardOrder;
      });

      return {
        normalizedQuery,
        matchedProjectIds,
        matchedColumnIdsByProjectId,
        cardHits,
      };
    },
  };
}
