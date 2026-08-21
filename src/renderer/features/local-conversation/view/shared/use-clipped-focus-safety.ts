import type { RefObject } from "react";
import { useLayoutEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
].join(",");

interface PriorFocusableState {
  readonly ariaHidden: string | null;
  readonly inert: boolean;
  readonly inertAttribute: string | null;
}

function listFocusableDescendants(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function useClippedFocusSafety(
  clippedContainerRef: RefObject<HTMLElement | null>,
  clipped: boolean,
): void {
  useLayoutEffect(() => {
    const clippedContainer = clippedContainerRef.current;
    if (!clippedContainer || !clipped || typeof IntersectionObserver === "undefined") return;

    const priorStates = new Map<HTMLElement, PriorFocusableState>();
    const restore = (element: HTMLElement) => {
      const prior = priorStates.get(element);
      if (!prior) return;

      if (prior.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", prior.ariaHidden);
      element.inert = prior.inert;
      if (prior.inertAttribute === null) element.removeAttribute("inert");
      else element.setAttribute("inert", prior.inertAttribute);
      priorStates.delete(element);
    };
    const setClipped = (element: HTMLElement, isClipped: boolean) => {
      if (!isClipped) {
        restore(element);
        return;
      }

      if (!priorStates.has(element)) {
        priorStates.set(element, {
          ariaHidden: element.getAttribute("aria-hidden"),
          inert: Boolean(element.inert),
          inertAttribute: element.getAttribute("inert"),
        });
      }
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    };

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setClipped(entry.target as HTMLElement, entry.intersectionRatio < 1);
        }
      },
      {
        root: clippedContainer,
        threshold: 1,
      },
    );
    const observeDescendants = (root: HTMLElement) => {
      if (root.matches(FOCUSABLE_SELECTOR)) intersectionObserver.observe(root);
      for (const element of listFocusableDescendants(root)) {
        intersectionObserver.observe(element);
      }
    };

    for (const element of listFocusableDescendants(clippedContainer)) {
      intersectionObserver.observe(element);
    }
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            for (const record of records) {
              for (const addedNode of record.addedNodes) {
                if (addedNode instanceof HTMLElement) observeDescendants(addedNode);
              }
            }
          });
    mutationObserver?.observe(clippedContainer, { childList: true, subtree: true });

    return () => {
      mutationObserver?.disconnect();
      intersectionObserver.disconnect();
      for (const element of [...priorStates.keys()]) restore(element);
    };
  }, [clipped, clippedContainerRef]);
}
