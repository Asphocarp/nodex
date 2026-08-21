import { describe, expect, test } from "vitest";
import {
  getNodexHomeMarkGlyphScene,
  NODEX_HOME_MARK_HELLO_BOUNDARIES,
  NODEX_HOME_MARK_HELLO_DURATION_FRAMES,
  NODEX_HOME_MARK_LOADER_DURATION_FRAMES,
  resolveNodexHomeMarkHelloFrame,
  resolveNodexHomeMarkLoaderFrame,
} from "./nodex-home-mark-glyph-performance";

const millisecondsAtFrame = (frame: number) => (frame / 60) * 1_000;

describe("Nodex home mark glyph performance", () => {
  test("uses the approved hello scene at every authored boundary", () => {
    for (const boundary of NODEX_HOME_MARK_HELLO_BOUNDARIES) {
      expect(resolveNodexHomeMarkHelloFrame(millisecondsAtFrame(boundary.atFrame)).sceneId).toBe(
        boundary.sceneId,
      );
    }
    expect(
      resolveNodexHomeMarkHelloFrame(millisecondsAtFrame(NODEX_HOME_MARK_HELLO_DURATION_FRAMES)),
    ).toEqual({
      complete: true,
      frame: NODEX_HOME_MARK_HELLO_DURATION_FRAMES,
      nextChangeMs: 0,
      sceneId: "prompt",
    });
  });

  test("holds the loader cursor for twenty frames before every hard cut", () => {
    expect(resolveNodexHomeMarkLoaderFrame(millisecondsAtFrame(19.99)).sceneId).toBe("prompt");
    expect(resolveNodexHomeMarkLoaderFrame(millisecondsAtFrame(20)).sceneId).toBe(
      "prompt-no-cursor",
    );
    expect(resolveNodexHomeMarkLoaderFrame(millisecondsAtFrame(40)).sceneId).toBe("prompt");
    expect(
      resolveNodexHomeMarkLoaderFrame(millisecondsAtFrame(NODEX_HOME_MARK_LOADER_DURATION_FRAMES))
        .complete,
    ).toBe(true);
  });

  test("keeps every generated scene inside the one-draw-call shader budget", () => {
    const sceneIds = [
      "prompt",
      "prompt-no-cursor",
      ...new Set(NODEX_HOME_MARK_HELLO_BOUNDARIES.map(({ sceneId }) => sceneId)),
    ] as const;
    for (const sceneId of sceneIds) {
      const scene = getNodexHomeMarkGlyphScene(sceneId);
      expect(scene.segments.length).toBeLessThanOrEqual(9);
      expect(scene.svgPaths.length).toBeLessThanOrEqual(3);
    }
    expect(getNodexHomeMarkGlyphScene("prompt").segments).toHaveLength(3);
    expect(getNodexHomeMarkGlyphScene("prompt-no-cursor").segments).toHaveLength(2);
    expect(getNodexHomeMarkGlyphScene("code").svgPaths).toHaveLength(3);
  });
});
