import { useCallback, useEffect, useState, type RefCallback } from "react";

export interface ElementVisibility {
  readonly ref: RefCallback<HTMLElement>;
  readonly visible: boolean;
}

/**
 * Keeps heavyweight nested editors out of offscreen rows. A small root margin
 * prewarms a Card shortly before it scrolls into view.
 */
export const useElementVisibility = (
  rootMargin = "160px 0px",
): ElementVisibility => {
  const canObserve = typeof globalThis.IntersectionObserver === "function";
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(!canObserve);
  const ref = useCallback<RefCallback<HTMLElement>>((nextElement) => {
    setElement(nextElement);
  }, []);

  useEffect(() => {
    if (!element) return;
    if (typeof globalThis.IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }

    setVisible(false);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rootMargin]);

  return { ref, visible };
};
