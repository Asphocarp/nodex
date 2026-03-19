import type { Board, CardStatus } from "@/lib/types";

export interface KanbanDropIndicatorState {
  columnId: CardStatus;
  index: number;
  label?: string;
}

export interface ResolvedKanbanDropFeedback {
  dropIndicator: KanbanDropIndicatorState | null;
  activeDropColumnId: CardStatus | null;
}

interface ResolveKanbanDropFeedbackInput {
  visibleBoard: Board | null;
  columnId: CardStatus;
  visibleIndex: number;
  showSlotIndicator: boolean;
  label?: string;
}

function isEmptyVisibleColumn(
  visibleBoard: Board | null,
  columnId: CardStatus,
): boolean {
  const targetColumn = visibleBoard?.columns.find((column) => column.id === columnId);
  return (targetColumn?.cards.length ?? 0) === 0;
}

export function resolveKanbanDropFeedback(
  input: ResolveKanbanDropFeedbackInput,
): ResolvedKanbanDropFeedback {
  if (!input.showSlotIndicator || isEmptyVisibleColumn(input.visibleBoard, input.columnId)) {
    return {
      dropIndicator: null,
      activeDropColumnId: input.columnId,
    };
  }

  return {
    dropIndicator: {
      columnId: input.columnId,
      index: input.visibleIndex,
      ...(input.label ? { label: input.label } : {}),
    },
    activeDropColumnId: null,
  };
}
