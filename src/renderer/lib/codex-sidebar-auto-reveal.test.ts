import { describe, expect, test } from "bun:test";
import {
  CODEX_SIDEBAR_FLOATING_PANEL_REDUCED_MOTION_TRANSITION,
  CODEX_SIDEBAR_FLOATING_PANEL_TRANSITION,
  CODEX_SIDEBAR_POINTER_DEFAULT,
  clampCodexSidebarWidth,
  deriveCodexSidebarFloatingVisibility,
  getCodexSidebarFloatingTransition,
  isCodexSidebarEdgeEnterX,
  isCodexSidebarKeepOpenX,
  normalizeCodexSidebarPointer,
  resolveCodexSidebarWidth,
  shouldClearCodexSidebarHoverSuppression,
} from "./codex-sidebar-auto-reveal";

describe("Codex sidebar auto-reveal contract", () => {
  test("clamps width to the Codex default/min/max contract", () => {
    expect(clampCodexSidebarWidth(Number.NaN)).toBe(300);
    expect(clampCodexSidebarWidth(120)).toBe(240);
    expect(clampCodexSidebarWidth(300)).toBe(300);
    expect(clampCodexSidebarWidth(900)).toBe(520);
  });

  test("resolves width with layout, Codex storage, Nodex storage, then default precedence", () => {
    expect(resolveCodexSidebarWidth({
      layoutSnapshotWidth: 260,
      codexStorageWidth: 320,
      nodexStorageWidth: 340,
    })).toBe(260);
    expect(resolveCodexSidebarWidth({
      codexStorageWidth: 320,
      nodexStorageWidth: 340,
    })).toBe(320);
    expect(resolveCodexSidebarWidth({
      nodexStorageWidth: 340,
    })).toBe(340);
    expect(resolveCodexSidebarWidth({})).toBe(300);
  });

  test("uses Codex edge-enter and keep-open geometry boundaries", () => {
    expect(isCodexSidebarEdgeEnterX(null)).toBeFalse();
    expect(isCodexSidebarEdgeEnterX(-1)).toBeFalse();
    expect(isCodexSidebarEdgeEnterX(0)).toBeTrue();
    expect(isCodexSidebarEdgeEnterX(12)).toBeTrue();
    expect(isCodexSidebarEdgeEnterX(13)).toBeFalse();

    expect(isCodexSidebarKeepOpenX(null, 300)).toBeFalse();
    expect(isCodexSidebarKeepOpenX(-1, 300)).toBeFalse();
    expect(isCodexSidebarKeepOpenX(0, 300)).toBeTrue();
    expect(isCodexSidebarKeepOpenX(300, 300)).toBeTrue();
    expect(isCodexSidebarKeepOpenX(301, 300)).toBeFalse();
  });

  test("keeps collapse suppression until the trigger is not hovered and pointer leaves the edge strip", () => {
    expect(shouldClearCodexSidebarHoverSuppression({
      pointerX: null,
      triggerHovered: false,
    })).toBeFalse();
    expect(shouldClearCodexSidebarHoverSuppression({
      pointerX: 40,
      triggerHovered: true,
    })).toBeFalse();
    expect(shouldClearCodexSidebarHoverSuppression({
      pointerX: 12,
      triggerHovered: false,
    })).toBeFalse();
    expect(shouldClearCodexSidebarHoverSuppression({
      pointerX: 13,
      triggerHovered: false,
    })).toBeTrue();
  });

  test("derives floating visibility from open, animation, suppression, edge, keep-open, and focus state", () => {
    expect(deriveCodexSidebarFloatingVisibility({
      pointerX: 8,
      leftPanelWidthPx: 300,
      sidebarOpen: true,
      sidebarAnimating: false,
      hoverSuppressed: false,
      focusOverride: false,
      currentlyVisible: false,
    })).toBeFalse();
    expect(deriveCodexSidebarFloatingVisibility({
      pointerX: 8,
      leftPanelWidthPx: 300,
      sidebarOpen: false,
      sidebarAnimating: true,
      hoverSuppressed: false,
      focusOverride: false,
      currentlyVisible: false,
    })).toBeFalse();
    expect(deriveCodexSidebarFloatingVisibility({
      pointerX: 8,
      leftPanelWidthPx: 300,
      sidebarOpen: false,
      sidebarAnimating: false,
      hoverSuppressed: true,
      focusOverride: true,
      currentlyVisible: false,
    })).toBeFalse();
    expect(deriveCodexSidebarFloatingVisibility({
      pointerX: 12,
      leftPanelWidthPx: 300,
      sidebarOpen: false,
      sidebarAnimating: false,
      hoverSuppressed: false,
      focusOverride: false,
      currentlyVisible: false,
    })).toBeTrue();
    expect(deriveCodexSidebarFloatingVisibility({
      pointerX: 301,
      leftPanelWidthPx: 300,
      sidebarOpen: false,
      sidebarAnimating: false,
      hoverSuppressed: false,
      focusOverride: false,
      currentlyVisible: true,
    })).toBeFalse();
    expect(deriveCodexSidebarFloatingVisibility({
      pointerX: 301,
      leftPanelWidthPx: 300,
      sidebarOpen: false,
      sidebarAnimating: false,
      hoverSuppressed: false,
      focusOverride: true,
      currentlyVisible: true,
    })).toBeTrue();
  });

  test("normalizes pointer coordinates and velocity by the Codex window zoom", () => {
    const first = normalizeCodexSidebarPointer(
      { clientX: 20, clientY: 10, updatedAt: 1000 },
      CODEX_SIDEBAR_POINTER_DEFAULT,
      2,
    );
    const second = normalizeCodexSidebarPointer(
      { clientX: 40, clientY: 30, updatedAt: 2000 },
      first,
      2,
    );

    expect(first.x).toBe(10);
    expect(first.y).toBe(5);
    expect(first.speed).toBe(0);
    expect(second.x).toBe(20);
    expect(second.y).toBe(15);
    expect(second.velocityX).toBe(10);
    expect(second.velocityY).toBe(10);
    expect(Math.round(second.speed)).toBe(14);
  });

  test("selects the Codex spring or reduced-motion transition", () => {
    expect(JSON.stringify(getCodexSidebarFloatingTransition(false))).toBe(
      JSON.stringify(CODEX_SIDEBAR_FLOATING_PANEL_TRANSITION),
    );
    expect(JSON.stringify(getCodexSidebarFloatingTransition(true))).toBe(
      JSON.stringify(CODEX_SIDEBAR_FLOATING_PANEL_REDUCED_MOTION_TRANSITION),
    );
  });
});
