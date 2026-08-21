import type { BoardSummary, WorkflowStatus } from "@/lib/types";
import { computeNativeDropIndexFromSurface } from "./native-drop-index";
import {
  canDropOnBoardCard,
  isBoardCardEditorTransferTargetData,
  isBoardCardDropTargetData,
  isBoardCardDragData,
  isBoardColumnDropTargetData,
} from "./pragmatic-drag-data";

interface DropTargetRecordLike {
  data: Record<string | symbol, unknown>;
}

export interface ResolvedBoardDropLocation {
  columnId: WorkflowStatus;
  index: number;
}

export function resolveBoardDropLocation(args: {
  visibleBoard: BoardSummary | null;
  dropTargets: readonly DropTargetRecordLike[];
  sourceData?: unknown;
  draggedPageIds: readonly string[];
  pointerY: number | null;
  resolveColumnSurface: (columnId: string) => HTMLElement | null;
}): ResolvedBoardDropLocation | null {
  if (args.dropTargets.some((target) => isBoardCardEditorTransferTargetData(target.data))) {
    return null;
  }
  const ignoredPageIds = new Set(args.draggedPageIds);
  const sourceData = isBoardCardDragData(args.sourceData) ? args.sourceData : null;
  const pageTarget = args.dropTargets.find((target) => {
    if (!isBoardCardDropTargetData(target.data)) {
      return false;
    }

    if (!sourceData) {
      return !args.draggedPageIds.includes(target.data.pageId);
    }

    return canDropOnBoardCard({
      targetPageId: target.data.pageId,
      source: sourceData,
      instanceId: sourceData.instanceId,
    });
  });
  const resolvedColumnId =
    pageTarget && isBoardCardDropTargetData(pageTarget.data)
      ? pageTarget.data.columnId
      : (() => {
          const columnTarget = args.dropTargets.find((target) =>
            isBoardColumnDropTargetData(target.data),
          );
          if (!columnTarget || !isBoardColumnDropTargetData(columnTarget.data)) {
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
  const index =
    typeof args.pointerY === "number" && surface
      ? computeNativeDropIndexFromSurface(surface, args.pointerY, {
          ignoredPageIds,
        })
      : fallbackIndex;

  return {
    columnId: resolvedColumnId,
    index,
  };
}
