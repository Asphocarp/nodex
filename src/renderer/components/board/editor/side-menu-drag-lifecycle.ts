import { SideMenuExtension } from "@blocknote/core/extensions";

interface SideMenuDragLifecycle {
  blockDragEnd: () => void;
}

export interface SideMenuDragCleanupEditor {
  prosemirrorView?: {
    dragging?: unknown;
    root?: Document | ShadowRoot;
  };
  getExtension?: (extension: unknown) => unknown;
}

type ProseMirrorDragView = NonNullable<SideMenuDragCleanupEditor["prosemirrorView"]>;

function supportsSideMenuDragLifecycle(value: unknown): value is SideMenuDragLifecycle {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { blockDragEnd?: unknown }).blockDragEnd === "function";
}

function removeDanglingDragPreviews(rootEl: Document | ShadowRoot | undefined): void {
  if (!rootEl) return;
  for (const element of rootEl.querySelectorAll(".bn-drag-preview")) {
    element.remove();
  }
}

function getMountedProseMirrorView(
  editor: SideMenuDragCleanupEditor,
): ProseMirrorDragView | undefined {
  try {
    return editor.prosemirrorView;
  } catch {
    return undefined;
  }
}

function getMountedProseMirrorRoot(
  pmView: ProseMirrorDragView | undefined,
): Document | ShadowRoot | undefined {
  if (!pmView) return undefined;
  try {
    return pmView.root;
  } catch {
    return undefined;
  }
}

function clearProseMirrorDragging(pmView: ProseMirrorDragView | undefined): void {
  if (!pmView || !("dragging" in pmView)) return;
  try {
    pmView.dragging = null;
  } catch {
    // Tiptap can invalidate view-backed properties before React cleanup runs.
  }
}

function getSideMenuDragLifecycle(
  editor: SideMenuDragCleanupEditor,
): SideMenuDragLifecycle | undefined {
  if (typeof editor.getExtension !== "function") return undefined;
  try {
    const sideMenuExtension = editor.getExtension(SideMenuExtension);
    if (!supportsSideMenuDragLifecycle(sideMenuExtension)) return undefined;
    return sideMenuExtension;
  } catch {
    return undefined;
  }
}

export function finalizeSideMenuBlockDrag(editor: SideMenuDragCleanupEditor): void {
  const pmView = getMountedProseMirrorView(editor);
  const rootEl = getMountedProseMirrorRoot(pmView);

  clearProseMirrorDragging(pmView);

  const sideMenuExtension = getSideMenuDragLifecycle(editor);
  if (rootEl && sideMenuExtension) {
    sideMenuExtension.blockDragEnd();
  }
  removeDanglingDragPreviews(rootEl ?? (typeof document !== "undefined" ? document : undefined));
}
