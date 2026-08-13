import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  clampUnitInterval,
  computeImagePointDistance,
  computePinchZoomPercent,
  computeWheelZoomPercent,
  computeZoomAnchorCorrection,
  computeZoomViewportCenter,
  IMAGE_PINCH_CLICK_SUPPRESSION_MS,
} from "../model/image-geometry";
import { readImageEditorWindowZoom } from "../model/generated-image-view-transition";

interface ViewportPoint {
  clientX: number;
  clientY: number;
}

interface PinchSample {
  distance: number;
  zoomPercent: number;
}

export function useImageZoomGestures(args: {
  onZoomPercentChange: (zoomPercent: number) => void;
  zoomPercent: number;
}) {
  const { onZoomPercentChange, zoomPercent } = args;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomTargetRef = useRef<HTMLDivElement | null>(null);
  const pinchRef = useRef<PinchSample | null>(null);
  const lastPointerRef = useRef<ViewportPoint | null>(null);
  const lastPinchEndAtRef = useRef(0);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

  const viewportCenter = useCallback((element: HTMLElement): ViewportPoint => {
    const rect = element.getBoundingClientRect();
    const center = computeZoomViewportCenter({
      direction: getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr",
      viewportRect: rect,
      windowZoom: readImageEditorWindowZoom(element),
    });
    return { clientX: center.x, clientY: center.y };
  }, []);

  const setZoomAtPoint = useCallback((
    zoomPercent: number,
    point: ViewportPoint,
  ) => {
    const scroller = scrollContainerRef.current;
    const target = zoomTargetRef.current;
    if (!scroller || !target) {
      onZoomPercentChange(zoomPercent);
      return;
    }
    const before = target.getBoundingClientRect();
    const anchorX = before.width > 0
      ? clampUnitInterval((point.clientX - before.left) / before.width)
      : 0.5;
    const anchorY = before.height > 0
      ? clampUnitInterval((point.clientY - before.top) / before.height)
      : 0.5;
    flushSync(() => onZoomPercentChange(zoomPercent));
    if (!scroller.isConnected || !target.isConnected) return;
    const after = target.getBoundingClientRect();
    const correction = computeZoomAnchorCorrection({
      anchorClientPoint: { x: point.clientX, y: point.clientY },
      anchorRatio: { x: anchorX, y: anchorY },
      nextTargetRect: after,
      windowZoom: readImageEditorWindowZoom(target),
    });
    scroller.scrollLeft += correction.x;
    scroller.scrollTop += correction.y;
  }, [onZoomPercentChange]);

  useEffect(() => {
    if (!scrollContainer) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const next = computeWheelZoomPercent(zoomPercent, event.deltaY);
      if (next === zoomPercent) return;
      const point = event.clientX === 0 && event.clientY === 0
        ? lastPointerRef.current ?? viewportCenter(scrollContainer)
        : { clientX: event.clientX, clientY: event.clientY };
      setZoomAtPoint(next, point);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        pinchRef.current = null;
        return;
      }
      event.preventDefault();
      const first = event.touches.item(0);
      const second = event.touches.item(1);
      if (!first || !second) return;
      pinchRef.current = {
        distance: computeImagePointDistance(
          { x: first.clientX, y: first.clientY },
          { x: second.clientX, y: second.clientY },
        ),
        zoomPercent,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (event.touches.length !== 2 || !pinch) return;
      event.preventDefault();
      event.stopPropagation();
      const first = event.touches.item(0);
      const second = event.touches.item(1);
      if (!first || !second) return;
      const next = computePinchZoomPercent({
        initialDistance: pinch.distance,
        initialZoomPercent: pinch.zoomPercent,
        nextDistance: computeImagePointDistance(
          { x: first.clientX, y: first.clientY },
          { x: second.clientX, y: second.clientY },
        ),
      });
      if (next === zoomPercent) return;
      setZoomAtPoint(next, {
        clientX: (first.clientX + second.clientX) / 2,
        clientY: (first.clientY + second.clientY) / 2,
      });
    };

    const finishPinch = (event: TouchEvent) => {
      if (pinchRef.current) lastPinchEndAtRef.current = event.timeStamp;
      pinchRef.current = null;
    };

    scrollContainer.addEventListener("wheel", handleWheel, { passive: false });
    scrollContainer.addEventListener("touchstart", handleTouchStart, { passive: false });
    scrollContainer.addEventListener("touchmove", handleTouchMove, { passive: false });
    scrollContainer.addEventListener("touchend", finishPinch);
    scrollContainer.addEventListener("touchcancel", finishPinch);
    return () => {
      scrollContainer.removeEventListener("wheel", handleWheel);
      scrollContainer.removeEventListener("touchstart", handleTouchStart);
      scrollContainer.removeEventListener("touchmove", handleTouchMove);
      scrollContainer.removeEventListener("touchend", finishPinch);
      scrollContainer.removeEventListener("touchcancel", finishPinch);
    };
  }, [scrollContainer, setZoomAtPoint, viewportCenter, zoomPercent]);

  const setScrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element;
    setScrollContainer(element);
  }, []);

  return {
    zoomTargetRef,
    setScrollContainerRef,
    setZoomAtViewportCenter(zoomPercent: number) {
      const scroller = scrollContainerRef.current;
      if (!scroller) {
        onZoomPercentChange(zoomPercent);
        return;
      }
      setZoomAtPoint(zoomPercent, viewportCenter(scroller));
    },
    handleClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
      if (
        lastPinchEndAtRef.current !== 0
        && event.timeStamp - lastPinchEndAtRef.current
          < IMAGE_PINCH_CLICK_SUPPRESSION_MS
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    handlePointerMoveCapture(event: ReactPointerEvent<HTMLDivElement>) {
      lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (event.pointerType === "touch" && pinchRef.current) {
        event.stopPropagation();
      }
    },
  };
}
