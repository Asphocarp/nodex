import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/**
 * Closes the current user-visible history event without adding an event of its
 * own. ProseMirror consumes `closeHistory`; y-prosemirror consumes
 * `addToHistory: false` by stopping the current surface's Y.UndoManager capture.
 */
export function asHistoryBoundary(transaction: Transaction): Transaction {
  return closeHistory(transaction).setMeta("addToHistory", false);
}

export function dispatchHistoryBoundary(view: EditorView): void {
  view.dispatch(asHistoryBoundary(view.state.tr));
}
