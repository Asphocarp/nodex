import { describe, expect, test } from "bun:test";
import {
  buildVirtualizedTurnLayout,
  resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta,
  resolveTargetCenterDistanceFromBottom,
  resolveTurnCenterDistanceFromBottom,
  resolveVisibleTurnRange,
  resolveVisibleTurnRangeFromBottomDistance,
} from "./local-conversation-turn-virtualization";

describe("buildVirtualizedTurnLayout", () => {
  test("matches the Codex spacer layout offsets and total height", () => {
    const layout = buildVirtualizedTurnLayout({
      heightsPx: [100, 120, 80],
      gapPx: 12,
    });

    expect(layout.topOffsetsPx.join(",")).toBe("0,112,244");
    expect(layout.bottomOffsetsPx.join(",")).toBe("224,92,0");
    expect(layout.totalHeightPx).toBe(324);
  });
});

describe("resolveVisibleTurnRange", () => {
  test("returns an exclusive end index with overscan", () => {
    const range = resolveVisibleTurnRange({
      heightsPx: [100, 120, 80, 90],
      gapPx: 12,
      viewportTopPx: 130,
      viewportBottomPx: 290,
      overscanCount: 1,
    });

    expect(`${range.startIndex}:${range.endIndex}`).toBe("0:4");
  });
});

describe("resolveVisibleTurnRangeFromBottomDistance", () => {
  test("returns visible turns from a bottom-origin viewport", () => {
    const layout = buildVirtualizedTurnLayout({
      heightsPx: [100, 120, 80, 90],
      gapPx: 12,
    });

    const range = resolveVisibleTurnRangeFromBottomDistance({
      distanceFromBottomPx: 0,
      layout,
      viewportHeightPx: 160,
      overscanCount: 1,
    });

    expect(`${range.startIndex}:${range.endIndex}`).toBe("1:4");
  });

  test("resolves older visible turns as distance from bottom increases", () => {
    const layout = buildVirtualizedTurnLayout({
      heightsPx: [100, 120, 80, 90],
      gapPx: 12,
    });

    const range = resolveVisibleTurnRangeFromBottomDistance({
      distanceFromBottomPx: 250,
      layout,
      viewportHeightPx: 100,
      overscanCount: 0,
    });

    expect(`${range.startIndex}:${range.endIndex}`).toBe("0:2");
  });
});

describe("turn reveal distances", () => {
  test("centers a turn using bottom-origin distance", () => {
    const layout = buildVirtualizedTurnLayout({
      heightsPx: [100, 120, 80],
      gapPx: 12,
    });

    expect(
      resolveTurnCenterDistanceFromBottom({
        layout,
        turnIndex: 0,
        viewportHeightPx: 200,
      }),
    ).toBe(174);
    expect(
      resolveTurnCenterDistanceFromBottom({
        layout,
        turnIndex: 2,
        viewportHeightPx: 200,
      }),
    ).toBe(0);
  });

  test("centers a target inside a turn using bottom-origin distance", () => {
    const layout = buildVirtualizedTurnLayout({
      heightsPx: [100, 120, 80],
      gapPx: 12,
    });

    expect(
      resolveTargetCenterDistanceFromBottom({
        layout,
        targetHeightPx: 20,
        targetTopWithinTurnPx: 20,
        turnIndex: 0,
        viewportHeightPx: 200,
      }),
    ).toBe(194);
  });
});

describe("resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta", () => {
  test("does not adjust when the turn is still visible in the viewport", () => {
    const adjustedScrollDistanceFromBottomPx =
      resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta({
      currentScrollDistanceFromBottomPx: 300,
      heightDeltaPx: 80,
      turnTopDistanceFromBottomPx: 340,
      viewportBottomDistanceFromBottomPx: 300,
      scrollMode: "user",
    });

    expect(adjustedScrollDistanceFromBottomPx === null).toBeTrue();
  });

  test("adjusts when the measured turn is fully below the viewport", () => {
    const adjustedScrollDistanceFromBottomPx =
      resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta({
      currentScrollDistanceFromBottomPx: 300,
      heightDeltaPx: 80,
      turnTopDistanceFromBottomPx: 220,
      viewportBottomDistanceFromBottomPx: 300,
      scrollMode: "user",
    });

    expect(adjustedScrollDistanceFromBottomPx).toBe(380);
  });

  test("stays at zero while sticking to bottom", () => {
    const adjustedScrollDistanceFromBottomPx =
      resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta({
      currentScrollDistanceFromBottomPx: 700,
      heightDeltaPx: 64,
      turnTopDistanceFromBottomPx: 740,
      viewportBottomDistanceFromBottomPx: 640,
      scrollMode: "stickToBottom",
    });

    expect(adjustedScrollDistanceFromBottomPx).toBe(0);
  });

  test("suppresses height compensation during programmatic find scrolls", () => {
    const adjustedScrollDistanceFromBottomPx =
      resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta({
      currentScrollDistanceFromBottomPx: 400,
      heightDeltaPx: 40,
      turnTopDistanceFromBottomPx: 120,
      viewportBottomDistanceFromBottomPx: 400,
      scrollMode: "programmaticFind",
    });

    expect(adjustedScrollDistanceFromBottomPx === null).toBeTrue();
  });
});
