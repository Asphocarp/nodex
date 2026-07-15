import type { BoardChangeEvent } from "../../shared/ipc-api";
import type { BoardSummary, CardSummary } from "./types";

export function removeCardSummaryFromBoard(board: BoardSummary, cardId: string): BoardSummary {
  let changed = false;
  const columns = board.columns.map((column) => {
    const cards = column.cards.filter((card) => card.id !== cardId);
    if (cards.length === column.cards.length) return column;
    changed = true;
    return { ...column, cards };
  });

  return changed ? { ...board, columns } : board;
}

export function upsertCardSummaryInBoard(board: BoardSummary, card: CardSummary): BoardSummary {
  const boardWithoutCard = removeCardSummaryFromBoard(board, card.id);
  if (card.archived) return boardWithoutCard;

  const targetColumnIndex = boardWithoutCard.columns.findIndex((column) => column.id === card.status);
  if (targetColumnIndex < 0) return boardWithoutCard;

  const targetColumn = boardWithoutCard.columns[targetColumnIndex];
  if (!targetColumn) return boardWithoutCard;

  const cards = [...targetColumn.cards, card].sort(
    (left, right) =>
      left.order - right.order || left.id.localeCompare(right.id),
  );
  const columns = boardWithoutCard.columns.map((column, index) =>
    index === targetColumnIndex ? { ...column, cards } : column
  );
  return { ...boardWithoutCard, columns };
}

export function applyBoardChangeEventToBoard(
  board: BoardSummary | undefined,
  event: BoardChangeEvent,
): BoardSummary | null {
  if (!board) return null;
  if (event.summary) return upsertCardSummaryInBoard(board, event.summary);
  if (event.changeType === "delete" && event.cardId) {
    return removeCardSummaryFromBoard(board, event.cardId);
  }
  return null;
}
