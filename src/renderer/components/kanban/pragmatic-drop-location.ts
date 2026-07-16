import type { BoardSummary, WorkflowStatus } from "@/lib/types";
import { computeNativeDropIndexFromSurface } from "./native-drop-index";
import {
  canDropOnKanbanCard,
  isKanbanCardEditorTransferTargetData,
  isKanbanCardDropTargetData,
  isKanbanCardDragData,
  isKanbanColumnDropTargetData,
} from "./pragmatic-drag-data";

interface DropTargetRecordLike {
  data: Record<string | symbol, unknown>;
}

export interface ResolvedKanbanDropLocation {
  columnId: WorkflowStatus;
  index: number;
}

export function resolveKanbanDropLocation(args: {
  visibleBoard: BoardSummary | null;
  dropTargets: readonly DropTargetRecordLike[];
  sourceData?: unknown;
  draggedPageIds: readonly string[];
  pointerY: number | null;
  resolveColumnSurface: (columnId: string) => HTMLElement | null;
}): ResolvedKanbanDropLocation | null {
  if (args.dropTargets.some((target) =>
    isKanbanCardEditorTransferTargetData(target.data))) {
    return null;
  }
  const ignoredPageIds = new Set(args.draggedPageIds);
  const sourceData = isKanbanCardDragData(args.sourceData) ? args.sourceData : null;
  const pageTarget = args.dropTargets.find((target) => {
    if (!isKanbanCardDropTargetData(target.data)) {
      return false;
    }

    if (!sourceData) {
      return !args.draggedPageIds.includes(target.data.pageId);
    }

    return canDropOnKanbanCard({
      targetPageId: target.data.pageId,
      source: sourceData,
      instanceId: sourceData.instanceId,
    });
  });
  const resolvedColumnId = pageTarget && isKanbanCardDropTargetData(pageTarget.data)
    ? pageTarget.data.columnId
    : (() => {
      const columnTarget = args.dropTargets.find((target) => isKanbanColumnDropTargetData(target.data));
      if (!columnTarget || !isKanbanColumnDropTargetData(columnTarget.data)) {
        return null;
      }
      return columnTarget.data.columnId;
    })();
  if (!resolvedColumnId) {
    return null;
  }

  const targetColumn = args.visibleBoard?.columns.find((column) => column.id === resolvedColumnId);
  const fallbackIndex = targetColumn?.cards.length ?? 0;
  const surface = args.resolveColumnSurface(resolvedColumnId);
  const index = typeof args.pointerY === "number" && surface
    ? computeNativeDropIndexFromSurface(surface, args.pointerY, {
      ignoredPageIds,
    })
    : fallbackIndex;

  return {
    columnId: resolvedColumnId,
    index,
  };
}
