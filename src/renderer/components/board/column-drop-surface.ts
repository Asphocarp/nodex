import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { WorkflowStatus } from "@/lib/types";
import {
  buildBoardColumnDropTargetData,
  type BoardCardDragData,
} from "./pragmatic-drag-data";

export interface BindBoardColumnDropSurfaceInput {
  columnId: WorkflowStatus;
  columnDropDisabled: boolean;
  dragInstanceId?: symbol;
  element: HTMLElement | null;
  scrollElement: HTMLElement | null;
}

interface ColumnDropSurfaceDeps {
  autoScrollForElements: typeof autoScrollForElements;
  combine: typeof combine;
  dropTargetForElements: typeof dropTargetForElements;
}

const DEFAULT_DEPS: ColumnDropSurfaceDeps = {
  autoScrollForElements,
  combine,
  dropTargetForElements,
};

function canDropBoardCard(source: { data: Record<string | symbol, unknown> }, dragInstanceId: symbol): boolean {
  const data = source.data as Partial<BoardCardDragData>;
  return data.type === "board-card"
    && data.instanceId === dragInstanceId;
}

export function bindBoardColumnDropSurface(
  input: BindBoardColumnDropSurfaceInput,
  deps: ColumnDropSurfaceDeps = DEFAULT_DEPS,
): (() => void) | undefined {
  if (input.columnDropDisabled || !input.dragInstanceId || !input.element) {
    return undefined;
  }

  const dropCleanup = deps.dropTargetForElements({
    element: input.element,
    canDrop: ({ source }) => canDropBoardCard(source, input.dragInstanceId as symbol),
    getIsSticky: () => true,
    getData: () => buildBoardColumnDropTargetData({
      instanceId: input.dragInstanceId as symbol,
      columnId: input.columnId,
    }),
  });

  if (!input.scrollElement) {
    return dropCleanup;
  }

  const autoScrollCleanup = deps.autoScrollForElements({
    element: input.scrollElement,
    canScroll: ({ source }) => canDropBoardCard(source, input.dragInstanceId as symbol),
  });

  return deps.combine(dropCleanup, autoScrollCleanup);
}
