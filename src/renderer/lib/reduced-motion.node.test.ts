import { describe, expect, test } from "vite-plus/test";
import { normalizeReducedMotionPreference, resolveReducedMotionPreference } from "./reduced-motion";

describe("reduced motion preference", () => {
  test("normalizes persisted values", () => {
    expect(normalizeReducedMotionPreference("system")).toBe("system");
    expect(normalizeReducedMotionPreference("on")).toBe("on");
    expect(normalizeReducedMotionPreference("off")).toBe("off");
    expect(normalizeReducedMotionPreference("reduce")).toBe("system");
    expect(normalizeReducedMotionPreference(null)).toBe("system");
  });

  test.each([
    ["system", false, false],
    ["system", true, true],
    ["on", false, true],
    ["on", true, true],
    ["off", false, false],
    ["off", true, false],
  ] as const)("resolves %s against OS=%s", (preference, os, expected) => {
    expect(resolveReducedMotionPreference(preference, os)).toBe(expected);
  });
});
