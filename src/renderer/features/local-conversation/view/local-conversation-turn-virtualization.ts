export type ThreadScrollMode = "stickToBottom" | "user" | "programmaticFind";

export interface VirtualizedTurnLayoutInput {
  heightsPx: number[];
  gapPx: number;
}

export interface VirtualizedTurnLayout {
  bottomOffsetsPx: number[];
  heightsPx: number[];
  totalHeightPx: number;
  topOffsetsPx: number[];
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
  currentScrollDistanceFromBottomPx: number;
  heightDeltaPx: number;
  turnTopDistanceFromBottomPx: number;
  viewportBottomDistanceFromBottomPx: number;
  scrollMode: ThreadScrollMode;
}

export interface VisibleTurnRangeFromBottomDistanceInput {
  distanceFromBottomPx: number;
  layout: VirtualizedTurnLayout;
  overscanCount: number;
  viewportHeightPx: number;
}

export interface TurnRevealDistanceInput {
  layout: VirtualizedTurnLayout;
  turnIndex: number;
  viewportHeightPx: number;
}

export interface TargetRevealDistanceInput extends TurnRevealDistanceInput {
  targetHeightPx: number;
  targetTopWithinTurnPx: number;
}

export function buildVirtualizedTurnLayout({
  heightsPx,
  gapPx,
}: VirtualizedTurnLayoutInput): VirtualizedTurnLayout {
  let nextOffsetPx = 0;
  const topOffsetsPx = heightsPx.map((heightPx, index) => {
    const currentOffsetPx = nextOffsetPx;
    nextOffsetPx += heightPx;
    if (index < heightsPx.length - 1) {
      nextOffsetPx += gapPx;
    }
    return currentOffsetPx;
  });

  return {
    bottomOffsetsPx: topOffsetsPx.map((topOffsetPx, index) =>
      nextOffsetPx - topOffsetPx - (heightsPx[index] ?? 0),
    ),
    heightsPx,
    totalHeightPx: nextOffsetPx,
    topOffsetsPx,
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

function findStartIndexFromBottomDistance({
  bottomOffsetsPx,
  targetPx,
}: {
  bottomOffsetsPx: number[];
  targetPx: number;
}): number {
  let start = 0;
  let end = bottomOffsetsPx.length;

  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if ((bottomOffsetsPx[middle] ?? 0) < targetPx) {
      end = middle;
      continue;
    }
    start = middle + 1;
  }

  return start;
}

function findEndIndexFromBottomDistance({
  bottomOffsetsPx,
  heightsPx,
  targetPx,
}: {
  bottomOffsetsPx: number[];
  heightsPx: number[];
  targetPx: number;
}): number {
  let start = 0;
  let end = bottomOffsetsPx.length;

  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    const turnTopDistanceFromBottomPx =
      (bottomOffsetsPx[middle] ?? 0) + (heightsPx[middle] ?? 0);
    if (turnTopDistanceFromBottomPx <= targetPx) {
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

  const { topOffsetsPx } = buildVirtualizedTurnLayout({ heightsPx, gapPx });
  const firstVisibleIndex = findStartIndex({
    offsetsPx: topOffsetsPx,
    heightsPx,
    targetPx: viewportTopPx,
  });
  const endIndex = findEndIndex({
    offsetsPx: topOffsetsPx,
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

export function resolveVisibleTurnRangeFromBottomDistance({
  distanceFromBottomPx,
  layout,
  overscanCount,
  viewportHeightPx,
}: VisibleTurnRangeFromBottomDistanceInput): VisibleTurnRange {
  if (layout.topOffsetsPx.length === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const viewportBottomDistancePx = Math.min(
    Math.max(0, distanceFromBottomPx),
    layout.totalHeightPx,
  );
  const viewportTopDistancePx = Math.min(
    viewportBottomDistancePx + Math.max(0, viewportHeightPx),
    layout.totalHeightPx,
  );
  const firstVisibleIndex = findStartIndexFromBottomDistance({
    bottomOffsetsPx: layout.bottomOffsetsPx,
    targetPx: viewportTopDistancePx,
  });
  const endIndex = findEndIndexFromBottomDistance({
    bottomOffsetsPx: layout.bottomOffsetsPx,
    heightsPx: layout.heightsPx,
    targetPx: viewportBottomDistancePx,
  });

  return {
    startIndex: Math.max(0, firstVisibleIndex - overscanCount),
    endIndex: Math.min(
      layout.topOffsetsPx.length,
      Math.max(endIndex, firstVisibleIndex + 1) + overscanCount,
    ),
  };
}

export function resolveTurnCenterDistanceFromBottom({
  layout,
  turnIndex,
  viewportHeightPx,
}: TurnRevealDistanceInput): number | null {
  const bottomOffsetPx = layout.bottomOffsetsPx[turnIndex];
  const heightPx = layout.heightsPx[turnIndex];
  if (bottomOffsetPx == null || heightPx == null) return null;

  return Math.max(0, bottomOffsetPx - viewportHeightPx / 2 + heightPx / 2);
}

export function resolveTargetCenterDistanceFromBottom({
  layout,
  targetHeightPx,
  targetTopWithinTurnPx,
  turnIndex,
  viewportHeightPx,
}: TargetRevealDistanceInput): number | null {
  const bottomOffsetPx = layout.bottomOffsetsPx[turnIndex];
  const heightPx = layout.heightsPx[turnIndex];
  if (bottomOffsetPx == null || heightPx == null) return null;

  return Math.max(
    0,
    bottomOffsetPx
      + heightPx
      - targetTopWithinTurnPx
      - targetHeightPx / 2
      - viewportHeightPx / 2,
  );
}

export function resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta({
  currentScrollDistanceFromBottomPx,
  heightDeltaPx,
  turnTopDistanceFromBottomPx,
  viewportBottomDistanceFromBottomPx,
  scrollMode,
}: MeasuredTurnHeightDeltaInput): number | null {
  if (heightDeltaPx === 0 || scrollMode === "programmaticFind") {
    return null;
  }

  if (scrollMode === "stickToBottom") {
    return 0;
  }

  if (turnTopDistanceFromBottomPx <= viewportBottomDistanceFromBottomPx) {
    return Math.max(0, currentScrollDistanceFromBottomPx + heightDeltaPx);
  }

  return null;
}
