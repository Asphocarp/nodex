import type {
  BlockDocumentMutationBarrier,
  DocumentHeadFence,
} from "@/lib/block-document-surface-runtime";
import {
  finalizeSideMenuBlockDrag,
  type SideMenuDragCleanupEditor,
} from "./side-menu-drag-lifecycle";

export interface NfmEditorMutationRuntime {
  readonly isFocused?: () => boolean;
  readonly isWithinEditor?: (element: Element) => boolean;
  readonly blur?: () => void;
}

export type NfmEditorStructuralMutationRuntime =
  NfmEditorMutationRuntime & SideMenuDragCleanupEditor;

export const prepareNfmEditorForMutation = async (
  editor: NfmEditorMutationRuntime,
  container: HTMLElement,
): Promise<void> => {
  const activeElement = container.ownerDocument.activeElement;
  const ownsFocus =
    activeElement instanceof Element &&
    (container.contains(activeElement) ||
      editor.isWithinEditor?.(activeElement) === true);
  if (ownsFocus && activeElement instanceof HTMLElement) activeElement.blur();
  if (ownsFocus || editor.isFocused?.()) editor.blur?.();
  await Promise.resolve();
};

/** Settles editor-only drag/focus state before Core observes a causal head. */
export const prepareNfmEditorStructuralMutation = async (
  editor: NfmEditorStructuralMutationRuntime,
  container: HTMLElement,
  barrier: BlockDocumentMutationBarrier,
): Promise<DocumentHeadFence> => {
  finalizeSideMenuBlockDrag(editor);
  await prepareNfmEditorForMutation(editor, container);
  return await barrier.flushAndFence();
};
