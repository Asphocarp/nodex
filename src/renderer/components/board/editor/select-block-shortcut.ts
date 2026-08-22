import { findBlockDescendantById } from "./block-dom-selectors";
import { AllSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { findSelectedEditableLeaf, selectEditableLeafContent } from "@/lib/editable-leaf-selection";

interface BlockCursor {
  id: string;
  type: string;
}

interface BlockConfig {
  content?: string;
}

interface EditorWithSelectShortcut {
  domElement?: ParentNode;
  prosemirrorView?: {
    readonly state: EditorState;
    readonly dispatch: (transaction: Transaction) => void;
  };
  schema: { blockSchema: Record<string, BlockConfig> };
  getTextCursorPosition: () => { block: BlockCursor };
}

function getBrowserSelection(): Selection | null {
  if (typeof window === "undefined") return null;
  return window.getSelection();
}

function isInlineBlock(editor: EditorWithSelectShortcut, blockType: string): boolean {
  const blockConfig = editor.schema.blockSchema[blockType];
  return blockConfig?.content === "inline";
}

export function findInlineContentForBlock(
  editorDom: ParentNode | undefined,
  blockId: string,
): HTMLElement | null {
  return findBlockDescendantById<HTMLElement>(editorDom, blockId, ".bn-inline-content");
}

function selectEditorContent(editor: EditorWithSelectShortcut): boolean {
  const view = editor.prosemirrorView;
  if (!view) return false;
  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
  return true;
}

function selectLeafThenEditor(
  editor: EditorWithSelectShortcut,
  leaf: HTMLElement,
  selection: Selection,
): boolean {
  if (selectEditableLeafContent(leaf, selection)) return true;
  return selectEditorContent(editor);
}

export function selectCurrentBlockContent(
  editor: EditorWithSelectShortcut,
  selection: Selection | null = getBrowserSelection(),
): boolean {
  if (!selection) return false;

  const editableLeaf = findSelectedEditableLeaf(editor.domElement, selection);
  if (editableLeaf) return selectLeafThenEditor(editor, editableLeaf, selection);

  const cursor = editor.getTextCursorPosition();
  if (!isInlineBlock(editor, cursor.block.type)) return false;

  const inlineContent = findInlineContentForBlock(editor.domElement, cursor.block.id);
  if (!inlineContent) return false;
  return selectLeafThenEditor(editor, inlineContent, selection);
}
