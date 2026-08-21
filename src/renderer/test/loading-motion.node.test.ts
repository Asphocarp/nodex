import { describe, expect, test } from "vite-plus/test";

import { normalizeLoadingAnimation } from "./loading-motion";

describe("loading motion diagnostics", () => {
  test("normalizes timing, properties, target identity, and hidden ancestry", () => {
    const ancestor = {
      getAttribute: () => null,
      parentElement: null,
      tagName: "SECTION",
    } as unknown as Element;
    const target = {
      getAttribute: (name: string) => (name === "role" ? "status" : null),
      parentElement: ancestor,
      tagName: "SPAN",
    } as unknown as Element;
    const effect = {
      getComputedTiming: () => ({
        delay: 600,
        duration: 1_000,
        iterations: 1,
      }),
      getKeyframes: () => [
        { offset: 0, transform: "translateX(0)", opacity: "0" },
        { offset: 1, transform: "translateX(1px)", opacity: "1" },
      ],
      pseudoElement: "::before",
      target,
    };
    const animation = {
      currentTime: 725,
      effect,
      playState: "running",
    } as unknown as Animation;

    const normalized = normalizeLoadingAnimation(animation, (element) => ({
      display: "block",
      opacity: element === ancestor ? "0" : "1",
      visibility: "visible",
    }));

    expect(normalized).toEqual({
      animatedProperties: ["opacity", "transform"],
      currentTimeMs: 725,
      delayMs: 600,
      durationMs: 1_000,
      hiddenByAncestor: true,
      iterationCount: 1,
      playState: "running",
      pseudoElement: "::before",
      target: 'span[role="status"]',
    });
  });
});
