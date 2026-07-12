import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  encodeBlockCardCopyDragPayload,
  encodeCardReferenceDragPayload,
  NODEX_BLOCK_CARD_COPIES_DRAG_MIME,
  NODEX_CARD_REFERENCES_DRAG_MIME,
} from "../cross-surface-drag";
import {
  mapBlocksToCardCopies,
  mapCanonicalCardReferences,
  resolveTopLevelDraggedBlocks,
} from "./block-card-copy-mapper";
import {
  setupCardReferenceDrop,
  type CardReferenceDropBoundary,
} from "./card-reference-drop";
import { resolveDraggedBlockIds } from "./drag-source-resolver";
import { finalizeSideMenuBlockDrag } from "./side-menu-drag-lifecycle";
import { setupToggleDrop } from "./toggle-drop";

interface UseEditorDragBehaviorsOptions {
  editor: Parameters<typeof setupToggleDrop>[1];
  containerRef: RefObject<HTMLElement | null>;
  crossSurface?: {
    readonly projectId: string;
    readonly cardReferenceDrop: CardReferenceDropBoundary;
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
      const cardReferences = mapCanonicalCardReferences(
        blocks,
        current.crossSurface.projectId,
      );
      if (cardReferences) {
        event.dataTransfer.setData(
          NODEX_CARD_REFERENCES_DRAG_MIME,
          encodeCardReferenceDragPayload(cardReferences),
        );
        event.dataTransfer.effectAllowed = "linkMove";
        return;
      }

      const cards = mapBlocksToCardCopies(blocks);
      if (cards.length === 0) return;
      event.dataTransfer.setData(
        NODEX_BLOCK_CARD_COPIES_DRAG_MIME,
        encodeBlockCardCopyDragPayload({
          sourceProjectId: current.crossSurface.projectId,
          cards,
        }),
      );
      event.dataTransfer.effectAllowed = "copy";
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
    return setupCardReferenceDrop(
      el,
      editor as unknown as Parameters<typeof setupCardReferenceDrop>[1],
      crossSurface.cardReferenceDrop,
    );
  }, [containerRef, crossSurface, editor]);
}
