import { resolveDraggedBlockIds } from "./drag-source-resolver";
import type { DragSessionBlock, EditorForExternalBlockDrop } from "./external-block-drag-session";

export interface SendBlockSelection {
  blockIds: string[];
  blocks: DragSessionBlock[];
}

const resolveTopLevelBlocks = (
  editor: EditorForExternalBlockDrop,
  blockIds: readonly string[],
): DragSessionBlock[] => {
  const selectedIds = new Set(blockIds);
  return blockIds
    .filter((id) => {
      let parent = editor.getParentBlock(id);
      while (parent) {
        if (selectedIds.has(parent.id)) return false;
        parent = editor.getParentBlock(parent.id);
      }
      return true;
    })
    .map((id) => editor.getBlock(id))
    .filter((block): block is DragSessionBlock => block !== undefined);
};

/**
 * Resolves a stable top-level block selection for menu-driven "send block(s)"
 * actions. Falls back to the drag-handle block when no explicit selection exists.
 */
export function resolveSendBlockSelection(
  editor: EditorForExternalBlockDrop,
  container: HTMLElement,
  fallbackBlockId: string,
): SendBlockSelection {
  const draggedIds = resolveDraggedBlockIds(editor, container);
  const candidateIds = draggedIds.length > 0 ? draggedIds : [fallbackBlockId];

  const uniqueIds = Array.from(
    new Set(candidateIds.filter((id) => typeof id === "string" && id.length > 0)),
  );
  if (uniqueIds.length === 0) {
    return { blockIds: [], blocks: [] };
  }

  const topLevelBlocks = resolveTopLevelBlocks(editor, uniqueIds);
  return {
    blockIds: topLevelBlocks.map((block) => block.id),
    blocks: topLevelBlocks,
  };
}
