import { describe, expect, test } from "bun:test";
import {
  CODEX_SUMMARY_SHIFT_X,
  clampCodexPanelProgress,
  resolveCodexAnimatedPanelSize,
  resolveCodexHeaderEdgeScroll,
  resolveCodexMainContentFrameBorder,
  resolveCodexMainContentTargetWidth,
  resolveCodexSummaryContentShift,
  resolveCodexSummaryPanelLayoutMode,
  shouldSnapCodexMotion,
} from "./codex-panel-motion";

describe("Codex panel motion helpers", () => {
  test("clamps panel progress to the Codex 0..1 range", () => {
    expect(clampCodexPanelProgress(-0.5)).toBe(0);
    expect(clampCodexPanelProgress(0.42)).toBe(0.42);
    expect(clampCodexPanelProgress(1.5)).toBe(1);
    expect(clampCodexPanelProgress(Number.NaN)).toBe(0);
  });

  test("derives animated size from clamped progress and target size", () => {
    expect(resolveCodexAnimatedPanelSize(0, 600)).toBe(0);
    expect(resolveCodexAnimatedPanelSize(0.5, 600)).toBe(300);
    expect(resolveCodexAnimatedPanelSize(2, 600)).toBe(600);
    expect(resolveCodexAnimatedPanelSize(0.5, -1)).toBe(0);
  });

  test("matches Codex summary display breakpoints", () => {
    expect(resolveCodexSummaryPanelLayoutMode(1095)).toBe("overlay");
    expect(resolveCodexSummaryPanelLayoutMode(1096)).toBe("shift");
    expect(resolveCodexSummaryPanelLayoutMode(1535)).toBe("shift");
    expect(resolveCodexSummaryPanelLayoutMode(1536)).toBe("gutter");
    expect(resolveCodexSummaryPanelLayoutMode(736 + 179 * 2)).toBe("overlay");
    expect(resolveCodexSummaryPanelLayoutMode(736 + 180 * 2)).toBe("shift");
    expect(resolveCodexSummaryPanelLayoutMode(736 + 399 * 2)).toBe("shift");
    expect(resolveCodexSummaryPanelLayoutMode(736 + 400 * 2)).toBe("gutter");
  });

  test("derives Codex main content target width from shell panel reservations", () => {
    expect(resolveCodexMainContentTargetWidth({
      shellWidth: 1800,
      leftSidebarOpen: false,
      leftSidebarWidth: 300,
      rightPanelOpen: false,
      rightPanelWidth: 600,
    })).toBe(1800);
    expect(resolveCodexMainContentTargetWidth({
      shellWidth: 1800,
      leftSidebarOpen: true,
      leftSidebarWidth: 300,
      rightPanelOpen: true,
      rightPanelWidth: 500,
    })).toBe(1000);
    expect(resolveCodexMainContentTargetWidth({
      shellWidth: 1800,
      leftSidebarOpen: true,
      leftSidebarWidth: 300,
      rightPanelOpen: true,
      rightPanelWidth: 500,
      rightPanelFullWidth: true,
    })).toBe(0);
  });

  test("matches Codex thread edge-scroll and frame border guards", () => {
    expect(resolveCodexHeaderEdgeScroll({
      layout: "thread-edge-scroll",
      mainContentWidth: 1535,
    })).toBeFalse();
    expect(resolveCodexHeaderEdgeScroll({
      layout: "thread-edge-scroll",
      mainContentWidth: 1536,
    })).toBeTrue();
    expect(resolveCodexHeaderEdgeScroll({
      layout: "thread-edge-scroll",
      mainContentWidth: 1536,
      rightPanelFullWidth: true,
    })).toBeFalse();
    expect(resolveCodexHeaderEdgeScroll({
      layout: "full-bleed",
      mainContentWidth: 1536,
    })).toBeFalse();
    expect(resolveCodexMainContentFrameBorder({
      rightPanelOpen: false,
      headerEdgeScroll: true,
    })).toBeFalse();
    expect(resolveCodexMainContentFrameBorder({
      rightPanelOpen: true,
      headerEdgeScroll: true,
    })).toBeTrue();
    expect(resolveCodexMainContentFrameBorder({
      rightPanelOpen: false,
      headerEdgeScroll: false,
    })).toBeTrue();
  });

  test("applies Codex shift only for pinned shift mode", () => {
    expect(CODEX_SUMMARY_SHIFT_X).toBe(-158);
    expect(resolveCodexSummaryContentShift({ layoutMode: "shift", pinnedOpen: true })).toBe(-158);
    expect(resolveCodexSummaryContentShift({ layoutMode: "shift", pinnedOpen: false })).toBe(0);
    expect(resolveCodexSummaryContentShift({ layoutMode: "overlay", pinnedOpen: true })).toBe(0);
    expect(resolveCodexSummaryContentShift({ layoutMode: "gutter", pinnedOpen: true })).toBe(0);
  });

  test("snaps panel motion for reduced motion or explicit non-animated updates", () => {
    expect(shouldSnapCodexMotion(true, true)).toBeTrue();
    expect(shouldSnapCodexMotion(false, false)).toBeTrue();
    expect(shouldSnapCodexMotion(null, true)).toBeFalse();
    expect(shouldSnapCodexMotion(false, true)).toBeFalse();
  });
});
