import { useCallback, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

export function useMeasuredElementHeight() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [elementHeightPx, setElementHeightPx] = useState(0);

  const updateHeight = useEffectEvent(() => {
    if (element === null) {
      setElementHeightPx(0);
      return;
    }

    const nextHeight = element.scrollHeight;
    setElementHeightPx((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  });

  const elementRef = useCallback((node: HTMLDivElement | null) => {
    setElement(node);
  }, []);

  useLayoutEffect(() => {
    updateHeight();

    if (resizeObserverRef.current === null && typeof ResizeObserver !== "undefined") {
      resizeObserverRef.current = new ResizeObserver(() => {
        updateHeight();
      });
    }

    if (element === null) return;

    resizeObserverRef.current?.observe(element);
    return () => {
      resizeObserverRef.current?.unobserve(element);
    };
  }, [element, updateHeight]);

  useLayoutEffect(() => () => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  return {
    elementHeightPx,
    elementRef,
  };
}
