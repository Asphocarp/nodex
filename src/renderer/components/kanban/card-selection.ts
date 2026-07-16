import type { BoardSummary, DatabasePageSummary } from "@/lib/types";

export interface CardSelectionState {
  pageIds: ReadonlySet<string>;
}

export interface SelectedCardEntry {
  card: DatabasePageSummary;
  columnId: string;
  columnName: string;
}

export function emptyCardSelection(): CardSelectionState {
  return {
    pageIds: new Set<string>(),
  };
}

export function toggleCardSelection(
  selection: CardSelectionState,
  pageId: string,
): CardSelectionState {
  const nextPageIds = new Set(selection.pageIds);

  if (nextPageIds.has(pageId)) {
    nextPageIds.delete(pageId);
  } else {
    nextPageIds.add(pageId);
  }

  if (nextPageIds.size === 0) {
    return emptyCardSelection();
  }

  return {
    pageIds: nextPageIds,
  };
}

export function normalizeCardSelection(
  selection: CardSelectionState,
  board: BoardSummary | null,
): CardSelectionState {
  if (!board || selection.pageIds.size === 0) return selection;

  const visiblePageIds = new Set(
    board.columns.flatMap((column) => column.cards.map((card) => card.id)),
  );
  const normalizedIds = new Set(
    [...selection.pageIds].filter((pageId) => visiblePageIds.has(pageId)),
  );

  if (normalizedIds.size === 0) return emptyCardSelection();
  if (normalizedIds.size === selection.pageIds.size) return selection;

  return {
    pageIds: normalizedIds,
  };
}

export function resolveSelectedCardEntries(
  board: BoardSummary | null,
  selection: CardSelectionState,
): SelectedCardEntry[] {
  if (!board || selection.pageIds.size === 0) return [];

  return board.columns.flatMap((column) =>
    column.cards
      .filter((card) => selection.pageIds.has(card.id))
      .map((card) => ({
        card,
        columnId: column.id,
        columnName: column.name,
      })),
  );
}

export function resolveDragGroup(
  board: BoardSummary | null,
  selection: CardSelectionState,
  activePage: {
    card: DatabasePageSummary;
    columnId: string;
  },
): SelectedCardEntry[] {
  if (!selection.pageIds.has(activePage.card.id) || selection.pageIds.size <= 1) {
    return [{
      card: activePage.card,
      columnId: activePage.columnId,
      columnName: board?.columns.find((column) => column.id === activePage.columnId)?.name
        ?? activePage.columnId,
    }];
  }

  const selectedEntries = resolveSelectedCardEntries(board, selection);
  if (selectedEntries.length === 0) {
    return [{
      card: activePage.card,
      columnId: activePage.columnId,
      columnName: board?.columns.find((column) => column.id === activePage.columnId)?.name
        ?? activePage.columnId,
    }];
  }

  return selectedEntries;
}
