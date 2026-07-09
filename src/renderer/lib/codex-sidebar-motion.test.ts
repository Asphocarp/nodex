import { describe, expect, test } from "bun:test";
import {
  resolveCodexSidebarMotionMounted,
  resolveCodexSidebarMotionSetOpen,
  shouldCommitCodexSidebarMotionCompletion,
} from "./codex-sidebar-motion";

describe("Codex sidebar motion controller helpers", () => {
  test("keeps the inline sidebar mounted while closing progress is still visible", () => {
    expect(resolveCodexSidebarMotionMounted({ logicalOpen: true, progress: 0 })).toBeTrue();
    expect(resolveCodexSidebarMotionMounted({ logicalOpen: false, progress: 0.25 })).toBeTrue();
    expect(resolveCodexSidebarMotionMounted({ logicalOpen: false, progress: 0 })).toBeFalse();
  });

  test("defaults collapse to hover suppression and allows explicit opt-out", () => {
    expect(resolveCodexSidebarMotionSetOpen({
      nextOpen: false,
      reducedMotion: false,
    }).suppressHoverOpen).toBeTrue();
    expect(resolveCodexSidebarMotionSetOpen({
      nextOpen: false,
      reducedMotion: false,
      suppressHoverOpen: false,
    }).suppressHoverOpen).toBeFalse();
    expect(resolveCodexSidebarMotionSetOpen({
      nextOpen: true,
      reducedMotion: false,
    }).suppressHoverOpen).toBeFalse();
  });

  test("snaps reduced-motion and animate false updates to the target progress", () => {
    const reducedMotionResolution = resolveCodexSidebarMotionSetOpen({
      nextOpen: true,
      animate: true,
      reducedMotion: true,
    });
    expect(reducedMotionResolution.targetProgress).toBe(1);
    expect(reducedMotionResolution.shouldAnimate).toBeFalse();

    const nonAnimatedResolution = resolveCodexSidebarMotionSetOpen({
      nextOpen: false,
      animate: false,
      reducedMotion: false,
    });
    expect(nonAnimatedResolution.targetProgress).toBe(0);
    expect(nonAnimatedResolution.shouldAnimate).toBeFalse();
  });

  test("ignores stale animation completions after a newer toggle generation starts", () => {
    expect(shouldCommitCodexSidebarMotionCompletion({
      completionGeneration: 3,
      currentGeneration: 4,
    })).toBeFalse();
    expect(shouldCommitCodexSidebarMotionCompletion({
      completionGeneration: 4,
      currentGeneration: 4,
    })).toBeTrue();
  });
});
