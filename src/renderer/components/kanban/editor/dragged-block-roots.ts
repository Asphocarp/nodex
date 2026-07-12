export interface DraggableEditorBlock {
  readonly id: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly content?: unknown;
  readonly children?: readonly DraggableEditorBlock[];
}

/** Remove selected descendants so one transfer never duplicates a subtree. */
export const resolveTopLevelDraggedBlocks = (
  editor: {
    getBlock: (id: string) => DraggableEditorBlock | undefined;
    getParentBlock: (id: string) => DraggableEditorBlock | undefined;
  },
  draggedIds: readonly string[],
): readonly DraggableEditorBlock[] => {
  const selected = new Set(draggedIds);
  return draggedIds
    .filter((id) => {
      let parent = editor.getParentBlock(id);
      while (parent) {
        if (selected.has(parent.id)) return false;
        parent = editor.getParentBlock(parent.id);
      }
      return true;
    })
    .map((id) => editor.getBlock(id))
    .filter((block): block is DraggableEditorBlock => block !== undefined);
};
