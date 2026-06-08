import { describe, expect, test } from "bun:test";
import {
  CODEX_SUMMARY_SHIFT_X,
  clampCodexPanelProgress,
  resolveCodexAnimatedPanelSize,
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
    expect(resolveCodexSummaryPanelLayoutMode(736 + 179 * 2)).toBe("overlay");
    expect(resolveCodexSummaryPanelLayoutMode(736 + 180 * 2)).toBe("shift");
    expect(resolveCodexSummaryPanelLayoutMode(736 + 399 * 2)).toBe("shift");
    expect(resolveCodexSummaryPanelLayoutMode(736 + 400 * 2)).toBe("gutter");
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
