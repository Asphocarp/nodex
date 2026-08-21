interface AtomicBackspaceBlock {
  readonly id: string;
  readonly type: string;
  readonly children?: readonly AtomicBackspaceBlock[];
}

interface AtomicBackspaceEditor {
  readonly document: readonly AtomicBackspaceBlock[];
  readonly schema: {
    readonly blockSchema: Readonly<Record<string, { readonly content?: string }>>;
  };
  readonly prosemirrorView?: {
    readonly state: {
      readonly selection: {
        readonly empty: boolean;
        readonly $from: {
          readonly parentOffset: number;
        };
      };
    };
  };
  getTextCursorPosition(): {
    readonly block: AtomicBackspaceBlock;
    readonly prevBlock?: AtomicBackspaceBlock;
  };
  getParentBlock(blockId: string): AtomicBackspaceBlock | undefined;
  setTextCursorPosition(blockId: string, placement: "end"): void;
  focus(): void;
}

const hasInlineContent = (editor: AtomicBackspaceEditor, block: AtomicBackspaceBlock): boolean =>
  editor.schema.blockSchema[block.type]?.content === "inline";

/**
 * Treats non-inline sibling Blocks as atomic cursor boundaries. Backspace from
 * the following text Block crosses the atomic run without deleting or merging
 * it, matching the editor's explicit Block-selection model.
 */
export function handleBackspaceAcrossAtomicBlocks(editor: AtomicBackspaceEditor): boolean {
  const view = editor.prosemirrorView;
  if (!view?.state.selection.empty || view.state.selection.$from.parentOffset !== 0) return false;

  const cursor = editor.getTextCursorPosition();
  if (!hasInlineContent(editor, cursor.block)) return false;
  if (!cursor.prevBlock || hasInlineContent(editor, cursor.prevBlock)) return false;

  const parent = editor.getParentBlock(cursor.block.id);
  const siblings = parent?.children ?? editor.document;
  const currentIndex = siblings.findIndex((block) => block.id === cursor.block.id);
  if (currentIndex < 0) return false;

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = siblings[index];
    if (!candidate || !hasInlineContent(editor, candidate)) continue;
    editor.setTextCursorPosition(candidate.id, "end");
    editor.focus();
    return true;
  }

  // There is no text leaf to move into. Still claim Backspace so the atomic
  // siblings cannot become an accidental merge/delete target.
  return true;
}
