import type { BoardChangeEvent } from "../../shared/ipc-api";
import type { DatabaseViewPageRow } from "../../shared/database-views";
import type { BoardSummary, DatabasePageSummary } from "./types";

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
    return false;

  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord)
    .filter((key) => leftRecord[key] !== undefined)
    .sort();
  const rightKeys = Object.keys(rightRecord)
    .filter((key) => rightRecord[key] !== undefined)
    .sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && valuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
};

export const cardSummariesEqual = (
  left: DatabasePageSummary,
  right: DatabasePageSummary,
): boolean => valuesEqual(left, right);

export const boardSummariesEqual = (
  left: BoardSummary | null,
  right: BoardSummary | null,
): boolean => {
  if (left === right) return true;
  if (!left || !right || left.columns.length !== right.columns.length) return false;
  return left.columns.every((column, columnIndex) => {
    const other = right.columns[columnIndex];
    return (
      Boolean(other) &&
      column.id === other?.id &&
      column.name === other.name &&
      column.cards.length === other.cards.length &&
      column.cards.every((card, cardIndex) => {
        const otherCard = other.cards[cardIndex];
        return Boolean(otherCard) && cardSummariesEqual(card, otherCard as DatabasePageSummary);
      })
    );
  });
};

const reindexCards = (
  cards: readonly DatabasePageSummary[],
  previousCards: readonly DatabasePageSummary[] = [],
): DatabasePageSummary[] => {
  const previousById = new Map(previousCards.map((card) => [card.id, card]));
  return cards.map((card, index) => {
    const orderedCard = card.order === index ? card : { ...card, order: index };
    const previous = previousById.get(orderedCard.id);
    return previous && cardSummariesEqual(previous, orderedCard) ? previous : orderedCard;
  });
};

const cardRunsMatch = (
  left: readonly DatabasePageSummary[],
  right: readonly DatabasePageSummary[],
): boolean => left.length === right.length && left.every((card, index) => card === right[index]);

export function removePageSummaryFromBoard(board: BoardSummary, pageId: string): BoardSummary {
  let changed = false;
  const columns = board.columns.map((column) => {
    const withoutPage = column.cards.filter((card) => card.id !== pageId);
    const cards = reindexCards(withoutPage, column.cards);
    if (cards.length === column.cards.length) return column;
    changed = true;
    return { ...column, cards };
  });

  return changed ? { ...board, columns } : board;
}

export function upsertCardSummaryInBoard(
  board: BoardSummary,
  card: DatabasePageSummary,
): BoardSummary {
  const existing = board.columns
    .flatMap((column) => column.cards)
    .find((candidate) => candidate.id === card.id);
  const canonicalCard = existing && cardSummariesEqual(existing, card) ? existing : card;
  let changed = false;
  const columns = board.columns.map((column) => {
    const remaining = column.cards.filter((candidate) => candidate.id !== card.id);
    const shouldInsert = !card.archived && column.id === card.status;
    if (!shouldInsert) {
      if (remaining.length === column.cards.length) return column;
      changed = true;
      return { ...column, cards: reindexCards(remaining, column.cards) };
    }

    const insertionIndex = Math.min(Math.max(Math.trunc(card.order), 0), remaining.length);
    const nextCards = [...remaining];
    nextCards.splice(insertionIndex, 0, canonicalCard);
    const cards = reindexCards(nextCards, column.cards);
    if (cardRunsMatch(column.cards, cards)) return column;
    changed = true;
    return { ...column, cards };
  });

  return changed ? { ...board, columns } : board;
}

/**
 * A projection row's numeric `order` is only meaningful alongside all rows in
 * that bounded window. Rebuild each column from the rank-ordered row set so a
 * top/before upsert cannot collide with stale sibling ordinals.
 */
export function rebuildBoardFromRankedRows(
  board: BoardSummary,
  rows: readonly DatabaseViewPageRow[],
): BoardSummary {
  const rowsByStatus = new Map<string, DatabasePageSummary[]>();
  for (const row of rows) {
    if (row.page.archived) continue;
    const cards = rowsByStatus.get(row.page.status) ?? [];
    cards.push(row.page);
    rowsByStatus.set(row.page.status, cards);
  }

  let changed = false;
  const columns = board.columns.map((column) => {
    const cards = reindexCards(rowsByStatus.get(column.id) ?? [], column.cards);
    if (cardRunsMatch(column.cards, cards)) return column;
    changed = true;
    return { ...column, cards };
  });
  return changed ? { ...board, columns } : board;
}

export function applyBoardChangeEventToBoard(
  board: BoardSummary | undefined,
  event: BoardChangeEvent,
): BoardSummary | null {
  if (!board) return null;
  if (event.summary) return upsertCardSummaryInBoard(board, event.summary);
  if (event.changeType === "delete" && event.pageId) {
    return removePageSummaryFromBoard(board, event.pageId);
  }
  return null;
}
