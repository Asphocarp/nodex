import {
  AllSelection,
  NodeSelection,
  Selection,
  TextSelection,
} from "prosemirror-state";
import type { ProsemirrorBinding } from "y-prosemirror";
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "y-prosemirror";
import * as Y from "yjs";
import type { BlockNoteEditor } from "../editor/BlockNoteEditor.js";
import type { BlockSchema } from "../schema/blocks/types.js";
import type { InlineContentSchema } from "../schema/inlineContent/types.js";
import type { StyleSchema } from "../schema/styles/types.js";

export interface CollaborativeSelectionBookmark {
  readonly type: "all" | "node" | "text";
  readonly anchor: Y.RelativePosition;
  readonly head: Y.RelativePosition;
}

interface CollaborativeSelectionSyncState {
  readonly doc: Y.Doc;
  readonly type: Y.AbstractType<unknown>;
  readonly binding?: ProsemirrorBinding;
}

const getCollaborativeSelectionSyncState = <
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
): CollaborativeSelectionSyncState | null => {
  const state = ySyncPluginKey.getState(editor.prosemirrorState) as
    | CollaborativeSelectionSyncState
    | undefined;
  if (!state?.binding) return null;
  return state;
};

const getSelectionType = (
  selection: Selection,
): CollaborativeSelectionBookmark["type"] => {
  if (selection instanceof AllSelection) return "all";
  if (selection instanceof NodeSelection) return "node";
  return "text";
};

/**
 * Captures a collaborative selection independently from the current
 * ProseMirror document shape. The returned Yjs-relative positions remain
 * attached to the same logical content while remote changes are applied.
 */
export function captureCollaborativeSelection<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
): CollaborativeSelectionBookmark | null {
  const syncState = getCollaborativeSelectionSyncState(editor);
  if (!syncState?.binding) return null;

  const selection = editor.prosemirrorState.selection;
  return {
    type: getSelectionType(selection),
    anchor: absolutePositionToRelativePosition(
      selection.anchor,
      syncState.binding.type,
      syncState.binding.mapping,
    ),
    head: absolutePositionToRelativePosition(
      selection.head,
      syncState.binding.type,
      syncState.binding.mapping,
    ),
  };
}

/**
 * Restores a selection captured from the same collaborative fragment. Call
 * this after mounting so y-prosemirror has reconciled the EditorView with the
 * latest Y.Doc state.
 */
export function restoreCollaborativeSelection<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
  bookmark: CollaborativeSelectionBookmark,
): boolean {
  const view = editor.prosemirrorView;
  if (!view) return false;

  const syncState = getCollaborativeSelectionSyncState(editor);
  if (!syncState?.binding) return false;

  const anchor = relativePositionToAbsolutePosition(
    syncState.doc,
    syncState.binding.type,
    bookmark.anchor,
    syncState.binding.mapping,
  );
  const head = relativePositionToAbsolutePosition(
    syncState.doc,
    syncState.binding.type,
    bookmark.head,
    syncState.binding.mapping,
  );
  if (anchor === null || head === null) return false;

  const state = editor.prosemirrorState;
  const clampedAnchor = Math.min(Math.max(anchor, 0), state.doc.content.size);
  const clampedHead = Math.min(Math.max(head, 0), state.doc.content.size);
  let selection: Selection;

  try {
    if (bookmark.type === "all") {
      selection = new AllSelection(state.doc);
    } else if (bookmark.type === "node") {
      selection = NodeSelection.create(state.doc, clampedAnchor);
    } else {
      selection = TextSelection.between(
        state.doc.resolve(clampedAnchor),
        state.doc.resolve(clampedHead),
      );
    }
  } catch {
    selection = Selection.near(state.doc.resolve(clampedHead));
  }

  view.dispatch(
    state.tr.setSelection(selection).setMeta("addToHistory", false),
  );
  return true;
}
