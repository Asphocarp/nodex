export interface CardVerticalRect {
  top: number;
  bottom: number;
}

export function computeNativeDropIndex(
  cardRects: readonly CardVerticalRect[],
  pointerY: number,
): number {
  if (cardRects.length === 0) return 0;

  for (const [index, rect] of cardRects.entries()) {
    const midpoint = rect.top + (rect.bottom - rect.top) / 2;
    if (pointerY < midpoint) return index;
  }

  return cardRects.length;
}

export function computeNativeDropIndexFromSurface(
  surface: HTMLElement,
  pointerY: number,
  options?: {
    ignoredPageIds?: ReadonlySet<string>;
  },
): number {
  const ignoredPageIds = options?.ignoredPageIds;
  const cardElements = Array.from(
    surface.querySelectorAll<HTMLElement>("[data-kanban-uuid-v7]"),
  ).filter((element) => {
    if (!ignoredPageIds || ignoredPageIds.size === 0) {
      return true;
    }

    const pageId = element.dataset.kanbanUuidV7;
    return !pageId || !ignoredPageIds.has(pageId);
  });
  const rects = cardElements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  return computeNativeDropIndex(rects, pointerY);
}
