/**
 * Backspace handler for child blocks inside any inline parent with child blocks.
 *
 * When Backspace is pressed at the start of a child block:
 * - nested classic list items and toggle list items exit list formatting in
 *   place by resetting to a paragraph
 * - other inline leaf children merge into the previous sibling (if one
 *   exists), otherwise into the parent block's inline content
 * - plain-text children and targets stay on BlockNote's content-model-aware
 *   boundary path
 *
 * This preserves root-level list-item Backspace semantics for nested list-like
 * children while still preventing BlockNote's default unindent/lift for the
 * general nested child-group case.
 */

interface BlockCursor {
  id: string;
  type: string;
}

interface BlockWithChildren {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown; // InlineContent[] at runtime; checked via Array.isArray
  children: { id: string }[];
}

interface TiptapView {
  state: {
    selection: {
      anchor: number;
      head: number;
      $anchor: { parentOffset: number; parent: { content: { size: number } } };
    };
  };
}

export interface EditorForChildGroupBackspace {
  schema: {
    acceptsBlockChildren: (block: { type: string; props?: Record<string, unknown> }) => boolean;
    blockSchema: Record<string, { content: "inline" | "plain" | "none" | "table" } | undefined>;
  };
  getTextCursorPosition: () => { block: BlockCursor };
  getBlock: (id: string) => BlockWithChildren | undefined;
  getParentBlock: (id: string) => BlockWithChildren | undefined;
  getPrevBlock: (id: string) => BlockWithChildren | undefined;
  updateBlock: (
    block: BlockWithChildren,
    update: { type: "paragraph"; props: Record<string, never> },
  ) => BlockWithChildren;
  /** Merge source block's content into target block, position cursor at join point, remove source. */
  mergeIntoBlock: (targetId: string, sourceId: string) => void;
  focus: () => void;
  transact: {
    <T>(fn: (tr: { selection: TiptapView["state"]["selection"] }) => T): T;
    (fn: () => void): void;
  };
}

function acceptsChildren(editor: EditorForChildGroupBackspace, block?: BlockWithChildren): boolean {
  if (!block) return false;
  return editor.schema.acceptsBlockChildren(block);
}

function isCursorAtBlockStart(editor: EditorForChildGroupBackspace): boolean {
  return editor.transact((tr) => {
    const { anchor, head, $anchor } = tr.selection;
    if (anchor !== head) return false;
    return $anchor.parentOffset === 0;
  });
}

function shouldResetToParagraphAtBlockStart(type: string): boolean {
  return (
    type === "bulletListItem" ||
    type === "numberedListItem" ||
    type === "checkListItem" ||
    type === "toggleListItem"
  );
}

export function handleChildGroupBackspace(editor: EditorForChildGroupBackspace): boolean {
  const cursor = editor.getTextCursorPosition();
  const currentBlock = editor.getBlock(cursor.block.id);
  if (!currentBlock) return false;
  if (currentBlock.children.length > 0) return false;

  const parent = editor.getParentBlock(currentBlock.id);
  if (!parent) return false;
  if (!acceptsChildren(editor, parent)) return false;
  if (!isCursorAtBlockStart(editor)) return false;

  const currentContentModel = editor.schema.blockSchema[currentBlock.type]?.content;
  if (currentContentModel !== "inline") return false;

  if (shouldResetToParagraphAtBlockStart(currentBlock.type)) {
    editor.updateBlock(currentBlock, { type: "paragraph", props: {} });
    editor.focus();
    return true;
  }

  // Merge target: previous sibling if exists, otherwise parent.
  const previousSibling = editor.getPrevBlock(currentBlock.id);
  const targetBlock = previousSibling ? editor.getBlock(previousSibling.id) : parent;
  if (!targetBlock) return false;
  if (editor.schema.blockSchema[targetBlock.type]?.content !== "inline") return false;

  // Both blocks must have array content to merge
  if (!Array.isArray(targetBlock.content) || !Array.isArray(currentBlock.content)) return false;

  editor.mergeIntoBlock(targetBlock.id, currentBlock.id);
  editor.focus();

  return true;
}
