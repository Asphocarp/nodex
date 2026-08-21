import type { BoardSummary, WorkflowStatus } from "@/lib/types";

interface ResolveFilteredDropOrderInput {
  board: BoardSummary | null;
  visibleBoard: BoardSummary | null;
  draggedPageIds: readonly string[];
  targetColumnId: WorkflowStatus;
  targetVisibleIndex: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function resolveFilteredDropOrder({
  board,
  visibleBoard,
  draggedPageIds,
  targetColumnId,
  targetVisibleIndex,
}: ResolveFilteredDropOrderInput): number {
  if (!board || !visibleBoard) {
    return 0;
  }

  const fullTargetColumn = board.columns.find((column) => column.id === targetColumnId);
  const visibleTargetColumn = visibleBoard.columns.find((column) => column.id === targetColumnId);
  if (!fullTargetColumn || !visibleTargetColumn) {
    return 0;
  }

  const draggedPageIdSet = new Set(draggedPageIds);
  const fullTargetPages = fullTargetColumn.cards;
  const visibleTargetPages = visibleTargetColumn.cards;
  const remainingTargetPages = fullTargetPages.filter((card) => !draggedPageIdSet.has(card.id));
  const visibleRemainingCards = visibleTargetPages.filter((card) => !draggedPageIdSet.has(card.id));
  const visibleInsertIndex = clamp(targetVisibleIndex, 0, visibleRemainingCards.length);

  if (visibleRemainingCards.length === 0) {
    const firstDraggedIndex = fullTargetPages.findIndex((card) => draggedPageIdSet.has(card.id));
    if (firstDraggedIndex < 0) {
      return remainingTargetPages.length;
    }

    return fullTargetPages
      .slice(0, firstDraggedIndex)
      .filter((card) => !draggedPageIdSet.has(card.id)).length;
  }

  if (visibleInsertIndex < visibleRemainingCards.length) {
    const anchorPageId = visibleRemainingCards[visibleInsertIndex]?.id;
    const anchorIndex = remainingTargetPages.findIndex((card) => card.id === anchorPageId);
    if (anchorIndex >= 0) {
      return anchorIndex;
    }
  }

  const lastVisiblePageId = visibleRemainingCards[visibleRemainingCards.length - 1]?.id;
  const lastVisibleIndex = remainingTargetPages.findIndex((card) => card.id === lastVisiblePageId);
  if (lastVisibleIndex >= 0) {
    return lastVisibleIndex + 1;
  }

  return remainingTargetPages.length;
}
