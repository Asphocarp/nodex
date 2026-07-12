import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  beginLocalNativeEditorDrag,
  encodeBlockTransferDragPayload,
  endLocalNativeEditorDrag,
  NODEX_BLOCK_TRANSFER_DRAG_MIME,
} from "../cross-surface-drag";
import {
  resolveTopLevelDraggedBlocks,
} from "./dragged-block-roots";
import {
  setupKanbanCardTransferDrop,
  type BlockTransferDropBoundary,
} from "./block-transfer-drop";
import { resolveDraggedBlockIds } from "./drag-source-resolver";
import { finalizeSideMenuBlockDrag } from "./side-menu-drag-lifecycle";
import { setupToggleDrop } from "./toggle-drop";

interface UseEditorDragBehaviorsOptions {
  editor: Parameters<typeof setupToggleDrop>[1];
  containerRef: RefObject<HTMLElement | null>;
  crossSurface?: {
    readonly projectId: string;
    readonly documentId: string;
    readonly storeEpoch: string;
    readonly blockTransferDrop: BlockTransferDropBoundary;
  };
}

export function useEditorDragBehaviors({
  editor,
  containerRef,
  crossSurface,
}: UseEditorDragBehaviorsOptions) {
  const latestOptionsRef = useRef({ editor, crossSurface });

  useEffect(() => {
    latestOptionsRef.current = { editor, crossSurface };
  }, [editor, crossSurface]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let dropCleanupTimeout: number | undefined;

    const cleanupNativeDrag = () => {
      if (dropCleanupTimeout !== undefined) {
        window.clearTimeout(dropCleanupTimeout);
        dropCleanupTimeout = undefined;
      }

      const hadLocalDragState = el.hasAttribute("data-dragging");
      el.removeAttribute("data-dragging");
      endLocalNativeEditorDrag(el);
      const currentEditor = latestOptionsRef.current.editor;
      if (hadLocalDragState && currentEditor) {
        finalizeSideMenuBlockDrag(currentEditor);
      }
    };

    const onDragStart = (event: DragEvent) => {
      el.setAttribute("data-dragging", "");
      const current = latestOptionsRef.current;
      if (!current.editor || !current.crossSurface || !event.dataTransfer) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".nfm-editor") !== el) return;

      const draggedBlockIds = resolveDraggedBlockIds(current.editor, el);
      const blocks = resolveTopLevelDraggedBlocks(current.editor, draggedBlockIds);
      if (blocks.length === 0) return;
      event.dataTransfer.setData(
        NODEX_BLOCK_TRANSFER_DRAG_MIME,
        encodeBlockTransferDragPayload({
          projectId: current.crossSurface.projectId,
          storeEpoch: current.crossSurface.storeEpoch,
          source: {
            kind: "document",
            documentId: current.crossSurface.documentId,
          },
          rootBlockIds: blocks.map((block) => block.id),
          displayHints: blocks.map((block) => block.type),
        }),
      );
      beginLocalNativeEditorDrag(el);
      event.dataTransfer.effectAllowed = "copyMove";
    };

    const onDragEnd = () => {
      cleanupNativeDrag();
    };

    const scheduleDropCleanup = () => {
      if (!el.hasAttribute("data-dragging")) return;
      if (dropCleanupTimeout !== undefined) {
        window.clearTimeout(dropCleanupTimeout);
      }
      dropCleanupTimeout = window.setTimeout(() => {
        dropCleanupTimeout = undefined;
        cleanupNativeDrag();
      }, 0);
    };

    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", scheduleDropCleanup, true);
    window.addEventListener("dragend", scheduleDropCleanup, true);

    return () => {
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", scheduleDropCleanup, true);
      window.removeEventListener("dragend", scheduleDropCleanup, true);
      cleanupNativeDrag();
    };
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !editor) return;
    return setupToggleDrop(el, editor);
  }, [containerRef, editor]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !editor || !crossSurface) return;
    return setupKanbanCardTransferDrop(
      el,
      editor as unknown as Parameters<typeof setupKanbanCardTransferDrop>[1],
      crossSurface.blockTransferDrop,
    );
  }, [containerRef, crossSurface, editor]);
}
