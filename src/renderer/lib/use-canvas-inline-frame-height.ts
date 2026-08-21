import { useCallback, useLayoutEffect, useRef, type RefCallback } from "react";

import {
  createCanvasInlineFramePersistence,
  DEFAULT_CANVAS_INLINE_FRAME_HEIGHT_PX,
  normalizeCanvasInlineFramePreference,
  readCanvasInlineFramePreference,
} from "./canvas-presentation-preference";
import { readResizeObserverBorderBoxSize } from "./resize-observer-size";

export function useCanvasInlineFrameHeight(input: {
  readonly canvasBlockId: string;
  readonly storeEpoch: string | null;
  readonly expanded: boolean;
}): RefCallback<HTMLDivElement> {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const latestHeightRef = useRef(DEFAULT_CANVAS_INLINE_FRAME_HEIGHT_PX);
  const setElementRef = useCallback((element: HTMLDivElement | null) => {
    elementRef.current = element;
  }, []);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (!input.expanded) {
      element.style.removeProperty("height");
      return;
    }

    const identity = input.storeEpoch
      ? {
          storeEpoch: input.storeEpoch,
          canvasBlockId: input.canvasBlockId,
        }
      : null;
    const restored = identity ? readCanvasInlineFramePreference(identity) : null;
    latestHeightRef.current = restored?.heightPx ?? DEFAULT_CANVAS_INLINE_FRAME_HEIGHT_PX;
    element.style.height = `${latestHeightRef.current}px`;
    if (!identity) return;

    const persistence = createCanvasInlineFramePersistence(identity);
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            const entry = entries.find((candidate) => candidate.target === element);
            if (!entry) return;
            const measuredHeight = readResizeObserverBorderBoxSize(entry).height;
            if (measuredHeight <= 0) return;
            const normalized = normalizeCanvasInlineFramePreference({
              heightPx: measuredHeight,
            });
            if (!normalized) return;
            latestHeightRef.current = normalized.heightPx;
            persistence.observe(normalized);
          })
        : null;
    observer?.observe(element, { box: "border-box" });

    const flush = (): void => {
      persistence.observe({ heightPx: latestHeightRef.current });
      persistence.flush();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      observer?.disconnect();
      flush();
      persistence.dispose();
    };
  }, [input.canvasBlockId, input.expanded, input.storeEpoch]);

  return setElementRef;
}
