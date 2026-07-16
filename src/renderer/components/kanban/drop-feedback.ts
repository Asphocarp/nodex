import type { BoardSummary, WorkflowStatus } from "@/lib/types";

export interface KanbanDropIndicatorState {
  columnId: WorkflowStatus;
  index: number;
  label?: string;
}

export interface ResolvedKanbanDropFeedback {
  dropIndicator: KanbanDropIndicatorState | null;
  activeDropColumnId: WorkflowStatus | null;
}

interface ResolveKanbanDropFeedbackInput {
  visibleBoard: BoardSummary | null;
  columnId: WorkflowStatus;
  visibleIndex: number;
  showSlotIndicator: boolean;
  label?: string;
}

function isEmptyVisibleColumn(
  visibleBoard: BoardSummary | null,
  columnId: WorkflowStatus,
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
