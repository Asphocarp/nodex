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
}

export type AtomicBlockBackspacePlan =
  | { readonly kind: "protect_boundary" }
  | {
      readonly kind: "merge";
      readonly sourceBlockId: string;
      readonly targetBlockId: string;
    };

const hasInlineContent = (editor: AtomicBackspaceEditor, block: AtomicBackspaceBlock): boolean =>
  editor.schema.blockSchema[block.type]?.content === "inline";

/**
 * Plans the semantic merge behind Backspace at an atomic boundary.
 *
 * Non-paragraph Blocks deliberately fall through so BlockNote can first run
 * its normal type reset/list-exit command. Adjacent text Blocks also fall
 * through to BlockNote's mature local merge implementation.
 */
export function planBackspaceAcrossAtomicBlocks(
  editor: AtomicBackspaceEditor,
): AtomicBlockBackspacePlan | null {
  const view = editor.prosemirrorView;
  if (!view?.state.selection.empty || view.state.selection.$from.parentOffset !== 0) return null;

  const cursor = editor.getTextCursorPosition();
  if (cursor.block.type !== "paragraph") return null;
  if (!cursor.prevBlock || hasInlineContent(editor, cursor.prevBlock)) return null;

  const parent = editor.getParentBlock(cursor.block.id);
  const siblings = parent?.children ?? editor.document;
  const currentIndex = siblings.findIndex((block) => block.id === cursor.block.id);
  if (currentIndex < 0) return null;

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = siblings[index];
    if (!candidate || !hasInlineContent(editor, candidate)) continue;
    return {
      kind: "merge",
      sourceBlockId: cursor.block.id,
      targetBlockId: candidate.id,
    };
  }

  // Claim the key so the default joinBackward path cannot delete the atomic
  // boundary when there is no editable target in this sibling group.
  return { kind: "protect_boundary" };
}
