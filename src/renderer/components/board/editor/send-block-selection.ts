import { resolveDraggedBlockIds } from "./drag-source-resolver";
import { resolveTopLevelDraggedBlocks } from "./dragged-block-roots";
import type { DragSessionBlock, EditorForExternalBlockDrop } from "./external-block-drag-session";

export interface SendBlockSelection {
  blockIds: string[];
  blocks: DragSessionBlock[];
}

/**
 * Resolves a stable top-level block selection for menu-driven "send block(s)"
 * actions. Falls back to the drag-handle block when no explicit selection exists.
 */
export function resolveSendBlockSelection(
  editor: EditorForExternalBlockDrop,
  container: HTMLElement,
  fallbackBlockId: string,
  retainedBlockIds?: readonly string[],
): SendBlockSelection {
  const candidateIds =
    retainedBlockIds ??
    (() => {
      const draggedIds = resolveDraggedBlockIds(editor, container);
      return draggedIds.length > 0 ? draggedIds : [fallbackBlockId];
    })();

  const uniqueIds = Array.from(
    new Set(candidateIds.filter((id) => typeof id === "string" && id.length > 0)),
  );
  if (uniqueIds.length === 0) {
    return { blockIds: [], blocks: [] };
  }

  const topLevelBlocks = resolveTopLevelDraggedBlocks(editor, uniqueIds);
  return {
    blockIds: topLevelBlocks.map((block) => block.id),
    blocks: [...topLevelBlocks],
  };
}
