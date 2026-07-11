import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { finalizeSideMenuBlockDrag } from "./side-menu-drag-lifecycle";
import { setupToggleDrop } from "./toggle-drop";

interface UseEditorDragBehaviorsOptions {
  editor: Parameters<typeof setupToggleDrop>[1];
  containerRef: RefObject<HTMLElement | null>;
}

export function useEditorDragBehaviors({
  editor,
  containerRef,
}: UseEditorDragBehaviorsOptions) {
  const latestEditorRef = useRef(editor);

  useEffect(() => {
    latestEditorRef.current = editor;
  }, [editor]);

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
      const currentEditor = latestEditorRef.current;
      if (hadLocalDragState && currentEditor) {
        finalizeSideMenuBlockDrag(currentEditor);
      }
    };

    const onDragStart = (event: DragEvent) => {
      void event;
      el.setAttribute("data-dragging", "");
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
}
