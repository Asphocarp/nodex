export interface ReviewFileTreeVirtualRange {
  start: number;
  end: number;
}

export interface ReviewFileTreeVirtualLayout {
  totalHeight: number;
  offsetHeight: number;
  windowHeight: number;
  stickyInset: number;
}

interface ReviewFileTreeVisibleRangeInput {
  scrollTop: number;
  viewportHeight: number;
  offset: number;
  itemCount: number;
  itemHeight: number;
}

interface ReviewFileTreeVirtualRangeInput extends ReviewFileTreeVisibleRangeInput {
  overscan?: number;
}

interface ReviewFileTreeScrollTargetInput {
  scrollTop: number;
  viewportHeight: number;
  offset?: number;
  itemHeight: number;
  index: number;
}

interface ReviewFileTreeVirtualLayoutInput {
  range: ReviewFileTreeVirtualRange;
  itemCount: number;
  itemHeight: number;
  viewportHeight: number;
}

export const REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX = 30;
export const REVIEW_FILE_TREE_FALLBACK_ITEM_HEIGHT_PX = 28;
export const REVIEW_FILE_TREE_VIRTUALIZE_THRESHOLD = 0;
export const REVIEW_FILE_TREE_VIRTUAL_OVERSCAN = 10;
export const REVIEW_FILE_TREE_VIEWPORT_FALLBACK_PX = 240;

const EMPTY_RANGE: ReviewFileTreeVirtualRange = {
  start: 0,
  end: -1,
};

function normalizeItemHeight(itemHeight: number): number {
  return itemHeight > 0 ? itemHeight : REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX;
}

function normalizeViewportHeight(viewportHeight: number): number {
  return viewportHeight > 0 ? viewportHeight : REVIEW_FILE_TREE_VIEWPORT_FALLBACK_PX;
}

function clampRange(range: ReviewFileTreeVirtualRange, itemCount: number): ReviewFileTreeVirtualRange {
  if (itemCount <= 0 || range.end < range.start) return EMPTY_RANGE;
  const start = Math.max(0, Math.min(range.start, itemCount - 1));
  return {
    start,
    end: Math.max(start, Math.min(range.end, itemCount - 1)),
  };
}

function getVisibleRange(
  input: ReviewFileTreeVisibleRangeInput,
): ReviewFileTreeVirtualRange {
  const { itemCount } = input;
  if (itemCount <= 0) return EMPTY_RANGE;

  const startIndex = Math.floor((input.scrollTop - input.offset) / input.itemHeight);
  const endIndex = Math.ceil((input.scrollTop - input.offset + input.viewportHeight) / input.itemHeight) - 1;

  if (endIndex < 0 || startIndex >= itemCount) return EMPTY_RANGE;
  return {
    start: Math.max(0, startIndex),
    end: Math.min(itemCount - 1, endIndex),
  };
}

function extendRange(
  range: ReviewFileTreeVirtualRange,
  itemCount: number,
  overscan: number,
): ReviewFileTreeVirtualRange {
  if (range.end < range.start || itemCount <= 0) return EMPTY_RANGE;
  return clampRange(
    {
      start: range.start - overscan,
      end: range.end + overscan,
    },
    itemCount,
  );
}

export function areReviewFileTreeRangesEqual(
  previous: ReviewFileTreeVirtualRange,
  next: ReviewFileTreeVirtualRange,
): boolean {
  return previous.start === next.start && previous.end === next.end;
}

export function getReviewFileTreeVirtualRange(
  input: ReviewFileTreeVirtualRangeInput,
  previousRange: ReviewFileTreeVirtualRange = EMPTY_RANGE,
): ReviewFileTreeVirtualRange {
  const visibleRange = getVisibleRange({
    ...input,
    viewportHeight: normalizeViewportHeight(input.viewportHeight),
    itemHeight: normalizeItemHeight(input.itemHeight),
  });
  const clampedPreviousRange = clampRange(previousRange, input.itemCount);

  if (
    clampedPreviousRange.end >= clampedPreviousRange.start
    && visibleRange.start >= clampedPreviousRange.start
    && visibleRange.end <= clampedPreviousRange.end
  ) {
    return clampedPreviousRange;
  }

  return extendRange(
    visibleRange,
    input.itemCount,
    Math.max(0, input.overscan ?? REVIEW_FILE_TREE_VIRTUAL_OVERSCAN),
  );
}

export function getReviewFileTreeVirtualLayout(
  input: ReviewFileTreeVirtualLayoutInput,
): ReviewFileTreeVirtualLayout {
  const itemHeight = normalizeItemHeight(input.itemHeight);
  const totalHeight = Math.max(0, input.itemCount * itemHeight);
  if (input.range.end < input.range.start) {
    return {
      totalHeight,
      offsetHeight: 0,
      windowHeight: 0,
      stickyInset: 0,
    };
  }

  const offsetHeight = input.range.start * itemHeight;
  const windowHeight = (input.range.end - input.range.start + 1) * itemHeight;
  return {
    totalHeight,
    offsetHeight,
    windowHeight,
    stickyInset: Math.min(0, normalizeViewportHeight(input.viewportHeight) - windowHeight),
  };
}

export function getReviewFileTreeScrollTopForIndex(
  input: ReviewFileTreeScrollTargetInput,
): number {
  const itemHeight = normalizeItemHeight(input.itemHeight);
  const viewportHeight = normalizeViewportHeight(input.viewportHeight);
  const offset = Math.max(0, input.offset ?? 0);
  const targetTop = offset + Math.max(0, input.index) * itemHeight;
  const targetBottom = targetTop + itemHeight;
  const currentTop = Math.max(0, input.scrollTop);
  const currentBottom = currentTop + viewportHeight;

  if (targetTop < currentTop) {
    return targetTop;
  }

  if (targetBottom > currentBottom) {
    return targetBottom - viewportHeight;
  }

  return currentTop;
}

export function isReviewFileTreeVirtualizationEnabled(
  itemCount: number,
  threshold = REVIEW_FILE_TREE_VIRTUALIZE_THRESHOLD,
): boolean {
  if (itemCount <= 0) return false;
  return itemCount >= Math.max(0, threshold);
}

export function resolveReviewFileTreeItemHeight(
  element: HTMLElement | null,
  explicitItemHeight?: number,
): number {
  if (explicitItemHeight && explicitItemHeight > 0) return explicitItemHeight;
  if (!element) return REVIEW_FILE_TREE_FALLBACK_ITEM_HEIGHT_PX;

  const computedStyle = getComputedStyle(element);
  const cssValue = computedStyle.getPropertyValue("--ft-internal-row-height").trim()
    || computedStyle.getPropertyValue("--trees-row-height").trim();
  const parsedHeight = Number.parseFloat(cssValue);
  if (Number.isFinite(parsedHeight) && parsedHeight > 0) return parsedHeight;

  return REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX;
}

export function getReviewFileTreeOffset(
  element: HTMLElement,
  scrollContainer: HTMLElement,
): number {
  let offset = 0;
  let current: HTMLElement | null = element;

  while (current && current !== scrollContainer) {
    offset += current.offsetTop;
    const offsetParent: Element | null = current.offsetParent;
    current = offsetParent instanceof HTMLElement ? offsetParent : null;
  }

  if (current === scrollContainer) return offset;

  const elementRect = element.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  return elementRect.top - containerRect.top + scrollContainer.scrollTop;
}
