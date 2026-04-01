import { describe, expect, test } from "bun:test";
import {
  buildVirtualizedTurnLayout,
  resolveAdjustedScrollTopForMeasuredTurnHeightDelta,
  resolveVisibleTurnRange,
} from "./local-conversation-turn-virtualization";

describe("buildVirtualizedTurnLayout", () => {
  test("matches the Codex spacer layout offsets and total height", () => {
    const layout = buildVirtualizedTurnLayout({
      heightsPx: [100, 120, 80],
      gapPx: 12,
    });

    expect(layout.offsetsPx.join(",")).toBe("0,112,244");
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

describe("resolveAdjustedScrollTopForMeasuredTurnHeightDelta", () => {
  test("does not adjust when the turn is still visible in the viewport", () => {
    const adjustedScrollTopPx = resolveAdjustedScrollTopForMeasuredTurnHeightDelta({
      currentScrollTopPx: 300,
      heightDeltaPx: 80,
      turnBottomPx: 340,
      viewportTopPx: 300,
      scrollMode: "user",
    });

    expect(adjustedScrollTopPx === null).toBeTrue();
  });

  test("adjusts when the measured turn is fully above the viewport", () => {
    const adjustedScrollTopPx = resolveAdjustedScrollTopForMeasuredTurnHeightDelta({
      currentScrollTopPx: 300,
      heightDeltaPx: 80,
      turnBottomPx: 220,
      viewportTopPx: 300,
      scrollMode: "user",
    });

    expect(adjustedScrollTopPx).toBe(380);
  });

  test("always adjusts while sticking to bottom", () => {
    const adjustedScrollTopPx = resolveAdjustedScrollTopForMeasuredTurnHeightDelta({
      currentScrollTopPx: 700,
      heightDeltaPx: 64,
      turnBottomPx: 740,
      viewportTopPx: 640,
      scrollMode: "stickToBottom",
    });

    expect(adjustedScrollTopPx).toBe(764);
  });

  test("suppresses height compensation during programmatic find scrolls", () => {
    const adjustedScrollTopPx = resolveAdjustedScrollTopForMeasuredTurnHeightDelta({
      currentScrollTopPx: 400,
      heightDeltaPx: 40,
      turnBottomPx: 120,
      viewportTopPx: 400,
      scrollMode: "programmaticFind",
    });

    expect(adjustedScrollTopPx === null).toBeTrue();
  });
});
