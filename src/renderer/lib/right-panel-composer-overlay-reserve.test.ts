import { describe, expect, test } from "bun:test";
import {
  RIGHT_PANEL_COMPOSER_OVERLAY_DURATION_MS,
  RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_PX,
  RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_FALLBACK_VALUE,
  RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX,
  RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE,
  RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
  clampRightPanelComposerOverlayProgress,
  easeRightPanelComposerOverlayReserveProgress,
  resolveRightPanelComposerOverlayReservePx,
} from "./right-panel-composer-overlay-reserve";

describe("right panel composer overlay reserve", () => {
  test("exports Codex overlay constants", () => {
    expect(RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_PX).toBe(102);
    expect(RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX).toBe(118);
    expect(RIGHT_PANEL_COMPOSER_OVERLAY_DURATION_MS).toBe(120);
    expect(RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_FALLBACK_VALUE).toBe(
      "var(--right-panel-composer-overlay-reserve, 1.5rem)",
    );
    expect(RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE).toBe(
      "var(--right-panel-composer-overlay-reserve, 0px)",
    );
  });

  test("clamps progress and applies Codex enter/exit easing", () => {
    expect(clampRightPanelComposerOverlayProgress(-1)).toBe(0);
    expect(clampRightPanelComposerOverlayProgress(2)).toBe(1);
    expect(easeRightPanelComposerOverlayReserveProgress({ direction: "enter", progress: 0.5 })).toBe(0.25);
    expect(easeRightPanelComposerOverlayReserveProgress({ direction: "exit", progress: 0.5 })).toBe(0.75);
  });

  test("resolves enter and exit reserve values over 120ms", () => {
    expect(resolveRightPanelComposerOverlayReservePx({
      direction: "enter",
      elapsedMs: 60,
      fromPx: 0,
      toPx: RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX,
    })).toBe(29.5);
    expect(resolveRightPanelComposerOverlayReservePx({
      direction: "exit",
      elapsedMs: 60,
      fromPx: RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX,
      toPx: 0,
    })).toBe(29.5);
    expect(resolveRightPanelComposerOverlayReservePx({
      direction: "enter",
      elapsedMs: 120,
      fromPx: 0,
      toPx: RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX,
    })).toBe(118);
  });

  test("shares a zero-fallback scroll reserve style for right-panel scroll owners", () => {
    expect(RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE.paddingBottom).toBe(
      RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
    );
    expect(RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE.scrollPaddingBottom).toBe(
      RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
    );
  });
});
