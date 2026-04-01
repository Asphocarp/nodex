export type ThreadScrollMode = "stickToBottom" | "user" | "programmaticFind";

export interface VirtualizedTurnLayoutInput {
  heightsPx: number[];
  gapPx: number;
}

export interface VirtualizedTurnLayout {
  offsetsPx: number[];
  totalHeightPx: number;
}

export interface VisibleTurnRangeInput extends VirtualizedTurnLayoutInput {
  viewportTopPx: number;
  viewportBottomPx: number;
  overscanCount: number;
}

export interface VisibleTurnRange {
  startIndex: number;
  endIndex: number;
}

export interface MeasuredTurnHeightDeltaInput {
  currentScrollTopPx: number;
  heightDeltaPx: number;
  turnBottomPx: number;
  viewportTopPx: number;
  scrollMode: ThreadScrollMode;
}

export function buildVirtualizedTurnLayout({
  heightsPx,
  gapPx,
}: VirtualizedTurnLayoutInput): VirtualizedTurnLayout {
  let nextOffsetPx = 0;
  const offsetsPx = heightsPx.map((heightPx, index) => {
    const currentOffsetPx = nextOffsetPx;
    nextOffsetPx += heightPx;
    if (index < heightsPx.length - 1) {
      nextOffsetPx += gapPx;
    }
    return currentOffsetPx;
  });

  return {
    offsetsPx,
    totalHeightPx: nextOffsetPx,
  };
}

function findStartIndex({
  offsetsPx,
  heightsPx,
  targetPx,
}: {
  offsetsPx: number[];
  heightsPx: number[];
  targetPx: number;
}): number {
  let start = 0;
  let end = heightsPx.length;

  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    const bottomPx = (offsetsPx[middle] ?? 0) + (heightsPx[middle] ?? 0);
    if (bottomPx > targetPx) {
      end = middle;
      continue;
    }
    start = middle + 1;
  }

  return start;
}

function findEndIndex({
  offsetsPx,
  targetPx,
}: {
  offsetsPx: number[];
  targetPx: number;
}): number {
  let start = 0;
  let end = offsetsPx.length;

  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if ((offsetsPx[middle] ?? 0) >= targetPx) {
      end = middle;
      continue;
    }
    start = middle + 1;
  }

  return start;
}

export function resolveVisibleTurnRange({
  heightsPx,
  gapPx,
  viewportTopPx,
  viewportBottomPx,
  overscanCount,
}: VisibleTurnRangeInput): VisibleTurnRange {
  if (heightsPx.length === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const { offsetsPx } = buildVirtualizedTurnLayout({ heightsPx, gapPx });
  const firstVisibleIndex = findStartIndex({
    offsetsPx,
    heightsPx,
    targetPx: viewportTopPx,
  });
  const endIndex = findEndIndex({
    offsetsPx,
    targetPx: viewportBottomPx,
  });

  if (firstVisibleIndex >= heightsPx.length) {
    return {
      startIndex: Math.max(0, heightsPx.length - 1 - overscanCount),
      endIndex: heightsPx.length,
    };
  }

  return {
    startIndex: Math.max(0, firstVisibleIndex - overscanCount),
    endIndex: Math.min(heightsPx.length, Math.max(endIndex, 1) + overscanCount),
  };
}

export function resolveAdjustedScrollTopForMeasuredTurnHeightDelta({
  currentScrollTopPx,
  heightDeltaPx,
  turnBottomPx,
  viewportTopPx,
  scrollMode,
}: MeasuredTurnHeightDeltaInput): number | null {
  if (heightDeltaPx === 0 || scrollMode === "programmaticFind") {
    return null;
  }

  if (scrollMode === "stickToBottom") {
    return currentScrollTopPx + heightDeltaPx;
  }

  if (turnBottomPx < viewportTopPx) {
    return currentScrollTopPx + heightDeltaPx;
  }

  return null;
}
