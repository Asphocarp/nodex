import { AllSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { findSelectedEditableLeaf, selectEditableLeafContent } from "@/lib/editable-leaf-selection";
import { blockHasEditableTextContent } from "./block-content-capabilities";

interface BlockCursor {
  id: string;
  type: string;
}

interface EditorWithSelectShortcut {
  domElement?: ParentNode;
  prosemirrorView?: {
    readonly state: EditorState;
    readonly dispatch: (transaction: Transaction) => void;
  };
  schema: { blockSchema: Record<string, { content?: string }> };
  getTextCursorPosition: () => { block: BlockCursor };
}

function getBrowserSelection(): Selection | null {
  if (typeof window === "undefined") return null;
  return window.getSelection();
}

function selectEditorContent(editor: EditorWithSelectShortcut): boolean {
  const view = editor.prosemirrorView;
  if (!view) return false;
  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
  return true;
}

/** Keeps managed text selection in editor state so NodeView decoration updates cannot collapse it. */
function selectProseMirrorTextContent(editor: EditorWithSelectShortcut): boolean {
  const view = editor.prosemirrorView;
  if (!view) return false;

  const { selection } = view.state;
  if (!selection.$anchor.sameParent(selection.$head)) return selectEditorContent(editor);
  if (!selection.$anchor.parent.isTextblock) return false;

  const from = selection.$anchor.start();
  const to = selection.$anchor.end();
  if (selection.from <= from && selection.to >= to) return selectEditorContent(editor);

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
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
  if (!blockHasEditableTextContent(editor.schema, cursor.block.type)) return false;
  return selectProseMirrorTextContent(editor);
}
